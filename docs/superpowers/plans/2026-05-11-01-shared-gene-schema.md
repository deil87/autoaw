# Shared Gene Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the canonical gene schema, Python dataclasses, JSON schema validation, and test fixtures that all other subsystems depend on.

**Architecture:** A single `backend/shared/` Python package defines `Gene`, `Agent`, `Edge`, `RunResult`, `Score`, and `ExperimentConfig` as dataclasses with JSON serialization. A JSON Schema file validates gene documents at boundaries. Fixtures provide canonical test genes for every topology type.

**Tech Stack:** Python 3.12, dataclasses, jsonschema, pytest

---

## File Map

```
backend/
└── shared/
    ├── __init__.py
    ├── gene.py           # Gene, Agent, Edge, TopologyParams dataclasses
    ├── experiment.py     # ExperimentConfig, ObjectiveWeights dataclasses
    ├── results.py        # RunResult, Score dataclasses
    ├── schema/
    │   └── gene.json     # JSON Schema for gene validation
    ├── fixtures/
    │   ├── __init__.py
    │   ├── fixed_pipeline.json
    │   ├── ai_orchestrated.json
    │   ├── debate.json
    │   ├── parallel_reduce.json
    │   ├── human_in_loop.json
    │   └── hybrid.json
    └── tests/
        ├── __init__.py
        ├── test_gene.py
        ├── test_experiment.py
        └── test_fixtures.py
```

---

### Task 1: Project scaffolding and dependencies

**Files:**
- Create: `backend/shared/__init__.py`
- Create: `backend/shared/tests/__init__.py`
- Create: `backend/shared/fixtures/__init__.py`
- Create: `backend/shared/schema/__init__.py`
- Create: `backend/requirements-shared.txt`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p backend/shared/schema backend/shared/fixtures backend/shared/tests
touch backend/shared/__init__.py
touch backend/shared/tests/__init__.py
touch backend/shared/fixtures/__init__.py
touch backend/shared/schema/__init__.py
```

- [ ] **Step 2: Create requirements file**

```
# backend/requirements-shared.txt
jsonschema==4.23.0
pytest==8.3.2
```

- [ ] **Step 3: Install dependencies**

```bash
pip install -r backend/requirements-shared.txt
```

Expected: packages install without errors.

- [ ] **Step 4: Commit scaffold**

```bash
git add backend/
git commit -m "chore: scaffold shared package structure"
```

---

### Task 2: Agent and Edge dataclasses

**Files:**
- Create: `backend/shared/gene.py`
- Create: `backend/shared/tests/test_gene.py`

- [ ] **Step 1: Write failing tests**

Create `backend/shared/tests/test_gene.py`:

```python
import pytest
from backend.shared.gene import Agent, Edge, TopologyParams, Gene, TopologyType


def test_agent_defaults():
    agent = Agent(id="a0", role="planner", model="gpt-4o", system_prompt="You are a planner.")
    assert agent.tools == []
    assert agent.temperature == 0.7


def test_agent_rejects_invalid_temperature():
    with pytest.raises(ValueError):
        Agent(id="a0", role="planner", model="gpt-4o", system_prompt="x", temperature=1.5)


def test_edge_types():
    edge = Edge(from_agent="a0", to_agent="a1", type="sequential")
    assert edge.type == "sequential"


def test_topology_type_enum():
    assert TopologyType.FIXED_PIPELINE.value == "fixed_pipeline"
    assert TopologyType.AI_ORCHESTRATED.value == "ai_orchestrated"
    assert TopologyType.DEBATE.value == "debate"
    assert TopologyType.PARALLEL_REDUCE.value == "parallel_reduce"
    assert TopologyType.HUMAN_IN_LOOP.value == "human_in_loop"
    assert TopologyType.HYBRID.value == "hybrid"


def test_gene_to_dict_roundtrip():
    agent = Agent(id="a0", role="planner", model="gpt-4o", system_prompt="Plan things.")
    edge = Edge(from_agent="a0", to_agent="a1", type="sequential")
    gene = Gene(
        id="gene_001",
        topology=TopologyType.FIXED_PIPELINE,
        agents=[agent],
        edges=[edge],
    )
    d = gene.to_dict()
    gene2 = Gene.from_dict(d)
    assert gene2.id == gene.id
    assert gene2.topology == gene.topology
    assert gene2.agents[0].role == "planner"


