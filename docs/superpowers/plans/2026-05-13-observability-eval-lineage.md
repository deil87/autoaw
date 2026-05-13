# Observability: Per-Datapoint Eval Logs + Population Evolution Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-datapoint evaluation logs to the trial detail page and a React Flow evolution canvas showing the full population lineage across all generations.

**Architecture:** Three layers of changes — backend DB schema + engine (store `parent_gene_ids`, `mutation_op`, `eval_rows`), API (two new endpoints), and frontend (trial detail tab + new `/evolution` page using React Flow). The GP loop is updated to evaluate every dataset row per trial (not a single random sample) and record per-row results.

**Tech Stack:** Python/FastAPI/SQLite (backend), React/Next.js/TypeScript/React Flow (frontend)

---

## File Map

| File | Change |
|---|---|
| `backend/api/store.py` | Add `eval_rows` table, add `parent_gene_ids`/`mutation_op` columns to `trials`, add `put_eval_rows`, `get_eval_rows`, `list_trials_lineage` methods |
| `backend/engine/gp/loop.py` | Evaluate ALL dataset rows per trial (not one random sample); pass `parent_gene_ids` + `mutation_op` in `TrialResult`; capture per-row `EvalRowResult` list |
| `backend/shared/results.py` | Add `EvalRowResult` dataclass |
| `backend/api/app.py` | Add `GET /experiments/{id}/trials/{trial_id}/eval-rows` and `GET /experiments/{id}/lineage` |
| `frontend/lib/types.ts` | Add `EvalRow`, `LineageNode` interfaces; extend `Trial` with `parent_gene_ids`, `mutation_op` |
| `frontend/lib/api.ts` | Add `api.trials.evalRows(experimentId, trialId)` and `api.experiments.lineage(experimentId)` |
| `frontend/app/experiments/[id]/trial/[trialId]/trial-client.tsx` | Add "Dataset Evaluation" tab with per-row table |
| `frontend/app/experiments/[id]/evolution/page.tsx` | New static page shell |
| `frontend/app/experiments/[id]/evolution/evolution-client.tsx` | New React Flow canvas: generations as lanes, genes as nodes, mutation edges |
| `frontend/components/nav.tsx` | Add "Evolution" link to experiment nav |

---

## Task 1: Add `EvalRowResult` to shared results

**Files:**
- Modify: `backend/shared/results.py`

- [ ] **Step 1: Add `EvalRowResult` dataclass after `Score`**

```python
@dataclass
class EvalRowResult:
    row_index: int
    input_json: str        # JSON string of the dataset row dict
    output_text: str
    score: float           # quality 0–1
    score_reasoning: str   # LLM judge reason or empty string
    latency_ms: int
    cost_usd: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "row_index": self.row_index,
            "input_json": self.input_json,
            "output_text": self.output_text,
            "score": self.score,
            "score_reasoning": self.score_reasoning,
            "latency_ms": self.latency_ms,
            "cost_usd": self.cost_usd,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "EvalRowResult":
        return cls(
            row_index=d["row_index"],
            input_json=d["input_json"],
            output_text=d["output_text"],
            score=d["score"],
            score_reasoning=d.get("score_reasoning", ""),
            latency_ms=d["latency_ms"],
            cost_usd=d["cost_usd"],
        )
```

- [ ] **Step 2: Extend `TrialResult` in `backend/engine/gp/loop.py` with lineage fields**

In `loop.py`, update the `TrialResult` dataclass (currently at top of file, imported by store.py):

```python
@dataclass
class TrialResult:
    gene: Gene
    generation: int
    input: str
    run_result: RunResult
    scores: list[Score]
    pareto: ParetoPoint
    fitness: float
    parent_gene_ids: list[str] = field(default_factory=list)   # ADD
    mutation_op: str = "seed"                                   # ADD
    eval_rows: list["EvalRowResult"] = field(default_factory=list)  # ADD
```

Add import at top of `loop.py`:
```python
from dataclasses import dataclass, field
from backend.shared.results import RunResult, Score, ParetoPoint, EvalRowResult
```

- [ ] **Step 3: Run existing tests to confirm nothing broken**

