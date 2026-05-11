import pytest
from backend.shared.experiment import (
    ExperimentConfig,
    ObjectiveWeights,
    EvaluatorConfig,
)


def test_objective_weights_must_sum_to_one():
    with pytest.raises(ValueError):
        ObjectiveWeights(quality=0.5, cost=0.3, speed=0.3)  # sums to 1.1


def test_objective_weights_valid():
    w = ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2)
    assert abs(w.quality + w.cost + w.speed - 1.0) < 1e-9


def test_experiment_config_defaults():
    config = ExperimentConfig(
        name="test-exp",
        task_description="Summarize documents",
        dataset_id="ds_001",
        evaluators=[
            EvaluatorConfig(
                type="llm_judge",
                params={"model": "gpt-4o", "rubric": "Rate 0-1 on accuracy."},
            )
        ],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
    )
    assert config.population_size == 20
    assert config.concurrency == 5
    assert config.convergence_patience == 10


def test_experiment_config_roundtrip(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    config = ExperimentConfig(
        name="test-exp",
        task_description="Summarize documents",
        dataset_id="ds_001",
        evaluators=[
            EvaluatorConfig(
                type="llm_judge",
                params={"model": "gpt-4o", "rubric": "Rate 0-1 on accuracy."},
            )
        ],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
        population_size=30,
        budget_max_trials=500,
    )
    d = config.to_dict()
    config2 = ExperimentConfig.from_dict(d)
    assert config2.name == config.name
    assert config2.population_size == 30
    assert config2.objective_weights.quality == 0.6
