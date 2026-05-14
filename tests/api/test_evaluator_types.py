from fastapi.testclient import TestClient
from backend.api.app import app

client = TestClient(app)


def test_get_evaluator_types_returns_list():
    resp = client.get("/evaluator-types")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 11


def test_evaluator_type_has_required_fields():
    resp = client.get("/evaluator-types")
    for entry in resp.json():
        assert "type" in entry
        assert "name" in entry
        assert "description" in entry
        assert "category" in entry
        assert "params" in entry


def test_benchmark_has_evaluators_field():
    resp = client.get("/benchmarks")
    assert resp.status_code == 200
    for b in resp.json():
        assert "evaluators" in b
        assert isinstance(b["evaluators"], list)


def test_workbench_benchmark_uses_workbench_evaluator():
    resp = client.get("/benchmarks")
    wb = next(b for b in resp.json() if b["id"] == "workbench")
    types = [e["type"] for e in wb["evaluators"]]
    assert "workbench" in types


def test_create_experiment_without_evaluator_type():
    # evaluator_type is no longer a valid field in the request
    payload = {
        "name": "test",
        "task_description": "test task",
        "dataset_id": "ds1",
        "evaluators": [
            {
                "type": "llm_judge",
                "params": {"model": "gpt-4o-mini", "rubric": "score it"},
            }
        ],
        "objective_weights": {"quality": 0.6, "cost": 0.2, "speed": 0.2},
    }
    resp = client.post("/experiments", json=payload)
    assert resp.status_code == 201
