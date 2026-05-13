# WorkBench Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the WorkBench benchmark into AutoAW so users can launch a GP experiment that optimises multi-agent workflows against 690 workplace tool-use tasks, evaluated by tool-call trace matching.

**Architecture:** Thin adapter pattern — `WorkBenchRunner` and `WorkBenchEvaluator` implement the existing `WorkflowRunner` / `Evaluator` interfaces. Thread-local stub tools capture all tool calls into a `ToolCallLog`. The GP loop needs no changes. `ExperimentConfig` gets `runner_type` / `evaluator_type` fields so the executor knows which runner and evaluator to instantiate.

**Tech Stack:** Python 3.12, LangChain (`langchain`, `langchain-openai`), HuggingFace `datasets` library (download script only), FastAPI, Next.js 14 App Router, shadcn/ui, Vitest.

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `scripts/download_workbench.py` | Create | Fetch WorkBench from HuggingFace, write `datasets/workbench.json` |
| `datasets/workbench.json` | Generated (gitignored) | WorkBench tasks in AutoAW dataset format |
| `backend/shared/experiment.py` | Modify | Add `runner_type`, `evaluator_type` fields to `ExperimentConfig` |
| `backend/engine/workbench/__init__.py` | Create | Empty package marker |
| `backend/engine/workbench/tools.py` | Create | 26 stub tools + thread-local `ToolCallLog` |
| `backend/engine/workbench/evaluator.py` | Create | `WorkBenchEvaluator` — trace-based partial credit scoring |
| `backend/engine/workbench/runner.py` | Create | `WorkBenchRunner` — LangChain ReAct agent from gene |
| `backend/engine/workbench/tests/__init__.py` | Create | Empty package marker |
| `backend/engine/workbench/tests/test_tools.py` | Create | Tool stub + log isolation tests |
| `backend/engine/workbench/tests/test_evaluator.py` | Create | Evaluator scoring tests |
| `backend/engine/workbench/tests/test_runner.py` | Create | Runner integration test with mock LLM |
| `backend/api/executor.py` | Modify | Add `_build_runner()` / `_build_evaluator()` using `runner_type` / `evaluator_type` |
| `backend/api/app.py` | Modify | Add `GET /benchmarks` endpoint; include `runner_type`/`evaluator_type` in `CreateExperimentRequest` |
| `backend/api/tests/test_api.py` | Modify | Add `GET /benchmarks` tests |
| `frontend/lib/types.ts` | Modify | Add `BenchmarkDescriptor`; extend `ExperimentConfig` with `runner_type?`, `evaluator_type?` |
| `frontend/lib/api.ts` | Modify | Add `api.benchmarks.list()` |
| `frontend/components/benchmark-card.tsx` | Create | Card UI component for a single benchmark |
| `frontend/app/experiments/new/page.tsx` | Modify | Fetch benchmarks, render cards above form |
| `frontend/components/experiment-form.tsx` | Modify | Accept `runner_type` / `evaluator_type` in initial values; include in POST body |
| `frontend/tests/benchmark-card.test.tsx` | Create | Card render + onSelect callback test |
| `frontend/tests/experiment-form-workbench.test.tsx` | Create | WorkBench pre-fill + submit test |

---

## Task 1: Tool stubs and ToolCallLog

**Files:**
- Create: `backend/engine/workbench/__init__.py`
- Create: `backend/engine/workbench/tools.py`
- Create: `backend/engine/workbench/tests/__init__.py`
- Create: `backend/engine/workbench/tests/test_tools.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/engine/workbench/tests/test_tools.py`:

```python
from __future__ import annotations
import threading
import pytest
from backend.engine.workbench.tools import (
    reset_tool_call_log,
    get_tool_call_log,
    build_workbench_tools,
    ToolCall,
    ALL_TOOL_NAMES,
)


def test_tool_call_logged():
    reset_tool_call_log()
    tools = build_workbench_tools()
    tool = next(t for t in tools if t.name == "create_calendar_event")
    result = tool.func(title="standup", datetime="2026-01-01T09:00:00")
    log = get_tool_call_log()
    assert len(log) == 1
    assert log[0].tool == "create_calendar_event"
    assert log[0].args["title"] == "standup"
    assert "OK" in result


def test_reset_clears_log():
    reset_tool_call_log()
    tools = build_workbench_tools()
    tool = next(t for t in tools if t.name == "send_email")
    tool.func(to="a@b.com", subject="hi", body="hello")
    reset_tool_call_log()
    assert get_tool_call_log() == []


def test_allowed_filter():
    allowed = ["send_email", "get_emails"]
    tools = build_workbench_tools(allowed=allowed)
    names = {t.name for t in tools}
    assert names == {"send_email", "get_emails"}


def test_all_26_tools_present():
    tools = build_workbench_tools()
    names = {t.name for t in tools}
    assert len(names) == 26
    assert names == set(ALL_TOOL_NAMES)


def test_thread_local_isolation():
    """Two threads each have their own independent log."""
    reset_tool_call_log()

    barrier = threading.Barrier(2)
    results: dict[int, list[ToolCall]] = {}

    def worker(thread_id: int, tool_name: str):
        reset_tool_call_log()
        barrier.wait()  # both threads start together
        tools = build_workbench_tools()
        tool = next(t for t in tools if t.name == tool_name)
        tool.func()
        results[thread_id] = list(get_tool_call_log())

    t1 = threading.Thread(target=worker, args=(1, "search_web"), kwargs={})
    t2 = threading.Thread(target=worker, args=(2, "set_reminder"), kwargs={})

    # Fix: worker signature must accept **kwargs for tool.func() call
    def worker2(thread_id: int, tool_name: str, kwargs: dict):
        reset_tool_call_log()
        barrier.wait()
        tools = build_workbench_tools()
        tool = next(t for t in tools if t.name == tool_name)
        tool.func(**kwargs)
        results[thread_id] = list(get_tool_call_log())

    barrier2 = threading.Barrier(2)
    results2: dict[int, list[ToolCall]] = {}

    def worker3(thread_id: int, tool_name: str, kwargs: dict):
        reset_tool_call_log()
        barrier2.wait()
        tools = build_workbench_tools()
        tool = next(t for t in tools if t.name == tool_name)
        tool.func(**kwargs)
        results2[thread_id] = list(get_tool_call_log())

    t1 = threading.Thread(target=worker3, args=(1, "search_web", {"query": "test"}))
    t2 = threading.Thread(target=worker3, args=(2, "set_reminder", {"message": "hi", "datetime": "2026-01-01T10:00:00"}))
    t1.start(); t2.start()
    t1.join(); t2.join()

    assert len(results2[1]) == 1 and results2[1][0].tool == "search_web"
    assert len(results2[2]) == 1 and results2[2][0].tool == "set_reminder"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /path/to/autoaw
python -m pytest backend/engine/workbench/tests/test_tools.py -v 2>&1 | head -30
```

