# Stop Reason Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface *why* an experiment stopped (converged, budget hit, cancelled, max-generations) as a dedicated `stop_reason` field that is stored, returned by the API, and displayed in the frontend experiment monitor.

**Architecture:** `GPLoop.run()` returns a `GPResult` dataclass (best gene + stop reason) instead of a bare `Gene`. The stop reason flows through `executor.py` → `LocalStore.put_best_gene()` → SQLite → API → frontend. A SQLite migration adds the column; the frontend `Experiment` type is extended and `experiment-details.tsx` gains a dedicated "Stop Reason" card.

**Tech Stack:** Python 3.12 (dataclasses, pytest), SQLite (ALTER TABLE migration), TypeScript / React (Next.js App Router, shadcn/ui Badge + Card)

---

## File Map

| File | Change |
|---|---|
| `backend/engine/gp/loop.py` | Add `GPResult` dataclass; `run()` returns `GPResult`; track 5 stop reasons |
| `backend/api/store.py` | Add `stop_reason` column via ALTER TABLE migration; `put_best_gene()` accepts + stores it; `get_experiment()` returns it |
| `backend/api/executor.py` | Unpack `GPResult`; pass `stop_reason` to `put_best_gene()`; pass actual `best_fitness` (fix `fitness=0.0` bug) |
| `backend/engine/tests/test_loop.py` | Tests for each stop reason |
| `backend/api/tests/test_store.py` | Test `stop_reason` persists and is returned |
| `backend/api/tests/test_executor.py` | Test executor passes stop reason through |
| `frontend/lib/types.ts` | Add `stop_reason` to `Experiment` interface |
| `frontend/components/experiment-details.tsx` | Add "Stop Reason" card; rename patience label to include "(generations)" |

---

## Task 1: Add `GPResult` dataclass and stop-reason tracking in `GPLoop.run()`

**Files:**
- Modify: `backend/engine/gp/loop.py`

- [ ] **Step 1: Write failing tests for stop reasons**

Add to `backend/engine/tests/test_loop.py`:

```python
from backend.engine.gp.loop import GPLoop, TrialResult, GPResult


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
        "converged", "budget_trials", "budget_usd", "cancelled",
        "max_generations", "empty_generation",
    )


def test_gp_loop_stop_reason_budget_trials():
    config = make_config()
    config.budget_max_trials = 1  # 1 row dataset × 1 trial → stops immediately
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
    # Evaluator always returns same fitness → converges quickly
    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
    )
    result = loop.run()
    assert result.stop_reason == "converged"


def test_gp_loop_stop_reason_cancelled():
    import threading
    config = make_config()
    stop_event = threading.Event()
    stop_event.set()  # signal before run
    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
        stop_event=stop_event,
    )
    result = loop.run()
    assert result.stop_reason == "cancelled"
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd /Users/deil/Development/autoaw
python -m pytest backend/engine/tests/test_loop.py::test_gp_loop_returns_gp_result backend/engine/tests/test_loop.py::test_gp_loop_stop_reason_budget_trials backend/engine/tests/test_loop.py::test_gp_loop_stop_reason_converged backend/engine/tests/test_loop.py::test_gp_loop_stop_reason_cancelled -v 2>&1 | head -30
```

Expected: `FAILED` with `AttributeError: module 'backend.engine.gp.loop' has no attribute 'GPResult'` or similar.

- [ ] **Step 3: Add `GPResult` dataclass and update `run()` in `loop.py`**

At the top of `backend/engine/gp/loop.py`, after the `TrialResult` dataclass (after line 36), add:

```python
@dataclass
class GPResult:
    best_gene: Gene
    stop_reason: str  # "converged" | "budget_trials" | "budget_usd" | "cancelled" | "max_generations" | "empty_generation"
    generations_run: int
    best_fitness: float
```

Replace the entire `run()` method (lines 187–263) with:

