from __future__ import annotations
import json
import os
import random
from backend.shared.gene import (
    Gene, Agent, Edge, Subtask, TopologyType,
    AgentMetaType, TEMPERATURE_BOUNDS,
)
from backend.engine.llm_client import ProviderConfig, make_client, provider_from_env
from backend.shared.experiment import DEFAULT_CLOUD_MODELS

_DEFAULT_ALLOWED_MODELS = DEFAULT_CLOUD_MODELS


def _find_sinks(gene: Gene) -> list[Agent]:
    """Return agents with no outgoing edges — nodes that produce the final output."""
    from_ids = {e.from_agent for e in gene.edges}
    return [a for a in gene.agents if a.id not in from_ids]


def _ensure_single_sink(
    gene: Gene,
    allowed_models: list[str] | None = None,
) -> Gene:
    """If the gene has multiple sink nodes, add a synthesizer that collects them all.

    Called after any structural mutation that could fan out without reconnecting,
    guaranteeing the runner always has exactly one output node to read from.
    """
    models = allowed_models if allowed_models else _DEFAULT_ALLOWED_MODELS
    sinks = _find_sinks(gene)
    if len(sinks) <= 1:
        return gene
    sink_ids = [a.id for a in sinks]
    reducer_id = f"reducer_{'_'.join(sink_ids[:3])}"  # cap id length
    task_list = "\n".join(f"- {a.system_prompt}" for a in sinks)
    gene.agents.append(Agent(
        id=reducer_id,
        role="synthesizer",
        model=random.choice(models),
        system_prompt=(
            f"Synthesize the outputs of the following parallel tasks into one "
            f"coherent final response:\n{task_list}"
        ),
        meta_type=AgentMetaType.SYNTHESIZER,
        temperature=0.3,
    ))
    for sink_id in sink_ids:
        gene.edges.append(Edge(from_agent=sink_id, to_agent=reducer_id, type="reduce"))
    return gene


def _rewrite_prompt_with_llm(prompt: str, provider_config: ProviderConfig) -> str:
    """Call an LLM to rewrite a system prompt with diversity directive."""
    client = make_client(provider_config)
    meta_prompt = (
        "Rewrite the following system prompt to achieve the same goal but with a "
        "different phrasing, structure, and strategy. The rewrite must be meaningfully "
        "different — not just paraphrased. Return ONLY the rewritten prompt, no explanation.\n\n"
        f"Original prompt:\n{prompt}"
    )
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": meta_prompt}],
        temperature=0.9,
    )
    return response.choices[0].message.content.strip()


def mutate_structure(
    gene: Gene,
    provider_config: ProviderConfig | None = None,
    allowed_models: list[str] | None = None,
) -> Gene:
    """Randomly apply one structural mutation: add agent, remove agent, swap topology, or rewire edge."""
    models = allowed_models if allowed_models else _DEFAULT_ALLOWED_MODELS
    g = gene.copy()
    choices = ["swap_topology"]
    if len(g.agents) > 1:
        choices.append("remove_agent")
    if len(g.edges) > 0:
        choices.append("rewire_edge")

    action = random.choice(choices)

    if action == "remove_agent":
        removed = random.choice(g.agents)
        g.agents = [a for a in g.agents if a.id != removed.id]
        g.edges = [
            e
            for e in g.edges
            if e.from_agent != removed.id and e.to_agent != removed.id
        ]
        if "parallel_agent_ids" in g.topology_params:
            g.topology_params["parallel_agent_ids"] = [
                aid for aid in g.topology_params["parallel_agent_ids"]
                if aid != removed.id
            ]
        if g.topology_params.get("reducer_id") == removed.id:
            g.topology_params.pop("reducer_id")

    elif action == "swap_topology":
        other = [t for t in TopologyType if t != g.topology]
        g.topology = random.choice(other)
        g.topology_params = {}

    elif action == "rewire_edge":
        if g.edges:
            edge = random.choice(g.edges)
            agent_ids = [a.id for a in g.agents]
            edge.to_agent = random.choice(agent_ids)

    return g