Expected: ImportError or ModuleNotFoundError — `backend.engine.workbench.tools` does not exist yet.

- [ ] **Step 3: Create package markers**

Create `backend/engine/workbench/__init__.py` (empty):
```python
```

Create `backend/engine/workbench/tests/__init__.py` (empty):
```python
```

- [ ] **Step 4: Implement `backend/engine/workbench/tools.py`**

```python
from __future__ import annotations
import threading
from dataclasses import dataclass, field
from typing import Any
from langchain_core.tools import Tool

# --------------------------------------------------------------------------- #
# All 26 WorkBench tool names                                                  #
# --------------------------------------------------------------------------- #
ALL_TOOL_NAMES: list[str] = [
    # Calendar
    "create_calendar_event",
    "delete_calendar_event",
    "update_calendar_event",
    "get_calendar_events",
    # Email
    "send_email",
    "reply_to_email",
    "forward_email",
    "get_emails",
    # Contacts
    "add_contact",
    "delete_contact",
    "update_contact",
    "get_contacts",
    # Tasks
    "create_task",
    "delete_task",
    "update_task",
    "get_tasks",
    # Notes
    "create_note",
    "delete_note",
    "update_note",
    "get_notes",
    # Files
    "create_file",
    "delete_file",
    "rename_file",
    "move_file",
    # Misc
    "set_reminder",
    "search_web",
]

# --------------------------------------------------------------------------- #
# Thread-local call log                                                        #
# --------------------------------------------------------------------------- #

@dataclass
class ToolCall:
    tool: str
    args: dict[str, Any] = field(default_factory=dict)


_local = threading.local()


def reset_tool_call_log() -> None:
    """Reset the thread-local tool call log. Call at the start of each run."""
    _local.log = []


def get_tool_call_log() -> list[ToolCall]:
    """Return the current thread-local tool call log."""
    if not hasattr(_local, "log"):
        _local.log = []
    return _local.log


# --------------------------------------------------------------------------- #
# Stub tool factory                                                            #
# --------------------------------------------------------------------------- #

def _make_stub(tool_name: str) -> Tool:
    """Return a LangChain Tool that logs calls and returns a canned response."""

    def _stub(**kwargs: Any) -> str:
        log = get_tool_call_log()
        log.append(ToolCall(tool=tool_name, args=dict(kwargs)))
        return f"OK: {tool_name} executed"

    return Tool(
        name=tool_name,
        func=_stub,
        description=f"WorkBench stub for {tool_name}",
    )


_ALL_TOOLS: list[Tool] = [_make_stub(name) for name in ALL_TOOL_NAMES]
_TOOL_MAP: dict[str, Tool] = {t.name: t for t in _ALL_TOOLS}


def build_workbench_tools(allowed: list[str] | None = None) -> list[Tool]:
    """Return LangChain Tool stubs. If allowed is None, return all 26."""
    if allowed is None:
        return list(_ALL_TOOLS)
    return [_TOOL_MAP[name] for name in allowed if name in _TOOL_MAP]
```

- [ ] **Step 5: Run tests**

```bash
python -m pytest backend/engine/workbench/tests/test_tools.py -v
```

Expected: All tests pass. Note: the thread isolation test is written with a self-contained `worker3` — it should pass cleanly.

- [ ] **Step 6: Commit**

```bash
git add backend/engine/workbench/ && git commit -m "feat: add WorkBench tool stubs and ToolCallLog"
```

---

## Task 2: WorkBenchEvaluator

**Files:**
- Create: `backend/engine/workbench/evaluator.py`
- Create: `backend/engine/workbench/tests/test_evaluator.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/engine/workbench/tests/test_evaluator.py`:

