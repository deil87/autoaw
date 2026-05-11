from __future__ import annotations
import copy
import random
from backend.shared.gene import Gene, Agent, Edge, TopologyType


def _rewrite_prompt_with_llm(prompt: str) -> str:
    """Call an LLM to rewrite a system prompt with diversity directive."""
    import openai

    client = openai.OpenAI()
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


def mutate_structure(gene: Gene) -> Gene:
    """Randomly apply one structural mutation: add agent, remove agent, swap topology, or rewire edge."""
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
                model=random.choice(["gpt-4o-mini", "gpt-4o"]),
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


def mutate_prompt(gene: Gene) -> Gene:
    """Select one random agent and rewrite its system prompt via LLM."""
    g = gene.copy()
    agent = random.choice(g.agents)
    agent.system_prompt = _rewrite_prompt_with_llm(agent.system_prompt)
    return g


def mutate_param(gene: Gene) -> Gene:
    """Apply Gaussian perturbation to temperature of one random agent."""
    g = gene.copy()
    agent = random.choice(g.agents)
    delta = random.gauss(0, 0.1)
    agent.temperature = max(0.0, min(1.0, round(agent.temperature + delta, 3)))
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
