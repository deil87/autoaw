from __future__ import annotations
import math
import re
import time
from collections import deque
from typing import Any
from openai import RateLimitError
from backend.shared.gene import Gene, TopologyType
from backend.shared.results import RunResult
from backend.engine.runner.base import WorkflowRunner
from backend.engine.llm_client import (
    ProviderConfig,
    make_client,
    provider_from_env,
    is_bedrock_model,
    is_ollama_model,
    bedrock_chat_with_retry,
    ollama_chat_with_retry,
    llm_cost_usd,
    _parse_retry_after,
    _MAX_RETRIES,
    _RETRY_BASE_DELAY,
    _RETRY_MAX_DELAY,
)
import logging

logger = logging.getLogger(__name__)


# ─── MemoryStore ─────────────────────────────────────────────────────────────

class MemoryStore:
    """Per-run memory state for all agents in a workflow execution.

    Three independent memory scopes live here:

    1. **Per-agent buffer** — a deque of (user, assistant) message pairs for
       each agent, respecting the agent's ``memory.window`` setting.
    2. **Per-agent summary** — a single-sentence LLM-compressed running summary
       for agents configured with ``{"type": "summary"}``.
    3. **Per-agent vector index** — a lightweight TF-IDF-inspired in-memory
       index of text chunks produced by each agent, used for semantic retrieval
       by agents configured with ``{"type": "vector", "top_k": K}``.
    4. **Shared scratchpad** — a gene-level plaintext key→value store written
       by agents during execution and read by all subsequent agents.
    """

    def __init__(self) -> None:
        self._buffer: dict[str, deque[tuple[str, str]]] = {}   # agent_id → [(user, assistant)]
        self._summary: dict[str, str] = {}                      # agent_id → running summary
        self._vector_index: list[tuple[str, str]] = []          # [(agent_id, chunk)]
        self.scratchpad: dict[str, str] = {}                    # shared key→value

    # ── Buffer ───────────────────────────────────────────────────────────────

    def buffer_add(self, agent_id: str, user: str, assistant: str, window: int) -> None:
        if agent_id not in self._buffer:
            self._buffer[agent_id] = deque(maxlen=window)
        buf = self._buffer[agent_id]
        buf.maxlen  # mypy hint
        # Recreate with updated maxlen if window changed
        if buf.maxlen != window:
            self._buffer[agent_id] = deque(list(buf)[-window:], maxlen=window)
        self._buffer[agent_id].append((user, assistant))

    def buffer_messages(self, agent_id: str) -> list[dict[str, str]]:
        """Return the buffered exchanges as a flat list of chat messages."""
        msgs: list[dict[str, str]] = []
        for user, assistant in self._buffer.get(agent_id, []):
            msgs.append({"role": "user", "content": user})
            msgs.append({"role": "assistant", "content": assistant})
        return msgs

    # ── Summary ──────────────────────────────────────────────────────────────

    def summary_get(self, agent_id: str) -> str | None:
        return self._summary.get(agent_id)

    def summary_set(self, agent_id: str, summary: str) -> None:
        self._summary[agent_id] = summary

    # ── Vector index ─────────────────────────────────────────────────────────

    def vector_index(self, agent_id: str, text: str) -> None:
        """Add text chunks from agent_id into the vector index."""
        for chunk in _chunk_text(text):
            self._vector_index.append((agent_id, chunk))

    def vector_retrieve(self, query: str, top_k: int) -> list[str]:
        """Return top-K chunks most relevant to query (TF-IDF cosine similarity)."""
        if not self._vector_index:
            return []
        query_vec = _tfidf_vector(query)
        scored = [
            (_cosine(query_vec, _tfidf_vector(chunk)), chunk)
            for _, chunk in self._vector_index
        ]
        scored.sort(key=lambda x: x[0], reverse=True)
        return [chunk for _, chunk in scored[:top_k] if _ > 0]

    # ── Scratchpad ───────────────────────────────────────────────────────────

    def scratchpad_context(self) -> str | None:
        """Format scratchpad as a readable context block, or None if empty."""
        if not self.scratchpad:
            return None
        lines = [f"- {k}: {v}" for k, v in self.scratchpad.items()]
        return "[Shared scratchpad]\n" + "\n".join(lines)


