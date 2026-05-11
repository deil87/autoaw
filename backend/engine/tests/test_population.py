import pytest
from unittest.mock import patch
from backend.shared import Gene, ExperimentConfig, ObjectiveWeights, EvaluatorConfig
from backend.engine.gp.population import seed_population
from backend.engine.gp.diversity import topology_diversity_score


def make_config(population_size=6):
    return ExperimentConfig(
        name="test",
        task_description="Summarize documents",
        dataset_id="ds_001",
        evaluators=[
            EvaluatorConfig(
                type="llm_judge", params={"model": "gpt-4o-mini", "rubric": "Rate 0-1."}
            )
        ],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
        population_size=population_size,
    )


def test_seed_population_returns_correct_count(monkeypatch):
    monkeypatch.setattr(
        "backend.engine.gp.population._generate_gene_with_llm",
        lambda task, topology: None,
    )
    config = make_config(population_size=6)
    pop = seed_population(config)
    assert len(pop) == 6


def test_seed_population_all_valid_genes(monkeypatch):
    monkeypatch.setattr(
        "backend.engine.gp.population._generate_gene_with_llm",
        lambda task, topology: None,
    )
    from backend.shared.validator import validate_gene

    config = make_config(population_size=6)
    pop = seed_population(config)
    for gene in pop:
        validate_gene(gene.to_dict())


def test_seed_population_has_topology_diversity(monkeypatch):
    monkeypatch.setattr(
        "backend.engine.gp.population._generate_gene_with_llm",
        lambda task, topology: None,
    )
    config = make_config(population_size=12)
    pop = seed_population(config)
    score = topology_diversity_score(pop)
    assert score > 0.0  # should have at least some variety
