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
    - If config.seed_gene is set, inject it at slot 0 with id "seed_user".
    - Cycle through all 6 topology types to fill remaining slots.
    - Load canonical fixture for each topology as the seed genome.
    - Apply random param jitter (temperature) to introduce variation.
    - LLM-assisted generation is called as a hook (no-op in test/dev).
    """
    population: list[Gene] = []
    topology_cycle = [TopologyType(t) for t in TOPOLOGY_FIXTURES]

    if config.seed_gene:
        user_gene = Gene.from_dict(config.seed_gene)
        user_gene.id = "seed_user"
        population.append(user_gene)

    start_i = len(population)
    for i in range(start_i, config.population_size):
        topology = topology_cycle[i % len(topology_cycle)]
        llm_result = _generate_gene_with_llm(config.task_description, topology)

        if llm_result is not None:
            gene = llm_result
        else:
            gene = Gene.from_dict(load_fixture(topology.value))
            gene.id = f"seed_{i:04d}"
            for agent in gene.agents:
                agent.temperature = round(random.uniform(0.2, 0.9), 2)

        population.append(gene)

    return population
