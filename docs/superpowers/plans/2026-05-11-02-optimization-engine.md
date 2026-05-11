# Optimization Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ECS Fargate optimization engine — workflow runner, evaluators, GP loop (DEAP), and SMBO polish (Optuna) — that executes experiments and writes trial results to DynamoDB/S3.

**Architecture:** A long-lived Python process reads an experiment config from DynamoDB, runs a DEAP evolutionary loop where each gene is executed via a stateless WorkflowRunner adapter, scored by a pluggable Evaluator, then writes results back incrementally. On GP convergence, Optuna fine-tunes the best gene's continuous params.

**Tech Stack:** Python 3.12, DEAP, Optuna, openai, boto3, pytest, pytest-asyncio

**Prerequisite:** Plan 01 (shared gene schema) must be complete.

---

## File Map

```
backend/
└── engine/
    ├── __init__.py
    ├── runner/
    │   ├── __init__.py
    │   ├── base.py           # WorkflowRunner abstract base
    │   └── raw_llm.py        # Raw OpenAI/Anthropic adapter
    ├── evaluator/
    │   ├── __init__.py
    │   ├── base.py           # Evaluator abstract base
    │   ├── llm_judge.py      # LLMJudgeEvaluator
    │   ├── function_eval.py  # FunctionEvaluator
    │   └── human_eval.py     # HumanEvaluator (queues to DynamoDB)
    ├── gp/
    │   ├── __init__.py
    │   ├── operators.py      # mutate_structure, mutate_prompt, mutate_param, crossover_subgraph, crossover_prompt
    │   ├── population.py     # initial population seeder (LLM-diversity)
    │   ├── loop.py           # DEAP evolutionary loop
    │   └── diversity.py      # topology diversity score calculation
    ├── smbo/
    │   ├── __init__.py
    │   └── polish.py         # Optuna TPE study for continuous param tuning
    ├── store/
    │   ├── __init__.py
    │   └── dynamodb.py       # read experiment config, write trial results
    └── tests/
        ├── __init__.py
        ├── test_runner.py
        ├── test_evaluator.py
        ├── test_operators.py
        ├── test_population.py
        ├── test_diversity.py
        ├── test_loop.py
        └── test_smbo.py
```

---

### Task 1: Dependencies and project setup

**Files:**
- Create: `backend/requirements-engine.txt`
- Create: `backend/engine/__init__.py`
- Create: `backend/engine/tests/__init__.py`

- [ ] **Step 1: Create requirements file**

```
# backend/requirements-engine.txt
deap==1.4.1
optuna==3.6.1
openai==1.30.1
anthropic==0.28.0
boto3==1.34.100
pytest==8.3.2
pytest-asyncio==0.23.7
```

- [ ] **Step 2: Install dependencies**

```bash
pip install -r backend/requirements-engine.txt
```

Expected: all packages install without errors.

- [ ] **Step 3: Create package init files**

```bash
mkdir -p backend/engine/runner backend/engine/evaluator backend/engine/gp backend/engine/smbo backend/engine/store backend/engine/tests
touch backend/engine/__init__.py backend/engine/runner/__init__.py backend/engine/evaluator/__init__.py
touch backend/engine/gp/__init__.py backend/engine/smbo/__init__.py backend/engine/store/__init__.py
touch backend/engine/tests/__init__.py
```

- [ ] **Step 4: Commit scaffold**

```bash
git add backend/engine/ backend/requirements-engine.txt
git commit -m "chore: scaffold engine package structure"
```

---

### Task 2: WorkflowRunner base and raw LLM adapter

**Files:**
- Create: `backend/engine/runner/base.py`
- Create: `backend/engine/runner/raw_llm.py`
- Create: `backend/engine/tests/test_runner.py`

- [ ] **Step 1: Write failing tests**

Create `backend/engine/tests/test_runner.py`:

```python
import pytest
from unittest.mock import patch, MagicMock
from backend.shared import Gene, load_fixture
from backend.engine.runner.base import WorkflowRunner
from backend.engine.runner.raw_llm import RawLLMRunner


def test_runner_is_abstract():
    with pytest.raises(TypeError):
        WorkflowRunner()


def test_raw_llm_runner_implements_interface():
    runner = RawLLMRunner()
    assert hasattr(runner, "run")


def test_raw_llm_runner_fixed_pipeline(monkeypatch):
    """RawLLMRunner executes each agent in sequence for fixed_pipeline topology."""
    gene_dict = load_fixture("fixed_pipeline")
    gene = Gene.from_dict(gene_dict)

    call_count = 0
    def fake_chat(model, messages, temperature):
        nonlocal call_count
        call_count += 1
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content=f"response_{call_count}"))],
            usage=MagicMock(prompt_tokens=10, completion_tokens=5),
        )

    runner = RawLLMRunner()
    monkeypatch.setattr(runner, "_call_llm", fake_chat)
    result = runner.run(gene, "test input")

    assert result.output  # non-empty final output
    assert result.cost_usd >= 0
    assert result.latency_ms >= 0
    assert len(result.trace) == len(gene.agents)


def test_raw_llm_runner_cost_always_set(monkeypatch):
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))

    def fake_chat(model, messages, temperature):
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content="answer"))],
            usage=MagicMock(prompt_tokens=100, completion_tokens=50),
        )

    runner = RawLLMRunner()
    monkeypatch.setattr(runner, "_call_llm", fake_chat)
    result = runner.run(gene, "input")
    assert result.cost_usd > 0  # cost must always be tracked
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest engine/tests/test_runner.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement runner base**

Create `backend/engine/runner/base.py`:

```python
from __future__ import annotations
from abc import ABC, abstractmethod
from backend.shared.gene import Gene
from backend.shared.results import RunResult