```python
def run(self) -> GPResult:
    """Run the GP loop and return a GPResult with the best gene and stop reason."""
    seed_genes = seed_population(self.config)
    population: list[tuple[Gene, list[str], str]] = [
        (g, [], "seed") for g in seed_genes
    ]
    best_gene = seed_genes[0]
    best_fitness = float("-inf")
    no_improvement = 0
    stop_reason = "max_generations"
    generation = 0

    for generation in range(1000):
        if self._stop_event.is_set():
            stop_reason = "cancelled"
            break
        if self._budget_exceeded():
            stop_reason = self._budget_stop_reason()
            break

        scored = self._evaluate_generation(population, generation)

        if not scored:
            stop_reason = "empty_generation"
            break

        for gene, fitness in scored:
            if fitness > best_fitness:
                best_fitness = fitness
                best_gene = gene
                no_improvement = 0

        if no_improvement >= self.config.convergence_patience:
            stop_reason = "converged"
            break
        no_improvement += 1

        # Selection: keep top half
        scored.sort(key=lambda x: x[1], reverse=True)
        survivors = [g for g, _ in scored[: max(1, len(scored) // 2)]]

        # Reproduce: fill population back to size
        new_population: list[tuple[Gene, list[str], str]] = [
            (g, [], "survived") for g in survivors
        ]
        while len(new_population) < self.config.population_size:
            parent1 = random.choice(survivors)
            op = random.choice(
                ["mutate_structure", "mutate_prompt", "mutate_param", "crossover"]
            )
            if op == "mutate_structure":
                child = mutate_structure(
                    parent1,
                    provider_config=self.config.provider,
                    allowed_models=self.config.allowed_models,
                )
                new_population.append((child, [parent1.id], "mutate_structure"))
            elif op == "mutate_prompt":
                try:
                    child = mutate_prompt(
                        parent1, provider_config=self.config.provider
                    )
                    new_population.append((child, [parent1.id], "mutate_prompt"))
                except Exception:
                    child = mutate_param(parent1)
                    new_population.append((child, [parent1.id], "mutate_param"))
            elif op == "mutate_param":
                child = mutate_param(parent1)
                new_population.append((child, [parent1.id], "mutate_param"))
            elif op == "crossover" and len(survivors) > 1:
                parent2 = random.choice(
                    [s for s in survivors if s is not parent1] or survivors
                )
                child1, _ = crossover_subgraph(parent1, parent2)
                new_population.append(
                    (child1, [parent1.id, parent2.id], "crossover_subgraph")
                )
            else:
                child = mutate_param(parent1)
                new_population.append((child, [parent1.id], "mutate_param"))

        population = new_population[: self.config.population_size]
    else:
        # for loop completed all 1000 iterations without break
        stop_reason = "max_generations"

    # If we broke out due to budget_exceeded but stop_event is the real cause, re-check
    if stop_reason in ("budget_trials", "budget_usd") and self._stop_event.is_set():
        stop_reason = "cancelled"

    return GPResult(
        best_gene=best_gene,
        stop_reason=stop_reason,
        generations_run=generation + 1,
        best_fitness=best_fitness,
    )
```

Also add this helper method to `GPLoop`, right after `_budget_exceeded()` (after line 160):

```python
def _budget_stop_reason(self) -> str:
    """Return the specific budget-related stop reason."""
    if self._stop_event.is_set():
        return "cancelled"
    with self._lock:
        if (
            self.config.budget_max_trials
            and self._trial_count >= self.config.budget_max_trials
        ):
            return "budget_trials"
        if (
            self.config.budget_max_usd
            and self._total_cost >= self.config.budget_max_usd
        ):
            return "budget_usd"
    return "budget_trials"  # fallback
```

- [ ] **Step 4: Run the new tests and the existing loop tests**

```bash
cd /Users/deil/Development/autoaw
python -m pytest backend/engine/tests/test_loop.py -v
```

Expected: all pass. The existing tests call `loop.run()` and use the result as `Gene` — they will break because `run()` now returns `GPResult`. Fix any existing tests that do `best = loop.run(); assert isinstance(best, Gene)` by changing them to `result = loop.run(); best = result.best_gene; assert isinstance(best, Gene)`.

Updated existing test bodies in `backend/engine/tests/test_loop.py`:

```python
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
```

- [ ] **Step 5: Run all loop tests**

```bash
cd /Users/deil/Development/autoaw
python -m pytest backend/engine/tests/test_loop.py -v
```

