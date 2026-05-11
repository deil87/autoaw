# AutoAW Local Prototype Design

**Date:** 2026-05-11  
**Status:** Approved

## Goal

Replace the AWS-specific infrastructure (Lambda, DynamoDB, SQS, ECS) with a locally runnable stack so AutoAW can be cloned from GitHub and run without any cloud account. The optimization engine (GP loop, SMBO, runners, evaluators) is already built and remains unchanged except for one enhancement: parallel gene evaluation within a generation.

---

## Architecture

```
git clone https://github.com/…/autoaw
cp .env.example .env          # add OPENAI_API_KEY / ANTHROPIC_API_KEY
pip install -r requirements-local.txt
uvicorn backend.api.app:app --reload   # port 8000

cd frontend && npm install && npm run dev  # port 3000
```

Two processes, no Docker required:

- **Backend:** FastAPI app (`backend/api/`) on port 8000. Manages SQLite, REST API, and experiment execution via a thread pool.
- **Frontend:** Existing Next.js + shadcn/ui app (`frontend/`) on port 3000. Polls the API for experiment progress.

---

## Storage: SQLite

**File:** `autoaw.db` in the project root (git-ignored).  
**WAL mode** enabled at startup so multiple threads can write without blocking reads.  
**Connection policy:** Each thread creates its own `sqlite3` connection. Connections are never shared across threads.

### Schema

```sql
CREATE TABLE experiments (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    config_json TEXT NOT NULL,       -- ExperimentConfig serialized as JSON
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    best_gene_json TEXT,             -- NULL until GP+SMBO complete
    best_fitness   REAL,
    error_message  TEXT              -- populated on failure
);

CREATE TABLE trials (
    id            TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL REFERENCES experiments(id),
    generation    INTEGER NOT NULL,
    gene_id       TEXT NOT NULL,
    gene_json     TEXT NOT NULL,
    fitness       REAL NOT NULL,
    quality       REAL NOT NULL,
    cost_usd      REAL NOT NULL,
    latency_ms    INTEGER NOT NULL,
    created_at    TEXT NOT NULL
);
```

A `datasets/` directory in the project root holds uploaded dataset JSON files (list of `{"input": str, "expected": str}` objects), identified by `dataset_id` which is the filename stem.

---

## Parallelism

### Experiment-level

A module-level `ExperimentExecutor` wraps a `concurrent.futures.ThreadPoolExecutor`. `max_workers` defaults to `4`, configurable via `MAX_CONCURRENT_EXPERIMENTS` env var.

Starting an experiment (`POST /experiments/{id}/start`) submits the engine callable to this pool and returns immediately. The thread writes incremental progress (trial results, status updates) to SQLite as it runs.

### Trial-level (within an experiment)

`GPLoop` gains a `concurrency: int` parameter (already present in `ExperimentConfig`). When evaluating a generation, it uses a nested `ThreadPoolExecutor(max_workers=concurrency)` and `executor.map` to evaluate multiple genes simultaneously. Each gene evaluation is one `runner.run()` + `evaluator.score()` call — these are IO-bound (LLM API calls), so threads are appropriate.

The existing `GPLoop.run()` sequential loop is replaced with a parallel batch evaluation step. All operators, SMBO, runner adapters remain untouched.

---

## API Layer

**File:** `backend/api/app.py`  
**Framework:** FastAPI  
**CORS:** allow `http://localhost:3000`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns `{"status": "ok"}` |
| `POST` | `/experiments` | Create experiment (body: `ExperimentConfig`-shaped JSON + `dataset_id`) |
| `GET` | `/experiments` | List all experiments (id, name, status, created_at, best_fitness) |
| `GET` | `/experiments/{id}` | Get experiment detail including best gene |
| `POST` | `/experiments/{id}/start` | Submit to executor, set status=running |
| `DELETE` | `/experiments/{id}` | Cancel (if running) or delete |
| `GET` | `/experiments/{id}/trials` | List trials with pagination (`?page=1&limit=50`) |
| `POST` | `/datasets` | Upload a dataset JSON file (multipart) |
| `GET` | `/datasets` | List available datasets |

All endpoints return JSON. Errors return `{"detail": "..."}` with appropriate HTTP status.

### SQLite Store (local replacement for DynamoDB)

`backend/api/store.py` — `LocalStore` class with the same interface as `ExperimentStore` from `backend/engine/store/dynamodb.py`:

- `get_experiment_config(id) -> ExperimentConfig`
- `put_trial_result(experiment_id, result: TrialResult) -> None`
- `put_best_gene(experiment_id, gene, fitness) -> None`

Plus additional methods for the API:

- `create_experiment(id, config) -> None`
- `list_experiments() -> list[dict]`
- `get_experiment(id) -> dict`
- `update_experiment_status(id, status, error=None) -> None`
- `list_trials(experiment_id, page, limit) -> list[dict]`

The engine (`GPLoop`, `smbo_polish`) is injected with a `LocalStore` instance, replacing the `ExperimentStore` (DynamoDB). The engine's store interface is unchanged — only the implementation swaps.

---

## Environment Configuration

`.env.example`:
```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
MAX_CONCURRENT_EXPERIMENTS=4
DATABASE_PATH=autoaw.db
DATASETS_DIR=datasets
```

The app loads `.env` at startup via `python-dotenv` (falls back gracefully if not present). Env vars always take precedence over `.env` values.

---

## Frontend Changes

The frontend (`frontend/`) is already planned as Next.js + shadcn/ui. For local prototype, the only change from the original plan is:

- API base URL defaults to `http://localhost:8000` (configurable via `NEXT_PUBLIC_API_URL` env var)
- No AWS Cognito auth — unauthenticated access (local use only)
- Live updates via polling (`setInterval`, 2s) rather than WebSocket

The frontend is out of scope for this spec — it is addressed in Plan 04. This spec covers backend only.

---

## File Map

```
autoaw/
├── .env.example
├── requirements-local.txt          # fastapi, uvicorn, python-dotenv, + existing engine deps
├── backend/
│   ├── api/
│   │   ├── __init__.py
│   │   ├── app.py                  # FastAPI app, CORS, lifespan (DB init)
│   │   ├── store.py                # LocalStore (SQLite)
│   │   ├── executor.py             # ExperimentExecutor (ThreadPoolExecutor)
│   │   └── tests/
│   │       ├── __init__.py
│   │       ├── test_store.py
│   │       ├── test_executor.py
│   │       └── test_api.py
│   └── engine/
│       └── gp/
│           └── loop.py             # Modified: parallel gene evaluation via ThreadPoolExecutor
└── datasets/                       # git-ignored; holds uploaded dataset JSON files
```

---

## What Does NOT Change

- `backend/shared/` — gene schema, experiment config, results — untouched
- `backend/engine/runner/` — untouched
- `backend/engine/evaluator/` — untouched
- `backend/engine/gp/operators.py`, `diversity.py`, `population.py` — untouched
- `backend/engine/smbo/` — untouched
- `backend/engine/store/dynamodb.py` — kept for future cloud deployment; not deleted

The `backend/engine/main.py` ECS entrypoint also stays; it is the cloud path. The local path is `backend/api/executor.py` calling the same `GPLoop` and `smbo_polish` directly.

---

## Out of Scope for This Spec

- Frontend implementation (Plan 04)
- Cloud deployment (original Plans 03 / infra)
- Authentication / multi-user
- Real-time WebSocket progress (polling is sufficient for prototype)
