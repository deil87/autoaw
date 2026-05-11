from unittest.mock import MagicMock
from backend.shared import (
    Gene,
    ExperimentConfig,
    ObjectiveWeights,
    EvaluatorConfig,
    load_fixture,
)
from backend.shared.results import RunResult, Score
from backend.engine.smbo.polish import smbo_polish


def make_config():
    return ExperimentConfig(
        name="test",
        task_description="Summarize",
        dataset_id="ds_001",
        evaluators=[EvaluatorConfig(type="function", params={})],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
        budget_max_trials=10,
    )


def make_mock_runner():
    runner = MagicMock()
    runner.run.return_value = RunResult(
        output="ans", token_usage={}, latency_ms=100, cost_usd=0.001
    )
    return runner


def make_mock_evaluator():
    ev = MagicMock()
    ev.score.return_value = Score(quality=0.85)
    return ev


def test_smbo_polish_returns_gene():
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    result = smbo_polish(
        gene=gene,
        config=make_config(),
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc", "expected": "summary"}],
        n_trials=5,
    )
    assert isinstance(result, Gene)


def test_smbo_polish_temperatures_in_range():
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    result = smbo_polish(
        gene=gene,
        config=make_config(),
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc", "expected": "summary"}],
        n_trials=5,
    )
    for agent in result.agents:
        assert 0.0 <= agent.temperature <= 1.0