Expected: all 8 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/deil/Development/autoaw
git add backend/engine/gp/loop.py backend/engine/tests/test_loop.py
git commit -m "feat: GPLoop.run() returns GPResult with stop_reason and best_fitness"
```

---

## Task 2: Update `LocalStore` — add `stop_reason` column and `put_best_gene()` signature

**Files:**
- Modify: `backend/api/store.py`
- Modify: `backend/api/tests/test_store.py`

- [ ] **Step 1: Write failing test for stop_reason persistence**

Add to `backend/api/tests/test_store.py`:

```python
def test_put_best_gene_stores_stop_reason(store):
    exp_id = "exp_stop"
    config = make_config()
    store.create_experiment(exp_id, config)
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    store.put_best_gene(exp_id, gene, fitness=0.85, stop_reason="converged")
    result = store.get_experiment(exp_id)
    assert result["stop_reason"] == "converged"
    assert result["status"] == "completed"
    assert abs(result["best_fitness"] - 0.85) < 1e-6


def test_put_best_gene_stop_reason_budget(store):
    exp_id = "exp_budget"
    config = make_config()
    store.create_experiment(exp_id, config)
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    store.put_best_gene(exp_id, gene, fitness=0.5, stop_reason="budget_trials")
    result = store.get_experiment(exp_id)
    assert result["stop_reason"] == "budget_trials"