def mutate_prompt(
    gene: Gene,
    provider_config: ProviderConfig | None = None,
    allowed_models: list[str] | None = None,
) -> Gene:
    """Select one random agent and rewrite its system prompt via LLM."""
    cfg = provider_config or provider_from_env()
    g = gene.copy()
    agent = random.choice(g.agents)
    agent.system_prompt = _rewrite_prompt_with_llm(agent.system_prompt, cfg)
    return g


def mutate_param(gene: Gene) -> Gene:
    """Apply Gaussian perturbation to temperature of one random agent, clamped to its meta type bounds."""
    g = gene.copy()
    agent = random.choice(g.agents)
    lo, hi = TEMPERATURE_BOUNDS[agent.meta_type] if agent.meta_type is not None else (0.0, 1.0)
    if lo == hi:
        # Fixed temperature (e.g. critic) — nothing to mutate
        return g
    delta = random.gauss(0, 0.1)
    agent.temperature = max(lo, min(hi, round(agent.temperature + delta, 3)))
    return g


def detect_subtasks(
    agent: Agent,
    provider_config: ProviderConfig | None = None,
    content: str | None = None,
) -> Agent:
    """Detect and populate subtasks for an agent (idempotent).

    Runs once per agent — skipped if agent.subtasks is already populated.
    Single-task prompts produce a one-entry list wrapping the full prompt, so
    callers can always assume agent.subtasks is non-empty after this runs.
    On LLM error falls back to the same single-entry behaviour.

    Args:
        agent: The agent to analyse.
        provider_config: LLM provider config; falls back to env vars if None.
        content: Override text to decompose. When omitted, agent.system_prompt
            is used. agent.system_prompt is preferred over raw task_description
            because generated prompts embed explicit numbered steps that the
            LLM can cleanly split into per-agent subtasks.
    """
    if agent.subtasks:
        return agent

    text = content if content is not None else agent.system_prompt

    system = (
        "You are a task decomposer. Split the given agent system prompt into "
        "the smallest distinct subtasks that could each be handled by a separate agent.\n"
        "Rules:\n"
        "- Numbered steps, bullet points, or named phases each become their own subtask.\n"
        "- Every subtask must be actionable by an independent agent.\n"
        "- Aim for 2–6 subtasks; only return exactly one entry if the task is truly atomic "
        "(a single indivisible action with no internal phases).\n"
        "Return a JSON object with key \"subtasks\": an array of objects, each with:\n"
        "  id: string (\"s0\", \"s1\", \"s2\" ...)\n"
        "  prompt: string (the isolated, self-contained subtask instruction)\n"
        "  depends_on: array of id strings (empty if independent)\n"
        "Return ONLY valid JSON, no explanation."
    )

    try:
        cfg = provider_config or provider_from_env()
        client = make_client(cfg)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": text},
            ],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        raw = json.loads(response.choices[0].message.content)
        agent.subtasks = [
            Subtask(id=s["id"], prompt=s["prompt"], depends_on=s.get("depends_on", []))
            for s in raw.get("subtasks", [])
        ]
    except Exception:
        pass

    # Fallback: always guarantee at least one subtask entry
    if not agent.subtasks:
        agent.subtasks = [Subtask(id="s0", prompt=agent.system_prompt)]

    return agent


def run_split_detection(
    gene: Gene,
    provider_config: ProviderConfig | None = None,
) -> Gene:
    """Run detect_subtasks on every agent in the gene.

    Idempotent — agents with subtasks already populated are skipped.
    Call this once when a gene enters the population for the first time.
    Each agent is decomposed against its own system_prompt, which for
    generated seed genes already embeds explicit numbered steps.
    """
    for agent in gene.agents:
        detect_subtasks(agent, provider_config)
    return gene