def test_gene_copy_is_independent():
    agent = Agent(id="a0", role="planner", model="gpt-4o", system_prompt="Plan things.")
    gene = Gene(id="gene_001", topology=TopologyType.FIXED_PIPELINE, agents=[agent], edges=[])
    copy = gene.copy()
    copy.agents[0].role = "mutated"
    assert gene.agents[0].role == "planner"  # original unchanged
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest shared/tests/test_gene.py -v
```

Expected: `ModuleNotFoundError` — gene.py does not exist yet.

- [ ] **Step 3: Implement gene.py**

Create `backend/shared/gene.py`:

```python
from __future__ import annotations
import copy
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class TopologyType(str, Enum):
    FIXED_PIPELINE = "fixed_pipeline"
    AI_ORCHESTRATED = "ai_orchestrated"
    DEBATE = "debate"
    PARALLEL_REDUCE = "parallel_reduce"
    HUMAN_IN_LOOP = "human_in_loop"
    HYBRID = "hybrid"


VALID_EDGE_TYPES = {"sequential", "broadcast", "reduce", "conditional"}


@dataclass
class Agent:
    id: str
    role: str
    model: str
    system_prompt: str
    tools: list[str] = field(default_factory=list)
    temperature: float = 0.7

    def __post_init__(self) -> None:
        if not (0.0 <= self.temperature <= 1.0):
            raise ValueError(f"temperature must be between 0.0 and 1.0, got {self.temperature}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "role": self.role,
            "model": self.model,
            "system_prompt": self.system_prompt,
            "tools": list(self.tools),
            "temperature": self.temperature,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Agent:
        return cls(
            id=d["id"],
            role=d["role"],
            model=d["model"],
            system_prompt=d["system_prompt"],
            tools=list(d.get("tools", [])),
            temperature=d.get("temperature", 0.7),
        )


@dataclass
class Edge:
    from_agent: str
    to_agent: str
    type: str = "sequential"

    def __post_init__(self) -> None:
        if self.type not in VALID_EDGE_TYPES:
            raise ValueError(f"edge type must be one of {VALID_EDGE_TYPES}, got {self.type!r}")

    def to_dict(self) -> dict[str, Any]:
        return {"from": self.from_agent, "to": self.to_agent, "type": self.type}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Edge:
        return cls(from_agent=d["from"], to_agent=d["to"], type=d.get("type", "sequential"))


@dataclass
class Gene:
    topology: TopologyType
    agents: list[Agent]
    edges: list[Edge]
    id: str = field(default_factory=lambda: f"gene_{uuid.uuid4().hex[:8]}")
    topology_params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "topology": self.topology.value,
            "agents": [a.to_dict() for a in self.agents],
            "edges": [e.to_dict() for e in self.edges],
            "topology_params": dict(self.topology_params),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Gene:
        return cls(
            id=d["id"],
            topology=TopologyType(d["topology"]),
            agents=[Agent.from_dict(a) for a in d["agents"]],
            edges=[Edge.from_dict(e) for e in d["edges"]],
            topology_params=dict(d.get("topology_params", {})),
        )

    def copy(self) -> Gene:
        """Return a deep copy. Never mutate a gene in place."""
        return Gene.from_dict(copy.deepcopy(self.to_dict()))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest shared/tests/test_gene.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/shared/gene.py backend/shared/tests/test_gene.py
git commit -m "feat: add Gene, Agent, Edge dataclasses with roundtrip serialization"
```

---

### Task 3: ExperimentConfig dataclass

**Files:**
- Create: `backend/shared/experiment.py`
- Create: `backend/shared/tests/test_experiment.py`

- [ ] **Step 1: Write failing tests**

Create `backend/shared/tests/test_experiment.py`:

```python
import pytest
from backend.shared.experiment import ExperimentConfig, ObjectiveWeights, EvaluatorConfig


def test_objective_weights_must_sum_to_one():
    with pytest.raises(ValueError):
        ObjectiveWeights(quality=0.5, cost=0.3, speed=0.3)  # sums to 1.1


def test_objective_weights_valid():
    w = ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2)
    assert abs(w.quality + w.cost + w.speed - 1.0) < 1e-9


