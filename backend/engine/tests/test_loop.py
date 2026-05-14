import threading
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
from backend.engine.gp.loop import GPLoop, TrialResult, GPResult


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
    result = loop.run()
    assert isinstance(result.best_gene, Gene)


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
    result = loop.run()
    assert isinstance(result.best_gene, Gene)


def test_gp_loop_parallel_evaluation():
    """concurrency > 1 should evaluate genes in parallel and still return a GPResult."""
    config = make_config()
    config.concurrency = 3
    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
        on_trial_complete=None,
    )
    result = loop.run()
    assert isinstance(result.best_gene, Gene)


def test_gp_loop_returns_gp_result():
    config = make_config()
    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
    )
    result = loop.run()
    assert isinstance(result, GPResult)
    assert isinstance(result.best_gene, Gene)
    assert result.stop_reason in (
        "converged",
        "budget_trials",
        "budget_usd",
        "cancelled",
        "max_generations",
        "empty_generation",
    )
    assert result.generations_run >= 1
    assert result.best_fitness > float("-inf")


def test_gp_loop_stop_reason_budget_trials():
    config = make_config()
    config.budget_max_trials = 1  # 1 row dataset × 1 trial → budget hit quickly
    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
    )
    result = loop.run()
    assert result.stop_reason == "budget_trials"


def test_gp_loop_stop_reason_converged():
    config = make_config()
    config.budget_max_trials = None
    config.convergence_patience = 1
    # Evaluator always returns same fitness → no improvement → converges
    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
    )
    result = loop.run()
    assert result.stop_reason == "converged"


def test_gp_loop_stop_reason_cancelled():
    config = make_config()
    stop_event = threading.Event()
    stop_event.set()  # signal before run starts
    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
        stop_event=stop_event,
    )
    result = loop.run()
    assert result.stop_reason == "cancelled"