def mutate_inject_critique(
    gene: Gene,
    allowed_models: list[str] | None = None,
) -> Gene:
    """Insert a critic agent immediately after a randomly chosen non-critic agent (1 → 2)."""
    models = allowed_models if allowed_models else _DEFAULT_ALLOWED_MODELS
    g = gene.copy()
    candidates = [a for a in g.agents if a.role != "critic"]
    if not candidates:
        return g
    target = random.choice(candidates)
    critic_id = f"critic_{target.id}"
    g.agents.append(Agent(
        id=critic_id,
        role="critic",
        model=random.choice(models),
        system_prompt=(
            f"Evaluate whether the following output successfully completes this task: "
            f"{target.system_prompt}\n\n"
            f"Identify specific inaccuracies, gaps, or logical flaws. "
            f"If the output is satisfactory, confirm it and explain why."
        ),
        meta_type=AgentMetaType.CRITIC,
        temperature=0.0,
    ))
    for e in g.edges:
        if e.from_agent == target.id:
            e.from_agent = critic_id
    g.edges.append(Edge(from_agent=target.id, to_agent=critic_id, type="sequential"))
    return _ensure_single_sink(g, models)


def mutate_expand(
    gene: Gene,
    n: int | None = None,
    allowed_models: list[str] | None = None,
    provider_config: ProviderConfig | None = None,
) -> Gene:
    """Expand one randomly chosen agent into subtask agents derived from its task (1 → n).

    Each new agent's system_prompt is the isolated subtask prompt from detect_subtasks.
    If the source task is not decomposable (only one subtask detected), the gene is
    returned unchanged.
    """
    models = allowed_models if allowed_models else _DEFAULT_ALLOWED_MODELS
    g = gene.copy()
    if not g.agents:
        return g
    source = random.choice(g.agents)
    detect_subtasks(source, provider_config)
    subtasks = source.subtasks
    if len(subtasks) <= 1:
        return g
    selected = subtasks[:n] if n is not None else subtasks
    new_agents = [
        Agent(
            id=f"{source.id}_sub{i}",
            role="agent",
            model=random.choice(models),
            system_prompt=st.prompt,
            temperature=round(random.uniform(0.3, 0.8), 2),
        )
        for i, st in enumerate(selected)
    ]
    # Populate subtasks on sub-agents so future mutate_expand calls have
    # material to work with (chains of decomposition across generations).
    for a in new_agents:
        detect_subtasks(a, provider_config)
    for e in g.edges:
        if e.to_agent == source.id:
            e.to_agent = new_agents[0].id
    g.edges = [e for e in g.edges if e.from_agent != source.id]
    g.agents = [a for a in g.agents if a.id != source.id] + new_agents
    return _ensure_single_sink(g, models)


def mutate_compact(gene: Gene) -> Gene:
    """Merge two adjacent agents (connected by an edge) into one generalised agent (n → n-1)."""
    g = gene.copy()
    pairs = [(e.from_agent, e.to_agent) for e in g.edges]
    if not pairs:
        return g
    from_id, to_id = random.choice(pairs)
    from_agent = next((a for a in g.agents if a.id == from_id), None)
    to_agent = next((a for a in g.agents if a.id == to_id), None)
    if not from_agent or not to_agent:
        return g
    merged_id = f"merged_{from_id}_{to_id}"
    g.agents.append(Agent(
        id=merged_id,
        role="agent",
        model=from_agent.model,
        system_prompt=(
            f"Complete the following tasks in sequence:\n"
            f"1. {from_agent.system_prompt}\n"
            f"2. {to_agent.system_prompt}"
        ),
        temperature=round((from_agent.temperature + to_agent.temperature) / 2, 2),
    ))
    remove_ids = {from_id, to_id}
    g.agents = [a for a in g.agents if a.id not in remove_ids]
    g.edges = [e for e in g.edges if not (e.from_agent == from_id and e.to_agent == to_id)]
    for e in g.edges:
        if e.from_agent in remove_ids:
            e.from_agent = merged_id
        if e.to_agent in remove_ids:
            e.to_agent = merged_id
    return _ensure_single_sink(g)