def test_experiment_config_defaults():
    config = ExperimentConfig(
        name="test-exp",
        task_description="Summarize documents",
        dataset_id="ds_001",
        evaluators=[EvaluatorConfig(type="llm_judge", params={"model": "gpt-4o", "rubric": "Rate 0-1 on accuracy."})],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
    )
    assert config.population_size == 20
    assert config.concurrency == 5
    assert config.convergence_patience == 10


def test_experiment_config_roundtrip():
    config = ExperimentConfig(
        name="test-exp",
        task_description="Summarize documents",
        dataset_id="ds_001",
        evaluators=[EvaluatorConfig(type="llm_judge", params={"model": "gpt-4o", "rubric": "Rate 0-1 on accuracy."})],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
        population_size=30,
        budget_max_trials=500,
    )
    d = config.to_dict()
    config2 = ExperimentConfig.from_dict(d)
    assert config2.name == config.name
    assert config2.population_size == 30
    assert config2.objective_weights.quality == 0.6
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest shared/tests/test_experiment.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement experiment.py**

Create `backend/shared/experiment.py`:

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ObjectiveWeights:
    quality: float
    cost: float
    speed: float

    def __post_init__(self) -> None:
        total = self.quality + self.cost + self.speed
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"Objective weights must sum to 1.0, got {total}")

    def to_dict(self) -> dict[str, float]:
        return {"quality": self.quality, "cost": self.cost, "speed": self.speed}

    @classmethod
    def from_dict(cls, d: dict[str, float]) -> ObjectiveWeights:
        return cls(quality=d["quality"], cost=d["cost"], speed=d["speed"])


@dataclass
class EvaluatorConfig:
    type: str   # "llm_judge" | "function" | "human"
    params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, "params": dict(self.params)}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> EvaluatorConfig:
        return cls(type=d["type"], params=dict(d.get("params", {})))


@dataclass
class ExperimentConfig:
    name: str
    task_description: str
    dataset_id: str
    evaluators: list[EvaluatorConfig]
    objective_weights: ObjectiveWeights
    population_size: int = 20
    budget_max_trials: int | None = None
    budget_max_usd: float | None = None
    convergence_patience: int = 10
    concurrency: int = 5

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
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ExperimentConfig:
        return cls(
            name=d["name"],
            task_description=d["task_description"],
            dataset_id=d["dataset_id"],
            evaluators=[EvaluatorConfig.from_dict(e) for e in d["evaluators"]],
            objective_weights=ObjectiveWeights.from_dict(d["objective_weights"]),
            population_size=d.get("population_size", 20),
            budget_max_trials=d.get("budget_max_trials"),
            budget_max_usd=d.get("budget_max_usd"),
            convergence_patience=d.get("convergence_patience", 10),
            concurrency=d.get("concurrency", 5),
        )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest shared/tests/test_experiment.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/shared/experiment.py backend/shared/tests/test_experiment.py
git commit -m "feat: add ExperimentConfig and ObjectiveWeights dataclasses"
```

---

### Task 4: RunResult and Score dataclasses

**Files:**
- Create: `backend/shared/results.py`
- Modify: `backend/shared/tests/test_gene.py` (add import smoke test)

- [ ] **Step 1: Write failing tests**

Create `backend/shared/tests/test_results.py`:

```python
import pytest
from backend.shared.results import RunResult, Score, ParetoPoint


def test_score_clamps():
    with pytest.raises(ValueError):
        Score(quality=1.5)


def test_score_valid():
    s = Score(quality=0.85, metadata={"reason": "mostly correct"})
    assert s.quality == 0.85


def test_run_result_requires_cost():
    with pytest.raises(TypeError):
        RunResult(output="hello", token_usage={}, latency_ms=500)  # missing cost_usd


def test_run_result_roundtrip():
    r = RunResult(
        output="answer text",
        token_usage={"gpt-4o": {"prompt": 100, "completion": 50}},
        latency_ms=1200,
        cost_usd=0.003,
        trace=[{"agent": "a0", "message": "hello"}],
    )
    d = r.to_dict()
    r2 = RunResult.from_dict(d)
    assert r2.output == r.output
    assert r2.cost_usd == r.cost_usd