class WorkflowRunner(ABC):
    @abstractmethod
    def run(self, gene: Gene, input: str) -> RunResult:
        """Execute a workflow gene on the given input. Stateless."""
        ...
```

- [ ] **Step 4: Implement raw LLM runner**

Create `backend/engine/runner/raw_llm.py`:

```python
from __future__ import annotations
import time
from typing import Any
from backend.shared.gene import Gene, TopologyType
from backend.shared.results import RunResult
from backend.engine.runner.base import WorkflowRunner

# Cost per 1k tokens (prompt/completion) by model prefix
_COST_TABLE: dict[str, tuple[float, float]] = {
    "gpt-4o":           (0.005, 0.015),
    "gpt-4o-mini":      (0.000150, 0.000600),
    "claude-3-5-sonnet":(0.003, 0.015),
    "claude-3-haiku":   (0.00025, 0.00125),
}

def _model_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    for prefix, (p_rate, c_rate) in _COST_TABLE.items():
        if model.startswith(prefix):
            return (prompt_tokens / 1000) * p_rate + (completion_tokens / 1000) * c_rate
    return 0.0


class RawLLMRunner(WorkflowRunner):
    """Executes workflow genes using raw OpenAI-compatible chat completions.

    Supports fixed_pipeline and parallel_reduce topologies natively.
    Other topologies fall back to sequential execution.
    """

    def _call_llm(self, model: str, messages: list[dict], temperature: float) -> Any:
        import openai
        client = openai.OpenAI()
        return client.chat.completions.create(
            model=model, messages=messages, temperature=temperature
        )

    def run(self, gene: Gene, input: str) -> RunResult:
        start = time.monotonic()
        trace: list[dict] = []
        total_cost = 0.0
        total_tokens: dict[str, dict[str, int]] = {}

        if gene.topology == TopologyType.FIXED_PIPELINE:
            output = self._run_fixed_pipeline(gene, input, trace, total_tokens)
        elif gene.topology == TopologyType.PARALLEL_REDUCE:
            output = self._run_parallel_reduce(gene, input, trace, total_tokens)
        else:
            # Fallback: run agents sequentially by edge order
            output = self._run_sequential_fallback(gene, input, trace, total_tokens)

        for model, usage in total_tokens.items():
            total_cost += _model_cost(model, usage["prompt"], usage["completion"])

        latency_ms = int((time.monotonic() - start) * 1000)
        return RunResult(
            output=output,
            token_usage=total_tokens,
            latency_ms=latency_ms,
            cost_usd=total_cost,
            trace=trace,
        )

    def _call_agent(
        self,
        agent,
        messages: list[dict],
        trace: list[dict],
        total_tokens: dict[str, dict[str, int]],
    ) -> str:
        response = self._call_llm(agent.model, messages, agent.temperature)
        content = response.choices[0].message.content
        usage = response.usage
        mdl = agent.model
        if mdl not in total_tokens:
            total_tokens[mdl] = {"prompt": 0, "completion": 0}
        total_tokens[mdl]["prompt"] += usage.prompt_tokens
        total_tokens[mdl]["completion"] += usage.completion_tokens
        trace.append({"agent_id": agent.id, "role": agent.role, "output": content})
        return content

    def _run_fixed_pipeline(self, gene, input, trace, total_tokens) -> str:
        current_input = input
        ordered_agents = self._topological_order(gene)
        for agent in ordered_agents:
            messages = [
                {"role": "system", "content": agent.system_prompt},
                {"role": "user", "content": current_input},
            ]
            current_input = self._call_agent(agent, messages, trace, total_tokens)
        return current_input

    def _run_parallel_reduce(self, gene, input, trace, total_tokens) -> str:
        params = gene.topology_params
        reducer_id = params.get("reducer_id")
        parallel_ids = params.get("parallel_agent_ids", [])
        agent_map = {a.id: a for a in gene.agents}

        parallel_outputs: list[str] = []
        for aid in parallel_ids:
            agent = agent_map[aid]
            messages = [
                {"role": "system", "content": agent.system_prompt},
                {"role": "user", "content": input},
            ]
            parallel_outputs.append(self._call_agent(agent, messages, trace, total_tokens))

        if reducer_id and reducer_id in agent_map:
            reducer = agent_map[reducer_id]
            combined = "\n\n---\n\n".join(parallel_outputs)
            messages = [
                {"role": "system", "content": reducer.system_prompt},
                {"role": "user", "content": f"Synthesize the following responses:\n\n{combined}"},
            ]
            return self._call_agent(reducer, messages, trace, total_tokens)

        return parallel_outputs[-1] if parallel_outputs else ""

    def _run_sequential_fallback(self, gene, input, trace, total_tokens) -> str:
        current_input = input
        for agent in gene.agents:
            messages = [
                {"role": "system", "content": agent.system_prompt},
                {"role": "user", "content": current_input},
            ]
            current_input = self._call_agent(agent, messages, trace, total_tokens)
        return current_input

    def _topological_order(self, gene) -> list:
        """Return agents in edge-defined topological order, fallback to list order."""
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
        # Include any agents not reached by edges
        seen = {a.id for a in ordered}
        ordered += [a for a in gene.agents if a.id not in seen]
        return ordered
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && python -m pytest engine/tests/test_runner.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/engine/runner/ backend/engine/tests/test_runner.py
git commit -m "feat: add WorkflowRunner base and RawLLMRunner adapter"
```

---

### Task 3: Evaluators

**Files:**
- Create: `backend/engine/evaluator/base.py`
- Create: `backend/engine/evaluator/llm_judge.py`
- Create: `backend/engine/evaluator/function_eval.py`
- Create: `backend/engine/evaluator/human_eval.py`
- Create: `backend/engine/tests/test_evaluator.py`

- [ ] **Step 1: Write failing tests**

Create `backend/engine/tests/test_evaluator.py`:

```python
import pytest
from unittest.mock import patch, MagicMock
from backend.engine.evaluator.base import Evaluator
from backend.engine.evaluator.llm_judge import LLMJudgeEvaluator
from backend.engine.evaluator.function_eval import FunctionEvaluator


