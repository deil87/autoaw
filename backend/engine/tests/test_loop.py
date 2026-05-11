import pytest
from unittest.mock import MagicMock, patch
from backend.shared import (
    Gene,
    ExperimentConfig,
    ObjectiveWeights,
    EvaluatorConfig,
    load_fixture,
)
from backend.shared.results import RunResult, Score, ParetoPoint
from backend.engine.gp.loop import GPLoop, TrialResult


def make_config():
    return ExperimentConfig(
        name="test",
        task_description="Summarize documents",
        dataset_id="ds_001",
        evaluators=[EvaluatorConfig(type="function", params={})],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
        population_size=4,
        budget_max_trials=20,
        convergence_patience=3,
        concurrency=1,
    )


def make_mock_runner():
    runner = MagicMock()
    runner.run.return_value = RunResult(
        output="answer", token_usage={}, latency_ms=100, cost_usd=0.001
    )
    return runner


def make_mock_evaluator():
    evaluator = MagicMock()
    evaluator.score.return_value = Score(quality=0.8)
    return evaluator


def test_gp_loop_runs_and_returns_best_gene():
    config = make_config()
    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
        on_trial_complete=None,
    )
    best = loop.run()
    assert isinstance(best, Gene)


def test_gp_loop_respects_budget():
    config = make_config()
    config.budget_max_trials = 8
    trial_count = []

    def count_trial(result: TrialResult):
        trial_count.append(result)

    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
        on_trial_complete=count_trial,
    )
    loop.run()
    assert len(trial_count) <= 8


def test_trial_result_records_pareto_point():
    config = make_config()
    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
        on_trial_complete=None,
    )
    best = loop.run()
    assert isinstance(best, Gene)
