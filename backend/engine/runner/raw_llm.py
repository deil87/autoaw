from __future__ import annotations
import time
from typing import Any
from openai import RateLimitError
from backend.shared.gene import Gene, TopologyType
from backend.shared.results import RunResult
from backend.engine.runner.base import WorkflowRunner
from backend.engine.llm_client import (
    ProviderConfig,
    make_client,
    provider_from_env,
    _parse_retry_after,
    _MAX_RETRIES,
    _RETRY_BASE_DELAY,
    _RETRY_MAX_DELAY,
)
import logging

logger = logging.getLogger(__name__)


# Cost per 1k tokens (prompt/completion) by model prefix
_COST_TABLE: dict[str, tuple[float, float]] = {
    "gpt-4o": (0.005, 0.015),
    "gpt-4o-mini": (0.000150, 0.000600),
    "gpt-4.1-nano": (0.000100, 0.000400),
    "gpt-4.1-mini": (0.000400, 0.001600),
    "claude-3-5-sonnet": (0.003, 0.015),
    "claude-3-haiku": (0.00025, 0.00125),
}


def _model_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    for prefix, (p_rate, c_rate) in _COST_TABLE.items():
        if model.startswith(prefix):
            return (prompt_tokens / 1000) * p_rate + (completion_tokens / 1000) * c_rate
    return 0.0


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

        if gene.topology == TopologyType.FIXED_PIPELINE:
            output = self._run_fixed_pipeline(gene, input, trace, total_tokens)
        elif gene.topology == TopologyType.PARALLEL_REDUCE:
            output = self._run_parallel_reduce(gene, input, trace, total_tokens)
        else:
            # Fallback: run agents sequentially by edge order
            output = self._run_sequential_fallback(gene, input, trace, total_tokens)

        for model, usage in total_tokens.items():
            total_cost += _model_cost(model, usage["prompt"], usage["completion"])

        latency_ms = int((time.monotonic() - start) * 1000)
        return RunResult(
            output=output,
            token_usage=total_tokens,
            latency_ms=latency_ms,
            cost_usd=total_cost,
            trace=trace,
        )

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

    def _run_fixed_pipeline(self, gene, input, trace, total_tokens) -> str:
        current_input = input
        ordered_agents = self._topological_order(gene)
        for agent in ordered_agents:
            messages = [
                {"role": "system", "content": agent.system_prompt},
                {"role": "user", "content": current_input},
            ]
            current_input = self._call_agent(agent, messages, trace, total_tokens)
        return current_input

    def _run_parallel_reduce(self, gene, input, trace, total_tokens) -> str:
        params = gene.topology_params
        reducer_id = params.get("reducer_id")
        parallel_ids = params.get("parallel_agent_ids", [])
        agent_map = {a.id: a for a in gene.agents}

        parallel_outputs: list[str] = []
        for aid in parallel_ids:
            agent = agent_map[aid]
            messages = [
                {"role": "system", "content": agent.system_prompt},
                {"role": "user", "content": input},
            ]
            parallel_outputs.append(
                self._call_agent(agent, messages, trace, total_tokens)
            )

        if reducer_id and reducer_id in agent_map:
            reducer = agent_map[reducer_id]
            combined = "\n\n---\n\n".join(parallel_outputs)
            messages = [
                {"role": "system", "content": reducer.system_prompt},
                {
                    "role": "user",
                    "content": f"Synthesize the following responses:\n\n{combined}",
                },
            ]
            return self._call_agent(reducer, messages, trace, total_tokens)

        return parallel_outputs[-1] if parallel_outputs else ""

    def _run_sequential_fallback(self, gene, input, trace, total_tokens) -> str:
        current_input = input
        for agent in gene.agents:
            messages = [
                {"role": "system", "content": agent.system_prompt},
                {"role": "user", "content": current_input},
            ]
            current_input = self._call_agent(agent, messages, trace, total_tokens)
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