def test_pareto_point():
    p = ParetoPoint(quality=0.9, cost_usd=0.01, latency_ms=800)
    assert p.quality == 0.9


def test_scalar_fitness():
    from backend.shared.experiment import ObjectiveWeights
    weights = ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2)
    p = ParetoPoint(quality=0.9, cost_usd=0.01, latency_ms=800)
    # fitness = 0.6*0.9 - 0.2*norm_cost - 0.2*norm_speed
    # norm values depend on provided max bounds
    fitness = p.scalar_fitness(weights, max_cost_usd=0.1, max_latency_ms=5000)
    assert 0.0 < fitness < 1.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest shared/tests/test_results.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement results.py**

Create `backend/shared/results.py`:

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any
from backend.shared.experiment import ObjectiveWeights


@dataclass
class Score:
    quality: float
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not (0.0 <= self.quality <= 1.0):
            raise ValueError(f"quality must be between 0.0 and 1.0, got {self.quality}")

    def to_dict(self) -> dict[str, Any]:
        return {"quality": self.quality, "metadata": dict(self.metadata)}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Score:
        return cls(quality=d["quality"], metadata=dict(d.get("metadata", {})))


@dataclass
class RunResult:
    output: str
    token_usage: dict[str, Any]
    latency_ms: int
    cost_usd: float
    trace: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "output": self.output,
            "token_usage": dict(self.token_usage),
            "latency_ms": self.latency_ms,
            "cost_usd": self.cost_usd,
            "trace": list(self.trace),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RunResult:
        return cls(
            output=d["output"],
            token_usage=dict(d["token_usage"]),
            latency_ms=d["latency_ms"],
            cost_usd=d["cost_usd"],
            trace=list(d.get("trace", [])),
        )


@dataclass
class ParetoPoint:
    quality: float
    cost_usd: float
    latency_ms: int

    def scalar_fitness(
        self,
        weights: ObjectiveWeights,
        max_cost_usd: float,
        max_latency_ms: int,
    ) -> float:
        """Compute weighted scalar fitness. Higher is better."""
        norm_cost = self.cost_usd / max_cost_usd if max_cost_usd > 0 else 0.0
        norm_speed = self.latency_ms / max_latency_ms if max_latency_ms > 0 else 0.0
        return (
            weights.quality * self.quality
            - weights.cost * norm_cost
            - weights.speed * norm_speed
        )

    def to_dict(self) -> dict[str, Any]:
        return {"quality": self.quality, "cost_usd": self.cost_usd, "latency_ms": self.latency_ms}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ParetoPoint:
        return cls(quality=d["quality"], cost_usd=d["cost_usd"], latency_ms=d["latency_ms"])
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest shared/tests/test_results.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/shared/results.py backend/shared/tests/test_results.py
git commit -m "feat: add RunResult, Score, ParetoPoint with scalar fitness"
```

---

### Task 5: JSON Schema for gene validation

**Files:**
- Create: `backend/shared/schema/gene.json`
- Create: `backend/shared/validator.py`
- Create: `backend/shared/tests/test_validator.py`

- [ ] **Step 1: Write failing tests**

Create `backend/shared/tests/test_validator.py`:

```python
import pytest
from backend.shared.validator import validate_gene, GeneValidationError


def test_valid_gene_passes():
    gene = {
        "id": "gene_001",
        "topology": "fixed_pipeline",
        "agents": [
            {"id": "a0", "role": "planner", "model": "gpt-4o",
             "system_prompt": "Plan.", "tools": [], "temperature": 0.7}
        ],
        "edges": [{"from": "a0", "to": "a1", "type": "sequential"}],
        "topology_params": {},
    }
    validate_gene(gene)  # should not raise


def test_missing_topology_raises():
    with pytest.raises(GeneValidationError):
        validate_gene({"id": "x", "agents": [], "edges": [], "topology_params": {}})


def test_invalid_topology_value_raises():
    with pytest.raises(GeneValidationError):
        validate_gene({
            "id": "x", "topology": "invalid_type",
            "agents": [], "edges": [], "topology_params": {},
        })