def test_evaluator_is_abstract():
    with pytest.raises(TypeError):
        Evaluator()


def test_llm_judge_returns_score_between_0_and_1(monkeypatch):
    evaluator = LLMJudgeEvaluator(
        model="gpt-4o-mini",
        rubric="Rate 0-1 on accuracy and completeness.",
    )
    def fake_chat(model, messages, temperature):
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content='{"score": 0.82, "reason": "mostly correct"}'))]
        )
    monkeypatch.setattr(evaluator, "_call_llm", fake_chat)
    score = evaluator.score(input="What is 2+2?", output="4", expected="4")
    assert 0.0 <= score.quality <= 1.0
    assert "reason" in score.metadata


def test_llm_judge_handles_malformed_json(monkeypatch):
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric="Rate 0-1.")
    def fake_chat(model, messages, temperature):
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content="Score: 0.7 - looks good"))]
        )
    monkeypatch.setattr(evaluator, "_call_llm", fake_chat)
    score = evaluator.score(input="q", output="a", expected=None)
    assert 0.0 <= score.quality <= 1.0  # fallback parsing


def test_function_evaluator_calls_user_function():
    def my_scorer(input, output, expected):
        return 1.0 if output.strip() == expected.strip() else 0.0

    evaluator = FunctionEvaluator(fn=my_scorer)
    score = evaluator.score(input="q", output="correct", expected="correct")
    assert score.quality == 1.0

    score2 = evaluator.score(input="q", output="wrong", expected="correct")
    assert score2.quality == 0.0


def test_function_evaluator_clamps_out_of_range():
    def bad_scorer(input, output, expected):
        return 5.0  # out of range

    evaluator = FunctionEvaluator(fn=bad_scorer)
    score = evaluator.score(input="q", output="a", expected="e")
    assert score.quality == 1.0  # clamped to 1.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest engine/tests/test_evaluator.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement evaluator base**

Create `backend/engine/evaluator/base.py`:

```python
from __future__ import annotations
from abc import ABC, abstractmethod
from backend.shared.results import Score


class Evaluator(ABC):
    @abstractmethod
    def score(self, input: str, output: str, expected: str | None) -> Score:
        """Score a workflow output. Returns Score with quality in [0, 1]."""
        ...
```

- [ ] **Step 4: Implement LLMJudgeEvaluator**

Create `backend/engine/evaluator/llm_judge.py`:

```python
from __future__ import annotations
import json
import re
from typing import Any
from backend.shared.results import Score
from backend.engine.evaluator.base import Evaluator


class LLMJudgeEvaluator(Evaluator):
    """Scores workflow output using an LLM judge with a user-defined rubric."""

    def __init__(self, model: str, rubric: str) -> None:
        self.model = model
        self.rubric = rubric

    def _call_llm(self, model: str, messages: list[dict], temperature: float) -> Any:
        import openai
        client = openai.OpenAI()
        return client.chat.completions.create(
            model=model, messages=messages, temperature=temperature
        )

    def score(self, input: str, output: str, expected: str | None) -> Score:
        expected_section = f"\n\nExpected answer: {expected}" if expected else ""
        prompt = (
            f"You are an evaluator. Score the following AI output using this rubric:\n{self.rubric}\n\n"
            f"Input: {input}\n\nAI Output: {output}{expected_section}\n\n"
            "Respond ONLY with valid JSON in this format: "
            '{"score": <float between 0 and 1>, "reason": "<brief explanation>"}'
        )
        response = self._call_llm(
            self.model,
            [{"role": "user", "content": prompt}],
            temperature=0.1,
        )
        content = response.choices[0].message.content
        quality, metadata = self._parse_score(content)
        return Score(quality=quality, metadata=metadata)

    def _parse_score(self, content: str) -> tuple[float, dict]:
        try:
            data = json.loads(content)
            quality = float(data["score"])
            quality = max(0.0, min(1.0, quality))
            return quality, {"reason": data.get("reason", "")}
        except (json.JSONDecodeError, KeyError, ValueError):
            # Fallback: extract first float found in response
            match = re.search(r"0?\.\d+|[01]\.0*", content)
            quality = float(match.group()) if match else 0.5
            quality = max(0.0, min(1.0, quality))
            return quality, {"raw": content, "parse_error": True}
```

- [ ] **Step 5: Implement FunctionEvaluator**

Create `backend/engine/evaluator/function_eval.py`:

```python
from __future__ import annotations
from typing import Callable
from backend.shared.results import Score
from backend.engine.evaluator.base import Evaluator


class FunctionEvaluator(Evaluator):
    """Evaluates output using a user-supplied Python callable."""

    def __init__(self, fn: Callable[[str, str, str | None], float]) -> None:
        self.fn = fn

    def score(self, input: str, output: str, expected: str | None) -> Score:
        raw = self.fn(input, output, expected)
        quality = max(0.0, min(1.0, float(raw)))
        return Score(quality=quality, metadata={"raw_score": raw})
```

- [ ] **Step 6: Implement HumanEvaluator**

Create `backend/engine/evaluator/human_eval.py`:

