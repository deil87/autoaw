import json
import io
import os
import pytest
import tempfile
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test.db")
    datasets_dir = str(tmp_path / "datasets")
    os.makedirs(datasets_dir)
    monkeypatch.setenv("DATABASE_PATH", db_path)
    monkeypatch.setenv("DATASETS_DIR", datasets_dir)
    monkeypatch.setenv("MAX_CONCURRENT_EXPERIMENTS", "2")

    from backend.api import app as app_module
    import importlib

    importlib.reload(app_module)
    from backend.api.app import app, _store

    _store.init_db()

    with TestClient(app) as c:
        yield c


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_create_experiment(client):
    payload = {
        "name": "test experiment",
        "task_description": "summarize documents",
        "dataset_id": "ds_001",
        "evaluators": [
            {
                "type": "llm_judge",
                "params": {"model": "gpt-4o-mini", "rubric": "Rate 0-1."},
            }
        ],
        "objective_weights": {"quality": 0.6, "cost": 0.2, "speed": 0.2},
        "population_size": 10,
        "budget_max_trials": 50,
        "concurrency": 3,
    }
    resp = client.post("/experiments", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert "id" in data
    assert data["status"] == "pending"


def test_list_experiments(client):
    payload = {
        "name": "exp1",
        "task_description": "task",
        "dataset_id": "ds_001",
        "evaluators": [{"type": "function", "params": {"fn_path": "some.fn"}}],
        "objective_weights": {"quality": 0.6, "cost": 0.2, "speed": 0.2},
    }
    client.post("/experiments", json=payload)
    resp = client.get("/experiments")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_get_experiment(client):
    payload = {
        "name": "exp_get",
        "task_description": "task",
        "dataset_id": "ds_001",
        "evaluators": [{"type": "function", "params": {"fn_path": "some.fn"}}],
        "objective_weights": {"quality": 0.6, "cost": 0.2, "speed": 0.2},
    }
    create_resp = client.post("/experiments", json=payload)
    exp_id = create_resp.json()["id"]
    resp = client.get(f"/experiments/{exp_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == exp_id


def test_start_experiment(client, tmp_path):
    # Create dataset file first
    datasets_dir = os.environ.get("DATASETS_DIR", str(tmp_path / "datasets"))
    os.makedirs(datasets_dir, exist_ok=True)
    dataset_path = os.path.join(datasets_dir, "ds_001.json")
    with open(dataset_path, "w") as f:
        json.dump([{"input": "hello", "expected": "hi"}], f)

    payload = {
        "name": "exp_start",
        "task_description": "task",
        "dataset_id": "ds_001",
        "evaluators": [{"type": "function", "params": {"fn_path": "some.fn"}}],
        "objective_weights": {"quality": 0.6, "cost": 0.2, "speed": 0.2},
    }
    create_resp = client.post("/experiments", json=payload)
    exp_id = create_resp.json()["id"]

    with patch("backend.api.app._executor") as mock_exec:
        resp = client.post(f"/experiments/{exp_id}/start")
        assert resp.status_code == 200
        mock_exec.submit.assert_called_once_with(exp_id)


def test_get_experiment_not_found(client):
    resp = client.get("/experiments/nonexistent")
    assert resp.status_code == 404


def test_upload_dataset(client, tmp_path):
    datasets_dir = os.environ.get("DATASETS_DIR", str(tmp_path / "datasets"))
    os.makedirs(datasets_dir, exist_ok=True)
    data = json.dumps([{"input": "q", "expected": "a"}]).encode()
    resp = client.post(
        "/datasets",
        files={"file": ("mydata.json", io.BytesIO(data), "application/json")},
    )
    assert resp.status_code == 201
    assert resp.json()["dataset_id"] == "mydata"


def test_list_datasets(client, tmp_path):
    datasets_dir = os.environ.get("DATASETS_DIR", str(tmp_path / "datasets"))
    os.makedirs(datasets_dir, exist_ok=True)
    with open(os.path.join(datasets_dir, "ds_a.json"), "w") as f:
        f.write("[]")
    resp = client.get("/datasets")
    assert resp.status_code == 200
    ids = [d["dataset_id"] for d in resp.json()]
    assert "ds_a" in ids


def test_get_dataset_returns_records(client):
    import os, json

    datasets_dir = os.environ.get("DATASETS_DIR", "datasets")
    os.makedirs(datasets_dir, exist_ok=True)
    records = [{"input": "hello", "expected": "world"}]
    with open(os.path.join(datasets_dir, "myds.json"), "w") as f:
        json.dump(records, f)
    resp = client.get("/datasets/myds")
    assert resp.status_code == 200
    assert resp.json() == records


def test_get_dataset_not_found(client):
    resp = client.get("/datasets/nonexistent")
    assert resp.status_code == 404
    assert "nonexistent" in resp.json()["detail"]


def test_list_trials(client):
    payload = {
        "name": "exp_trials",
        "task_description": "task",
        "dataset_id": "ds_001",
        "evaluators": [{"type": "function", "params": {"fn_path": "some.fn"}}],
        "objective_weights": {"quality": 0.6, "cost": 0.2, "speed": 0.2},
    }
    create_resp = client.post("/experiments", json=payload)
    exp_id = create_resp.json()["id"]
    resp = client.get(f"/experiments/{exp_id}/trials")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_create_experiment_workbench_fields(client):
    """runner_type and evaluator_type round-trip through config."""
    payload = {
        "name": "wb test",
        "task_description": "workplace tasks",
        "dataset_id": "workbench",
        "evaluators": [{"type": "workbench", "params": {}}],
        "objective_weights": {"quality": 0.7, "cost": 0.2, "speed": 0.1},
        "runner_type": "workbench",
        "evaluator_type": "workbench",
    }
    resp = client.post("/experiments", json=payload)
    assert resp.status_code == 201
    exp = resp.json()
    config = json.loads(exp["config_json"])
    assert config["runner_type"] == "workbench"
    assert config["evaluator_type"] == "workbench"