def test_get_experiment_stop_reason_defaults_to_none(store):
    """Old rows without stop_reason should return None gracefully."""
    exp_id = "exp_old"
    config = make_config()
    store.create_experiment(exp_id, config)
    result = store.get_experiment(exp_id)
    assert result["stop_reason"] is None
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd /Users/deil/Development/autoaw
python -m pytest backend/api/tests/test_store.py::test_put_best_gene_stores_stop_reason backend/api/tests/test_store.py::test_put_best_gene_stop_reason_budget backend/api/tests/test_store.py::test_get_experiment_stop_reason_defaults_to_none -v 2>&1 | head -20
```

Expected: `FAILED` — `put_best_gene() takes 4 positional arguments but 5 were given` or column not found.

- [ ] **Step 3: Add `stop_reason` column and migration to `store.py`**

In `backend/api/store.py`:

1. Replace the `_CREATE_EXPERIMENTS` constant (lines 13–25) with:

```python
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
    stop_reason     TEXT,
    error_message   TEXT
)
"""
```

2. Add a migration constant after the existing `_ALTER_TRIALS_MUTATION_OP` line (after line 48):

```python
_ALTER_EXPERIMENTS_STOP_REASON = """
ALTER TABLE experiments ADD COLUMN stop_reason TEXT
"""
```

3. In `init_db()`, add the new migration to the existing loop (lines 91–95):

```python
for stmt in (
    _ALTER_TRIALS_PARENT,
    _ALTER_TRIALS_MUTATION_OP,
    _ALTER_EXPERIMENTS_STOP_REASON,
):
    try:
        conn.execute(stmt)
    except sqlite3.OperationalError:
        pass  # Column already exists
```

4. Replace `put_best_gene()` (lines 143–149) with:

```python
def put_best_gene(
    self, experiment_id: str, gene: Gene, fitness: float, stop_reason: str = "completed"
) -> None:
    self._conn().execute(
        "UPDATE experiments SET best_gene_json = ?, best_fitness = ?, "
        "status = 'completed', stop_reason = ?, updated_at = ? WHERE id = ?",
        (json.dumps(gene.to_dict()), fitness, stop_reason, _now(), experiment_id),
    )
    self._conn().commit()
```

- [ ] **Step 4: Run the new store tests and all existing store tests**

```bash
cd /Users/deil/Development/autoaw
python -m pytest backend/api/tests/test_store.py -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/deil/Development/autoaw
git add backend/api/store.py backend/api/tests/test_store.py
git commit -m "feat: add stop_reason column to experiments table"
```

---

## Task 3: Update `executor.py` to pass `stop_reason` and real `best_fitness`

**Files:**
- Modify: `backend/api/executor.py`
- Modify: `backend/api/tests/test_executor.py`

- [ ] **Step 1: Write failing test**

Read `backend/api/tests/test_executor.py` to understand its structure, then add:

```python
def test_executor_passes_stop_reason_to_store(tmp_path):
    """Executor should call put_best_gene with the stop_reason from GPResult."""
    from unittest.mock import MagicMock, patch
    from backend.engine.gp.loop import GPResult
    from backend.shared import Gene, load_fixture

    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    gp_result = GPResult(
        best_gene=gene,
        stop_reason="converged",
        generations_run=5,
        best_fitness=0.91,
    )

    mock_store = MagicMock()
    mock_store.get_experiment_config.return_value = make_config()
    mock_store.get_experiment.return_value = {"id": "exp_001", "status": "pending"}

    with (
        patch("backend.api.executor.GPLoop") as MockGP,
        patch("backend.api.executor.smbo_polish") as mock_smbo,
        patch("backend.api.executor._build_runner"),
        patch("backend.api.executor._build_evaluators"),
        patch("builtins.open", MagicMock(return_value=MagicMock(
            __enter__=MagicMock(return_value=MagicMock(
                read=MagicMock(return_value=b'[{"input":"x"}]')
            )),
            __exit__=MagicMock(return_value=False),
        ))),
        patch("json.load", return_value=[{"input": "x", "expected": "y"}]),
    ):
        mock_loop_instance = MagicMock()
        mock_loop_instance.run.return_value = gp_result
        MockGP.return_value = mock_loop_instance
        mock_smbo.return_value = gene

        import threading
        _run_experiment("exp_001", mock_store, str(tmp_path), threading.Event())

    mock_store.put_best_gene.assert_called_once()
    call_kwargs = mock_store.put_best_gene.call_args
    assert call_kwargs[1].get("stop_reason") == "converged" or call_kwargs[0][3] == "converged"
    # Best fitness should be real value, not 0.0
    fitness_arg = call_kwargs[1].get("fitness") or call_kwargs[0][2]
    assert fitness_arg != 0.0
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /Users/deil/Development/autoaw
python -m pytest backend/api/tests/test_executor.py::test_executor_passes_stop_reason_to_store -v 2>&1 | head -20
```

Expected: `FAILED`.

- [ ] **Step 3: Update `_run_experiment()` in `executor.py`**

In `backend/api/executor.py`, replace lines 87–109 (the GP loop call through `put_best_gene`):

```python
log.info("exp=%s: GP loop starting", experiment_id)
gp_result = loop.run()
log.info(
    "exp=%s: GP loop complete, best=%s stop_reason=%s fitness=%.4f",
    experiment_id,
    gp_result.best_gene.id,
    gp_result.stop_reason,
    gp_result.best_fitness,
)

if stop_event.is_set():
    log.info(
        "exp=%s: stop requested, skipping SMBO and marking cancelled",
        experiment_id,
    )
    store.update_experiment_status(experiment_id, "cancelled")
    return

polished_gene = smbo_polish(
    gene=gp_result.best_gene,
    config=config,
    runner=runner,
    evaluators=evaluators,
    dataset=dataset,
    n_trials=30,
)
log.info("exp=%s: SMBO complete, final=%s", experiment_id, polished_gene.id)

store.put_best_gene(
    experiment_id,
    polished_gene,
    fitness=gp_result.best_fitness,
    stop_reason=gp_result.stop_reason,
)
```

Also update the import at the top of the loop section from `best_gene = loop.run()` to reflect the new return type (no import change needed, `GPResult` is returned).

- [ ] **Step 4: Run executor tests and all api tests**

```bash
cd /Users/deil/Development/autoaw
python -m pytest backend/api/tests/ -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/deil/Development/autoaw
git add backend/api/executor.py backend/api/tests/test_executor.py
git commit -m "fix: pass stop_reason and real best_fitness from GPResult to store"
```

---

## Task 4: Expose `stop_reason` in the API response

The API's `get_experiment` endpoint at `backend/api/app.py` already calls `store.get_experiment(experiment_id)` which returns `dict(row)` from SQLite — so `stop_reason` will appear automatically once the column exists. No change to `app.py` is needed.

- [ ] **Step 1: Verify with a quick smoke test**

```bash
cd /Users/deil/Development/autoaw
python -m pytest backend/api/tests/test_api.py -v -k "get_experiment" 2>&1 | head -30
```

Expected: existing get-experiment tests pass. If there are none, that is acceptable — the column is transparent.

---

## Task 5: Update frontend types and display `stop_reason`

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/components/experiment-details.tsx`

- [ ] **Step 1: Add `stop_reason` to `Experiment` type in `frontend/lib/types.ts`**

Replace the `Experiment` interface (lines 77–87):

```typescript
export type StopReason =
  | "converged"
  | "budget_trials"
  | "budget_usd"
  | "cancelled"
  | "max_generations"
  | "empty_generation";

// Matches actual backend response shape
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
  stop_reason?: StopReason | null;
}
```

- [ ] **Step 2: Add `stop_reason` display to `experiment-details.tsx`**

In `frontend/components/experiment-details.tsx`:

1. Add the `StopReason` import to the types import line:

```typescript
import type { Experiment, ExperimentConfig, StopReason } from "@/lib/types";
```

2. Add a helper function after `formatDate`:

```typescript
function formatStopReason(reason: StopReason | null | undefined): string {
  switch (reason) {
    case "converged": return "Converged (patience exhausted)";
    case "budget_trials": return "Budget: trial limit reached";
    case "budget_usd": return "Budget: cost limit reached";
    case "cancelled": return "Cancelled by user";
    case "max_generations": return "Max generations reached (1 000)";
    case "empty_generation": return "Empty generation (no genes evaluated)";
    default: return "—";
  }
}

function stopReasonVariant(reason: StopReason | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  if (reason === "converged") return "default";
  if (reason === "cancelled") return "destructive";
  if (reason?.startsWith("budget")) return "secondary";
  return "outline";
}
```

3. Add a "Stop Reason" card inside the returned JSX, after the "Metadata" card (after line 131, before the closing `</div>`):

```tsx
{/* Stop Reason */}
{experiment.stop_reason && (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-sm text-muted-foreground">Stop Reason</CardTitle>
    </CardHeader>
    <CardContent>
      <Badge variant={stopReasonVariant(experiment.stop_reason)}>
        {formatStopReason(experiment.stop_reason)}
      </Badge>
    </CardContent>
  </Card>
)}
```

4. In the "GP & Budget Parameters" card, update the `Convergence Patience` label (line 108):

```tsx
<dt className="text-muted-foreground">Convergence Patience (generations)</dt>
```

- [ ] **Step 3: Build the frontend to check for type errors**

```bash
cd /Users/deil/Development/autoaw/frontend
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Run frontend tests**

```bash
cd /Users/deil/Development/autoaw/frontend
npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/deil/Development/autoaw
git add frontend/lib/types.ts frontend/components/experiment-details.tsx
git commit -m "feat: show stop_reason in experiment details; clarify convergence patience label"
```

---

## Task 6: Run full test suite

- [ ] **Step 1: Run all backend tests**

```bash
cd /Users/deil/Development/autoaw
python -m pytest backend/ -v 2>&1 | tail -40
```

Expected: all pass.

- [ ] **Step 2: Run all frontend tests**

```bash
cd /Users/deil/Development/autoaw/frontend
npm test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 3: Commit if any cleanup was needed**

Only commit if fixes were needed after the full run. Otherwise this task is done.

---

## Self-Review

**Spec coverage:**
- ✅ Show stop reason in UI → Task 5 (dedicated card in `experiment-details.tsx`)
- ✅ Convergence patience is per-generation → already in code; Task 5 clarifies label
- ✅ `stop_reason` as top-level field on experiment record → Tasks 2–4
- ✅ `fitness=0.0` placeholder bug fixed → Task 3
- ✅ All 5 stop reasons covered: `converged`, `budget_trials`, `budget_usd`, `cancelled`, `max_generations`

**Placeholder scan:** None found.

**Type consistency:** `GPResult.stop_reason: str` (Python) → `Experiment.stop_reason: StopReason | null` (TypeScript). The string values are identical across all layers. `put_best_gene(stop_reason=...)` keyword arg used consistently.