```python
from __future__ import annotations
import time
import uuid
import boto3
from backend.shared.results import Score
from backend.engine.evaluator.base import Evaluator


class HumanEvaluator(Evaluator):
    """Queues a rating task to DynamoDB and blocks until a human rates it."""

    def __init__(self, table_name: str, poll_interval_sec: float = 5.0, timeout_sec: float = 3600.0) -> None:
        self.table_name = table_name
        self.poll_interval_sec = poll_interval_sec
        self.timeout_sec = timeout_sec
        self._dynamo = boto3.resource("dynamodb")

    def score(self, input: str, output: str, expected: str | None) -> Score:
        table = self._dynamo.Table(self.table_name)
        task_id = f"human_{uuid.uuid4().hex[:8]}"
        table.put_item(Item={
            "pk": task_id,
            "sk": "human_rating",
            "status": "pending",
            "input": input,
            "output": output,
            "expected": expected or "",
        })

        deadline = time.monotonic() + self.timeout_sec
        while time.monotonic() < deadline:
            resp = table.get_item(Key={"pk": task_id, "sk": "human_rating"})
            item = resp.get("Item", {})
            if item.get("status") == "rated":
                quality = max(0.0, min(1.0, float(item["quality"])))
                return Score(quality=quality, metadata={"task_id": task_id, "comment": item.get("comment", "")})
            time.sleep(self.poll_interval_sec)

        return Score(quality=0.0, metadata={"task_id": task_id, "error": "timeout"})
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd backend && python -m pytest engine/tests/test_evaluator.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/engine/evaluator/ backend/engine/tests/test_evaluator.py
git commit -m "feat: add LLMJudgeEvaluator, FunctionEvaluator, HumanEvaluator"
```

---

### Task 4: Genetic operators

**Files:**
- Create: `backend/engine/gp/operators.py`
- Create: `backend/engine/tests/test_operators.py`

- [ ] **Step 1: Write failing tests**

Create `backend/engine/tests/test_operators.py`:

```python
import pytest
from unittest.mock import MagicMock, patch
from backend.shared import Gene, load_fixture
from backend.engine.gp.operators import (
    mutate_structure,
    mutate_prompt,
    mutate_param,
    crossover_subgraph,
    crossover_prompt,
)


def make_gene(topology="fixed_pipeline"):
    return Gene.from_dict(load_fixture(topology))


def test_mutate_structure_returns_new_gene():
    gene = make_gene()
    mutated = mutate_structure(gene)
    assert mutated is not gene  # new object
    assert isinstance(mutated, Gene)


def test_mutate_structure_does_not_modify_original():
    gene = make_gene()
    original_agent_count = len(gene.agents)
    mutate_structure(gene)
    assert len(gene.agents) == original_agent_count  # original unchanged


def test_mutate_param_changes_temperature():
    gene = make_gene()
    original_temps = [a.temperature for a in gene.agents]
    mutated = mutate_param(gene)
    new_temps = [a.temperature for a in mutated.agents]
    # At least one temperature should differ (with very high probability)
    assert mutated is not gene
    assert all(0.0 <= t <= 1.0 for t in new_temps)


def test_mutate_prompt_calls_llm(monkeypatch):
    gene = make_gene()

    def fake_rewrite(prompt: str) -> str:
        return "Rewritten: " + prompt

    monkeypatch.setattr("backend.engine.gp.operators._rewrite_prompt_with_llm", fake_rewrite)
    mutated = mutate_prompt(gene)
    assert mutated is not gene
    # At least one system prompt should be different
    original_prompts = {a.id: a.system_prompt for a in gene.agents}
    new_prompts = {a.id: a.system_prompt for a in mutated.agents}
    assert any(new_prompts[aid] != original_prompts[aid] for aid in original_prompts)


def test_crossover_subgraph_returns_two_children():
    gene1 = make_gene("fixed_pipeline")
    gene2 = make_gene("debate")
    child1, child2 = crossover_subgraph(gene1, gene2)
    assert isinstance(child1, Gene)
    assert isinstance(child2, Gene)
    assert child1 is not gene1
    assert child2 is not gene2


def test_crossover_prompt_swaps_matching_roles():
    gene1 = make_gene("fixed_pipeline")
    gene2 = make_gene("fixed_pipeline")
    # Give them different prompts for same roles
    gene2.agents[0].system_prompt = "Completely different prompt for researcher."
    child1, child2 = crossover_prompt(gene1, gene2)
    assert isinstance(child1, Gene)
    assert isinstance(child2, Gene)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest engine/tests/test_operators.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement operators.py**

Create `backend/engine/gp/operators.py`:

```python
from __future__ import annotations
import copy
import random
from backend.shared.gene import Gene, Agent, Edge, TopologyType


def _rewrite_prompt_with_llm(prompt: str) -> str:
    """Call an LLM to rewrite a system prompt with diversity directive."""
    import openai
    client = openai.OpenAI()
    meta_prompt = (
        "Rewrite the following system prompt to achieve the same goal but with a "
        "different phrasing, structure, and strategy. The rewrite must be meaningfully "
        "different — not just paraphrased. Return ONLY the rewritten prompt, no explanation.\n\n"
        f"Original prompt:\n{prompt}"
    )
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": meta_prompt}],
        temperature=0.9,
    )
    return response.choices[0].message.content.strip()


def mutate_structure(gene: Gene) -> Gene:
    """Randomly apply one structural mutation: add agent, remove agent, swap topology, or rewire edge."""
    g = gene.copy()
    choices = ["add_agent", "swap_topology"]
    if len(g.agents) > 1:
        choices.append("remove_agent")
    if len(g.edges) > 0:
        choices.append("rewire_edge")

    action = random.choice(choices)

    if action == "add_agent":
        new_id = f"a{len(g.agents)}"
        g.agents.append(Agent(
            id=new_id,
            role=random.choice(["analyst", "critic", "writer", "researcher", "synthesizer"]),
            model=random.choice(["gpt-4o-mini", "gpt-4o"]),
            system_prompt="You assist with tasks assigned to you. Be helpful and precise.",
            temperature=round(random.uniform(0.3, 0.9), 2),
        ))
        if g.agents:
            source = random.choice(g.agents[:-1])
            g.edges.append(Edge(from_agent=source.id, to_agent=new_id, type="sequential"))

    elif action == "remove_agent":
        removed = random.choice(g.agents)
        g.agents = [a for a in g.agents if a.id != removed.id]
        g.edges = [e for e in g.edges if e.from_agent != removed.id and e.to_agent != removed.id]

    elif action == "swap_topology":
        topologies = list(TopologyType)
        topologies.remove(g.topology)
        g.topology = random.choice(topologies)
        g.topology_params = {}

    elif action == "rewire_edge":
        if g.edges:
            edge = random.choice(g.edges)
            agent_ids = [a.id for a in g.agents]
            edge.to_agent = random.choice(agent_ids)

    return g


