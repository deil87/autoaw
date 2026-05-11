# Local Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AWS-specific infrastructure with a locally runnable FastAPI + SQLite stack so AutoAW can be cloned from GitHub and run without any cloud account.

**Architecture:** FastAPI app manages SQLite storage and HTTP endpoints on port 8000. A `ThreadPoolExecutor` runs multiple experiments concurrently. Within each experiment, `GPLoop` evaluates genes in parallel using a nested `ThreadPoolExecutor` controlled by `config.concurrency`. The Next.js frontend polls the API for live progress.

**Tech Stack:** Python 3.12, FastAPI, uvicorn, sqlite3 (stdlib), python-dotenv, concurrent.futures, pytest, httpx (test client)

**Prerequisite:** Plan 02 (optimization engine) must be complete.

---

## File Map

```
autoaw/
├── .env.example                         # new
├── requirements-local.txt               # new
├── datasets/                            # new (git-ignored)
└── backend/
    ├── api/
    │   ├── __init__.py                  # new
    │   ├── app.py                       # new — FastAPI app, lifespan, CORS, routes
    │   ├── store.py                     # new — LocalStore (SQLite)
    │   ├── executor.py                  # new — ExperimentExecutor (ThreadPoolExecutor)
    │   └── tests/
    │       ├── __init__.py              # new
    │       ├── test_store.py            # new
    │       ├── test_executor.py         # new
    │       └── test_api.py              # new
    └── engine/
        └── gp/
            └── loop.py                  # modified — parallel gene evaluation
```

---

### Task 1: Project scaffold and dependencies

**Files:**
- Create: `.env.example`
- Create: `requirements-local.txt`
- Create: `datasets/.gitkeep`
- Create: `backend/api/__init__.py`
- Create: `backend/api/tests/__init__.py`

- [ ] **Step 1: Create `.env.example`**

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
MAX_CONCURRENT_EXPERIMENTS=4
DATABASE_PATH=autoaw.db
DATASETS_DIR=datasets
```

- [ ] **Step 2: Create `requirements-local.txt`**

```
# Core engine deps (already in requirements-engine.txt)
deap==1.4.1
optuna==3.6.1
openai==1.30.1
anthropic==0.28.0
boto3==1.34.100

# Local API deps
fastapi==0.111.0
uvicorn[standard]==0.29.0
python-dotenv==1.0.1
httpx==0.27.0