```python
from __future__ import annotations
import json
import pytest
from backend.engine.workbench.evaluator import WorkBenchEvaluator


@pytest.fixture
def ev():
    return WorkBenchEvaluator()


def _log(calls: list[dict]) -> str:
    return json.dumps(calls)


def _expected(calls: list[dict]) -> str:
    return json.dumps(calls)


def test_perfect_match(ev):
    output = _log([{"tool": "send_email", "args": {"to": "a@b.com", "subject": "hi"}}])
    expected = _expected([{"tool": "send_email", "args": {"to": "a@b.com", "subject": "hi"}}])
    score = ev.score("task", output, expected)
    assert score.quality == 1.0
    assert score.metadata["matched"] == 1
    assert score.metadata["total"] == 1


def test_partial_credit(ev):
    output = _log([
        {"tool": "send_email", "args": {"to": "a@b.com", "subject": "hi"}},
        {"tool": "create_task", "args": {"title": "wrong title"}},
    ])
    expected = _expected([
        {"tool": "send_email", "args": {"to": "a@b.com", "subject": "hi"}},
        {"tool": "create_task", "args": {"title": "correct title"}},
    ])
    score = ev.score("task", output, expected)
    assert score.quality == pytest.approx(0.5)
    assert score.metadata["matched"] == 1


def test_wrong_tool(ev):
    output = _log([{"tool": "send_email", "args": {}}])
    expected = _expected([{"tool": "create_calendar_event", "args": {}}])
    score = ev.score("task", output, expected)
    assert score.quality == 0.0


def test_empty_expected(ev):
    score = ev.score("task", "[]", "[]")
    assert score.quality == 1.0
    assert score.metadata["total"] == 0


def test_bad_output_json(ev):
    score = ev.score("task", "NOT JSON", _expected([{"tool": "foo", "args": {}}]))
    assert score.quality == 0.0
    assert score.metadata.get("error") == "parse_failed"


def test_extra_args_in_log_ok(ev):
    """Extra keys in logged args are ignored."""
    output = _log([{"tool": "send_email", "args": {"to": "a@b.com", "subject": "hi", "extra": "x"}}])
    expected = _expected([{"tool": "send_email", "args": {"to": "a@b.com", "subject": "hi"}}])
    score = ev.score("task", output, expected)
    assert score.quality == 1.0


def test_wrong_position_is_miss(ev):
    """Correct tools in wrong order = miss for each out-of-position call."""
    output = _log([
        {"tool": "create_task", "args": {"title": "t"}},
        {"tool": "send_email", "args": {"to": "a@b.com"}},
    ])
    expected = _expected([
        {"tool": "send_email", "args": {"to": "a@b.com"}},
        {"tool": "create_task", "args": {"title": "t"}},
    ])
    score = ev.score("task", output, expected)
    assert score.quality == 0.0
```

- [ ] **Step 2: Run to confirm failure**

```bash
python -m pytest backend/engine/workbench/tests/test_evaluator.py -v 2>&1 | head -20
```

Expected: ImportError — `backend.engine.workbench.evaluator` does not exist.

- [ ] **Step 3: Implement `backend/engine/workbench/evaluator.py`**

```python
from __future__ import annotations
import json
from backend.engine.evaluator.base import Evaluator
from backend.shared.results import Score


class WorkBenchEvaluator(Evaluator):
    """Evaluate a WorkBench trial by comparing the tool call log to expected actions.

    output  — JSON string: list[{"tool": str, "args": dict}]
    expected — JSON string: list[{"tool": str, "args": dict}]

    Scoring: partial credit = matched_positions / len(expected).
    Matching is positional and strict on tool name; args match if all keys
    in expected[i].args are present in logged[i].args with equal values
    (extra keys in logged call are ignored).
    """

    def score(self, input: str, output: str, expected: str | None) -> Score:
        # Parse output (tool call log)
        try:
            logged: list[dict] = json.loads(output)
            if not isinstance(logged, list):
                raise ValueError("not a list")
        except Exception:
            return Score(quality=0.0, metadata={"error": "parse_failed"})

        # Parse expected actions
        try:
            expected_actions: list[dict] = json.loads(expected or "[]")
            if not isinstance(expected_actions, list):
                raise ValueError("not a list")
        except Exception:
            expected_actions = []

        if not expected_actions:
            return Score(quality=1.0, metadata={"matched": 0, "total": 0})

        matched = 0
        for i, exp in enumerate(expected_actions):
            if i >= len(logged):
                break
            log_entry = logged[i]
            if log_entry.get("tool") != exp.get("tool"):
                continue
            exp_args: dict = exp.get("args", {})
            log_args: dict = log_entry.get("args", {})
            if all(log_args.get(k) == v for k, v in exp_args.items()):
                matched += 1

        quality = matched / len(expected_actions)
        return Score(
            quality=quality,
            metadata={"matched": matched, "total": len(expected_actions)},
        )
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest backend/engine/workbench/tests/test_evaluator.py -v
```

Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/engine/workbench/evaluator.py backend/engine/workbench/tests/test_evaluator.py
git commit -m "feat: add WorkBenchEvaluator with partial credit scoring"
```

---

## Task 3: WorkBenchRunner

**Files:**
- Create: `backend/engine/workbench/runner.py`
- Create: `backend/engine/workbench/tests/test_runner.py`

Dependencies: `langchain`, `langchain-openai` must be in `requirements-local.txt`.

- [ ] **Step 1: Check/add LangChain to requirements**

Read `requirements-local.txt`. If `langchain` and `langchain-openai` are not present, add them:

```
langchain>=0.2.0
langchain-openai>=0.1.0
```

Install: `pip install langchain langchain-openai`

- [ ] **Step 2: Write the failing runner test**

Create `backend/engine/workbench/tests/test_runner.py`:

```python
from __future__ import annotations
import json
from unittest.mock import patch, MagicMock
import pytest
from backend.shared.gene import Gene, Agent, Edge, TopologyType
from backend.engine.workbench.runner import WorkBenchRunner


def _make_simple_gene() -> Gene:
    return Gene(
        topology=TopologyType.FIXED_PIPELINE,
        agents=[
            Agent(
                id="a1",
                role="assistant",
                model="gpt-4o-mini",
                system_prompt="You are a helpful workplace assistant.",
                tools=["send_email"],
                temperature=0.0,
            )
        ],
        edges=[],
    )


def _mock_agent_response(tool_name: str, tool_args: dict) -> MagicMock:
    """Return a mock AgentExecutor.invoke result that mimics a tool call."""
    # The runner calls tool stubs directly; we patch the LLM to emit a tool call
    response = MagicMock()
    response.return_value = {"output": f"I called {tool_name}"}
    return response


