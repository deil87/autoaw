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


def test_executor_submits_and_tracks_experiment(store, tmp_path):
    datasets_dir = str(tmp_path / "datasets")
    import os

    os.makedirs(datasets_dir)
    import json

    dataset_path = os.path.join(datasets_dir, "ds_test.json")
    with open(dataset_path, "w") as f:
        json.dump([{"input": "hello", "expected": "hi"}], f)

    executor = ExperimentExecutor(store=store, datasets_dir=datasets_dir, max_workers=2)

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


def test_executor_sets_failed_on_error(store, tmp_path):
    """If dataset_id doesn't exist, experiment should be marked failed."""
    datasets_dir = str(tmp_path / "datasets_empty")
    import os

    os.makedirs(datasets_dir)

    executor = ExperimentExecutor(store=store, datasets_dir=datasets_dir, max_workers=2)

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


def test_executor_shutdown(store, tmp_path):
    datasets_dir = str(tmp_path / "datasets")
    import os

    os.makedirs(datasets_dir)
    executor = ExperimentExecutor(store=store, datasets_dir=datasets_dir, max_workers=2)
    executor.shutdown()  # should not raise
