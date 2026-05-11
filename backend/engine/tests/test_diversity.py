from backend.shared import Gene, load_fixture
from backend.engine.gp.diversity import topology_diversity_score


def test_identical_population_has_zero_diversity():
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    population = [gene.copy() for _ in range(5)]
    score = topology_diversity_score(population)
    assert score == 0.0


def test_all_different_topologies_has_high_diversity():
    topologies = [
        "fixed_pipeline",
        "ai_orchestrated",
        "debate",
        "parallel_reduce",
        "human_in_loop",
        "hybrid",
    ]
    population = [Gene.from_dict(load_fixture(t)) for t in topologies]
    score = topology_diversity_score(population)
    assert score > 0.5


def test_diversity_score_between_0_and_1():
    population = [
        Gene.from_dict(load_fixture("fixed_pipeline")),
        Gene.from_dict(load_fixture("fixed_pipeline")),
        Gene.from_dict(load_fixture("debate")),
    ]
    score = topology_diversity_score(population)
    assert 0.0 <= score <= 1.0
