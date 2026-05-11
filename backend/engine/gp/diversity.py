from __future__ import annotations
from collections import Counter
from backend.shared.gene import Gene


def topology_diversity_score(population: list[Gene]) -> float:
    """Measure structural diversity in a population.

    Returns a value in [0, 1] where 0 = all identical topologies,
    1 = all different topologies. Uses normalized Shannon entropy
    over topology type distribution.
    """
    if len(population) <= 1:
        return 0.0

    import math

    counts = Counter(g.topology.value for g in population)
    n = len(population)
    num_types = len(counts)

    if num_types == 1:
        return 0.0

    entropy = -sum((c / n) * math.log2(c / n) for c in counts.values())
    max_entropy = math.log2(num_types)
    return entropy / max_entropy if max_entropy > 0 else 0.0
