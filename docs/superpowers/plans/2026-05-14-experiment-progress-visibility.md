# Experiment Progress Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show row-level progress, current GP generation/phase, and ETA on the experiment monitor page while a trial is evaluating.

**Architecture:** The engine emits a progress callback every 10 rows inside `_evaluate_gene`; the executor writes a heartbeat to a single `progress_json` column on the experiments table; the existing 2s poll on the frontend reads it and renders a progress bar, phase badge, and ETA.

**Tech Stack:** Python (SQLite via `LocalStore`), FastAPI, Next.js/React, shadcn/ui Progress component.

---

## File Map

| File | Change |
|------|--------|
| `backend/api/store.py` | Add `progress_json` column + `update_progress()` method |
| `backend/engine/gp/loop.py` | Add `on_progress` callback param; fire it every 10 rows |
| `backend/api/executor.py` | Wire `on_progress` → `store.update_progress()`; pass phase |
| `backend/engine/smbo/polish.py` | Accept + forward `on_progress` so SMBO phase is also visible |
| `frontend/lib/types.ts` | Add `ExperimentProgress` interface; add `progress?` to `Experiment` |
| `frontend/app/experiments/[id]/monitor/monitor-client.tsx` | Render progress bar, phase badge, ETA |

---

### Task 1: Add `progress_json` column and `update_progress()` to `LocalStore`

**Files:**
- Modify: `backend/api/store.py`
- Test: `backend/api/tests/test_store.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/api/tests/test_store.py`:

```python
def test_update_progress(tmp_path):
    from backend.api.store import LocalStore
    store = LocalStore(str(tmp_path / "test.db"))
    store.init_db()
    from backend.shared.experiment import ExperimentConfig, ObjectiveWeights
    config = ExperimentConfig(
        name="p", task_description="t", dataset_id="d",
        evaluators=[], objective_weights=ObjectiveWeights(0.7, 0.2, 0.1),
        population_size=2, convergence_patience=3, concurrency=1,
    )
    store.create_experiment("exp_prog_001", config)

    store.update_progress("exp_prog_001", {
        "rows_done": 50,
        "rows_total": 690,
        "generation": 2,
        "phase": "gp",
        "avg_row_ms": 1500,
        "eta_s": 960,
    })

    row = store.get_experiment("exp_prog_001")
    import json
    progress = json.loads(row["progress_json"])
    assert progress["rows_done"] == 50
    assert progress["rows_total"] == 690
    assert progress["generation"] == 2
    assert progress["phase"] == "gp"
    assert progress["avg_row_ms"] == 1500
    assert progress["eta_s"] == 960
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /Users/deil/Development/autoaw
python -m pytest backend/api/tests/test_store.py::test_update_progress -v
```

Expected: `FAILED` — `update_progress` not yet defined / `progress_json` column missing.

- [ ] **Step 3: Add schema migration constant and `update_progress()` to `store.py`**

In `backend/api/store.py`, after `_ALTER_TRIALS_MUTATION_OP = ...` add:

```python
_ALTER_EXPERIMENTS_PROGRESS = """
ALTER TABLE experiments ADD COLUMN progress_json TEXT
"""
```

In `init_db()`, extend the `for stmt in (...)` loop to include the new migration:

```python
for stmt in (_ALTER_TRIALS_PARENT, _ALTER_TRIALS_MUTATION_OP, _ALTER_EXPERIMENTS_PROGRESS):
    try:
        conn.execute(stmt)
    except sqlite3.OperationalError:
        pass  # Column already exists
```

After `update_experiment_status()`, add:

```python
def update_progress(self, experiment_id: str, progress: dict) -> None:
    self._conn().execute(
        "UPDATE experiments SET progress_json = ?, updated_at = ? WHERE id = ?",
        (json.dumps(progress), _now(), experiment_id),
    )
    self._conn().commit()
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
python -m pytest backend/api/tests/test_store.py::test_update_progress -v
```

Expected: `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add backend/api/store.py backend/api/tests/test_store.py
git commit -m "feat: add progress_json column and update_progress() to LocalStore"
```

---

### Task 2: Add `on_progress` callback to `GPLoop._evaluate_gene`