# ── Lightweight TF-IDF helpers (no external dependencies) ──────────────────

def _chunk_text(text: str, size: int = 200) -> list[str]:
    """Split text into ~size-word chunks."""
    words = text.split()
    return [" ".join(words[i : i + size]) for i in range(0, max(1, len(words)), size)]


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _tfidf_vector(text: str) -> dict[str, float]:
    tokens = _tokenize(text)
    freq: dict[str, float] = {}
    for t in tokens:
        freq[t] = freq.get(t, 0) + 1
    norm = math.sqrt(sum(v * v for v in freq.values())) or 1.0
    return {k: v / norm for k, v in freq.items()}


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    return sum(a.get(k, 0) * v for k, v in b.items())


class RawLLMRunner(WorkflowRunner):
    """Executes workflow genes using raw OpenAI-compatible chat completions.

    Supports fixed_pipeline and parallel_reduce topologies natively.
    Other topologies fall back to sequential execution.
    """

    def __init__(self, provider_config: ProviderConfig | None = None) -> None:
        self._provider_config = provider_config  # None = lazy env lookup on first call

    def _call_llm_once(
        self, model: str, messages: list[dict], temperature: float
    ) -> Any:
        """Single LLM call with no retry. Separated from _call_llm for testability."""
        if is_bedrock_model(model):
            return bedrock_chat_with_retry(model, messages, temperature)
        if is_ollama_model(model):
            return ollama_chat_with_retry(model, messages, temperature)
        cfg = self._provider_config or provider_from_env()
        client = make_client(cfg)
        return client.chat.completions.create(
            model=model, messages=messages, temperature=temperature
        )

    def _call_llm(self, model: str, messages: list[dict], temperature: float) -> Any:
        """Call _call_llm_once with exponential-backoff retry on RateLimitError."""
        delay = _RETRY_BASE_DELAY
        for attempt in range(_MAX_RETRIES + 1):
            try:
                return self._call_llm_once(model, messages, temperature)
            except RateLimitError as exc:
                if attempt == _MAX_RETRIES:
                    raise
                wait = min(_parse_retry_after(exc) or delay, _RETRY_MAX_DELAY)
                logger.warning(
                    "Rate limited on attempt %d/%d; waiting %.0fs before retry.",
                    attempt + 1,
                    _MAX_RETRIES,
                    wait,
                )
                time.sleep(wait)
                delay = min(delay * 2, _RETRY_MAX_DELAY)

    def run(self, gene: Gene, input: str) -> RunResult:
        start = time.monotonic()
        trace: list[dict] = []
        total_cost = 0.0
        total_tokens: dict[str, dict[str, int]] = {}
        store = MemoryStore()

        if gene.topology == TopologyType.AI_ORCHESTRATED:
            output = self._run_sequential_fallback(gene, input, trace, total_tokens, store)
        elif self._has_reduce_edges(gene):
            output = self._run_parallel_reduce(gene, input, trace, total_tokens, store)
        else:
            output = self._run_fixed_pipeline(gene, input, trace, total_tokens, store)

        for model, usage in total_tokens.items():
            total_cost += llm_cost_usd(model, usage["prompt"], usage["completion"])

        latency_ms = int((time.monotonic() - start) * 1000)
        return RunResult(
            output=output,
            token_usage=total_tokens,
            latency_ms=latency_ms,
            cost_usd=total_cost,
            trace=trace,
        )

    def _build_messages(
        self,
        agent,
        user_content: str,
        store: MemoryStore,
        gene: Gene,
    ) -> list[dict]:
        """Build the messages list for an LLM call, injecting memory context.

        Injection order (each part is only added if relevant):
          1. System prompt (+ summary prefix if memory.type=="summary")
          2. Buffer history messages (if memory.type=="buffer")
          3. Vector retrieved chunks (if memory.type=="vector"), injected as
             an assistant-style context message before the user turn
          4. Shared scratchpad context (if gene.shared_memory is active),
             prepended to the user message
          5. User message
        """
        mem = agent.memory
        mem_type = mem.get("type") if mem else None

        # Build system prompt, optionally with summary prefix
        system_content = agent.system_prompt
        if mem_type == "summary":
            summary = store.summary_get(agent.id)
            if summary:
                system_content = f"[Running context: {summary}]\n\n{system_content}"

        messages: list[dict] = [{"role": "system", "content": system_content}]

        # Inject buffer history before the current user turn
        if mem_type == "buffer":
            messages.extend(store.buffer_messages(agent.id))

        # Inject vector-retrieved chunks as a context block
        if mem_type == "vector":
            top_k = int(mem.get("top_k", 3))
            chunks = store.vector_retrieve(user_content, top_k)
            if chunks:
                context_block = "\n\n".join(f"[Retrieved context]\n{c}" for c in chunks)
                messages.append({"role": "assistant", "content": context_block})

        # Build user message, optionally prefixed with shared scratchpad
        final_user = user_content
        if gene.shared_memory.get("type") == "scratchpad":
            ctx = store.scratchpad_context()
            if ctx:
                final_user = f"{ctx}\n\n{user_content}"

        messages.append({"role": "user", "content": final_user})
        return messages

    def _update_memory(
        self,
        agent,
        user_content: str,
        response_content: str,
        store: MemoryStore,
        gene: Gene,
        total_tokens: dict[str, dict[str, int]],
    ) -> None:
        """Update MemoryStore after an agent call."""
        mem = agent.memory
        mem_type = mem.get("type") if mem else None

        if mem_type == "buffer":
            window = int(mem.get("window", 10))
            store.buffer_add(agent.id, user_content, response_content, window)

        elif mem_type == "summary":
            # Fire a cheap LLM call to compress the new exchange into a summary
            prev = store.summary_get(agent.id) or ""
            compress_prompt = (
                "Compress the following into a single concise sentence that captures "
                "the key facts. Return ONLY the sentence, nothing else.\n\n"
            )
            if prev:
                compress_prompt += f"Previous summary: {prev}\n\n"
            compress_prompt += f"New exchange:\nInput: {user_content}\nOutput: {response_content}"
            try:
                resp = self._call_llm(
                    "gpt-4o-mini",
                    [{"role": "user", "content": compress_prompt}],
                    temperature=0.0,
                )
                new_summary = resp.choices[0].message.content.strip()
                store.summary_set(agent.id, new_summary)
                usage = resp.usage
                mdl = "gpt-4o-mini"
                if mdl not in total_tokens:
                    total_tokens[mdl] = {"prompt": 0, "completion": 0}
                total_tokens[mdl]["prompt"] += usage.prompt_tokens
                total_tokens[mdl]["completion"] += usage.completion_tokens
            except Exception:
                logger.warning("summary memory compression call failed; skipping", exc_info=True)

        elif mem_type == "vector":
            store.vector_index(agent.id, response_content)

        # Write to shared scratchpad if gene-level scratchpad is active
        if gene.shared_memory.get("type") == "scratchpad":
            store.scratchpad[agent.id] = response_content[:500]  # truncate for brevity

    def _call_agent(
        self,
        agent,
        messages: list[dict],
        trace: list[dict],
        total_tokens: dict[str, dict[str, int]],
    ) -> str:
        response = self._call_llm(agent.model, messages, agent.temperature)
        content = response.choices[0].message.content
        usage = response.usage
        mdl = agent.model
        if mdl not in total_tokens:
            total_tokens[mdl] = {"prompt": 0, "completion": 0}
        total_tokens[mdl]["prompt"] += usage.prompt_tokens
        total_tokens[mdl]["completion"] += usage.completion_tokens
        trace.append({"agent_id": agent.id, "role": agent.role, "output": content})
        return content

    def _run_fixed_pipeline(self, gene, input, trace, total_tokens, store: MemoryStore) -> str:
        current_input = input
        ordered_agents = self._topological_order(gene)
        for agent in ordered_agents:
            messages = self._build_messages(agent, current_input, store, gene)
            user_for_memory = current_input
            current_input = self._call_agent(agent, messages, trace, total_tokens)
            self._update_memory(agent, user_for_memory, current_input, store, gene, total_tokens)
        return current_input

    def _has_reduce_edges(self, gene) -> bool:
        """Return True if the gene contains reduce-type edges, indicating a parallel fan-in pattern."""
        return any(e.type == "reduce" for e in gene.edges)

    def _run_parallel_reduce(self, gene, input, trace, total_tokens, store: MemoryStore) -> str:
        params = gene.topology_params
        reducer_id = params.get("reducer_id")
        parallel_ids = params.get("parallel_agent_ids", [])

        # Infer from reduce edges when topology_params is not set (e.g. mutation-produced genes)
        if not reducer_id or not parallel_ids:
            reduce_edges = [e for e in gene.edges if e.type == "reduce"]
            reducer_candidates = {e.to_agent for e in reduce_edges}
            if len(reducer_candidates) == 1:
                reducer_id = reducer_candidates.pop()
                parallel_ids = [e.from_agent for e in reduce_edges]
        agent_map = {a.id: a for a in gene.agents}

        parallel_outputs: list[str] = []
        for aid in parallel_ids:
            agent = agent_map.get(aid)
            if agent is None:
                logger.warning("parallel_reduce: agent id %r missing from gene, skipping", aid)
                continue
            messages = self._build_messages(agent, input, store, gene)
            out = self._call_agent(agent, messages, trace, total_tokens)
            self._update_memory(agent, input, out, store, gene, total_tokens)
            parallel_outputs.append(out)

        if reducer_id and reducer_id in agent_map:
            reducer = agent_map[reducer_id]
            combined = "\n\n---\n\n".join(parallel_outputs)
            user_content = f"Synthesize the following responses:\n\n{combined}"
            messages = self._build_messages(reducer, user_content, store, gene)
            result = self._call_agent(reducer, messages, trace, total_tokens)
            self._update_memory(reducer, user_content, result, store, gene, total_tokens)
            return result

        return parallel_outputs[-1] if parallel_outputs else ""

    def _run_sequential_fallback(self, gene, input, trace, total_tokens, store: MemoryStore) -> str:
        current_input = input
        for agent in gene.agents:
            messages = self._build_messages(agent, current_input, store, gene)
            out = self._call_agent(agent, messages, trace, total_tokens)
            self._update_memory(agent, current_input, out, store, gene, total_tokens)
            current_input = out
        return current_input

    def _topological_order(self, gene) -> list:
        """Return agents in edge-defined topological order, fallback to list order."""
        from collections import defaultdict, deque

        agent_map = {a.id: a for a in gene.agents}
        in_degree: dict[str, int] = {a.id: 0 for a in gene.agents}
        adjacency: dict[str, list[str]] = defaultdict(list)
        for edge in gene.edges:
            if edge.type == "sequential":
                adjacency[edge.from_agent].append(edge.to_agent)
                in_degree[edge.to_agent] = in_degree.get(edge.to_agent, 0) + 1
        queue = deque([aid for aid, deg in in_degree.items() if deg == 0])
        ordered = []
        while queue:
            aid = queue.popleft()
            if aid in agent_map:
                ordered.append(agent_map[aid])
            for nxt in adjacency[aid]:
                in_degree[nxt] -= 1
                if in_degree[nxt] == 0:
                    queue.append(nxt)
        # Include any agents not reached by edges
        seen = {a.id for a in ordered}
        ordered += [a for a in gene.agents if a.id not in seen]
        return ordered