def crossover_subgraph(gene1: Gene, gene2: Gene) -> tuple[Gene, Gene]:
    """Exchange agents (and their edges) between two parents at a random split point."""
    g1, g2 = gene1.copy(), gene2.copy()
    if not g1.agents or not g2.agents:
        return g1, g2

    split1 = random.randint(1, len(g1.agents))
    split2 = random.randint(1, len(g2.agents))

    # Swap agent tails
    tail1 = g1.agents[split1:]
    tail2 = g2.agents[split2:]
    g1.agents = g1.agents[:split1] + tail2
    g2.agents = g2.agents[:split2] + tail1

    # Rebuild edges to only reference existing agent ids
    ids1 = {a.id for a in g1.agents}
    ids2 = {a.id for a in g2.agents}
    g1.edges = [e for e in g1.edges if e.from_agent in ids1 and e.to_agent in ids1]
    g2.edges = [e for e in g2.edges if e.from_agent in ids2 and e.to_agent in ids2]

    # Purge stale agent references from topology_params
    for g, valid_ids in ((g1, ids1), (g2, ids2)):
        if "parallel_agent_ids" in g.topology_params:
            g.topology_params["parallel_agent_ids"] = [
                aid for aid in g.topology_params["parallel_agent_ids"]
                if aid in valid_ids
            ]
        if g.topology_params.get("reducer_id") not in valid_ids:
            g.topology_params.pop("reducer_id", None)

    return g1, g2


def crossover_prompt(gene1: Gene, gene2: Gene) -> tuple[Gene, Gene]:
    """Swap system prompts between agents with matching roles across two parents."""
    g1, g2 = gene1.copy(), gene2.copy()
    roles1 = {a.role: a for a in g1.agents}
    roles2 = {a.role: a for a in g2.agents}
    shared_roles = set(roles1.keys()) & set(roles2.keys())
    for role in shared_roles:
        if random.random() < 0.5:
            p1 = roles1[role].system_prompt
            p2 = roles2[role].system_prompt
            roles1[role].system_prompt = p2
            roles2[role].system_prompt = p1
    return g1, g2


_BUFFER_WINDOWS = [3, 5, 10, 20]
_VECTOR_TOP_KS = [1, 2, 3, 5]
_MEMORY_TYPES = ["stateless", "buffer", "summary", "vector"]


def mutate_memory(gene: Gene) -> Gene:
    """Mutate the memory configuration of a randomly selected agent.

    Operator behaviour:
    - Picks one agent at random.
    - Randomly assigns one of four per-agent memory types:
        * stateless ``{}``
        * buffer  ``{"type": "buffer", "window": N}``  — N ∈ {3, 5, 10, 20}
        * summary ``{"type": "summary"}``
        * vector  ``{"type": "vector", "top_k": K}``   — K ∈ {1, 2, 3, 5}
    - With 30% probability also toggles the gene-level shared scratchpad
      between off ``{}`` and active ``{"type": "scratchpad"}``.
    """
    g = gene.copy()
    if not g.agents:
        return g

    agent = random.choice(g.agents)
    mem_type = random.choice(_MEMORY_TYPES)

    if mem_type == "stateless":
        agent.memory = {}
    elif mem_type == "buffer":
        agent.memory = {"type": "buffer", "window": random.choice(_BUFFER_WINDOWS)}
    elif mem_type == "summary":
        agent.memory = {"type": "summary"}
    elif mem_type == "vector":
        agent.memory = {"type": "vector", "top_k": random.choice(_VECTOR_TOP_KS)}

    # 30% chance to toggle gene-level shared scratchpad
    if random.random() < 0.3:
        if g.shared_memory.get("type") == "scratchpad":
            g.shared_memory = {}
        else:
            g.shared_memory = {"type": "scratchpad"}

    return g