@patch("backend.engine.workbench.runner.ChatOpenAI")
@patch("backend.engine.workbench.runner.AgentExecutor")
def test_run_returns_tool_call_log(mock_executor_cls, mock_chat_cls):
    """Runner returns RunResult whose output is a JSON tool call log."""
    from backend.engine.workbench.tools import reset_tool_call_log, get_tool_call_log, build_workbench_tools

    gene = _make_simple_gene()

    # Simulate tool being called during agent execution
    def fake_invoke(inputs, **kwargs):
        # Directly call the stub to simulate what the agent would do
        tools = build_workbench_tools(["send_email"])
        tools[0].func(to="bob@example.com", subject="Meeting")
        return {"output": "Done"}

    mock_executor_instance = MagicMock()
    mock_executor_instance.invoke.side_effect = fake_invoke
    mock_executor_cls.return_value = mock_executor_instance

    runner = WorkBenchRunner()
    reset_tool_call_log()
    result = runner.run(gene, "Send an email to bob about the meeting")

    log = json.loads(result.output)
    assert isinstance(log, list)
    assert len(log) == 1
    assert log[0]["tool"] == "send_email"
    assert log[0]["args"]["to"] == "bob@example.com"
    assert result.cost_usd >= 0.0
    assert result.latency_ms >= 0


@patch("backend.engine.workbench.runner.ChatOpenAI")
@patch("backend.engine.workbench.runner.AgentExecutor")
def test_run_empty_log_on_no_tool_calls(mock_executor_cls, mock_chat_cls):
    mock_executor_instance = MagicMock()
    mock_executor_instance.invoke.return_value = {"output": "No tools needed"}
    mock_executor_cls.return_value = mock_executor_instance

    from backend.engine.workbench.tools import reset_tool_call_log
    gene = _make_simple_gene()
    runner = WorkBenchRunner()
    reset_tool_call_log()
    result = runner.run(gene, "Hello")
    log = json.loads(result.output)
    assert log == []
```

- [ ] **Step 3: Run to confirm failure**

```bash
python -m pytest backend/engine/workbench/tests/test_runner.py -v 2>&1 | head -20
```

Expected: ImportError — `backend.engine.workbench.runner` does not exist.

- [ ] **Step 4: Implement `backend/engine/workbench/runner.py`**

```python
from __future__ import annotations
import json
import time
from typing import Any

from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_react_agent
from langchain import hub

from backend.shared.gene import Gene, TopologyType
from backend.shared.results import RunResult
from backend.engine.runner.base import WorkflowRunner
from backend.engine.workbench.tools import (
    reset_tool_call_log,
    get_tool_call_log,
    build_workbench_tools,
)


class WorkBenchRunner(WorkflowRunner):
    """Execute a gene against a WorkBench task using LangChain ReAct agents.

    Tool calls are captured in a thread-local ToolCallLog. The RunResult.output
    is a JSON-serialised list of {"tool": str, "args": dict} entries.
    """

    def run(self, gene: Gene, input: str) -> RunResult:
        reset_tool_call_log()
        start = time.monotonic()

        # Build per-agent executors and run them in topology order
        ordered_agents = self._topological_order(gene)
        current_input = input

        for agent_def in ordered_agents:
            tools = build_workbench_tools(agent_def.tools if agent_def.tools else None)
            llm = ChatOpenAI(
                model=agent_def.model,
                temperature=agent_def.temperature,
            )

            try:
                prompt = hub.pull("hwchase17/react")
            except Exception:
                # Fallback if hub is unavailable (e.g., offline)
                from langchain_core.prompts import PromptTemplate
                prompt = PromptTemplate.from_template(
                    "{system_prompt}\n\n{tools}\n\nTool names: {tool_names}\n\n"
                    "Question: {input}\n{agent_scratchpad}"
                )

            react_agent = create_react_agent(llm=llm, tools=tools, prompt=prompt)
            executor = AgentExecutor(
                agent=react_agent,
                tools=tools,
                max_iterations=10,
                handle_parsing_errors=True,
                verbose=False,
            )
            try:
                result = executor.invoke(
                    {
                        "input": current_input,
                        "system_prompt": agent_def.system_prompt,
                    }
                )
                current_input = result.get("output", "")
            except Exception as exc:
                current_input = f"ERROR: {exc}"

        log = get_tool_call_log()
        output = json.dumps([{"tool": c.tool, "args": c.args} for c in log])
        latency_ms = int((time.monotonic() - start) * 1000)

        return RunResult(
            output=output,
            token_usage={},
            latency_ms=latency_ms,
            cost_usd=0.0,  # Cost tracking via LangChain callbacks is optional for prototype
            trace=[],
        )

    def _topological_order(self, gene: Gene) -> list:
        """Return agents in edge-defined topological order, fallback to list order.
        (Same logic as RawLLMRunner._topological_order.)
        """
        from collections import defaultdict, deque

        agent_map = {a.id: a for a in gene.agents}
        in_degree: dict[str, int] = {a.id: 0 for a in gene.agents}
        adjacency: dict[str, list[str]] = defaultdict(list)
        for edge in gene.edges:
            if edge.type == "sequential":
                adjacency[edge.from_agent].append(edge.to_agent)
                in_degree[edge.to_agent] = in_degree.get(edge.to_agent, 0) + 1
        queue = deque([aid for aid, deg in in_degree.items() if deg == 0])
        ordered = []
        while queue:
            aid = queue.popleft()
            if aid in agent_map:
                ordered.append(agent_map[aid])
            for nxt in adjacency[aid]:
                in_degree[nxt] -= 1
                if in_degree[nxt] == 0:
                    queue.append(nxt)
        seen = {a.id for a in ordered}
        ordered += [a for a in gene.agents if a.id not in seen]
        return ordered
