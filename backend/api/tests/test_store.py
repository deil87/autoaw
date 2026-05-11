import json
import os
import pytest
import tempfile
from backend.shared import (
    Gene,
    load_fixture,
    ExperimentConfig,
    ObjectiveWeights,
    EvaluatorConfig,
)
from backend.shared.results import RunResult, Score, ParetoPoint
from backend.engine.gp.loop import TrialResult
from backend.api.store import LocalStore


@pytest.fixture
def store(tmp_path):
    db_path = str(tmp_path / "test.db")
    s = LocalStore(db_path=db_path)
    s.init_db()
    return s


def make_config():
    return ExperimentConfig(
        name="test-exp",
        task_description="summarize",
        dataset_id="ds_001",
        evaluators=[EvaluatorConfig(type="function", params={})],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
    )


def make_trial_result():
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    return TrialResult(
        gene=gene,
        generation=0,
        input="test input",
        run_result=RunResult(
            output="ans", token_usage={}, latency_ms=100, cost_usd=0.001
        ),
        scores=[Score(quality=0.8)],
        pareto=ParetoPoint(quality=0.8, cost_usd=0.001, latency_ms=100),
        fitness=0.75,
    )


def test_create_and_get_experiment(store):
    exp_id = "exp_001"
    config = make_config()
    store.create_experiment(exp_id, config)
    result = store.get_experiment(exp_id)
    assert result["id"] == exp_id
    assert result["name"] == "test-exp"
    assert result["status"] == "pending"


def test_list_experiments(store):
    store.create_experiment("exp_001", make_config())
    store.create_experiment("exp_002", make_config())
    experiments = store.list_experiments()
    assert len(experiments) == 2
    ids = [e["id"] for e in experiments]
    assert "exp_001" in ids
    assert "exp_002" in ids


def test_update_experiment_status(store):
    store.create_experiment("exp_001", make_config())
    store.update_experiment_status("exp_001", "running")
    result = store.get_experiment("exp_001")
    assert result["status"] == "running"


def test_update_experiment_status_with_error(store):
    store.create_experiment("exp_001", make_config())
    store.update_experiment_status("exp_001", "failed", error="boom")
    result = store.get_experiment("exp_001")
    assert result["status"] == "failed"
    assert result["error_message"] == "boom"


def test_get_experiment_config(store):
    exp_id = "exp_001"
    config = make_config()
    store.create_experiment(exp_id, config)
    loaded = store.get_experiment_config(exp_id)
    assert isinstance(loaded, ExperimentConfig)
    assert loaded.name == "test-exp"


def test_put_and_list_trials(store):
    store.create_experiment("exp_001", make_config())
    trial = make_trial_result()
    store.put_trial_result("exp_001", trial)
    trials = store.list_trials("exp_001", page=1, limit=50)
    assert len(trials) == 1
    assert trials[0]["gene_id"] == trial.gene.id
    assert trials[0]["fitness"] == pytest.approx(0.75)


def test_put_best_gene(store):
    store.create_experiment("exp_001", make_config())
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    store.put_best_gene("exp_001", gene, fitness=0.88)
    result = store.get_experiment("exp_001")
    assert result["best_fitness"] == pytest.approx(0.88)
    best = json.loads(result["best_gene_json"])
    assert best["id"] == gene.id


def test_list_trials_pagination(store):
    store.create_experiment("exp_001", make_config())
    for _ in range(5):
        store.put_trial_result("exp_001", make_trial_result())
    page1 = store.list_trials("exp_001", page=1, limit=3)
    page2 = store.list_trials("exp_001", page=2, limit=3)
    assert len(page1) == 3
    assert len(page2) == 2