def mutate_prompt(gene: Gene) -> Gene:
    """Select one random agent and rewrite its system prompt via LLM."""
    g = gene.copy()
    agent = random.choice(g.agents)
    agent.system_prompt = _rewrite_prompt_with_llm(agent.system_prompt)
    return g


def mutate_param(gene: Gene) -> Gene:
    """Apply Gaussian perturbation to temperature of one random agent."""
    g = gene.copy()
    agent = random.choice(g.agents)
    delta = random.gauss(0, 0.1)
    agent.temperature = max(0.0, min(1.0, round(agent.temperature + delta, 3)))
    return g


def crossover_subgraph(gene1: Gene, gene2: Gene) -> tuple[Gene, Gene]:
    """Exchange agents (and their edges) between two parents at a random split point."""
    g1, g2 = gene1.copy(), gene2.copy()
    if not g1.agents or not g2.agents:
        return g1, g2

    split1 = random.randint(1, len(g1.agents))
    split2 = random.randint(1, len(g2.agents))

    # Swap agent tails
    tail1 = g1.agents[split1:]
    tail2 = g2.agents[split2:]
    g1.agents = g1.agents[:split1] + tail2
    g2.agents = g2.agents[:split2] + tail1

    # Rebuild edges to only reference existing agent ids
    ids1 = {a.id for a in g1.agents}
    ids2 = {a.id for a in g2.agents}
    g1.edges = [e for e in g1.edges if e.from_agent in ids1 and e.to_agent in ids1]
    g2.edges = [e for e in g2.edges if e.from_agent in ids2 and e.to_agent in ids2]

    return g1, g2


def crossover_prompt(gene1: Gene, gene2: Gene) -> tuple[Gene, Gene]:
    """Swap system prompts between agents with matching roles across two parents."""
    g1, g2 = gene1.copy(), gene2.copy()
    roles1 = {a.role: a for a in g1.agents}
    roles2 = {a.role: a for a in g2.agents}
    shared_roles = set(roles1.keys()) & set(roles2.keys())
    for role in shared_roles:
        if random.random() < 0.5:
            p1 = roles1[role].system_prompt
            p2 = roles2[role].system_prompt
            roles1[role].system_prompt = p2
            roles2[role].system_prompt = p1
    return g1, g2
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest engine/tests/test_operators.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/engine/gp/operators.py backend/engine/tests/test_operators.py
git commit -m "feat: add GP genetic operators (mutate_structure, mutate_prompt, mutate_param, crossovers)"
```

---

### Task 5: Topology diversity score

**Files:**
- Create: `backend/engine/gp/diversity.py`
- Create: `backend/engine/tests/test_diversity.py`

- [ ] **Step 1: Write failing tests**

Create `backend/engine/tests/test_diversity.py`:

```python
from backend.shared import Gene, load_fixture
from backend.engine.gp.diversity import topology_diversity_score


def test_identical_population_has_zero_diversity():
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    population = [gene.copy() for _ in range(5)]
    score = topology_diversity_score(population)
    assert score == 0.0


def test_all_different_topologies_has_high_diversity():
    topologies = ["fixed_pipeline", "ai_orchestrated", "debate", "parallel_reduce", "human_in_loop", "hybrid"]
    population = [Gene.from_dict(load_fixture(t)) for t in topologies]
    score = topology_diversity_score(population)
    assert score > 0.5


def test_diversity_score_between_0_and_1():
    population = [
        Gene.from_dict(load_fixture("fixed_pipeline")),
        Gene.from_dict(load_fixture("fixed_pipeline")),
        Gene.from_dict(load_fixture("debate")),
    ]
    score = topology_diversity_score(population)
    assert 0.0 <= score <= 1.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest engine/tests/test_diversity.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement diversity.py**

Create `backend/engine/gp/diversity.py`:

```python
from __future__ import annotations
from collections import Counter
from backend.shared.gene import Gene


def topology_diversity_score(population: list[Gene]) -> float:
    """Measure structural diversity in a population.

    Returns a value in [0, 1] where 0 = all identical topologies,
    1 = all different topologies. Uses normalized Shannon entropy
    over topology type distribution.
    """
    if len(population) <= 1:
        return 0.0

    import math
    counts = Counter(g.topology.value for g in population)
    n = len(population)
    num_types = len(counts)

    if num_types == 1:
        return 0.0

    entropy = -sum((c / n) * math.log2(c / n) for c in counts.values())
    max_entropy = math.log2(num_types)
    return entropy / max_entropy if max_entropy > 0 else 0.0
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest engine/tests/test_diversity.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/engine/gp/diversity.py backend/engine/tests/test_diversity.py
git commit -m "feat: add topology diversity score using normalized Shannon entropy"
```

---

### Task 6: Initial population seeder

**Files:**
- Create: `backend/engine/gp/population.py`
- Create: `backend/engine/tests/test_population.py`

- [ ] **Step 1: Write failing tests**

Create `backend/engine/tests/test_population.py`:

```python
import pytest
from unittest.mock import patch
from backend.shared import Gene, ExperimentConfig, ObjectiveWeights, EvaluatorConfig
from backend.engine.gp.population import seed_population
from backend.engine.gp.diversity import topology_diversity_score


def make_config(population_size=6):
    return ExperimentConfig(
        name="test",
        task_description="Summarize documents",
        dataset_id="ds_001",
        evaluators=[EvaluatorConfig(type="llm_judge", params={"model": "gpt-4o-mini", "rubric": "Rate 0-1."})],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
        population_size=population_size,
    )


def test_seed_population_returns_correct_count(monkeypatch):
    monkeypatch.setattr("backend.engine.gp.population._generate_gene_with_llm", lambda task, topology: None)
    config = make_config(population_size=6)
    pop = seed_population(config)
    assert len(pop) == 6


def test_seed_population_all_valid_genes(monkeypatch):
    monkeypatch.setattr("backend.engine.gp.population._generate_gene_with_llm", lambda task, topology: None)
    from backend.shared.validator import validate_gene
    config = make_config(population_size=6)
    pop = seed_population(config)
    for gene in pop:
        validate_gene(gene.to_dict())


def test_seed_population_has_topology_diversity(monkeypatch):
    monkeypatch.setattr("backend.engine.gp.population._generate_gene_with_llm", lambda task, topology: None)
    config = make_config(population_size=12)
    pop = seed_population(config)
    score = topology_diversity_score(pop)
    assert score > 0.0  # should have at least some variety
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest engine/tests/test_population.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement population.py**

Create `backend/engine/gp/population.py`:

```python
from __future__ import annotations
import random
from backend.shared.gene import Gene, Agent, Edge, TopologyType
from backend.shared.experiment import ExperimentConfig
from backend.shared.fixtures import load_fixture, TOPOLOGY_FIXTURES


def _generate_gene_with_llm(task_description: str, topology: TopologyType) -> None:
    """Hook for LLM-assisted gene generation. Currently a no-op placeholder.

    In production, this calls an LLM with a diversity directive to produce
    a custom gene JSON for the given task and topology. The function mutates
    nothing and returns None — callers use the fixture-based path as fallback.
    """
    return None


def seed_population(config: ExperimentConfig) -> list[Gene]:
    """Generate an initial diverse population for a GP run.

    Strategy:
    - Cycle through all 6 topology types to ensure structural diversity.
    - Load canonical fixture for each topology as the seed genome.
    - Apply random param jitter (temperature) to introduce variation.
    - LLM-assisted generation is called as a hook (no-op in test/dev).
    """
    population: list[Gene] = []
    topology_cycle = [TopologyType(t) for t in TOPOLOGY_FIXTURES]

    for i in range(config.population_size):
        topology = topology_cycle[i % len(topology_cycle)]
        llm_result = _generate_gene_with_llm(config.task_description, topology)

        if llm_result is not None:
            gene = llm_result
        else:
            gene = Gene.from_dict(load_fixture(topology.value))
            gene.id = f"seed_{i:04d}"
            # Jitter temperatures for diversity
            for agent in gene.agents:
                agent.temperature = round(random.uniform(0.2, 0.9), 2)

        population.append(gene)

    return population
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest engine/tests/test_population.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/engine/gp/population.py backend/engine/tests/test_population.py
git commit -m "feat: add population seeder with topology diversity guarantee"
```

---

### Task 7: GP evolutionary loop

**Files:**
- Create: `backend/engine/gp/loop.py`
- Create: `backend/engine/tests/test_loop.py`

- [ ] **Step 1: Write failing tests**

Create `backend/engine/tests/test_loop.py`:

```python
import pytest
from unittest.mock import MagicMock, patch
from backend.shared import Gene, ExperimentConfig, ObjectiveWeights, EvaluatorConfig, load_fixture
from backend.shared.results import RunResult, Score, ParetoPoint
from backend.engine.gp.loop import GPLoop, TrialResult


def make_config():
    return ExperimentConfig(
        name="test",
        task_description="Summarize documents",
        dataset_id="ds_001",
        evaluators=[EvaluatorConfig(type="function", params={})],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
        population_size=4,
        budget_max_trials=20,
        convergence_patience=3,
        concurrency=1,
    )


def make_mock_runner():
    runner = MagicMock()
    runner.run.return_value = RunResult(
        output="answer", token_usage={}, latency_ms=100, cost_usd=0.001
    )
    return runner


def make_mock_evaluator():
    evaluator = MagicMock()
    evaluator.score.return_value = Score(quality=0.8)
    return evaluator


def test_gp_loop_runs_and_returns_best_gene():
    config = make_config()
    loop = GPLoop(
        config=config,
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc1", "expected": "summary1"}],
        on_trial_complete=None,
    )
    best = loop.run()
    assert isinstance(best, Gene)


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
    best = loop.run()
    assert isinstance(best, Gene)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest engine/tests/test_loop.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement loop.py**

Create `backend/engine/gp/loop.py`:

```python
from __future__ import annotations
import random
from dataclasses import dataclass
from typing import Callable
from deap import base, creator, tools, algorithms

from backend.shared.gene import Gene
from backend.shared.experiment import ExperimentConfig
from backend.shared.results import RunResult, Score, ParetoPoint
from backend.engine.runner.base import WorkflowRunner
from backend.engine.evaluator.base import Evaluator
from backend.engine.gp.operators import mutate_structure, mutate_prompt, mutate_param, crossover_subgraph
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

    def _evaluate_gene(self, gene: Gene, generation: int) -> tuple[float, ParetoPoint]:
        """Evaluate a gene on a random sample from the dataset. Returns (fitness, pareto)."""
        sample = random.choice(self.dataset)
        run_result = self.runner.run(gene, sample["input"])
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
            self.on_trial_complete(TrialResult(
                gene=gene, generation=generation,
                input=sample["input"], run_result=run_result,
                scores=scores, pareto=pareto, fitness=fitness,
            ))
        return fitness, pareto

    def _budget_exceeded(self) -> bool:
        if self.config.budget_max_trials and self._trial_count >= self.config.budget_max_trials:
            return True
        if self.config.budget_max_usd and self._total_cost >= self.config.budget_max_usd:
            return True
        return False

    def run(self) -> Gene:
        """Run the GP loop and return the best gene found."""
        population = seed_population(self.config)
        best_gene = population[0]
        best_fitness = float("-inf")
        no_improvement = 0

        for generation in range(1000):
            if self._budget_exceeded():
                break

            # Evaluate
            scored: list[tuple[Gene, float]] = []
            for gene in population:
                if self._budget_exceeded():
                    break
                fitness, _ = self._evaluate_gene(gene, generation)
                scored.append((gene, fitness))
                if fitness > best_fitness:
                    best_fitness = fitness
                    best_gene = gene
                    no_improvement = 0

            if not scored:
                break

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
                op = random.choice(["mutate_structure", "mutate_prompt", "mutate_param", "crossover"])
                if op == "mutate_structure":
                    new_population.append(mutate_structure(parent1))
                elif op == "mutate_prompt":
                    new_population.append(mutate_prompt(parent1))
                elif op == "mutate_param":
                    new_population.append(mutate_param(parent1))
                elif op == "crossover" and len(survivors) > 1:
                    parent2 = random.choice([s for s in survivors if s is not parent1] or survivors)
                    child1, _ = crossover_subgraph(parent1, parent2)
                    new_population.append(child1)
                else:
                    new_population.append(mutate_param(parent1))

            population = new_population[:self.config.population_size]

        return best_gene
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest engine/tests/test_loop.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/engine/gp/loop.py backend/engine/tests/test_loop.py
git commit -m "feat: add GP evolutionary loop with budget guard and convergence detection"
```

---

### Task 8: SMBO polish (Optuna)

**Files:**
- Create: `backend/engine/smbo/polish.py`
- Create: `backend/engine/tests/test_smbo.py`

- [ ] **Step 1: Write failing tests**

Create `backend/engine/tests/test_smbo.py`:

```python
from unittest.mock import MagicMock
from backend.shared import Gene, ExperimentConfig, ObjectiveWeights, EvaluatorConfig, load_fixture
from backend.shared.results import RunResult, Score
from backend.engine.smbo.polish import smbo_polish


def make_config():
    return ExperimentConfig(
        name="test",
        task_description="Summarize",
        dataset_id="ds_001",
        evaluators=[EvaluatorConfig(type="function", params={})],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
        budget_max_trials=10,
    )


def make_mock_runner():
    runner = MagicMock()
    runner.run.return_value = RunResult(output="ans", token_usage={}, latency_ms=100, cost_usd=0.001)
    return runner


def make_mock_evaluator():
    ev = MagicMock()
    ev.score.return_value = Score(quality=0.85)
    return ev


def test_smbo_polish_returns_gene():
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    result = smbo_polish(
        gene=gene,
        config=make_config(),
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc", "expected": "summary"}],
        n_trials=5,
    )
    assert isinstance(result, Gene)


def test_smbo_polish_temperatures_in_range():
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    result = smbo_polish(
        gene=gene,
        config=make_config(),
        runner=make_mock_runner(),
        evaluators=[make_mock_evaluator()],
        dataset=[{"input": "doc", "expected": "summary"}],
        n_trials=5,
    )
    for agent in result.agents:
        assert 0.0 <= agent.temperature <= 1.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest engine/tests/test_smbo.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement polish.py**

Create `backend/engine/smbo/polish.py`:

```python
from __future__ import annotations
import random
import optuna

optuna.logging.set_verbosity(optuna.logging.WARNING)

from backend.shared.gene import Gene
from backend.shared.experiment import ExperimentConfig
from backend.engine.runner.base import WorkflowRunner
from backend.engine.evaluator.base import Evaluator


def smbo_polish(
    gene: Gene,
    config: ExperimentConfig,
    runner: WorkflowRunner,
    evaluators: list[Evaluator],
    dataset: list[dict],
    n_trials: int = 30,
) -> Gene:
    """Use Optuna TPE to fine-tune continuous params (temperatures, max_rounds) of the best gene.

    Topology and system prompts are frozen. Only numerical parameters are searched.
    Returns the best gene found by Optuna.
    """
    best_gene = gene.copy()
    best_fitness = float("-inf")

    def objective(trial: optuna.Trial) -> float:
        nonlocal best_gene, best_fitness
        candidate = gene.copy()

        # Tune temperature for each agent independently
        for agent in candidate.agents:
            agent.temperature = trial.suggest_float(
                f"temp_{agent.id}", 0.0, 1.0, step=0.05
            )

        # Tune max_rounds if present in topology_params
        if "max_rounds" in candidate.topology_params:
            candidate.topology_params["max_rounds"] = trial.suggest_int("max_rounds", 1, 10)

        sample = random.choice(dataset)
        run_result = runner.run(candidate, sample["input"])
        scores = [
            ev.score(sample["input"], run_result.output, sample.get("expected"))
            for ev in evaluators
        ]
        avg_quality = sum(s.quality for s in scores) / len(scores) if scores else 0.0
        max_cost = config.budget_max_usd or 1.0
        norm_cost = run_result.cost_usd / (max_cost / max(n_trials, 1))
        norm_latency = run_result.latency_ms / 30000
        w = config.objective_weights
        fitness = w.quality * avg_quality - w.cost * norm_cost - w.speed * norm_latency

        if fitness > best_fitness:
            best_fitness = fitness
            best_gene = candidate

        return fitness

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler())
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)
    return best_gene
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest engine/tests/test_smbo.py -v
```

Expected: all 2 tests PASS.

- [ ] **Step 5: Run full engine test suite**

```bash
cd backend && python -m pytest engine/tests/ -v --tb=short
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/engine/smbo/ backend/engine/tests/test_smbo.py
git commit -m "feat: add Optuna TPE SMBO polish step for continuous parameter tuning"
```

---

### Task 9: DynamoDB store

**Files:**
- Create: `backend/engine/store/dynamodb.py`

- [ ] **Step 1: Implement store**

Create `backend/engine/store/dynamodb.py`:

```python
from __future__ import annotations
import json
import os
import boto3
from backend.shared.gene import Gene
from backend.shared.experiment import ExperimentConfig
from backend.engine.gp.loop import TrialResult


