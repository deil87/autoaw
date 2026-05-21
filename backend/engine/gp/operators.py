from __future__ import annotations
import os
import random
from backend.shared.gene import Gene, Agent, Edge, TopologyType
from backend.engine.llm_client import ProviderConfig, make_client, provider_from_env

_DEFAULT_ALLOWED_MODELS = ["gpt-4o-mini", "gpt-4o"]


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
    choices = ["add_agent", "swap_topology"]
    if len(g.agents) > 1:
        choices.append("remove_agent")
    if len(g.edges) > 0:
        choices.append("rewire_edge")

    action = random.choice(choices)

    if action == "add_agent":
        new_id = f"a{len(g.agents)}"
        g.agents.append(
            Agent(
                id=new_id,
                role=random.choice(
                    ["analyst", "critic", "writer", "researcher", "synthesizer"]
                ),
                model=random.choice(models),
                system_prompt="You assist with tasks assigned to you. Be helpful and precise.",
                temperature=round(random.uniform(0.3, 0.9), 2),
            )
        )
        if g.agents:
            source = random.choice(g.agents[:-1])
            g.edges.append(
                Edge(from_agent=source.id, to_agent=new_id, type="sequential")
            )

    elif action == "remove_agent":
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
        topologies = list(TopologyType)
        topologies.remove(g.topology)
        g.topology = random.choice(topologies)
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
    """Apply Gaussian perturbation to temperature of one random agent."""
    g = gene.copy()
    agent = random.choice(g.agents)
    delta = random.gauss(0, 0.1)
    agent.temperature = max(0.0, min(1.0, round(agent.temperature + delta, 3)))
    return g


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
            "You are a quality critic. Review the previous agent's output for "
            "accuracy, completeness, and logical consistency. Flag any issues."
        ),
        temperature=0.3,
    ))
    for e in g.edges:
        if e.from_agent == target.id:
            e.from_agent = critic_id
    g.edges.append(Edge(from_agent=target.id, to_agent=critic_id, type="sequential"))
    return g


def mutate_expand(
    gene: Gene,
    n: int | None = None,
    allowed_models: list[str] | None = None,
) -> Gene:
    """Expand one randomly chosen agent into n specialised subtask agents (1 → n)."""
    models = allowed_models if allowed_models else _DEFAULT_ALLOWED_MODELS
    g = gene.copy()
    if not g.agents:
        return g
    n = n if n is not None else random.randint(2, 4)
    source = random.choice(g.agents)
    specialist_roles = ["researcher", "analyst", "writer", "synthesizer", "drafter"]
    new_agents = [
        Agent(
            id=f"{source.id}_sub{i}",
            role=random.choice(specialist_roles),
            model=random.choice(models),
            system_prompt=f"Handle specialised subtask derived from: {source.system_prompt}",
            temperature=round(random.uniform(0.3, 0.8), 2),
        )
        for i in range(n)
    ]
    for e in g.edges:
        if e.to_agent == source.id:
            e.to_agent = new_agents[0].id
    g.edges = [e for e in g.edges if e.from_agent != source.id]
    g.agents = [a for a in g.agents if a.id != source.id] + new_agents
    return g


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
        role="synthesizer",
        model=from_agent.model,
        system_prompt=(
            f"Handle generalised task combining: [{from_agent.system_prompt}] "
            f"and [{to_agent.system_prompt}]"
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
    return g


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