```bash
cd /Users/deil/Development/autoaw && python -m pytest tests/ -x -q 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add backend/shared/results.py backend/engine/gp/loop.py
git commit -m "feat: add EvalRowResult dataclass and lineage fields to TrialResult"
```

---

## Task 2: Update GP loop to evaluate all dataset rows and track lineage

**Files:**
- Modify: `backend/engine/gp/loop.py`

- [ ] **Step 1: Replace `_evaluate_gene` to run all dataset rows**

Replace the existing `_evaluate_gene` method with:

```python
def _evaluate_gene(
    self,
    gene: Gene,
    generation: int,
    parent_gene_ids: list[str] | None = None,
    mutation_op: str = "seed",
) -> tuple[float, ParetoPoint, list[EvalRowResult]]:
    """Evaluate a gene on ALL dataset rows. Thread-safe."""
    eval_rows: list[EvalRowResult] = []
    total_quality = 0.0
    total_cost = 0.0
    total_latency = 0

    for idx, sample in enumerate(self.dataset):
        run_result = self.runner.run(gene, sample["input"])

        with self._lock:
            self._trial_count += 1
            self._total_cost += run_result.cost_usd

        scores = [
            ev.score(sample["input"], run_result.output, sample.get("expected"))
            for ev in self.evaluators
        ]
        avg_quality = sum(s.quality for s in scores) / len(scores) if scores else 0.0
        reasoning = ""
        if scores:
            reasoning = scores[0].metadata.get("reason", "")

        eval_rows.append(
            EvalRowResult(
                row_index=idx,
                input_json=json.dumps(sample),
                output_text=run_result.output,
                score=avg_quality,
                score_reasoning=reasoning,
                latency_ms=run_result.latency_ms,
                cost_usd=run_result.cost_usd,
            )
        )
        total_quality += avg_quality
        total_cost += run_result.cost_usd
        total_latency += run_result.latency_ms

        if self._budget_exceeded():
            break

    n = len(eval_rows) or 1
    avg_quality = total_quality / n
    max_cost = self.config.budget_max_usd or 1.0
    pareto = ParetoPoint(
        quality=avg_quality,
        cost_usd=total_cost / n,
        latency_ms=int(total_latency / n),
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
                input=self.dataset[0]["input"] if self.dataset else "",
                run_result=eval_rows[0].__dict__ if eval_rows else RunResult(
                    output="", token_usage={}, latency_ms=0, cost_usd=0.0
                ),
                scores=scores if eval_rows else [],
                pareto=pareto,
                fitness=fitness,
                parent_gene_ids=parent_gene_ids or [],
                mutation_op=mutation_op,
                eval_rows=eval_rows,
            )
        )
    return fitness, pareto, eval_rows
```

Note: `json` is already imported in `loop.py` — add it if missing (`import json` at top).

- [ ] **Step 2: Update `_evaluate_generation` to accept and pass lineage args**

Replace `_evaluate_generation` with:

```python
def _evaluate_generation(
    self,
    population: list[tuple[Gene, list[str], str]],  # (gene, parent_ids, mutation_op)
    generation: int,
) -> list[tuple[Gene, float]]:
    """Evaluate all genes in a generation, up to config.concurrency in parallel."""
    concurrency = max(1, self.config.concurrency)
    scored: list[tuple[Gene, float]] = []

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        future_to_gene = {
            executor.submit(
                self._evaluate_gene, gene, generation, parent_ids, mut_op
            ): gene
            for gene, parent_ids, mut_op in population
            if not self._budget_exceeded()
        }
        for future in as_completed(future_to_gene):
            if self._budget_exceeded():
                break
            fitness, _, _ = future.result()
            scored.append((future_to_gene[future], fitness))

    return scored
```

- [ ] **Step 3: Update `run()` to pass lineage info when creating offspring**

Replace the reproduction block in `run()`. The initial population uses `mutation_op="seed"` and `parent_gene_ids=[]`. For each new offspring track the op and parent:

```python
def run(self) -> Gene:
    """Run the GP loop and return the best gene found."""
    seed_genes = seed_population(self.config)
    # Wrap seeds: (gene, parent_ids, mutation_op)
    population: list[tuple[Gene, list[str], str]] = [
        (g, [], "seed") for g in seed_genes
    ]
    best_gene = seed_genes[0]
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
                    child = mutate_prompt(parent1, provider_config=self.config.provider)
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

    return best_gene
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/deil/Development/autoaw && python -m pytest tests/ -x -q 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add backend/engine/gp/loop.py
git commit -m "feat: GP loop evaluates all dataset rows per trial and tracks mutation lineage"
```

---

## Task 3: Update store — schema migration + new methods

**Files:**
- Modify: `backend/api/store.py`

- [ ] **Step 1: Add new SQL DDL constants at the top of store.py**

After `_CREATE_TRIALS`, add:

```python
_ALTER_TRIALS_PARENT = """
ALTER TABLE trials ADD COLUMN parent_gene_ids TEXT NOT NULL DEFAULT '[]'
"""

_ALTER_TRIALS_MUTATION_OP = """
ALTER TABLE trials ADD COLUMN mutation_op TEXT NOT NULL DEFAULT 'seed'
"""

_CREATE_EVAL_ROWS = """
CREATE TABLE IF NOT EXISTS eval_rows (
    id              TEXT PRIMARY KEY,
    trial_id        TEXT NOT NULL REFERENCES trials(id),
    row_index       INTEGER NOT NULL,
    input_json      TEXT NOT NULL,
    output_text     TEXT NOT NULL DEFAULT '',
    score           REAL NOT NULL,
    score_reasoning TEXT NOT NULL DEFAULT '',
    latency_ms      INTEGER NOT NULL DEFAULT 0,
    cost_usd        REAL NOT NULL DEFAULT 0.0
)
"""
```

- [ ] **Step 2: Update `init_db` to run the migration and create eval_rows**

Replace `init_db` with:

```python
def init_db(self) -> None:
    conn = self._conn()
    conn.execute(_CREATE_EXPERIMENTS)
    conn.execute(_CREATE_TRIALS)
    conn.execute(_CREATE_EVAL_ROWS)
    # Idempotent ALTER TABLE — ignore if columns already exist
    for stmt in (_ALTER_TRIALS_PARENT, _ALTER_TRIALS_MUTATION_OP):
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass  # Column already exists
    conn.commit()
```

- [ ] **Step 3: Update `put_trial_result` to persist new columns and eval_rows**

Replace `put_trial_result` with:

```python
def put_trial_result(self, experiment_id: str, result: TrialResult) -> None:
    trial_id = str(uuid.uuid4())
    now = _now()
    self._conn().execute(
        "INSERT INTO trials "
        "(id, experiment_id, generation, gene_id, gene_json, "
        " fitness, quality, cost_usd, latency_ms, created_at, "
        " parent_gene_ids, mutation_op) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            trial_id,
            experiment_id,
            result.generation,
            result.gene.id,
            json.dumps(result.gene.to_dict()),
            result.fitness,
            result.pareto.quality,
            result.pareto.cost_usd,
            result.pareto.latency_ms,
            now,
            json.dumps(result.parent_gene_ids),
            result.mutation_op,
        ),
    )
    for row in result.eval_rows:
        self._conn().execute(
            "INSERT INTO eval_rows "
            "(id, trial_id, row_index, input_json, output_text, score, "
            " score_reasoning, latency_ms, cost_usd) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                trial_id,
                row.row_index,
                row.input_json,
                row.output_text,
                row.score,
                row.score_reasoning,
                row.latency_ms,
                row.cost_usd,
            ),
        )
    self._conn().commit()
```

- [ ] **Step 4: Add `get_eval_rows` method**

Add after `list_trials`:

```python
def get_eval_rows(self, trial_id: str) -> list[dict[str, Any]]:
    rows = (
        self._conn()
        .execute(
            "SELECT * FROM eval_rows WHERE trial_id = ? ORDER BY row_index ASC",
            (trial_id,),
        )
        .fetchall()
    )
    return [dict(r) for r in rows]
```

- [ ] **Step 5: Add `list_trials_lineage` method (returns all trials for lineage graph)**