```

- [ ] **Step 5: Run tests**

```bash
python -m pytest backend/engine/workbench/tests/test_runner.py -v
```

Expected: Both tests pass (LangChain classes are mocked).

- [ ] **Step 6: Run all backend tests to check for regressions**

```bash
python -m pytest backend/ -v --tb=short 2>&1 | tail -20
```

Expected: All previously passing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add backend/engine/workbench/runner.py backend/engine/workbench/tests/test_runner.py requirements-local.txt
git commit -m "feat: add WorkBenchRunner with LangChain ReAct agent execution"
```

---

## Task 4: ExperimentConfig — runner_type / evaluator_type

**Files:**
- Modify: `backend/shared/experiment.py`

- [ ] **Step 1: Write a failing test**

Add to `backend/api/tests/test_api.py` (find the `test_create_experiment` function and add a new test after it):

```python
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
python -m pytest backend/api/tests/test_api.py::test_create_experiment_workbench_fields -v
```

Expected: FAIL — `runner_type` is not a recognised field (422 or key error).

- [ ] **Step 3: Add fields to `ExperimentConfig`**

Edit `backend/shared/experiment.py`. Add two fields to the `ExperimentConfig` dataclass after `allowed_models`:

```python
    runner_type: str = "raw_llm"
    evaluator_type: str = "llm_judge"
```

Update `to_dict`:
```python
    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "task_description": self.task_description,
            "dataset_id": self.dataset_id,
            "evaluators": [e.to_dict() for e in self.evaluators],
            "objective_weights": self.objective_weights.to_dict(),
            "population_size": self.population_size,
            "budget_max_trials": self.budget_max_trials,
            "budget_max_usd": self.budget_max_usd,
            "convergence_patience": self.convergence_patience,
            "concurrency": self.concurrency,
            "provider": self.provider.to_dict() if self.provider else None,
            "allowed_models": list(self.allowed_models),
            "runner_type": self.runner_type,
            "evaluator_type": self.evaluator_type,
        }
```

Update `from_dict` — add after the `allowed_models=` line:
```python
            runner_type=d.get("runner_type", "raw_llm"),
            evaluator_type=d.get("evaluator_type", "llm_judge"),
```

- [ ] **Step 4: Update `CreateExperimentRequest` in `backend/api/app.py`**

Add to the `CreateExperimentRequest` Pydantic model (after `concurrency`):

```python
    runner_type: str = "raw_llm"
    evaluator_type: str = "llm_judge"
```

Update the `ExperimentConfig(...)` construction in the `POST /experiments` handler to pass these fields:

```python
        runner_type=body.runner_type,
        evaluator_type=body.evaluator_type,
```

- [ ] **Step 5: Run the new test**

```bash
python -m pytest backend/api/tests/test_api.py::test_create_experiment_workbench_fields -v
```

Expected: PASS.

- [ ] **Step 6: Run all backend tests**

```bash
python -m pytest backend/ -v --tb=short 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add backend/shared/experiment.py backend/api/app.py backend/api/tests/test_api.py
git commit -m "feat: add runner_type and evaluator_type to ExperimentConfig"
```

---

## Task 5: ExperimentExecutor — wire WorkBenchRunner / WorkBenchEvaluator

**Files:**
- Modify: `backend/api/executor.py`

- [ ] **Step 1: Write a failing test**

Add to `backend/api/tests/test_api.py`:

```python
def test_executor_uses_workbench_runner(tmp_path):
    """_run_experiment instantiates WorkBenchRunner when runner_type='workbench'."""
    from unittest.mock import patch, MagicMock
    import json as _json
    from backend.api.store import LocalStore
    from backend.api.executor import _run_experiment
    from backend.shared.experiment import ExperimentConfig, ObjectiveWeights, EvaluatorConfig

    db_path = str(tmp_path / "test.db")
    datasets_dir = str(tmp_path / "datasets")
    os.makedirs(datasets_dir)

    # Write a minimal workbench dataset
    dataset = [{"input": "task1", "expected": "[]", "id": "wb_001"}]
    with open(os.path.join(datasets_dir, "workbench.json"), "w") as f:
        _json.dump(dataset, f)

    store = LocalStore(db_path=db_path)
    store.init_db()

    config = ExperimentConfig(
        name="wb",
        task_description="test",
        dataset_id="workbench",
        evaluators=[EvaluatorConfig(type="workbench", params={})],
        objective_weights=ObjectiveWeights(quality=0.7, cost=0.2, speed=0.1),
        population_size=2,
        budget_max_trials=1,
        runner_type="workbench",
        evaluator_type="workbench",
    )
    exp_id = store.create_experiment(config)

    with patch("backend.api.executor.WorkBenchRunner") as mock_runner_cls, \
         patch("backend.api.executor.GPLoop") as mock_gp_cls, \
         patch("backend.api.executor.smbo_polish") as mock_polish:
        mock_runner_cls.return_value = MagicMock()
        mock_gp_cls.return_value.run.return_value = MagicMock(id="gene_abc")
        mock_polish.return_value = MagicMock(id="gene_abc")
        _run_experiment(exp_id, store, datasets_dir)
        mock_runner_cls.assert_called_once()
```

- [ ] **Step 2: Run to confirm failure**

```bash
python -m pytest backend/api/tests/test_api.py::test_executor_uses_workbench_runner -v
```

Expected: FAIL — `WorkBenchRunner` not imported in executor.

- [ ] **Step 3: Update `backend/api/executor.py`**

Replace the file content with:

