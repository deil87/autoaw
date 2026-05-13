# WorkBench Integration Design

**Date:** 2026-05-13  
**Status:** Approved  
**Scope:** Local prototype only (no AWS deployment changes)

---

## Overview

Integrate the [WorkBench benchmark](https://huggingface.co/datasets/olly-styles/WorkBench) (arXiv:2405.00823) into AutoAW so users can launch a GP experiment that optimises multi-agent workflows against 690 workplace tasks.

WorkBench differs from AutoAW's existing text-comparison benchmarks: success is defined by whether the agent called the **correct tools with the correct arguments**, not by the content of the text reply. Evaluation is trace-based (mock tool stubs log calls; no real database is mutated).

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sandbox DB fidelity | Mock (trace-based) | Real DB state not needed when tool stubs capture calls |
| Dataset sourcing | Download from HuggingFace, store in `datasets/workbench.json` | Reproducible, no manual steps |
| What GP evolves | Full topology (agents, prompts, params, tool subsets per node) | Maximum optimisation surface |
| Tool implementation | Stubs — log call, return canned response | Sufficient for trace evaluation |
| Scoring | Partial credit: `matched / total expected actions` | Smoother fitness landscape for GP |
| Integration pattern | Thin adapter — `WorkBenchRunner` + `WorkBenchEvaluator` implement existing interfaces | No changes to GP loop |

---

## Components

### 1. Dataset: `datasets/workbench.json`

Downloaded by `scripts/download_workbench.py` from `olly-styles/WorkBench` (HuggingFace `datasets` library).

Schema (extends existing dataset format):

```json
[
  {
    "id": "wb_001",
    "input": "Schedule a meeting with Alice tomorrow at 2pm",
    "expected": "[{\"tool\": \"create_calendar_event\", \"args\": {\"title\": \"Meeting with Alice\", \"datetime\": \"2025-01-15T14:00:00\"}}]",
    "workbench_meta": {
      "expected_actions": [
        {"tool": "create_calendar_event", "args": {"title": "Meeting with Alice", "datetime": "2025-01-15T14:00:00"}}
      ],
      "category": "calendar",
      "difficulty": "easy"
    }
  }
]
```

**Note:** The `expected` field is a JSON-serialised list of `{tool, args}` objects. This allows the existing `Evaluator` interface (`score(input, output, expected: str)`) to be used without changes. The `workbench_meta` field preserves the richer original structure for analysis.

The download script:
- Fetches the HuggingFace dataset split (`train` or all splits if no train/test split exists).
- Writes `datasets/workbench.json`.
- Is idempotent: if the file already exists and `--force` is not passed, it skips the download.

`datasets/workbench.json` is added to `.gitignore` (large file); the script is the canonical way to obtain it.

---

### 2. Tool Stubs: `backend/engine/workbench/tools.py`

Defines the 26 WorkBench stub tools and a thread-local call log.

**`ToolCall`** — dataclass with `tool: str`, `args: dict`.

**`ToolCallLog`** — thread-local list of `ToolCall` objects, reset at the start of each `WorkBenchRunner.run()` call. Thread-local isolation ensures parallel trials within an experiment don't contaminate each other's logs.

Public API:
```python
def reset_tool_call_log() -> None: ...
def get_tool_call_log() -> list[ToolCall]: ...
def build_workbench_tools(allowed: list[str] | None = None) -> list[Tool]: ...
```

`build_workbench_tools(allowed)` returns LangChain `Tool` objects. If `allowed` is `None`, all 26 tools are returned. If `allowed` is a list of tool names, only those tools are returned (used when gene nodes specify a tool subset).

**The 26 WorkBench tools** (from the paper):

| Category | Tools |
|---|---|
| Calendar | `create_calendar_event`, `delete_calendar_event`, `update_calendar_event`, `get_calendar_events` |
| Email | `send_email`, `reply_to_email`, `forward_email`, `get_emails` |
| Database (contacts) | `add_contact`, `delete_contact`, `update_contact`, `get_contacts` |
| Database (tasks) | `create_task`, `delete_task`, `update_task`, `get_tasks` |
| Database (notes) | `create_note`, `delete_note`, `update_note`, `get_notes` |
| File ops | `create_file`, `delete_file`, `rename_file`, `move_file` |
| Miscellaneous | `set_reminder`, `search_web` |

Each stub: appends a `ToolCall` to the thread-local log, returns `"OK: <tool_name> executed"`.

---

### 3. WorkBenchRunner: `backend/engine/workbench/runner.py`

Implements `WorkflowRunner`.

```python
class WorkBenchRunner(WorkflowRunner):
    def run(self, gene: Gene, input: str) -> RunResult: ...
```

**Algorithm:**

1. Reset thread-local `ToolCallLog`.
2. Build a LangChain ReAct agent graph from the gene:
   - For each `Agent` node in `gene.agents`, create a `ChatOpenAI` with the node's `model`, `temperature`, and `system_prompt`.
   - Assign tools: if the gene node's `tools` list is non-empty, call `build_workbench_tools(node.tools)`; otherwise use all 26.
   - Wire nodes according to `gene.edges` (sequential or DAG).
3. Execute the graph on `input` with guards:
   - `max_iterations=10` (prevent infinite loops)
   - Token budget from `gene.params.get("max_tokens", 2000)`
4. Accumulate `ToolCallLog` across all agent nodes.
5. Serialise log to JSON: `json.dumps([{"tool": c.tool, "args": c.args} for c in get_tool_call_log()])`.
6. Return `RunResult(output=<log_json>, cost_usd=<tracked>, tokens_used=<tracked>)`.

Cost tracking: use the same callback pattern as `RawLLMRunner` (LangChain `get_openai_callback()`).

---

### 4. WorkBenchEvaluator: `backend/engine/workbench/evaluator.py`

Implements `Evaluator`.

```python
class WorkBenchEvaluator(Evaluator):
    def score(self, input: str, output: str, expected: str) -> Score: ...
```

**Algorithm:**

1. Parse `output` as `list[{tool, args}]` (the `ToolCallLog` JSON from `RunResult.output`). If parse fails, return `Score(quality=0.0, metadata={"error": "parse_failed"})`.
2. Parse `expected` as `list[{tool, args}]`. If empty or parse fails, return `Score(quality=1.0, metadata={"matched": 0, "total": 0})`.
3. For each expected action at index `i`:
   - Check if a logged call exists at index `i`.
   - Match condition: `logged[i].tool == expected[i].tool` AND all keys in `expected[i].args` are present in `logged[i].args` with equal values (extra keys in logged call are ignored).
4. `matched = count of matched positions`
5. `score = matched / len(expected)`
6. Return `Score(quality=score, metadata={"matched": matched, "total": len(expected)})`.

**Ordering:** Strict positional matching. A correct tool call at the wrong position counts as a miss. This is consistent with WorkBench's sequential task structure.

---

### 5. ExperimentConfig Changes: `backend/shared/experiment.py`

Two new optional fields on `ExperimentConfig`:

```python
runner_type: str = "raw_llm"      # "raw_llm" | "workbench"
evaluator_type: str = "llm_judge" # "llm_judge" | "function" | "human" | "workbench"
```

Default values preserve backward compatibility: existing experiments without these fields continue to use `RawLLMRunner` and `LLMJudgeEvaluator`.

---

### 6. ExperimentExecutor Changes: `backend/api/executor.py`

Extract `_build_runner()` and `_build_evaluator()` private methods:

```python
def _build_runner(self, config: ExperimentConfig) -> WorkflowRunner:
    if config.runner_type == "workbench":
        return WorkBenchRunner()
    return RawLLMRunner()

def _build_evaluator(self, config: ExperimentConfig) -> Evaluator:
    if config.evaluator_type == "workbench":
        return WorkBenchEvaluator()
    elif config.evaluator_type == "function":
        return FunctionEvaluator(...)
    elif config.evaluator_type == "human":
        return HumanEvaluator(...)
    return LLMJudgeEvaluator(...)
```

---

### 7. New API Endpoint: `GET /benchmarks`

Returns a static list of predefined benchmark descriptors. No DB backing — hardcoded in `app.py`.

Response schema:
```json
[
  {
    "id": "workbench",
    "name": "WorkBench",
    "description": "690 workplace tasks (calendar, email, database, files). Evaluated by tool-call trace matching.",
    "paper_url": "https://arxiv.org/abs/2405.00823",
    "dataset_id": "workbench",
    "runner_type": "workbench",
    "evaluator_type": "workbench",
    "default_objective": {
      "quality_weight": 0.7,
      "cost_weight": 0.2,
      "speed_weight": 0.1
    },
    "task_count": 690
  }
]
```

---

### 8. Gene Schema: `tools` field on `Agent`

The `Agent` dataclass in `backend/shared/gene.py` gains an optional field:

```python
tools: list[str] = field(default_factory=list)
```

An empty list means "all available tools for the configured runner". A non-empty list restricts the agent to those tool names. The GP's `mutate_structure` operator is extended to randomly add or remove tools from agent nodes (probability configurable, default 0.1 per tool per mutation).

---

### 9. Frontend: Predefined Benchmarks Section

**New component:** `frontend/components/benchmark-card.tsx`

Props: `benchmark: BenchmarkDescriptor`, `onSelect: (b: BenchmarkDescriptor) => void`.

Renders a card showing benchmark name, description, task count, and a "Use this benchmark" button.

**`frontend/app/experiments/new/page.tsx` changes:**

1. On mount, `GET /benchmarks` and render `<BenchmarkCard>` for each result above the manual form.
2. Add `runner_type` and `evaluator_type` to the form state (hidden fields, not shown in the UI).
3. When a card is selected: populate `datasetId`, `runner_type`, `evaluator_type`, `name` (pre-filled, editable).
4. Submit includes `runner_type` and `evaluator_type` in the POST body.

**`frontend/lib/types.ts`:** add `BenchmarkDescriptor` type; extend `ExperimentConfig` with `runner_type?: string`, `evaluator_type?: string`.

**`frontend/lib/api.ts`:** add `api.benchmarks.list()`.

---

## Data Flow Summary

```
User clicks "Use WorkBench" card
  → form pre-filled (dataset=workbench, runner_type=workbench, evaluator_type=workbench)
  → POST /experiments
  → ExperimentExecutor spawns GPLoop with WorkBenchRunner + WorkBenchEvaluator
  → Each trial: WorkBenchRunner builds ReAct agent from gene, runs on task input
  → Tool stubs log calls to ToolCallLog
  → RunResult.output = serialised ToolCallLog
  → WorkBenchEvaluator compares log to expected_actions → Score(quality=0..1)
  → Score stored as trial result, drives next GP generation
```

---

## File Manifest (new/changed)

| Path | Status |
|---|---|
| `scripts/download_workbench.py` | New |
| `datasets/workbench.json` | New (generated, gitignored) |
| `backend/shared/gene.py` | Changed — `tools: list[str]` on `Agent` |
| `backend/shared/experiment.py` | Changed — `runner_type`, `evaluator_type` fields |
| `backend/engine/workbench/__init__.py` | New |
| `backend/engine/workbench/tools.py` | New |
| `backend/engine/workbench/runner.py` | New |
| `backend/engine/workbench/evaluator.py` | New |
| `backend/api/app.py` | Changed — `GET /benchmarks` endpoint |
| `backend/api/executor.py` | Changed — `_build_runner`, `_build_evaluator` |
| `backend/api/tests/test_api.py` | Changed — `GET /benchmarks` tests |
| `backend/engine/workbench/tests/test_tools.py` | New |
| `backend/engine/workbench/tests/test_evaluator.py` | New |
| `backend/engine/workbench/tests/test_runner.py` | New |
| `backend/engine/workbench/tests/test_e2e.py` | New |
| `frontend/lib/types.ts` | Changed — `BenchmarkDescriptor`, extended `ExperimentConfig` |
| `frontend/lib/api.ts` | Changed — `api.benchmarks.list()` |
| `frontend/components/benchmark-card.tsx` | New |
| `frontend/app/experiments/new/page.tsx` | Changed — benchmark cards section |
| `frontend/tests/benchmark-card.test.tsx` | New |
| `frontend/tests/experiment-form-workbench.test.tsx` | New |

---

## Out of Scope (this spec)

- Real database mutations (SQLite/Postgres sandbox state)
- WorkBench eval server or remote grading
- AWS deployment changes
- SMBO polish for WorkBench (GP loop only for now)
- Leaderboard filtering by benchmark type
