import time
import pytest
import tempfile
from backend.shared import ExperimentConfig, ObjectiveWeights, EvaluatorConfig
from backend.api.store import LocalStore
from backend.api.executor import ExperimentExecutor


@pytest.fixture
def store(tmp_path):
    db_path = str(tmp_path / "test.db")
    s = LocalStore(db_path=db_path)
    s.init_db()
    return s


def make_config():
    return ExperimentConfig(
        name="test",
        task_description="test task",
        dataset_id="ds_test",
        evaluators=[EvaluatorConfig(type="function", params={})],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
        population_size=2,
        budget_max_trials=4,
        convergence_patience=2,
        concurrency=2,
    )


def test_executor_submits_and_tracks_experiment(store, tmp_path, monkeypatch):
    datasets_dir = str(tmp_path / "datasets")
    import os, json

    os.makedirs(datasets_dir)
    monkeypatch.setenv("DATASETS_DIR", datasets_dir)
    monkeypatch.delenv("DATASETS_BUCKET", raising=False)

    dataset_path = os.path.join(datasets_dir, "ds_test.json")
    with open(dataset_path, "w") as f:
        json.dump([{"input": "hello", "expected": "hi"}], f)

    executor = ExperimentExecutor(store=store, max_workers=2)

    config = make_config()
    exp_id = "exp_test_001"
    store.create_experiment(exp_id, config)

    executor.submit(exp_id)

    # Wait up to 30s for completion
    for _ in range(60):
        exp = store.get_experiment(exp_id)
        if exp["status"] in ("completed", "failed"):
            break
        time.sleep(0.5)

    exp = store.get_experiment(exp_id)
    assert exp["status"] in ("completed", "failed"), (
        f"Unexpected status: {exp['status']}"
    )


def test_executor_sets_failed_on_error(store, tmp_path, monkeypatch):
    """If dataset_id doesn't exist, experiment should be marked failed."""
    datasets_dir = str(tmp_path / "datasets_empty")
    import os

    os.makedirs(datasets_dir)
    monkeypatch.setenv("DATASETS_DIR", datasets_dir)
    monkeypatch.delenv("DATASETS_BUCKET", raising=False)

    executor = ExperimentExecutor(store=store, max_workers=2)

    config = make_config()  # dataset_id="ds_test" — file won't exist
    exp_id = "exp_fail_001"
    store.create_experiment(exp_id, config)
    executor.submit(exp_id)

    for _ in range(20):
        exp = store.get_experiment(exp_id)
        if exp["status"] == "failed":
            break
        time.sleep(0.5)

    exp = store.get_experiment(exp_id)
    assert exp["status"] == "failed"
    assert exp["error_message"] is not None


def test_executor_shutdown(store):
    executor = ExperimentExecutor(store=store, max_workers=2)
    executor.shutdown()  # should not raise


def test_executor_passes_stop_reason_to_store(tmp_path):
    """Executor should call put_best_gene with stop_reason from GPResult, not fitness=0.0."""
    import json
    import threading
    from unittest.mock import MagicMock, patch
    from backend.engine.gp.loop import GPResult
    from backend.shared import Gene, load_fixture
    from backend.api.executor import _run_experiment

    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    gp_result = GPResult(
        best_gene=gene,
        stop_reason="converged",
        generations_run=5,
        best_fitness=0.91,
    )

    mock_store = MagicMock()
    mock_store.get_experiment_config.return_value = make_config()

    with (
        patch("backend.engine.gp.loop.GPLoop") as MockGP,
        patch("backend.engine.smbo.polish.smbo_polish", return_value=gene),
        patch("backend.api.executor._build_runner"),
        patch("backend.api.executor._build_evaluators"),
        patch("backend.api.executor.load_dataset", return_value=[{"input": "x", "expected": "y"}]),
    ):
        mock_loop_instance = MagicMock()
        mock_loop_instance.run.return_value = gp_result
        MockGP.return_value = mock_loop_instance

        _run_experiment("exp_001", mock_store, threading.Event())

    mock_store.put_best_gene.assert_called_once()
    args, kwargs = mock_store.put_best_gene.call_args
    # Support both positional and keyword args
    all_args = list(args) + list(kwargs.values())
    stop_reason_passed = kwargs.get("stop_reason") or (
        args[3] if len(args) > 3 else None
    )
    fitness_passed = kwargs.get("fitness") or (args[2] if len(args) > 2 else None)
    assert stop_reason_passed == "converged", (
        f"Expected stop_reason='converged', got {stop_reason_passed!r}"
    )
    assert fitness_passed != 0.0, (
        "fitness should be the real GPResult.best_fitness, not 0.0"
    )


def test_progress_written_to_store(tmp_path, monkeypatch):
    """Executor wires on_progress → store.update_progress()."""
    import json, threading
    from unittest.mock import MagicMock, patch
    from backend.api.store import LocalStore
    from backend.api.executor import _run_experiment
    from backend.shared.experiment import ExperimentConfig, ObjectiveWeights

    store = LocalStore(str(tmp_path / "test.db"))
    store.init_db()
    config = ExperimentConfig(
        name="prog-test",
        task_description="t",
        dataset_id="ds1",
        evaluators=[],
        objective_weights=ObjectiveWeights(0.7, 0.2, 0.1),
        population_size=1,
        convergence_patience=1,
        concurrency=1,
    )
    store.create_experiment("exp_wire_001", config)

    # Write a minimal dataset file
    ds_dir = str(tmp_path)
    (tmp_path / "ds1.json").write_text(
        json.dumps([{"input": f"q{i}", "expected": "a"} for i in range(12)])
    )

    progress_snapshots = []
    original_update = store.update_progress

    def capture_progress(exp_id, prog):
        progress_snapshots.append(dict(prog))
        original_update(exp_id, prog)

    monkeypatch.setattr(store, "update_progress", capture_progress)
    monkeypatch.setattr(store, "put_best_gene", MagicMock())

    # Mock runner + evaluator so no real LLM calls happen
    with (
        patch("backend.api.executor._build_runner") as mock_runner_factory,
        patch("backend.api.executor._build_evaluators") as mock_eval_factory,
        patch("backend.engine.smbo.polish.smbo_polish") as mock_smbo,
        patch("backend.engine.llm_client.provider_from_env", return_value="github"),
        patch("backend.api.executor.load_dataset", return_value=json.loads((tmp_path / "ds1.json").read_text())),
    ):
        mock_run = MagicMock(output="x", token_usage={}, latency_ms=5, cost_usd=0.0)
        mock_runner_factory.return_value.run.return_value = mock_run
        mock_score = MagicMock()
        mock_score.quality = 0.5
        mock_score.metadata = {}
        mock_eval_factory.return_value = [
            MagicMock(score=MagicMock(return_value=mock_score))
        ]
        mock_smbo.return_value = MagicMock(id="g_smbo")

        _run_experiment("exp_wire_001", store, threading.Event())

    # With 12 rows and heartbeat every 10, at least one progress call expected
    assert len(progress_snapshots) >= 1
    assert progress_snapshots[0]["rows_done"] == 10
    assert progress_snapshots[0]["rows_total"] == 12