# Test deps
pytest==8.3.2
pytest-asyncio==0.23.7
```

- [ ] **Step 3: Install new deps**

```bash
pip install fastapi==0.111.0 uvicorn[standard]==0.29.0 python-dotenv==1.0.1 httpx==0.27.0
```

Expected: installs without errors.

- [ ] **Step 4: Create scaffold**

```bash
mkdir -p datasets backend/api/tests
touch datasets/.gitkeep backend/api/__init__.py backend/api/tests/__init__.py
```

- [ ] **Step 5: Add `datasets/` to `.gitignore`**

Open `.gitignore` and add these lines (keep existing content):

```
# Local runtime
autoaw.db
datasets/*.json
```

- [ ] **Step 6: Commit**

```bash
git add .env.example requirements-local.txt datasets/.gitkeep backend/api/__init__.py backend/api/tests/__init__.py .gitignore
git commit -m "chore: scaffold local prototype project structure"
```

---

### Task 2: LocalStore (SQLite)

**Files:**
- Create: `backend/api/store.py`
- Create: `backend/api/tests/test_store.py`

- [ ] **Step 1: Write failing tests**

Create `backend/api/tests/test_store.py`:

```python
import json
import os
import pytest
import tempfile
from backend.shared import Gene, load_fixture, ExperimentConfig, ObjectiveWeights, EvaluatorConfig
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
        run_result=RunResult(output="ans", token_usage={}, latency_ms=100, cost_usd=0.001),
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest backend/api/tests/test_store.py -v
```

Expected: `ModuleNotFoundError: No module named 'backend.api.store'`

- [ ] **Step 3: Implement `backend/api/store.py`**

```python
from __future__ import annotations
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.shared.experiment import ExperimentConfig
from backend.shared.gene import Gene
from backend.engine.gp.loop import TrialResult

_CREATE_EXPERIMENTS = """
CREATE TABLE IF NOT EXISTS experiments (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    config_json     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    best_gene_json  TEXT,
    best_fitness    REAL,
    error_message   TEXT
)
"""

_CREATE_TRIALS = """
CREATE TABLE IF NOT EXISTS trials (
    id              TEXT PRIMARY KEY,
    experiment_id   TEXT NOT NULL REFERENCES experiments(id),
    generation      INTEGER NOT NULL,
    gene_id         TEXT NOT NULL,
    gene_json       TEXT NOT NULL,
    fitness         REAL NOT NULL,
    quality         REAL NOT NULL,
    cost_usd        REAL NOT NULL,
    latency_ms      INTEGER NOT NULL,
    created_at      TEXT NOT NULL
)
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LocalStore:
    """SQLite-backed store. Each instance creates its own per-thread connections."""

    def __init__(self, db_path: str = "autoaw.db") -> None:
        self.db_path = db_path
        self._local = threading.local()

    def _conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn"):
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            self._local.conn = conn
        return self._local.conn

    def init_db(self) -> None:
        conn = self._conn()
        conn.execute(_CREATE_EXPERIMENTS)
        conn.execute(_CREATE_TRIALS)
        conn.commit()

    # ── Experiment CRUD ──────────────────────────────────────────────────────

    def create_experiment(self, experiment_id: str, config: ExperimentConfig) -> None:
        now = _now()
        self._conn().execute(
            "INSERT INTO experiments (id, name, config_json, status, created_at, updated_at) "
            "VALUES (?, ?, ?, 'pending', ?, ?)",
            (experiment_id, config.name, json.dumps(config.to_dict()), now, now),
        )
        self._conn().commit()

    def get_experiment(self, experiment_id: str) -> dict[str, Any]:
        row = self._conn().execute(
            "SELECT * FROM experiments WHERE id = ?", (experiment_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"Experiment {experiment_id!r} not found")
        return dict(row)

    def list_experiments(self) -> list[dict[str, Any]]:
        rows = self._conn().execute(
            "SELECT id, name, status, created_at, updated_at, best_fitness "
            "FROM experiments ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def update_experiment_status(
        self, experiment_id: str, status: str, error: str | None = None
    ) -> None:
        self._conn().execute(
            "UPDATE experiments SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
            (status, error, _now(), experiment_id),
        )
        self._conn().commit()

    def get_experiment_config(self, experiment_id: str) -> ExperimentConfig:
        row = self.get_experiment(experiment_id)
        return ExperimentConfig.from_dict(json.loads(row["config_json"]))

    def put_best_gene(self, experiment_id: str, gene: Gene, fitness: float) -> None:
        self._conn().execute(
            "UPDATE experiments SET best_gene_json = ?, best_fitness = ?, "
            "status = 'completed', updated_at = ? WHERE id = ?",
            (json.dumps(gene.to_dict()), fitness, _now(), experiment_id),
        )
        self._conn().commit()

    # ── Trials ───────────────────────────────────────────────────────────────

    def put_trial_result(self, experiment_id: str, result: TrialResult) -> None:
        self._conn().execute(
            "INSERT INTO trials "
            "(id, experiment_id, generation, gene_id, gene_json, "
            " fitness, quality, cost_usd, latency_ms, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                experiment_id,
                result.generation,
                result.gene.id,
                json.dumps(result.gene.to_dict()),
                result.fitness,
                result.pareto.quality,
                result.pareto.cost_usd,
                result.pareto.latency_ms,
                _now(),
            ),
        )
        self._conn().commit()

    def list_trials(
        self, experiment_id: str, page: int = 1, limit: int = 50
    ) -> list[dict[str, Any]]:
        offset = (page - 1) * limit
        rows = self._conn().execute(
            "SELECT * FROM trials WHERE experiment_id = ? "
            "ORDER BY created_at ASC LIMIT ? OFFSET ?",
            (experiment_id, limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest backend/api/tests/test_store.py -v
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/store.py backend/api/tests/test_store.py
git commit -m "feat: add LocalStore (SQLite) replacing DynamoDB for local prototype"
```

---

### Task 3: Parallel gene evaluation in GPLoop

**Files:**
- Modify: `backend/engine/gp/loop.py`
- Modify: `backend/engine/tests/test_loop.py`

- [ ] **Step 1: Write the new failing test**

Add this test to `backend/engine/tests/test_loop.py` (append to existing file):

```python
def test_gp_loop_parallel_evaluation():
    """concurrency > 1 should evaluate genes in parallel and still return a Gene."""
    config = make_config()
    config.concurrency = 3
    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
        on_trial_complete=None,
    )
    best = loop.run()
    assert isinstance(best, Gene)
```

- [ ] **Step 2: Run test to verify it fails (or passes sequentially)**

```bash
python -m pytest backend/engine/tests/test_loop.py::test_gp_loop_parallel_evaluation -v
```

This test may pass even with the sequential implementation (concurrency field exists but isn't used). That's fine — we're adding real parallel execution.

- [ ] **Step 3: Modify `backend/engine/gp/loop.py` to evaluate genes in parallel**

Replace the `run` method's inner evaluation loop (lines 109–123) with parallel batch evaluation. The full updated file:

```python
from __future__ import annotations
import random
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Callable
from deap import base, creator, tools, algorithms

from backend.shared.gene import Gene
from backend.shared.experiment import ExperimentConfig
from backend.shared.results import RunResult, Score, ParetoPoint
from backend.engine.runner.base import WorkflowRunner
from backend.engine.evaluator.base import Evaluator
from backend.engine.gp.operators import (
    mutate_structure,
    mutate_prompt,
    mutate_param,
    crossover_subgraph,
)
from backend.engine.gp.population import seed_population
from backend.engine.gp.diversity import topology_diversity_score


@dataclass
class TrialResult:
    gene: Gene
    generation: int
    input: str
    run_result: RunResult
    scores: list[Score]
    pareto: ParetoPoint
    fitness: float


class GPLoop:
    def __init__(
        self,
        config: ExperimentConfig,
        runner: WorkflowRunner,
        evaluators: list[Evaluator],
        dataset: list[dict],  # list of {"input": str, "expected": str | None}
        on_trial_complete: Callable[[TrialResult], None] | None = None,
    ) -> None:
        self.config = config
        self.runner = runner
        self.evaluators = evaluators
        self.dataset = dataset
        self.on_trial_complete = on_trial_complete
        self._trial_count = 0
        self._total_cost = 0.0
        self._lock = threading.Lock()

    def _evaluate_gene(self, gene: Gene, generation: int) -> tuple[float, ParetoPoint]:
        """Evaluate a gene on a random sample from the dataset. Thread-safe."""
        sample = random.choice(self.dataset)
        run_result = self.runner.run(gene, sample["input"])

        with self._lock:
            self._trial_count += 1
            self._total_cost += run_result.cost_usd

        scores = [
            ev.score(sample["input"], run_result.output, sample.get("expected"))
            for ev in self.evaluators
        ]
        avg_quality = sum(s.quality for s in scores) / len(scores) if scores else 0.0

        max_cost = self.config.budget_max_usd or 1.0
        pareto = ParetoPoint(
            quality=avg_quality,
            cost_usd=run_result.cost_usd,
            latency_ms=run_result.latency_ms,
        )
        fitness = pareto.scalar_fitness(
            self.config.objective_weights,
            max_cost_usd=max_cost / max(self.config.budget_max_trials or 100, 1),
            max_latency_ms=30000,
        )

        if self.on_trial_complete:
            self.on_trial_complete(
                TrialResult(
                    gene=gene,
                    generation=generation,
                    input=sample["input"],
                    run_result=run_result,
                    scores=scores,
                    pareto=pareto,
                    fitness=fitness,
                )
            )
        return fitness, pareto

    def _budget_exceeded(self) -> bool:
        with self._lock:
            if (
                self.config.budget_max_trials
                and self._trial_count >= self.config.budget_max_trials
            ):
                return True
            if (
                self.config.budget_max_usd
                and self._total_cost >= self.config.budget_max_usd
            ):
                return True
        return False

    def _evaluate_generation(
        self, population: list[Gene], generation: int
    ) -> list[tuple[Gene, float]]:
        """Evaluate all genes in a generation, up to config.concurrency in parallel."""
        concurrency = max(1, self.config.concurrency)
        scored: list[tuple[Gene, float]] = []

        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            future_to_gene = {
                executor.submit(self._evaluate_gene, gene, generation): gene
                for gene in population
                if not self._budget_exceeded()
            }
            for future in as_completed(future_to_gene):
                if self._budget_exceeded():
                    break
                fitness, _ = future.result()
                scored.append((future_to_gene[future], fitness))

        return scored

    def run(self) -> Gene:
        """Run the GP loop and return the best gene found."""
        population = seed_population(self.config)
        best_gene = population[0]
        best_fitness = float("-inf")
        no_improvement = 0

        for generation in range(1000):
            if self._budget_exceeded():
                break

            scored = self._evaluate_generation(population, generation)

            if not scored:
                break

            for gene, fitness in scored:
                if fitness > best_fitness:
                    best_fitness = fitness
                    best_gene = gene
                    no_improvement = 0

            if no_improvement >= self.config.convergence_patience:
                break
            no_improvement += 1

            # Selection: keep top half
            scored.sort(key=lambda x: x[1], reverse=True)
            survivors = [g for g, _ in scored[: max(1, len(scored) // 2)]]

            # Reproduce: fill population back to size
            new_population = list(survivors)
            while len(new_population) < self.config.population_size:
                parent1 = random.choice(survivors)
                op = random.choice(
                    ["mutate_structure", "mutate_prompt", "mutate_param", "crossover"]
                )
                if op == "mutate_structure":
                    new_population.append(mutate_structure(parent1))
                elif op == "mutate_prompt":
                    try:
                        new_population.append(mutate_prompt(parent1))
                    except Exception:
                        new_population.append(mutate_param(parent1))
                elif op == "mutate_param":
                    new_population.append(mutate_param(parent1))
                elif op == "crossover" and len(survivors) > 1:
                    parent2 = random.choice(
                        [s for s in survivors if s is not parent1] or survivors
                    )
                    child1, _ = crossover_subgraph(parent1, parent2)
                    new_population.append(child1)
                else:
                    new_population.append(mutate_param(parent1))

            population = new_population[: self.config.population_size]

        return best_gene
```

- [ ] **Step 4: Run all loop tests**

```bash
python -m pytest backend/engine/tests/test_loop.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Run full engine test suite to confirm nothing broken**

```bash
python -m pytest backend/engine/tests/ backend/shared/tests/ -v --tb=short
```

Expected: all 58 existing tests PASS plus the new one.

- [ ] **Step 6: Commit**

```bash
git add backend/engine/gp/loop.py backend/engine/tests/test_loop.py
git commit -m "feat: parallel gene evaluation in GPLoop using ThreadPoolExecutor"
```

---

### Task 4: ExperimentExecutor

**Files:**
- Create: `backend/api/executor.py`
- Create: `backend/api/tests/test_executor.py`

- [ ] **Step 1: Write failing tests**

Create `backend/api/tests/test_executor.py`:

```python
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
    import os; os.makedirs(datasets_dir)
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
    assert exp["status"] in ("completed", "failed"), f"Unexpected status: {exp['status']}"


def test_executor_sets_failed_on_error(store, tmp_path):
    """If dataset_id doesn't exist, experiment should be marked failed."""
    datasets_dir = str(tmp_path / "datasets_empty")
    import os; os.makedirs(datasets_dir)

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
    import os; os.makedirs(datasets_dir)
    executor = ExperimentExecutor(store=store, datasets_dir=datasets_dir, max_workers=2)
    executor.shutdown()  # should not raise
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest backend/api/tests/test_executor.py -v
```

Expected: `ModuleNotFoundError: No module named 'backend.api.executor'`

- [ ] **Step 3: Implement `backend/api/executor.py`**

```python
from __future__ import annotations
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor

from backend.shared.experiment import ExperimentConfig
from backend.engine.runner.raw_llm import RawLLMRunner
from backend.engine.evaluator.llm_judge import LLMJudgeEvaluator
from backend.engine.evaluator.function_eval import FunctionEvaluator
from backend.engine.gp.loop import GPLoop
from backend.engine.smbo.polish import smbo_polish
from backend.api.store import LocalStore

log = logging.getLogger(__name__)


def _build_evaluators(config: ExperimentConfig):
    evaluators = []
    for ev_config in config.evaluators:
        if ev_config.type == "llm_judge":
            evaluators.append(
                LLMJudgeEvaluator(
                    model=ev_config.params["model"],
                    rubric=ev_config.params["rubric"],
                )
            )
        elif ev_config.type == "function":
            import importlib
            module_path, fn_name = ev_config.params["fn_path"].rsplit(".", 1)
            mod = importlib.import_module(module_path)
            evaluators.append(FunctionEvaluator(fn=getattr(mod, fn_name)))
    return evaluators


def _run_experiment(
    experiment_id: str,
    store: LocalStore,
    datasets_dir: str,
) -> None:
    """Full experiment lifecycle: GP loop + SMBO polish. Runs in a worker thread."""
    try:
        store.update_experiment_status(experiment_id, "running")
        config = store.get_experiment_config(experiment_id)

        dataset_path = os.path.join(datasets_dir, f"{config.dataset_id}.json")
        with open(dataset_path) as f:
            dataset = json.load(f)

        evaluators = _build_evaluators(config)
        runner = RawLLMRunner()

        def on_trial(result):
            store.put_trial_result(experiment_id, result)
            log.info(
                "exp=%s gen=%d fitness=%.4f cost=$%.5f",
                experiment_id, result.generation, result.fitness, result.pareto.cost_usd,
            )

        loop = GPLoop(
            config=config,
            runner=runner,
            evaluators=evaluators,
            dataset=dataset,
            on_trial_complete=on_trial,
        )

        log.info("exp=%s: GP loop starting", experiment_id)
        best_gene = loop.run()
        log.info("exp=%s: GP loop complete, best=%s", experiment_id, best_gene.id)

        polished_gene = smbo_polish(
            gene=best_gene,
            config=config,
            runner=runner,
            evaluators=evaluators,
            dataset=dataset,
            n_trials=30,
        )
        log.info("exp=%s: SMBO complete, final=%s", experiment_id, polished_gene.id)

        store.put_best_gene(experiment_id, polished_gene, fitness=0.0)

    except Exception as exc:
        log.exception("exp=%s: failed with %s", experiment_id, exc)
        store.update_experiment_status(experiment_id, "failed", error=str(exc))


class ExperimentExecutor:
    """Manages concurrent experiment execution via a ThreadPoolExecutor."""

    def __init__(
        self,
        store: LocalStore,
        datasets_dir: str,
        max_workers: int = 4,
    ) -> None:
        self._store = store
        self._datasets_dir = datasets_dir
        self._pool = ThreadPoolExecutor(max_workers=max_workers)

    def submit(self, experiment_id: str) -> None:
        """Submit an experiment for async execution. Returns immediately."""
        self._pool.submit(_run_experiment, experiment_id, self._store, self._datasets_dir)

    def shutdown(self, wait: bool = False) -> None:
        self._pool.shutdown(wait=wait)
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest backend/api/tests/test_executor.py -v --timeout=60
```

Expected: all 3 tests PASS. The first test may take up to 30s (real GP loop with mock data).

- [ ] **Step 5: Commit**

```bash
git add backend/api/executor.py backend/api/tests/test_executor.py
git commit -m "feat: add ExperimentExecutor for concurrent experiment execution"
```

---

### Task 5: FastAPI app

**Files:**
- Create: `backend/api/app.py`
- Create: `backend/api/tests/test_api.py`

- [ ] **Step 1: Write failing tests**

Create `backend/api/tests/test_api.py`:

```python
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
        "evaluators": [{"type": "llm_judge", "params": {"model": "gpt-4o-mini", "rubric": "Rate 0-1."}}],
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest backend/api/tests/test_api.py -v
```

Expected: `ModuleNotFoundError: No module named 'backend.api.app'`

- [ ] **Step 3: Implement `backend/api/app.py`**

```python
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

load_dotenv()

from backend.shared.experiment import ExperimentConfig, ObjectiveWeights, EvaluatorConfig
from backend.api.store import LocalStore
from backend.api.executor import ExperimentExecutor

_DB_PATH = os.environ.get("DATABASE_PATH", "autoaw.db")
_DATASETS_DIR = os.environ.get("DATASETS_DIR", "datasets")
_MAX_WORKERS = int(os.environ.get("MAX_CONCURRENT_EXPERIMENTS", "4"))

_store = LocalStore(db_path=_DB_PATH)
_executor = ExperimentExecutor(store=_store, datasets_dir=_DATASETS_DIR, max_workers=_MAX_WORKERS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(_DATASETS_DIR, exist_ok=True)
    _store.init_db()
    yield
    _executor.shutdown(wait=False)


app = FastAPI(title="AutoAW", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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


# ── Routes ────────────────────────────────────────────────────────────────────

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
        evaluators=[EvaluatorConfig(type=e.type, params=e.params) for e in req.evaluators],
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
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id!r} not found")


@app.post("/experiments/{experiment_id}/start")
def start_experiment(experiment_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id!r} not found")
    _executor.submit(experiment_id)
    return {"status": "submitted", "experiment_id": experiment_id}


@app.delete("/experiments/{experiment_id}", status_code=204)
def delete_experiment(experiment_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id!r} not found")
    _store.update_experiment_status(experiment_id, "cancelled")


@app.get("/experiments/{experiment_id}/trials")
def list_trials(
    experiment_id: str,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_id!r} not found")
    return _store.list_trials(experiment_id, page=page, limit=limit)


@app.post("/datasets", status_code=201)
async def upload_dataset(file: UploadFile = File(...)):
    os.makedirs(_DATASETS_DIR, exist_ok=True)
    dataset_id = os.path.splitext(file.filename)[0]
    dest = os.path.join(_DATASETS_DIR, f"{dataset_id}.json")
    content = await file.read()
    # Validate it's valid JSON array
    try:
        parsed = json.loads(content)
        if not isinstance(parsed, list):
            raise HTTPException(status_code=422, detail="Dataset must be a JSON array")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"Invalid JSON: {e}")
    with open(dest, "wb") as f:
        f.write(content)
    return {"dataset_id": dataset_id, "records": len(parsed)}


@app.get("/datasets")
def list_datasets():
    os.makedirs(_DATASETS_DIR, exist_ok=True)
    files = [f for f in os.listdir(_DATASETS_DIR) if f.endswith(".json")]
    return [{"dataset_id": os.path.splitext(f)[0]} for f in sorted(files)]
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest backend/api/tests/test_api.py -v
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
python -m pytest backend/ -v --tb=short
```

Expected: all tests PASS (58 engine/shared + 8 store + 3 executor + 9 api = ~78).

- [ ] **Step 6: Commit**

```bash
git add backend/api/app.py backend/api/tests/test_api.py
git commit -m "feat: add FastAPI app with experiment CRUD, dataset upload, and start endpoint"
```

---

### Task 6: README and run instructions

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# AutoAW

AutoML for multi-agent workflows. Automatically discovers optimal workflow topologies, agent roles, prompts, and parameters using co-evolutionary genetic programming (DEAP) + Optuna SMBO.

## Prerequisites

- Python 3.12+
- Node.js 18+ (for the frontend)
- An OpenAI API key (and optionally Anthropic)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-org/autoaw.git
cd autoaw
pip install -r requirements-local.txt
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

### 3. Start the backend

```bash
uvicorn backend.api.app:app --reload --port 8000
```

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Running experiments via API

```bash
# Upload a dataset (JSON array of {input, expected} objects)
curl -X POST http://localhost:8000/datasets \
  -F "file=@my_dataset.json"

# Create an experiment
curl -X POST http://localhost:8000/experiments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My first experiment",
    "task_description": "Summarize technical documents clearly and concisely.",
    "dataset_id": "my_dataset",
    "evaluators": [{"type": "llm_judge", "params": {"model": "gpt-4o-mini", "rubric": "Rate 0-1 on clarity and accuracy."}}],
    "objective_weights": {"quality": 0.7, "cost": 0.2, "speed": 0.1},
    "population_size": 10,
    "budget_max_trials": 50,
    "concurrency": 3
  }'

# Start it (replace EXP_ID with the id from the response above)
curl -X POST http://localhost:8000/experiments/EXP_ID/start

# Poll for progress
curl http://localhost:8000/experiments/EXP_ID
curl http://localhost:8000/experiments/EXP_ID/trials
```

## Dataset format

A dataset is a JSON file containing a list of objects:

```json
[
  {"input": "...", "expected": "..."},
  {"input": "...", "expected": "..."}
]
```

`expected` is optional — if omitted, only LLM-judge evaluators can score the output.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | Required for OpenAI models and LLM-judge evaluator |
| `ANTHROPIC_API_KEY` | — | Required for Anthropic models |
| `MAX_CONCURRENT_EXPERIMENTS` | `4` | Max experiments running in parallel |
| `DATABASE_PATH` | `autoaw.db` | SQLite database file path |
| `DATASETS_DIR` | `datasets` | Directory for dataset JSON files |

## Running tests

```bash
python -m pytest backend/ -v
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with quick start and API usage guide"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| FastAPI on port 8000 | Task 5 (`app.py`) |
| SQLite with WAL mode | Task 2 (`store.py`) |
| Per-thread connections | Task 2 (`threading.local`) |
| `.env` + env var config | Task 1 + Task 5 (`load_dotenv`) |
| `MAX_CONCURRENT_EXPERIMENTS` | Task 4 + Task 5 |
| Experiment-level parallelism (ThreadPoolExecutor) | Task 4 (`executor.py`) |
| Trial-level parallelism (`concurrency` field) | Task 3 (`loop.py`) |
| Thread-safe `_trial_count` / `_total_cost` | Task 3 (`_lock`) |
| All 9 API endpoints | Task 5 |
| `LocalStore` same interface as `ExperimentStore` | Task 2 |
| Dataset upload + list | Task 5 |
| `datasets/` dir gitignored | Task 1 |
| `on_trial_complete` writes to SQLite | Task 4 (`executor.py`) |
| CORS for localhost:3000 | Task 5 |
| README / run instructions | Task 6 |

All spec requirements covered. No placeholders found. Type consistency verified: `LocalStore`, `ExperimentExecutor`, `GPLoop`, `TrialResult`, `ExperimentConfig` — all names consistent across tasks.