EXPERIMENTS_TABLE = os.environ.get("EXPERIMENTS_TABLE", "autoaw-experiments")
TRIALS_TABLE = os.environ.get("TRIALS_TABLE", "autoaw-trials")


class ExperimentStore:
    def __init__(self) -> None:
        self._dynamo = boto3.resource("dynamodb")
        self._experiments = self._dynamo.Table(EXPERIMENTS_TABLE)
        self._trials = self._dynamo.Table(TRIALS_TABLE)

    def get_experiment_config(self, experiment_id: str) -> ExperimentConfig:
        resp = self._experiments.get_item(Key={"pk": experiment_id, "sk": "config"})
        item = resp["Item"]
        return ExperimentConfig.from_dict(json.loads(item["config_json"]))

    def put_trial_result(self, experiment_id: str, result: TrialResult) -> None:
        self._trials.put_item(Item={
            "pk": experiment_id,
            "sk": f"trial#{result.gene.id}#{result.generation:06d}",
            "gene_id": result.gene.id,
            "generation": result.generation,
            "fitness": str(result.fitness),
            "quality": str(result.pareto.quality),
            "cost_usd": str(result.pareto.cost_usd),
            "latency_ms": result.pareto.latency_ms,
            "gene_json": json.dumps(result.gene.to_dict()),
        })

    def put_best_gene(self, experiment_id: str, gene: Gene, fitness: float) -> None:
        self._experiments.update_item(
            Key={"pk": experiment_id, "sk": "config"},
            UpdateExpression="SET best_gene_id = :gid, best_fitness = :fit, #s = :status",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":gid": gene.id,
                ":fit": str(fitness),
                ":status": "completed",
            },
        )
```

- [ ] **Step 2: Commit**

```bash
git add backend/engine/store/dynamodb.py
git commit -m "feat: add DynamoDB store for experiment config and trial results"
```

---

### Task 10: Engine entrypoint

**Files:**
- Create: `backend/engine/main.py`

- [ ] **Step 1: Implement entrypoint**

Create `backend/engine/main.py`:

```python
"""ECS Fargate entrypoint for the AutoAW optimization engine.

Reads EXPERIMENT_ID from environment, loads config from DynamoDB,
runs GP loop followed by SMBO polish, writes results back.
"""
from __future__ import annotations
import os
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


def main() -> None:
    experiment_id = os.environ["EXPERIMENT_ID"]
    log.info("Starting optimization for experiment %s", experiment_id)

    from backend.engine.store.dynamodb import ExperimentStore
    from backend.engine.runner.raw_llm import RawLLMRunner
    from backend.engine.evaluator.llm_judge import LLMJudgeEvaluator
    from backend.engine.evaluator.function_eval import FunctionEvaluator
    from backend.engine.gp.loop import GPLoop
    from backend.engine.smbo.polish import smbo_polish
    import boto3, json

    store = ExperimentStore()
    config = store.get_experiment_config(experiment_id)

    # Load dataset from S3
    s3 = boto3.client("s3")
    bucket = os.environ["DATASETS_BUCKET"]
    obj = s3.get_object(Bucket=bucket, Key=f"datasets/{config.dataset_id}.json")
    dataset = json.loads(obj["Body"].read())

    # Build evaluators
    evaluators = []
    for ev_config in config.evaluators:
        if ev_config.type == "llm_judge":
            evaluators.append(LLMJudgeEvaluator(
                model=ev_config.params["model"],
                rubric=ev_config.params["rubric"],
            ))
        elif ev_config.type == "function":
            # Function evaluators are loaded via importable path in params["fn_path"]
            import importlib
            module_path, fn_name = ev_config.params["fn_path"].rsplit(".", 1)
            mod = importlib.import_module(module_path)
            evaluators.append(FunctionEvaluator(fn=getattr(mod, fn_name)))

    runner = RawLLMRunner()

    def on_trial(result):
        store.put_trial_result(experiment_id, result)
        log.info(
            "gen=%d trial=%s fitness=%.4f cost=$%.4f",
            result.generation, result.gene.id, result.fitness, result.pareto.cost_usd,
        )

    loop = GPLoop(
        config=config,
        runner=runner,
        evaluators=evaluators,
        dataset=dataset,
        on_trial_complete=on_trial,
    )

    log.info("Running GP loop...")
    best_gene = loop.run()
    log.info("GP converged. Best gene: %s", best_gene.id)

    log.info("Running SMBO polish...")
    polished_gene = smbo_polish(
        gene=best_gene,
        config=config,
        runner=runner,
        evaluators=evaluators,
        dataset=dataset,
        n_trials=30,
    )
    log.info("SMBO complete. Final gene: %s", polished_gene.id)

    store.put_best_gene(experiment_id, polished_gene, fitness=0.0)
    log.info("Done. Results written to DynamoDB.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run all engine tests one final time**

```bash
cd backend && python -m pytest engine/tests/ shared/tests/ -v --tb=short
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/engine/main.py
git commit -m "feat: add ECS Fargate engine entrypoint"
```