**Files:**
- Modify: `backend/engine/gp/loop.py`
- Test: `backend/engine/gp/tests/test_loop.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/engine/gp/tests/test_loop.py` (create file if it doesn't exist):

```python
def test_on_progress_callback_fires():
    """on_progress is called with row progress every HEARTBEAT_INTERVAL rows."""
    from unittest.mock import MagicMock, patch
    from backend.engine.gp.loop import GPLoop
    from backend.shared.experiment import ExperimentConfig, ObjectiveWeights

    config = ExperimentConfig(
        name="t", task_description="t", dataset_id="d",
        evaluators=[], objective_weights=ObjectiveWeights(0.7, 0.2, 0.1),
        population_size=1, convergence_patience=1, concurrency=1,
    )

    # Dataset of 25 rows — with heartbeat every 10 rows we expect calls at row 10, 20
    dataset = [{"input": f"q{i}", "expected": "a"} for i in range(25)]

    runner = MagicMock()
    runner.run.return_value = MagicMock(output="out", token_usage={}, latency_ms=10, cost_usd=0.001)

    evaluator = MagicMock()
    evaluator.score.return_value = MagicMock(quality=0.8, metadata={})

    progress_calls = []

    loop = GPLoop(
        config=config,
        runner=runner,
        evaluators=[evaluator],
        dataset=dataset,
        on_progress=lambda p: progress_calls.append(dict(p)),
    )

    from backend.shared.gene import Gene
    gene = MagicMock(spec=Gene)
    gene.id = "g001"
    loop._evaluate_gene(gene, generation=1)

    # Should have fired at rows_done=10 and rows_done=20
    assert len(progress_calls) == 2
    assert progress_calls[0]["rows_done"] == 10
    assert progress_calls[0]["rows_total"] == 25
    assert progress_calls[0]["generation"] == 1
    assert progress_calls[0]["phase"] == "gp"
    assert progress_calls[1]["rows_done"] == 20
```

- [ ] **Step 2: Run to confirm it fails**

```bash
python -m pytest backend/engine/gp/tests/test_loop.py::test_on_progress_callback_fires -v
```

Expected: `FAILED` — `on_progress` param not accepted.

- [ ] **Step 3: Add `on_progress` to `GPLoop`**

In `backend/engine/gp/loop.py`:

At the top of the file, add the constant after imports:

```python
_PROGRESS_HEARTBEAT_ROWS = 10
```

In `GPLoop.__init__`, add `on_progress` parameter and store it:

```python
def __init__(
    self,
    config: ExperimentConfig,
    runner: WorkflowRunner,
    evaluators: list[Evaluator],
    dataset: list[dict],
    on_trial_complete: Callable[[TrialResult], None] | None = None,
    on_progress: Callable[[dict], None] | None = None,
    stop_event: threading.Event | None = None,
) -> None:
    self.config = config
    self.runner = runner
    self.evaluators = evaluators
    self.dataset = dataset
    self.on_trial_complete = on_trial_complete
    self.on_progress = on_progress
    self._stop_event = stop_event or threading.Event()
    self._trial_count = 0
    self._total_cost = 0.0
    self._lock = threading.Lock()
    self._current_generation = 0
    self._current_phase = "gp"
```

In `_evaluate_gene`, add a rolling latency tracker and fire the heartbeat. Replace the `for idx, sample in enumerate(self.dataset):` loop body — add after `eval_rows.append(...)` and before `total_quality += avg_quality`:

```python
# Heartbeat every _PROGRESS_HEARTBEAT_ROWS rows
rows_done = len(eval_rows)
if self.on_progress and rows_done % _PROGRESS_HEARTBEAT_ROWS == 0:
    avg_ms = int(total_latency / rows_done) if rows_done else 0
    remaining = len(self.dataset) - rows_done
    eta_s = int(remaining * avg_ms / 1000) if avg_ms else 0
    self.on_progress({
        "rows_done": rows_done,
        "rows_total": len(self.dataset),
        "generation": generation,
        "phase": self._current_phase,
        "avg_row_ms": avg_ms,
        "eta_s": eta_s,
    })
```

Also add a `set_phase()` helper at the bottom of `GPLoop`:

```python
def set_phase(self, phase: str) -> None:
    """Update the phase label emitted in progress heartbeats ('gp' or 'smbo')."""
    self._current_phase = phase
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
python -m pytest backend/engine/gp/tests/test_loop.py::test_on_progress_callback_fires -v
```

Expected: `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add backend/engine/gp/loop.py backend/engine/gp/tests/test_loop.py
git commit -m "feat: add on_progress heartbeat callback to GPLoop._evaluate_gene"
```

---

### Task 3: Wire `on_progress` in the executor and clear progress on completion

**Files:**
- Modify: `backend/api/executor.py`
- Test: `backend/api/tests/test_executor.py` (add one test)

- [ ] **Step 1: Write the failing test**

Add to `backend/api/tests/test_executor.py`:

```python
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
        name="prog-test", task_description="t", dataset_id="ds1",
        evaluators=[], objective_weights=ObjectiveWeights(0.7, 0.2, 0.1),
        population_size=1, convergence_patience=1, concurrency=1,
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

    # Mock runner + evaluator so no real LLM calls happen
    with patch("backend.api.executor._build_runner") as mock_runner_factory, \
         patch("backend.api.executor._build_evaluators") as mock_eval_factory, \
         patch("backend.api.executor.smbo_polish") as mock_smbo:
        mock_run = MagicMock(output="x", token_usage={}, latency_ms=5, cost_usd=0.0)
        mock_runner_factory.return_value.run.return_value = mock_run
        mock_eval_factory.return_value = [MagicMock(score=MagicMock(return_value=MagicMock(quality=0.5, metadata={})))]
        mock_smbo.return_value = MagicMock(id="g_smbo")

        _run_experiment("exp_wire_001", store, ds_dir, threading.Event())

    # With 12 rows and heartbeat every 10, at least one progress call expected
    assert len(progress_snapshots) >= 1
    assert progress_snapshots[0]["rows_done"] == 10
    assert progress_snapshots[0]["rows_total"] == 12
```

- [ ] **Step 2: Run to confirm it fails**

```bash
python -m pytest backend/api/tests/test_executor.py::test_progress_written_to_store -v
```

Expected: `FAILED`.

- [ ] **Step 3: Wire `on_progress` in `_run_experiment`**

In `backend/api/executor.py`, replace the `_run_experiment` function body to add the progress wiring:

```python
def _run_experiment(
    experiment_id: str,
    store: LocalStore,
    datasets_dir: str,
    stop_event: threading.Event,
) -> None:
    """Full experiment lifecycle: GP loop + SMBO polish. Runs in a worker thread."""
    try:
        store.update_experiment_status(experiment_id, "running")
        config = store.get_experiment_config(experiment_id)

        dataset_path = os.path.join(datasets_dir, f"{config.dataset_id}.json")
        with open(dataset_path) as f:
            dataset = json.load(f)

        runner = _build_runner(config)
        evaluators = _build_evaluators(config)

        def on_trial(result):
            store.put_trial_result(experiment_id, result)
            log.info(
                "exp=%s gen=%d fitness=%.4f cost=$%.5f",
                experiment_id,
                result.generation,
                result.fitness,
                result.pareto.cost_usd,
            )

        def on_progress(progress: dict) -> None:
            store.update_progress(experiment_id, progress)

        loop = GPLoop(
            config=config,
            runner=runner,
            evaluators=evaluators,
            dataset=dataset,
            on_trial_complete=on_trial,
            on_progress=on_progress,
            stop_event=stop_event,
        )

        log.info("exp=%s: GP loop starting", experiment_id)
        best_gene = loop.run()
        log.info("exp=%s: GP loop complete, best=%s", experiment_id, best_gene.id)

        if stop_event.is_set():
            log.info(
                "exp=%s: stop requested, skipping SMBO and marking cancelled",
                experiment_id,
            )
            store.update_experiment_status(experiment_id, "cancelled")
            # Clear progress on stop
            store.update_progress(experiment_id, {})
            return

        # Transition to SMBO phase
        loop.set_phase("smbo")
        store.update_progress(experiment_id, {
            "rows_done": 0,
            "rows_total": len(dataset),
            "generation": 0,
            "phase": "smbo",
            "avg_row_ms": 0,
            "eta_s": 0,
        })

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
        # Clear progress now that we're done
        store.update_progress(experiment_id, {})

    except Exception as exc:
        log.exception("exp=%s: failed with %s", experiment_id, exc)
        store.update_experiment_status(experiment_id, "failed", error=str(exc))
        store.update_progress(experiment_id, {})
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
python -m pytest backend/api/tests/test_executor.py::test_progress_written_to_store -v
```

Expected: `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add backend/api/executor.py backend/api/tests/test_executor.py
git commit -m "feat: wire on_progress callback through executor to store"
```

---

### Task 4: Expose `progress` in the `GET /experiments/{id}` API response

**Files:**
- Modify: `backend/api/app.py`
- Test: `backend/api/tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/api/tests/test_api.py`:

```python
def test_get_experiment_includes_progress(client, tmp_path):
    """GET /experiments/{id} deserialises progress_json into a progress object."""
    import json
    # Create experiment
    resp = client.post("/experiments", json={
        "name": "prog-api-test",
        "task_description": "t",
        "dataset_id": "ds1",
        "evaluators": [],
        "objective_weights": {"quality": 0.7, "cost": 0.2, "speed": 0.1},
        "population_size": 2,
        "convergence_patience": 3,
        "concurrency": 1,
    })
    assert resp.status_code == 201
    exp_id = resp.json()["id"]

    # Manually write progress via store
    from backend.api.app import _store
    _store.update_progress(exp_id, {
        "rows_done": 40,
        "rows_total": 690,
        "generation": 1,
        "phase": "gp",
        "avg_row_ms": 1200,
        "eta_s": 790,
    })

    resp = client.get(f"/experiments/{exp_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert "progress" in data
    assert data["progress"]["rows_done"] == 40
    assert data["progress"]["phase"] == "gp"
```

- [ ] **Step 2: Run to confirm it fails**

```bash
python -m pytest backend/api/tests/test_api.py::test_get_experiment_includes_progress -v
```

Expected: `FAILED` — `progress` key not in response.

- [ ] **Step 3: Update `get_experiment` endpoint to deserialise `progress_json`**

In `backend/api/app.py`, update the `get_experiment` endpoint:

```python
@app.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: str):
    try:
        row = _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    # Deserialise progress_json into a nested object (None if empty / missing)
    progress_raw = row.get("progress_json")
    progress = None
    if progress_raw:
        try:
            parsed = json.loads(progress_raw)
            # Empty dict means no active progress
            progress = parsed if parsed else None
        except Exception:
            progress = None
    row["progress"] = progress
    return row
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
python -m pytest backend/api/tests/test_api.py::test_get_experiment_includes_progress -v
```

Expected: `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add backend/api/app.py backend/api/tests/test_api.py
git commit -m "feat: include deserialized progress in GET /experiments/{id} response"
```

---

### Task 5: Add `ExperimentProgress` type and `progress` field to frontend types

**Files:**
- Modify: `frontend/lib/types.ts`

- [ ] **Step 1: Add the interface**

In `frontend/lib/types.ts`, after the `Experiment` interface, add:

```typescript
export interface ExperimentProgress {
  rows_done: number;
  rows_total: number;
  generation: number;
  phase: "gp" | "smbo";
  avg_row_ms: number;
  eta_s: number;
}
```

And add `progress` to the `Experiment` interface:

```typescript
export interface Experiment {
  id: string;
  name: string;
  status: ExperimentStatus;
  created_at: string;
  updated_at: string;
  best_fitness: number | null;
  best_gene_json?: string | null;
  config_json?: string;
  error_message?: string | null;
  progress?: ExperimentProgress | null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/deil/Development/autoaw/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/types.ts
git commit -m "feat: add ExperimentProgress type and progress field to Experiment"
```

---

### Task 6: Render progress bar, phase badge, and ETA on the monitor page

**Files:**
- Modify: `frontend/app/experiments/[id]/monitor/monitor-client.tsx`

- [ ] **Step 1: Add the Progress UI**

The shadcn/ui `Progress` component is used for the bar. Update `monitor-client.tsx`:

Add `Progress` to imports at the top:

```typescript
import { Progress } from "@/components/ui/progress";
```

Add a helper function before the `return` statement inside the component:

```typescript
function formatEta(seconds: number): string {
  if (seconds <= 0) return "< 1s";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
```

Inside `<TabsContent value="monitor">`, after the three stat cards `<div className="grid grid-cols-3 gap-4">`, add the progress block (only shown when `experiment.status === "running"` and `experiment.progress` exists):

```typescript
{experiment.status === "running" && experiment.progress && (
  <Card>
    <CardHeader className="pb-2">
      <div className="flex items-center justify-between">
        <CardTitle className="text-sm text-muted-foreground">
          Current Trial
        </CardTitle>
        <Badge variant="outline" className="font-mono text-xs">
          {experiment.progress.phase === "gp"
            ? `GP · gen ${experiment.progress.generation}`
            : "SMBO polish"}
        </Badge>
      </div>
    </CardHeader>
    <CardContent className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>
          Row {experiment.progress.rows_done} / {experiment.progress.rows_total}
        </span>
        <span className="text-muted-foreground">
          ETA {formatEta(experiment.progress.eta_s)}
        </span>
      </div>
      <Progress
        value={
          experiment.progress.rows_total > 0
            ? (experiment.progress.rows_done / experiment.progress.rows_total) * 100
            : 0
        }
      />
    </CardContent>
  </Card>
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/deil/Development/autoaw/frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run frontend tests**

```bash
cd /Users/deil/Development/autoaw/frontend
npm test -- --passWithNoTests
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/experiments/\[id\]/monitor/monitor-client.tsx
git commit -m "feat: render row progress bar, GP/SMBO phase badge, and ETA on monitor page"
```

---

### Task 7: Smoke test end-to-end

- [ ] **Step 1: Run the full backend test suite**

```bash
cd /Users/deil/Development/autoaw
python -m pytest backend/ -v --tb=short
```

Expected: all tests pass.

- [ ] **Step 2: Start the dev server and verify the UI**

```bash
cd /Users/deil/Development/autoaw
# Terminal 1: API
uvicorn backend.api.app:app --reload --port 8000

# Terminal 2: Frontend
cd frontend && npm run dev
```

Navigate to an experiment that is running. Confirm:
- Progress card appears with a progress bar
- Phase badge shows `GP · gen N` 
- ETA counts down
- Card disappears once experiment completes

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: smoke test corrections for progress visibility"
```