def test_agent_missing_role_raises():
    with pytest.raises(GeneValidationError):
        validate_gene({
            "id": "x", "topology": "fixed_pipeline",
            "agents": [{"id": "a0", "model": "gpt-4o", "system_prompt": "x",
                        "tools": [], "temperature": 0.7}],
            "edges": [], "topology_params": {},
        })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest shared/tests/test_validator.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create JSON Schema**

Create `backend/shared/schema/gene.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Gene",
  "type": "object",
  "required": ["id", "topology", "agents", "edges", "topology_params"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "topology": {
      "type": "string",
      "enum": ["fixed_pipeline", "ai_orchestrated", "debate", "parallel_reduce", "human_in_loop", "hybrid"]
    },
    "agents": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "role", "model", "system_prompt"],
        "additionalProperties": false,
        "properties": {
          "id":            { "type": "string", "minLength": 1 },
          "role":          { "type": "string", "minLength": 1 },
          "model":         { "type": "string", "minLength": 1 },
          "system_prompt": { "type": "string", "minLength": 1 },
          "tools":         { "type": "array", "items": { "type": "string" } },
          "temperature":   { "type": "number", "minimum": 0.0, "maximum": 1.0 }
        }
      }
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["from", "to"],
        "additionalProperties": false,
        "properties": {
          "from": { "type": "string" },
          "to":   { "type": "string" },
          "type": { "type": "string", "enum": ["sequential", "broadcast", "reduce", "conditional"] }
        }
      }
    },
    "topology_params": { "type": "object" }
  }
}
```

- [ ] **Step 4: Implement validator.py**

Create `backend/shared/validator.py`:

```python
from __future__ import annotations
import json
from pathlib import Path
import jsonschema

_SCHEMA_PATH = Path(__file__).parent / "schema" / "gene.json"

with _SCHEMA_PATH.open() as f:
    _GENE_SCHEMA = json.load(f)


class GeneValidationError(Exception):
    pass


def validate_gene(gene: dict) -> None:
    """Validate a gene dict against the canonical JSON Schema.

    Raises GeneValidationError if the gene is invalid.
    """
    try:
        jsonschema.validate(instance=gene, schema=_GENE_SCHEMA)
    except jsonschema.ValidationError as exc:
        raise GeneValidationError(exc.message) from exc
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && python -m pytest shared/tests/test_validator.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/shared/schema/gene.json backend/shared/validator.py backend/shared/tests/test_validator.py
git commit -m "feat: add JSON Schema validator for gene documents"
```

---

### Task 6: Canonical fixture genes for all topology types

**Files:**
- Create: `backend/shared/fixtures/fixed_pipeline.json`
- Create: `backend/shared/fixtures/ai_orchestrated.json`
- Create: `backend/shared/fixtures/debate.json`
- Create: `backend/shared/fixtures/parallel_reduce.json`
- Create: `backend/shared/fixtures/human_in_loop.json`
- Create: `backend/shared/fixtures/hybrid.json`
- Create: `backend/shared/fixtures/__init__.py` (loader helper)
- Create: `backend/shared/tests/test_fixtures.py`

- [ ] **Step 1: Write failing tests**

Create `backend/shared/tests/test_fixtures.py`:

```python
import pytest
from backend.shared.fixtures import load_fixture
from backend.shared.validator import validate_gene
from backend.shared.gene import Gene


TOPOLOGY_TYPES = [
    "fixed_pipeline",
    "ai_orchestrated",
    "debate",
    "parallel_reduce",
    "human_in_loop",
    "hybrid",
]


@pytest.mark.parametrize("topology", TOPOLOGY_TYPES)
def test_fixture_validates(topology):
    gene_dict = load_fixture(topology)
    validate_gene(gene_dict)  # must not raise


@pytest.mark.parametrize("topology", TOPOLOGY_TYPES)
def test_fixture_roundtrip(topology):
    gene_dict = load_fixture(topology)
    gene = Gene.from_dict(gene_dict)
    assert gene.topology.value == topology
    assert len(gene.agents) >= 1
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest shared/tests/test_fixtures.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create fixture JSON files**

`backend/shared/fixtures/fixed_pipeline.json`:
```json
{
  "id": "fixture_fixed_pipeline",
  "topology": "fixed_pipeline",
  "agents": [
    {"id": "a0", "role": "researcher", "model": "gpt-4o-mini", "system_prompt": "You research and gather relevant information on the given topic. Be thorough and factual.", "tools": ["web_search"], "temperature": 0.3},
    {"id": "a1", "role": "writer", "model": "gpt-4o-mini", "system_prompt": "You write clear, concise summaries based on research provided to you. Focus on key insights.", "tools": [], "temperature": 0.7}
  ],
  "edges": [{"from": "a0", "to": "a1", "type": "sequential"}],
  "topology_params": {}
}
```

`backend/shared/fixtures/ai_orchestrated.json`:
```json
{
  "id": "fixture_ai_orchestrated",
  "topology": "ai_orchestrated",
  "agents": [
    {"id": "a0", "role": "orchestrator", "model": "gpt-4o", "system_prompt": "You are an orchestrator. Given a task, decide which specialist agent to delegate to next. Return JSON: {\"next_agent\": \"<agent_id>\", \"instruction\": \"<what to do>\"}. When done, return {\"next_agent\": null, \"final_answer\": \"<answer>\"}.", "tools": [], "temperature": 0.2},
    {"id": "a1", "role": "analyst", "model": "gpt-4o-mini", "system_prompt": "You analyze data and provide structured insights when given an analysis task.", "tools": [], "temperature": 0.4},
    {"id": "a2", "role": "writer", "model": "gpt-4o-mini", "system_prompt": "You write polished prose output based on structured content given to you.", "tools": [], "temperature": 0.7}
  ],
  "edges": [
    {"from": "a0", "to": "a1", "type": "conditional"},
    {"from": "a0", "to": "a2", "type": "conditional"}
  ],
  "topology_params": {"orchestrator_id": "a0", "max_rounds": 5}
}
```

`backend/shared/fixtures/debate.json`:
```json
{
  "id": "fixture_debate",
  "topology": "debate",
  "agents": [
    {"id": "a0", "role": "advocate", "model": "gpt-4o-mini", "system_prompt": "You argue strongly in favor of the proposed solution. Provide clear reasoning and evidence.", "tools": [], "temperature": 0.8},
    {"id": "a1", "role": "critic", "model": "gpt-4o-mini", "system_prompt": "You critically challenge the proposed solution. Identify weaknesses, risks, and alternatives.", "tools": [], "temperature": 0.8},
    {"id": "a2", "role": "judge", "model": "gpt-4o", "system_prompt": "You synthesize the debate between advocate and critic. Produce a balanced final answer that incorporates the strongest points from both sides.", "tools": [], "temperature": 0.3}
  ],
  "edges": [
    {"from": "a0", "to": "a2", "type": "sequential"},
    {"from": "a1", "to": "a2", "type": "sequential"}
  ],
  "topology_params": {"judge_id": "a2", "debate_rounds": 2}
}
```

`backend/shared/fixtures/parallel_reduce.json`:
```json
{
  "id": "fixture_parallel_reduce",
  "topology": "parallel_reduce",
  "agents": [
    {"id": "a0", "role": "specialist_a", "model": "gpt-4o-mini", "system_prompt": "You handle the technical aspects of the given question. Be precise and detailed.", "tools": [], "temperature": 0.4},
    {"id": "a1", "role": "specialist_b", "model": "gpt-4o-mini", "system_prompt": "You handle the business and strategic aspects of the given question. Focus on practical implications.", "tools": [], "temperature": 0.5},
    {"id": "a2", "role": "reducer", "model": "gpt-4o", "system_prompt": "You receive multiple specialist responses and synthesize them into one coherent, comprehensive answer.", "tools": [], "temperature": 0.4}
  ],
  "edges": [
    {"from": "a0", "to": "a2", "type": "reduce"},
    {"from": "a1", "to": "a2", "type": "reduce"}
  ],
  "topology_params": {"reducer_id": "a2", "parallel_agent_ids": ["a0", "a1"]}
}
```

`backend/shared/fixtures/human_in_loop.json`:
```json
{
  "id": "fixture_human_in_loop",
  "topology": "human_in_loop",
  "agents": [
    {"id": "a0", "role": "drafter", "model": "gpt-4o-mini", "system_prompt": "You draft an initial response to the task. Clearly state your assumptions.", "tools": [], "temperature": 0.6},
    {"id": "a1", "role": "refiner", "model": "gpt-4o-mini", "system_prompt": "You refine the draft based on human feedback provided. Incorporate feedback faithfully.", "tools": [], "temperature": 0.5}
  ],
  "edges": [
    {"from": "a0", "to": "a1", "type": "sequential"}
  ],
  "topology_params": {"human_pause_after": "a0", "human_prompt": "Review the draft above and provide feedback or approval."}
}
```

`backend/shared/fixtures/hybrid.json`:
```json
{
  "id": "fixture_hybrid",
  "topology": "hybrid",
  "agents": [
    {"id": "a0", "role": "orchestrator", "model": "gpt-4o", "system_prompt": "You orchestrate a hybrid workflow. First delegate parallel research to specialists, then synthesize results.", "tools": [], "temperature": 0.2},
    {"id": "a1", "role": "researcher_a", "model": "gpt-4o-mini", "system_prompt": "You research factual and technical information on the given topic.", "tools": ["web_search"], "temperature": 0.3},
    {"id": "a2", "role": "researcher_b", "model": "gpt-4o-mini", "system_prompt": "You research market and business context on the given topic.", "tools": [], "temperature": 0.4},
    {"id": "a3", "role": "synthesizer", "model": "gpt-4o", "system_prompt": "You synthesize all gathered research into a final comprehensive answer.", "tools": [], "temperature": 0.5}
  ],
  "edges": [
    {"from": "a0", "to": "a1", "type": "broadcast"},
    {"from": "a0", "to": "a2", "type": "broadcast"},
    {"from": "a1", "to": "a3", "type": "reduce"},
    {"from": "a2", "to": "a3", "type": "reduce"}
  ],
  "topology_params": {"orchestrator_id": "a0", "reducer_id": "a3"}
}
```

- [ ] **Step 4: Create fixture loader**

Create `backend/shared/fixtures/__init__.py`:

```python
from __future__ import annotations
import json
from pathlib import Path

