from __future__ import annotations
import json
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(".env.local", override=True)
load_dotenv(".env")  # fallback for CI/prod where .env.local may not exist

from backend.shared.experiment import (
    ExperimentConfig,
    ObjectiveWeights,
    EvaluatorConfig,
)
from backend.shared.evaluator_catalog import CATALOG
from backend.api.executor import ExperimentExecutor
from backend.api.dataset_store import load_dataset, save_dataset, list_dataset_ids, dataset_exists

_DB_PATH = os.environ.get("DATABASE_PATH", "autoaw.db")
_MAX_WORKERS = int(os.environ.get("MAX_CONCURRENT_EXPERIMENTS", "4"))

if os.environ.get("STORE_BACKEND") == "dynamo":
    from backend.api.dynamo_store import DynamoStore
    _store = DynamoStore()
else:
    from backend.api.store import LocalStore
    _store = LocalStore(db_path=_DB_PATH)

_executor = ExperimentExecutor(
    store=_store, max_workers=_MAX_WORKERS
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if hasattr(_store, 'init_db'):
        _store.init_db()
    yield
    _executor.shutdown(wait=False)


app = FastAPI(title="AutoAW", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://d32ilmniiyvkjt.cloudfront.net",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3032",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic request models ───────────────────────────────────────────────────


class EvaluatorConfigIn(BaseModel):
    type: str
    params: dict[str, Any] = {}


class ObjectiveWeightsIn(BaseModel):
    quality: float
    cost: float
    speed: float


class CreateExperimentRequest(BaseModel):
    name: str
    task_description: str
    dataset_id: str
    evaluators: list[EvaluatorConfigIn]
    objective_weights: ObjectiveWeightsIn
    population_size: int = 20
    budget_max_trials: int | None = None
    budget_max_usd: float | None = None
    convergence_patience: int = 10
    concurrency: int = 5
    runner_type: str = "raw_llm"
    dataset_sample_size: int | None = None


# ── Routes ────────────────────────────────────────────────────────────────────

_BENCHMARKS = [
    {
        "id": "workbench",
        "name": "WorkBench",
        "description": (
            "690 workplace tasks (calendar, email, database, files). "
            "Evaluated by tool-call trace matching."
        ),
        "paper_url": "https://arxiv.org/abs/2405.00823",
        "dataset_id": "workbench",
        "runner_type": "workbench",
        "evaluators": [{"type": "workbench", "params": {}}],
        "default_objective": {
            "quality_weight": 0.7,
            "cost_weight": 0.2,
            "speed_weight": 0.1,
        },
        "task_count": 690,
    },
    {
        "id": "swe-bench",
        "name": "SWE-bench",
        "description": (
            "GitHub issue resolution across real Python repos. "
            "Evaluated by LLM patch-quality judge against ground-truth fixes."
        ),
        "paper_url": "https://www.swebench.com",
        "dataset_id": "swebench",
        "runner_type": "swebench",
        "evaluators": [{"type": "swebench", "params": {"model": "gpt-4o-mini"}}],
        "default_objective": {
            "quality_weight": 0.6,
            "cost_weight": 0.2,
            "speed_weight": 0.2,
        },
        "task_count": 300,
    },
]


@app.get("/benchmarks")
def list_benchmarks():
    return _BENCHMARKS


@app.get("/evaluator-types")
def list_evaluator_types():
    return [e.to_dict() for e in CATALOG]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/experiments", status_code=201)
def create_experiment(req: CreateExperimentRequest):
    exp_id = f"exp_{uuid.uuid4().hex[:12]}"
    config = ExperimentConfig(
        name=req.name,
        task_description=req.task_description,
        dataset_id=req.dataset_id,
        evaluators=[
            EvaluatorConfig(type=e.type, params=e.params) for e in req.evaluators
        ],
        objective_weights=ObjectiveWeights(
            quality=req.objective_weights.quality,
            cost=req.objective_weights.cost,
            speed=req.objective_weights.speed,
        ),
        population_size=req.population_size,
        budget_max_trials=req.budget_max_trials,
        budget_max_usd=req.budget_max_usd,
        convergence_patience=req.convergence_patience,
        concurrency=req.concurrency,
        runner_type=req.runner_type,
        dataset_sample_size=req.dataset_sample_size,
    )
    _store.create_experiment(exp_id, config)
    return _store.get_experiment(exp_id)


@app.get("/experiments")
def list_experiments():
    return _store.list_experiments()


@app.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: str):
    try:
        return _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )


@app.post("/experiments/{experiment_id}/start")
def start_experiment(experiment_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    _executor.submit(experiment_id)
    return {"status": "submitted", "experiment_id": experiment_id}


@app.post("/experiments/{experiment_id}/stop")
def stop_experiment(experiment_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    _executor.stop(experiment_id)
    _store.update_experiment_status(experiment_id, "cancelled")
    return {"status": "stopping", "experiment_id": experiment_id}


@app.delete("/experiments/{experiment_id}", status_code=204)
def delete_experiment(experiment_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    _store.update_experiment_status(experiment_id, "cancelled")


@app.get("/experiments/{experiment_id}/trials/{trial_id}")
def get_trial(experiment_id: str, trial_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    trial = _store.get_trial(experiment_id, trial_id)
    if trial is None:
        raise HTTPException(status_code=404, detail=f"Trial {trial_id!r} not found")
    return trial


@app.get("/experiments/{experiment_id}/trials/{trial_id}/eval-rows")
def get_trial_eval_rows(experiment_id: str, trial_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    trial = _store.get_trial(experiment_id, trial_id)
    if trial is None:
        raise HTTPException(status_code=404, detail=f"Trial {trial_id!r} not found")
    return _store.get_eval_rows(trial_id)


@app.get("/experiments/{experiment_id}/lineage")
def get_experiment_lineage(experiment_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    trials = _store.list_trials_lineage(experiment_id)
    for t in trials:
        t["parent_gene_ids"] = json.loads(t.get("parent_gene_ids") or "[]")
    return trials


@app.get("/experiments/{experiment_id}/trials")
def list_trials(
    experiment_id: str,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    return _store.list_trials(experiment_id, page=page, limit=limit)


@app.post("/datasets", status_code=201)
async def upload_dataset(file: UploadFile = File(...)):
    dataset_id = os.path.splitext(file.filename)[0]
    content = await file.read()
    try:
        parsed = json.loads(content)
        if not isinstance(parsed, list):
            raise HTTPException(status_code=422, detail="Dataset must be a JSON array")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"Invalid JSON: {e}")
    save_dataset(dataset_id, content)
    return {"dataset_id": dataset_id, "records": len(parsed)}


@app.get("/datasets")
def list_datasets_route():
    return [{"dataset_id": did} for did in list_dataset_ids()]


@app.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str):
    if not dataset_exists(dataset_id):
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id!r} not found")
    return load_dataset(dataset_id)
