from __future__ import annotations
import random
from backend.shared.gene import Gene, TopologyType
from backend.shared.experiment import ExperimentConfig
from backend.shared.fixtures import load_fixture, TOPOLOGY_FIXTURES


def _generate_gene_with_llm(task_description: str, topology: TopologyType) -> None:
    """Hook for LLM-assisted gene generation. Currently a no-op placeholder.

    In production, this calls an LLM with a diversity directive to produce
    a custom gene JSON for the given task and topology. The function mutates
    nothing and returns None — callers use the fixture-based path as fallback.
    """
    return None


def seed_population(config: ExperimentConfig) -> list[Gene]:
    """Generate an initial diverse population for a GP run.

    Strategy:
    - Cycle through all 6 topology types to ensure structural diversity.
    - Load canonical fixture for each topology as the seed genome.
    - Apply random param jitter (temperature) to introduce variation.
    - LLM-assisted generation is called as a hook (no-op in test/dev).
    """
    population: list[Gene] = []
    topology_cycle = [TopologyType(t) for t in TOPOLOGY_FIXTURES]

    for i in range(config.population_size):
        topology = topology_cycle[i % len(topology_cycle)]
        llm_result = _generate_gene_with_llm(config.task_description, topology)

        if llm_result is not None:
            gene = llm_result
        else:
            gene = Gene.from_dict(load_fixture(topology.value))
            gene.id = f"seed_{i:04d}"
            # Jitter temperatures for diversity
            for agent in gene.agents:
                agent.temperature = round(random.uniform(0.2, 0.9), 2)

        population.append(gene)

    return population