_FIXTURES_DIR = Path(__file__).parent

TOPOLOGY_FIXTURES = [
    "fixed_pipeline",
    "ai_orchestrated",
    "debate",
    "parallel_reduce",
    "human_in_loop",
    "hybrid",
]


def load_fixture(topology: str) -> dict:
    """Load a canonical fixture gene dict by topology type."""
    if topology not in TOPOLOGY_FIXTURES:
        raise ValueError(f"Unknown topology fixture: {topology!r}. Valid: {TOPOLOGY_FIXTURES}")
    path = _FIXTURES_DIR / f"{topology}.json"
    with path.open() as f:
        return json.load(f)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && python -m pytest shared/tests/test_fixtures.py -v
```

Expected: all 12 tests PASS (6 validate + 6 roundtrip).

- [ ] **Step 6: Run full shared test suite**

```bash
cd backend && python -m pytest shared/tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/shared/fixtures/ backend/shared/tests/test_fixtures.py
git commit -m "feat: add canonical fixture genes for all 6 topology types"
```

---

### Task 7: Package __init__.py exports

**Files:**
- Modify: `backend/shared/__init__.py`

- [ ] **Step 1: Export public API**

Edit `backend/shared/__init__.py`:

```python
from backend.shared.gene import Gene, Agent, Edge, TopologyType
from backend.shared.experiment import ExperimentConfig, ObjectiveWeights, EvaluatorConfig
from backend.shared.results import RunResult, Score, ParetoPoint
from backend.shared.validator import validate_gene, GeneValidationError
from backend.shared.fixtures import load_fixture

__all__ = [
    "Gene", "Agent", "Edge", "TopologyType",
    "ExperimentConfig", "ObjectiveWeights", "EvaluatorConfig",
    "RunResult", "Score", "ParetoPoint",
    "validate_gene", "GeneValidationError",
    "load_fixture",
]
```

- [ ] **Step 2: Verify import works**

```bash
cd backend && python -c "from shared import Gene, ExperimentConfig, RunResult, validate_gene, load_fixture; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Run full test suite one final time**

```bash
cd backend && python -m pytest shared/tests/ -v --tb=short
```

Expected: all tests PASS, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add backend/shared/__init__.py
git commit -m "feat: export public API from shared package"
```