```python
from __future__ import annotations
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor

from backend.shared.experiment import ExperimentConfig
from backend.engine.runner.base import WorkflowRunner
from backend.engine.evaluator.base import Evaluator
from backend.engine.runner.raw_llm import RawLLMRunner
from backend.engine.evaluator.llm_judge import LLMJudgeEvaluator
from backend.engine.evaluator.function_eval import FunctionEvaluator
from backend.engine.workbench.runner import WorkBenchRunner
from backend.engine.workbench.evaluator import WorkBenchEvaluator
from backend.engine.gp.loop import GPLoop
from backend.engine.smbo.polish import smbo_polish
from backend.api.store import LocalStore

log = logging.getLogger(__name__)


def _build_runner(config: ExperimentConfig) -> WorkflowRunner:
    if config.runner_type == "workbench":
        return WorkBenchRunner()
    return RawLLMRunner()


def _build_evaluators(config: ExperimentConfig) -> list[Evaluator]:
    if config.evaluator_type == "workbench":
        return [WorkBenchEvaluator()]
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
        self._pool.submit(
            _run_experiment, experiment_id, self._store, self._datasets_dir
        )

    def shutdown(self, wait: bool = False) -> None:
        self._pool.shutdown(wait=wait)
```

- [ ] **Step 4: Run the new test**

```bash
python -m pytest backend/api/tests/test_api.py::test_executor_uses_workbench_runner -v
```

Expected: PASS.

- [ ] **Step 5: Run all backend tests**

```bash
python -m pytest backend/ -v --tb=short 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add backend/api/executor.py backend/api/tests/test_api.py
git commit -m "feat: wire WorkBenchRunner and WorkBenchEvaluator in ExperimentExecutor"
```

---

## Task 6: GET /benchmarks endpoint

**Files:**
- Modify: `backend/api/app.py`
- Modify: `backend/api/tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/api/tests/test_api.py`:

```python
def test_get_benchmarks(client):
    resp = client.get("/benchmarks")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    wb = next((b for b in data if b["id"] == "workbench"), None)
    assert wb is not None
    assert wb["runner_type"] == "workbench"
    assert wb["evaluator_type"] == "workbench"
    assert wb["dataset_id"] == "workbench"
    assert wb["task_count"] == 690
    assert "default_objective" in wb
```

- [ ] **Step 2: Run to confirm failure**

```bash
python -m pytest backend/api/tests/test_api.py::test_get_benchmarks -v
```

Expected: FAIL — 404 (route doesn't exist).

- [ ] **Step 3: Add `GET /benchmarks` to `backend/api/app.py`**

Add after the existing imports/models section, before the first route:

```python
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
        "evaluator_type": "workbench",
        "default_objective": {
            "quality_weight": 0.7,
            "cost_weight": 0.2,
            "speed_weight": 0.1,
        },
        "task_count": 690,
    }
]


@app.get("/benchmarks")
def list_benchmarks():
    return _BENCHMARKS
```

- [ ] **Step 4: Run the new test**

```bash
python -m pytest backend/api/tests/test_api.py::test_get_benchmarks -v
```

Expected: PASS.

- [ ] **Step 5: Run all backend tests**

```bash
python -m pytest backend/ -v --tb=short 2>&1 | tail -10
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add backend/api/app.py backend/api/tests/test_api.py
git commit -m "feat: add GET /benchmarks endpoint"
```

---

## Task 7: Dataset download script

**Files:**
- Create: `scripts/download_workbench.py`
- Modify: `.gitignore`

- [ ] **Step 1: Check `.gitignore` for `datasets/workbench.json`**

Open `.gitignore`. Confirm `datasets/*.json` or `datasets/workbench.json` is listed (the file already ignores `datasets/*.json` with an exception for `ds1.json`). Add if missing:

```
datasets/workbench.json
```

(The existing rule `datasets/*.json` already covers this if present — just verify.)

- [ ] **Step 2: Create `scripts/download_workbench.py`**

```python
#!/usr/bin/env python3
"""Download the WorkBench dataset from HuggingFace and write datasets/workbench.json.

Usage:
    python scripts/download_workbench.py [--force] [--output PATH]

Options:
    --force     Overwrite existing file if present.
    --output    Output path (default: datasets/workbench.json).
"""
from __future__ import annotations
import argparse
import json
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Download WorkBench dataset")
    parser.add_argument("--force", action="store_true", help="Overwrite if file exists")
    parser.add_argument(
        "--output",
        default=os.path.join("datasets", "workbench.json"),
        help="Output path (default: datasets/workbench.json)",
    )
    args = parser.parse_args()

    if os.path.exists(args.output) and not args.force:
        print(f"File already exists: {args.output}  (pass --force to overwrite)")
        sys.exit(0)

    try:
        from datasets import load_dataset  # type: ignore
    except ImportError:
        print("ERROR: 'datasets' library not installed. Run: pip install datasets")
        sys.exit(1)

    print("Downloading olly-styles/WorkBench from HuggingFace…")
    ds = load_dataset("olly-styles/WorkBench", split="train")

    records = []
    for i, row in enumerate(ds):
        # Normalise field names — inspect actual schema and adapt as needed
        task_input = row.get("task") or row.get("input") or row.get("instruction") or ""
        expected_actions = row.get("actions") or row.get("expected_actions") or []
        category = row.get("category") or row.get("type") or ""
        difficulty = row.get("difficulty") or ""

        expected_str = json.dumps(expected_actions)

        records.append(
            {
                "id": f"wb_{i:04d}",
                "input": task_input,
                "expected": expected_str,
                "workbench_meta": {
                    "expected_actions": expected_actions,
                    "category": category,
                    "difficulty": difficulty,
                },
            }
        )

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(records)} records to {args.output}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the script to download the dataset**

```bash
python scripts/download_workbench.py
```

Expected: Downloads and writes `datasets/workbench.json` with ~690 records.

If the HuggingFace field names don't match (`task`, `actions`, etc.), inspect the first row and fix the field mappings in the script before committing.

Debug: `python -c "from datasets import load_dataset; ds = load_dataset('olly-styles/WorkBench', split='train'); print(ds[0])"` to see actual field names.

- [ ] **Step 4: Verify the output schema**

```bash
python -c "
import json
with open('datasets/workbench.json') as f:
    data = json.load(f)
print(f'Records: {len(data)}')
print('First record keys:', list(data[0].keys()))
print('Sample:', json.dumps(data[0], indent=2)[:500])
"
```

Expected: `Records: ~690`, keys include `id`, `input`, `expected`, `workbench_meta`.

- [ ] **Step 5: Commit script (not the data file)**

```bash
git add scripts/download_workbench.py .gitignore
git commit -m "feat: add WorkBench dataset download script"
```

---

## Task 8: Frontend — types, api client, BenchmarkCard

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/api.ts`
- Create: `frontend/components/benchmark-card.tsx`
- Create: `frontend/tests/benchmark-card.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `frontend/tests/benchmark-card.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BenchmarkCard } from "@/components/benchmark-card";
import type { BenchmarkDescriptor } from "@/lib/types";