```python
def list_trials_lineage(self, experiment_id: str) -> list[dict[str, Any]]:
    rows = (
        self._conn()
        .execute(
            "SELECT id, gene_id, generation, fitness, quality, cost_usd, latency_ms, "
            "       parent_gene_ids, mutation_op, created_at "
            "FROM trials WHERE experiment_id = ? ORDER BY generation ASC, created_at ASC",
            (experiment_id,),
        )
        .fetchall()
    )
    return [dict(r) for r in rows]
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/deil/Development/autoaw && python -m pytest tests/ -x -q 2>&1 | head -40
```

- [ ] **Step 7: Commit**

```bash
git add backend/api/store.py
git commit -m "feat: store eval_rows per trial and parent_gene_ids/mutation_op in trials"
```

---

## Task 4: Add new API endpoints

**Files:**
- Modify: `backend/api/app.py`

- [ ] **Step 1: Add eval-rows endpoint**

Add after the existing `get_trial` handler:

```python
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
```

- [ ] **Step 2: Add lineage endpoint**

Add after the eval-rows endpoint:

```python
@app.get("/experiments/{experiment_id}/lineage")
def get_experiment_lineage(experiment_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    trials = _store.list_trials_lineage(experiment_id)
    # Deserialize parent_gene_ids JSON string to list
    for t in trials:
        t["parent_gene_ids"] = json.loads(t.get("parent_gene_ids") or "[]")
    return trials
```

- [ ] **Step 3: Start server and manually verify endpoints exist**

```bash
cd /Users/deil/Development/autoaw && uvicorn backend.api.app:app --reload --port 8000 &
sleep 2
curl -s http://localhost:8000/health | python3 -m json.tool
# Expect: {"status": "ok"}
pkill -f "uvicorn backend.api.app"
```

- [ ] **Step 4: Commit**

```bash
git add backend/api/app.py
git commit -m "feat: add eval-rows and lineage API endpoints"
```

---

## Task 5: Update frontend types and API client

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Extend `Trial` and add `EvalRow`, `LineageNode` in types.ts**

Add to `frontend/lib/types.ts` after the existing `Trial` interface:

```typescript
// Extended trial with lineage fields (returned by GET /trials and GET /lineage)
export interface Trial {
  id: string;
  experiment_id: string;
  generation: number;
  gene_id: string;
  gene_json: string;
  fitness: number;
  quality: number;
  cost_usd: number;
  latency_ms: number;
  created_at: string;
  parent_gene_ids: string[];   // ADD
  mutation_op: string;          // ADD
}

export interface EvalRow {
  id: string;
  trial_id: string;
  row_index: number;
  input_json: string;   // JSON string — parse to display
  output_text: string;
  score: number;
  score_reasoning: string;
  latency_ms: number;
  cost_usd: number;
}

export interface LineageNode {
  id: string;           // trial id
  gene_id: string;
  generation: number;
  fitness: number;
  quality: number;
  cost_usd: number;
  latency_ms: number;
  parent_gene_ids: string[];
  mutation_op: string;
  created_at: string;
}
```

Replace the existing `Trial` interface (lines 72–83 of types.ts) with the new version above.

- [ ] **Step 2: Add `evalRows` and `lineage` to api.ts**

Add to `frontend/lib/api.ts` inside the `api` object:

In `trials`:
```typescript
evalRows: (experimentId: string, trialId: string) =>
  request<EvalRow[]>(
    `/experiments/${experimentId}/trials/${trialId}/eval-rows`
  ),
```

In `experiments`:
```typescript
lineage: (experimentId: string) =>
  request<LineageNode[]>(`/experiments/${experimentId}/lineage`),
```

Update the import at the top of `api.ts`:
```typescript
import type { Experiment, ExperimentConfig, Trial, EvalRow, LineageNode } from "@/lib/types";
```

- [ ] **Step 3: Run TypeScript compiler to check**

```bash
cd /Users/deil/Development/autoaw/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts
git commit -m "feat: add EvalRow and LineageNode types, extend API client"
```

---

## Task 6: Add Dataset Evaluation tab to trial detail page

**Files:**
- Modify: `frontend/app/experiments/[id]/trial/[trialId]/trial-client.tsx`

- [ ] **Step 1: Replace trial-client.tsx with tabbed version**

```tsx
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Trial, EvalRow } from "@/lib/types";
import type { Gene } from "@/lib/types";
import { GeneViewer } from "@/components/gene-viewer";

interface MetricCardProps {
  label: string;
  value: string;
}
function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

export function TrialClient({
  experimentId,
  trialId,
}: {
  experimentId: string;
  trialId: string;
}) {
  const [trial, setTrial] = useState<Trial | null>(null);
  const [evalRows, setEvalRows] = useState<EvalRow[] | null>(null);
  const [tab, setTab] = useState<"gene" | "evals">("gene");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.trials.get(experimentId, trialId),
      api.trials.evalRows(experimentId, trialId),
    ]).then(([t, rows]) => {
      setTrial(t);
      setEvalRows(rows);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [experimentId, trialId]);

  if (loading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (!trial) return <p className="p-8 text-destructive">Trial not found.</p>;

  const gene: Gene = JSON.parse(trial.gene_json);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Trial {trial.id}</h1>
        <p className="text-sm text-muted-foreground">
          Generation {trial.generation} · {trial.mutation_op || "seed"}
          {trial.parent_gene_ids?.length > 0 && (
            <> · parent: {trial.parent_gene_ids.join(", ")}</>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Fitness" value={trial.fitness.toFixed(4)} />
        <MetricCard label="Quality" value={(trial.quality * 100).toFixed(1) + "%"} />
        <MetricCard label="Cost" value={"$" + trial.cost_usd.toFixed(6)} />
        <MetricCard label="Latency" value={trial.latency_ms + " ms"} />
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-4">
        {(["gene", "evals"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "gene" ? "Gene Inspector" : `Dataset Evaluation (${evalRows?.length ?? 0})`}
          </button>
        ))}
      </div>

      {tab === "gene" && <GeneViewer gene={gene} />}

      {tab === "evals" && (
        <EvalRowsTable rows={evalRows ?? []} />
      )}
    </div>
  );
}

function EvalRowsTable({ rows }: { rows: EvalRow[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No per-row evaluation data recorded for this trial.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 pr-4 w-12 font-medium text-muted-foreground">#</th>
            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Input</th>
            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Output</th>
            <th className="text-right py-2 w-20 font-medium text-muted-foreground">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            let inputDisplay = row.input_json;
            try {
              const parsed = JSON.parse(row.input_json);
              inputDisplay = parsed.input ?? JSON.stringify(parsed);
            } catch {}
            const isExpanded = expanded === row.row_index;
            return (
              <>
                <tr
                  key={row.row_index}
                  className="border-b cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpanded(isExpanded ? null : row.row_index)}
                >
                  <td className="py-2 pr-4 text-muted-foreground">{row.row_index}</td>
                  <td className="py-2 pr-4 max-w-xs truncate">{inputDisplay}</td>
                  <td className="py-2 pr-4 max-w-xs truncate">{row.output_text}</td>
                  <td className="py-2 text-right">
                    <span
                      className={`font-mono ${
                        row.score >= 0.7
                          ? "text-green-600"
                          : row.score >= 0.4
                          ? "text-yellow-600"
                          : "text-red-600"
                      }`}
                    >
                      {(row.score * 100).toFixed(0)}%
                    </span>
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${row.row_index}-expanded`} className="bg-muted/20">
                    <td colSpan={4} className="py-4 px-4">
                      <div className="space-y-2">
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase">Full Input</p>
                          <pre className="mt-1 text-xs whitespace-pre-wrap break-all">{row.input_json}</pre>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase">Full Output</p>
                          <pre className="mt-1 text-xs whitespace-pre-wrap break-all">{row.output_text}</pre>
                        </div>
                        {row.score_reasoning && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase">Judge Reasoning</p>
                            <p className="mt-1 text-xs">{row.score_reasoning}</p>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Latency: {row.latency_ms}ms · Cost: ${row.cost_usd.toFixed(6)}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/deil/Development/autoaw/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/experiments/\[id\]/trial/\[trialId\]/trial-client.tsx
git commit -m "feat: add Dataset Evaluation tab to trial detail page"
```

---

## Task 7: Create Evolution Canvas page

**Files:**
- Create: `frontend/app/experiments/[id]/evolution/page.tsx`
- Create: `frontend/app/experiments/[id]/evolution/evolution-client.tsx`

- [ ] **Step 1: Install React Flow**

```bash
cd /Users/deil/Development/autoaw/frontend && npm install @xyflow/react
```

Expected: package added successfully.

- [ ] **Step 2: Create the static page shell**

Create `frontend/app/experiments/[id]/evolution/page.tsx`:

```tsx
import { EvolutionClient } from "./evolution-client";

export default function EvolutionPage({
  params,
}: {
  params: { id: string };
}) {
  return <EvolutionClient experimentId={params.id} />;
}
```

- [ ] **Step 3: Create the evolution client component**

Create `frontend/app/experiments/[id]/evolution/evolution-client.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/api";
import type { LineageNode } from "@/lib/types";
import { useRouter } from "next/navigation";

const MUTATION_COLORS: Record<string, string> = {
  seed: "#6366f1",
  survived: "#64748b",
  mutate_structure: "#f59e0b",
  mutate_prompt: "#10b981",
  mutate_param: "#3b82f6",
  crossover_subgraph: "#ec4899",
  crossover_prompt: "#8b5cf6",
};

const NODE_WIDTH = 160;
const NODE_HEIGHT = 80;
const H_GAP = 40;
const V_GAP = 120;

function buildGraph(
  lineage: LineageNode[],
  experimentId: string
): { nodes: Node[]; edges: Edge[] } {
  // Group by generation
  const byGen = new Map<number, LineageNode[]>();
  for (const n of lineage) {
    const arr = byGen.get(n.generation) ?? [];
    arr.push(n);
    byGen.set(n.generation, arr);
  }

  // Find best per generation
  const bestByGen = new Map<number, string>();
  for (const [gen, nodes] of byGen) {
    const best = nodes.reduce((a, b) => (b.fitness > a.fitness ? b : a));
    bestByGen.set(gen, best.id);
  }

  // gene_id → trial id lookup (use latest trial per gene_id)
  const geneToTrial = new Map<string, string>();
  for (const n of lineage) {
    geneToTrial.set(n.gene_id, n.id);
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const [gen, genNodes] of Array.from(byGen.entries()).sort(
    ([a], [b]) => a - b
  )) {
    genNodes.forEach((n, idx) => {
      const x = idx * (NODE_WIDTH + H_GAP);
      const y = gen * (NODE_HEIGHT + V_GAP);
      const isBest = bestByGen.get(gen) === n.id;
      const color = MUTATION_COLORS[n.mutation_op] ?? "#94a3b8";

      nodes.push({
        id: n.id,
        position: { x, y },
        data: {
          label: (
            <div
              style={{
                fontSize: 11,
                lineHeight: 1.4,
                textAlign: "center",
                padding: "4px 6px",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  color,
                  textTransform: "uppercase",
                  fontSize: 9,
                  letterSpacing: "0.05em",
                }}
              >
                {n.mutation_op}
              </div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {(n.fitness * 100).toFixed(1)}%
              </div>
              <div style={{ color: "#64748b", fontSize: 10 }}>
                {n.gene_id.slice(0, 10)}
              </div>
            </div>
          ),
          trialId: n.id,
          experimentId,
        },
        style: {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          border: isBest ? "2px solid #f59e0b" : `1px solid ${color}`,
          borderRadius: 8,
          background: isBest ? "#fffbeb" : "#f8fafc",
          cursor: "pointer",
        },
      });

      // Edges from parents
      for (const parentGeneId of n.parent_gene_ids) {
        const parentTrialId = geneToTrial.get(parentGeneId);
        if (parentTrialId) {
          edges.push({
            id: `${parentTrialId}->${n.id}`,
            source: parentTrialId,
            target: n.id,
            label: n.mutation_op,
            style: { stroke: color, strokeWidth: 1.5 },
            labelStyle: { fontSize: 9, fill: color },
          });
        }
      }
    });
  }

  return { nodes, edges };
}

export function EvolutionClient({ experimentId }: { experimentId: string }) {
  const [lineage, setLineage] = useState<LineageNode[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    api.experiments
      .lineage(experimentId)
      .then((data) => {
        setLineage(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [experimentId]);

  const { nodes, edges } = useMemo(
    () => buildGraph(lineage, experimentId),
    [lineage, experimentId]
  );

  // Generation lane labels (rendered as non-interactive overlay nodes)
  const laneNodes: Node[] = useMemo(() => {
    const gens = new Set(lineage.map((n) => n.generation));
    return Array.from(gens).map((gen) => ({
      id: `lane-${gen}`,
      position: { x: -120, y: gen * (NODE_HEIGHT + V_GAP) + NODE_HEIGHT / 4 },
      data: { label: `Gen ${gen}` },
      style: {
        width: 80,
        height: 32,
        fontSize: 12,
        fontWeight: 600,
        color: "#64748b",
        background: "transparent",
        border: "none",
        pointerEvents: "none" as const,
      },
      selectable: false,
      draggable: false,
    }));
  }, [lineage]);

  if (loading) {
    return <p className="p-8 text-muted-foreground">Loading evolution data…</p>;
  }

  if (lineage.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-2">Evolution Canvas</h1>
        <p className="text-muted-foreground">
          No trials recorded yet. Start the experiment to see the population evolve.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="p-6 border-b flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Evolution Canvas</h1>
          <p className="text-sm text-muted-foreground">
            {lineage.length} trials across{" "}
            {new Set(lineage.map((n) => n.generation)).size} generations. Click a
            node to inspect the trial.
          </p>
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(MUTATION_COLORS).map(([op, color]) => (
            <span
              key={op}
              className="text-xs px-2 py-0.5 rounded-full border"
              style={{ borderColor: color, color }}
            >
              {op}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1">
        <ReactFlow
          nodes={[...laneNodes, ...nodes]}
          edges={edges}
          fitView
          onNodeClick={(_, node) => {
            if (node.data?.trialId) {
              router.push(
                `/experiments/${experimentId}/trial/${node.data.trialId}`
              );
            }
          }}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd /Users/deil/Development/autoaw/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app/experiments/\[id\]/evolution/
git commit -m "feat: add React Flow evolution canvas showing population lineage"
```

---

## Task 8: Add Evolution nav link

**Files:**
- Modify: `frontend/components/nav.tsx` (or wherever experiment sub-navigation lives)

- [ ] **Step 1: Read the current nav component**

Read `frontend/components/nav.tsx` to see current link structure, then add an "Evolution" link alongside existing experiment-level links (Monitor, Leaderboard, etc.).

The link should be:
```tsx
<Link href={`/experiments/${id}/evolution`}>Evolution</Link>
```

Match the styling of existing nav links exactly.

- [ ] **Step 2: TypeScript check + dev server smoke test**

```bash
cd /Users/deil/Development/autoaw/frontend && npx tsc --noEmit 2>&1 | head -30
```

Start dev server manually and navigate to `/experiments/test/evolution` to confirm the page loads without JS errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/nav.tsx
git commit -m "feat: add Evolution link to experiment navigation"
```

---

## Self-Review

**Spec coverage:**
- ✅ Per-datapoint eval logs on trial detail page (Task 6)
- ✅ Population view / evolution canvas with React Flow (Task 7)
- ✅ Lineage tracking — parent_gene_ids + mutation_op (Tasks 1–3)
- ✅ All generations as rows of genes (Task 7 `buildGraph`)
- ✅ Mutation transitions shown as labeled edges (Task 7)
- ✅ Nav link to evolution page (Task 8)
- ✅ DB schema migration is idempotent (Task 3 `init_db`)

**Type consistency check:**
- `EvalRowResult` defined in Task 1 → used in Tasks 2, 3 ✅
- `TrialResult.parent_gene_ids`, `.mutation_op`, `.eval_rows` defined in Task 1 → used in Tasks 2 and 3 ✅
- `LineageNode` defined in Task 5 → used in Task 7 ✅
- `api.trials.evalRows` defined in Task 5 → used in Task 6 ✅
- `api.experiments.lineage` defined in Task 5 → used in Task 7 ✅

**Placeholders:** None found.