const wb: BenchmarkDescriptor = {
  id: "workbench",
  name: "WorkBench",
  description: "690 workplace tasks.",
  paper_url: "https://arxiv.org/abs/2405.00823",
  dataset_id: "workbench",
  runner_type: "workbench",
  evaluator_type: "workbench",
  default_objective: { quality_weight: 0.7, cost_weight: 0.2, speed_weight: 0.1 },
  task_count: 690,
};

describe("BenchmarkCard", () => {
  it("renders name and task count", () => {
    render(<BenchmarkCard benchmark={wb} onSelect={vi.fn()} />);
    expect(screen.getByText("WorkBench")).toBeDefined();
    expect(screen.getByText(/690/)).toBeDefined();
  });

  it("calls onSelect with the benchmark when button clicked", () => {
    const onSelect = vi.fn();
    render(<BenchmarkCard benchmark={wb} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(wb);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd frontend && npx vitest run tests/benchmark-card.test.tsx 2>&1 | tail -20
```

Expected: FAIL — `BenchmarkCard` and `BenchmarkDescriptor` do not exist.

- [ ] **Step 3: Add `BenchmarkDescriptor` to `frontend/lib/types.ts`**

Add after the `EvaluatorConfig` interface:

```ts
export interface BenchmarkDescriptor {
  id: string;
  name: string;
  description: string;
  paper_url: string;
  dataset_id: string;
  runner_type: string;
  evaluator_type: string;
  default_objective: {
    quality_weight: number;
    cost_weight: number;
    speed_weight: number;
  };
  task_count: number;
}
```

Extend `ExperimentConfig` — add two optional fields:

```ts
  runner_type?: string;
  evaluator_type?: string;
```

Also extend `ExperimentFormInitialValues` in `frontend/components/experiment-form.tsx` — add:
```ts
  runner_type?: string;
  evaluator_type?: string;
```

- [ ] **Step 4: Add `api.benchmarks.list()` to `frontend/lib/api.ts`**

Import `BenchmarkDescriptor`:
```ts
import type { Experiment, ExperimentConfig, Trial, EvalRow, LineageNode, BenchmarkDescriptor } from "@/lib/types";
```

Add after the `datasets` key:
```ts
  benchmarks: {
    list: () => request<BenchmarkDescriptor[]>("/benchmarks"),
  },
```

- [ ] **Step 5: Create `frontend/components/benchmark-card.tsx`**

```tsx
"use client";
import { Button } from "@/components/ui/button";
import type { BenchmarkDescriptor } from "@/lib/types";

interface BenchmarkCardProps {
  benchmark: BenchmarkDescriptor;
  onSelect: (b: BenchmarkDescriptor) => void;
}

export function BenchmarkCard({ benchmark, onSelect }: BenchmarkCardProps) {
  return (
    <div className="border rounded-lg p-4 space-y-2 bg-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-base">{benchmark.name}</h3>
          <p className="text-sm text-muted-foreground">{benchmark.description}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {benchmark.task_count} tasks &middot;{" "}
            <a
              href={benchmark.paper_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              paper
            </a>
          </p>
        </div>
        <Button size="sm" onClick={() => onSelect(benchmark)}>
          Use this benchmark
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the component test**

```bash
cd frontend && npx vitest run tests/benchmark-card.test.tsx
```

Expected: Both tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts frontend/components/benchmark-card.tsx frontend/tests/benchmark-card.test.tsx
git commit -m "feat: add BenchmarkDescriptor type, api.benchmarks.list, BenchmarkCard component"
```

---

## Task 9: Frontend — ExperimentForm + New Experiment page

**Files:**
- Modify: `frontend/components/experiment-form.tsx`
- Modify: `frontend/app/experiments/new/page.tsx`
- Create: `frontend/tests/experiment-form-workbench.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Create `frontend/tests/experiment-form-workbench.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExperimentForm } from "@/components/experiment-form";

// Mock api
vi.mock("@/lib/api", () => ({
  api: {
    datasets: {
      list: () => Promise.resolve([{ dataset_id: "workbench" }]),
    },
    experiments: {
      create: vi.fn().mockResolvedValue({ id: "exp_123" }),
    },
  },
}));

// Mock router
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("ExperimentForm — WorkBench pre-fill", () => {
  it("submits runner_type and evaluator_type when set via initialValues", async () => {
    const { api } = await import("@/lib/api");

    render(
      <ExperimentForm
        initialValues={{
          name: "WorkBench Run",
          dataset_id: "workbench",
          runner_type: "workbench",
          evaluator_type: "workbench",
          task_description: "Workplace tasks",
        }}
      />
    );

    const submitBtn = screen.getByRole("button", { name: /create/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.experiments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runner_type: "workbench",
          evaluator_type: "workbench",
          dataset_id: "workbench",
        })
      );
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd frontend && npx vitest run tests/experiment-form-workbench.test.tsx 2>&1 | tail -20
```

Expected: FAIL — `runner_type` is not passed in the submitted config.

- [ ] **Step 3: Update `frontend/components/experiment-form.tsx`**

Add `runner_type` and `evaluator_type` to the `ExperimentFormInitialValues` interface:

```ts
export interface ExperimentFormInitialValues {
  name?: string;
  task_description?: string;
  dataset_id?: string;
  rubric?: string;
  objective_weights?: ObjectiveWeights;
  population_size?: number;
  budget_max_trials?: number;
  runner_type?: string;
  evaluator_type?: string;
}
```

Add state variables inside `ExperimentForm`:

```ts
const [runnerType, setRunnerType] = useState(initialValues?.runner_type ?? "raw_llm");
const [evaluatorType, setEvaluatorType] = useState(initialValues?.evaluator_type ?? "llm_judge");
```

In `handleSubmit`, add to the `config` object:

```ts
      runner_type: runnerType,
      evaluator_type: evaluatorType,
```

- [ ] **Step 4: Update `frontend/app/experiments/new/page.tsx`**

Convert to a Client Component (add `"use client"` at top) so it can fetch benchmarks on the client and pass selection state to the form. Replace file content:

```tsx
"use client";
import { useState, useEffect } from "react";
import { ExperimentForm } from "@/components/experiment-form";
import type { ExperimentFormInitialValues } from "@/components/experiment-form";
import { BenchmarkCard } from "@/components/benchmark-card";
import { api } from "@/lib/api";
import type { BenchmarkDescriptor } from "@/lib/types";

export default function NewExperimentPage() {
  const [benchmarks, setBenchmarks] = useState<BenchmarkDescriptor[]>([]);
  const [initialValues, setInitialValues] = useState<ExperimentFormInitialValues | undefined>(
    undefined
  );

  useEffect(() => {
    api.benchmarks.list().then(setBenchmarks).catch(() => {});
  }, []);

  const handleSelectBenchmark = (b: BenchmarkDescriptor) => {
    setInitialValues({
      name: `${b.name} Run ${new Date().toISOString().slice(0, 10)}`,
      task_description: b.description,
      dataset_id: b.dataset_id,
      runner_type: b.runner_type,
      evaluator_type: b.evaluator_type,
      objective_weights: {
        quality: b.default_objective.quality_weight,
        cost: b.default_objective.cost_weight,
        speed: b.default_objective.speed_weight,
      },
    });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">New Experiment</h1>

      {benchmarks.length > 0 && (
        <div className="mb-8 space-y-3">
          <h2 className="text-lg font-semibold">Predefined Benchmarks</h2>
          <p className="text-sm text-muted-foreground">
            Select a benchmark to pre-fill the form below.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {benchmarks.map((b) => (
              <BenchmarkCard key={b.id} benchmark={b} onSelect={handleSelectBenchmark} />
            ))}
          </div>
        </div>
      )}

      <ExperimentForm key={JSON.stringify(initialValues)} initialValues={initialValues} />
    </div>
  );
}
```

Note: The `key` prop on `ExperimentForm` forces a remount when `initialValues` changes, so all state fields reset to the new values.

The old `page.tsx` had a server-side `?from=` clone feature. That logic is now lost since this is a client component. Move the clone logic to a separate `CloneExperimentPage` or handle via query param on the client. For now, the `?from=` feature is dropped in favour of the benchmark cards — it can be restored in a follow-up.

- [ ] **Step 5: Run the frontend test**

```bash
cd frontend && npx vitest run tests/experiment-form-workbench.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run all frontend tests**

```bash
cd frontend && npx vitest run
```

Expected: All pass (some may need mock updates if they test the New Experiment page — fix as needed).

- [ ] **Step 7: Build check**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/experiment-form.tsx frontend/app/experiments/new/page.tsx frontend/tests/experiment-form-workbench.test.tsx
git commit -m "feat: add Predefined Benchmarks section to New Experiment page"
```

---

## Task 10: Final regression check

- [ ] **Step 1: Run all backend tests**

```bash
python -m pytest backend/ -v --tb=short 2>&1 | tail -20
```

Expected: All tests pass (previously 81+, now more).

- [ ] **Step 2: Run all frontend tests**

```bash
cd frontend && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Smoke test the running server**

```bash
npm run dev &
sleep 5
curl -s http://localhost:8000/benchmarks | python -m json.tool | head -30
curl -s http://localhost:8000/health
```

Expected: `/benchmarks` returns a JSON array with the WorkBench entry.

- [ ] **Step 4: Final commit if needed**

```bash
git add -A && git status
# commit any stray changes
```

---

## Spec Coverage Check (self-review)

| Spec requirement | Task |
|---|---|
| Download script for WorkBench dataset | Task 7 |
| `datasets/workbench.json` gitignored | Task 7 |
| 26 stub tools + ToolCallLog + thread-local isolation | Task 1 |
| `WorkBenchEvaluator` with partial credit | Task 2 |
| `WorkBenchRunner` with LangChain ReAct | Task 3 |
| `ExperimentConfig.runner_type` / `evaluator_type` | Task 4 |
| Executor wires correct runner/evaluator | Task 5 |
| `GET /benchmarks` API | Task 6 |
| `BenchmarkDescriptor` type + `api.benchmarks.list()` | Task 8 |
| `BenchmarkCard` component | Task 8 |
| Predefined Benchmarks section on New Experiment page | Task 9 |
| Form pre-fills + submits `runner_type`/`evaluator_type` | Task 9 |
| All tests (backend + frontend) | Tasks 1–9 + Task 10 |
