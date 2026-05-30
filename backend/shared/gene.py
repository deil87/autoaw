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


class AgentMetaType(str, Enum):
    """Functional meta-category of an agent.

    Each meta type carries a fixed allowed temperature range that is enforced
    at construction time and respected by the GP mutation operators and SMBO polish.
    """
    PROFILER = "profiler"       # strict analytics — low temperature
    AUTHOR = "author"           # controlled creativity — mid-high temperature
    CRITIC = "critic"           # ruthless audit — zero temperature
    SYNTHESIZER = "synthesizer" # reduction / aggregation — low-mid temperature
    AGENT = "agent"             # generic — full range


# (min, max) inclusive temperature bounds per meta type.
TEMPERATURE_BOUNDS: dict[AgentMetaType, tuple[float, float]] = {
    AgentMetaType.PROFILER:    (0.0, 0.2),
    AgentMetaType.AUTHOR:      (0.5, 0.7),
    AgentMetaType.CRITIC:      (0.0, 0.0),
    AgentMetaType.SYNTHESIZER: (0.2, 0.5),
    AgentMetaType.AGENT:       (0.0, 1.0),
}


# Alias for backwards compatibility
TopologyParams = dict

VALID_EDGE_TYPES = {"sequential", "broadcast", "reduce", "conditional"}


@dataclass
class Subtask:
    """A single extracted subtask within an agent's prompt.

    Populated once by split detection and persisted on the agent so mutations
    can target individual subtasks without re-running detection each generation.
    """
    id: str
    prompt: str
    depends_on: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "prompt": self.prompt, "depends_on": list(self.depends_on)}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Subtask:
        return cls(id=d["id"], prompt=d["prompt"], depends_on=list(d.get("depends_on", [])))


@dataclass
class Agent:
    id: str
    role: str
    model: str
    system_prompt: str
    tools: list[str] = field(default_factory=list)
    memory: dict[str, Any] = field(default_factory=dict)
    """Per-agent memory configuration. Empty dict means stateless (default).

    Supported types:
      ``{}``                               — stateless (default)
      ``{"type": "buffer", "window": 10}`` — sliding-window conversation history;
                                             last N [user, assistant] pairs prepended
      ``{"type": "summary"}``              — LLM-compressed running summary prepended
                                             to system prompt on each call
      ``{"type": "vector", "top_k": 3}``  — ephemeral in-run semantic retrieval;
                                             earlier outputs are indexed and top-K
                                             chunks are injected before the user msg
    """
    temperature: float = 0.7
    meta_type: AgentMetaType | None = None
    """Optional functional category. When set, temperature must fall within
    the range defined in ``TEMPERATURE_BOUNDS`` for that meta type.
    GP mutation operators and SMBO polish respect these bounds automatically."""
    subtasks: list[Subtask] = field(default_factory=list)
    """Subtasks detected in system_prompt by split detection. Empty means the
    prompt was not yet analysed or contains only a single task."""

    def __post_init__(self) -> None:
        if self.meta_type is not None:
            lo, hi = TEMPERATURE_BOUNDS[self.meta_type]
            if not (lo <= self.temperature <= hi):
                raise ValueError(
                    f"temperature {self.temperature} is outside the allowed range "
                    f"[{lo}, {hi}] for meta_type '{self.meta_type}'"
                )
        else:
            if not (0.0 <= self.temperature <= 1.0):
                raise ValueError(
                    f"temperature must be between 0.0 and 1.0, got {self.temperature}"
                )

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "role": self.role,
            "model": self.model,
            "system_prompt": self.system_prompt,
            "tools": list(self.tools),
            "memory": dict(self.memory),
            "temperature": self.temperature,
            "subtasks": [s.to_dict() for s in self.subtasks],
        }
        if self.meta_type is not None:
            d["meta_type"] = self.meta_type.value
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Agent:
        raw_meta = d.get("meta_type")
        return cls(
            id=d["id"],
            role=d["role"],
            model=d["model"],
            system_prompt=d["system_prompt"],
            tools=list(d.get("tools", [])),
            memory=dict(d.get("memory", {})),
            temperature=d.get("temperature", 0.7),
            meta_type=AgentMetaType(raw_meta) if raw_meta is not None else None,
            subtasks=[Subtask.from_dict(s) for s in d.get("subtasks", [])],
        )


@dataclass
class Edge:
    from_agent: str
    to_agent: str
    type: str = "sequential"

    def __post_init__(self) -> None:
        if self.type not in VALID_EDGE_TYPES:
            raise ValueError(
                f"edge type must be one of {VALID_EDGE_TYPES}, got {self.type!r}"
            )

    def to_dict(self) -> dict[str, Any]:
        return {"from": self.from_agent, "to": self.to_agent, "type": self.type}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Edge:
        return cls(
            from_agent=d["from"], to_agent=d["to"], type=d.get("type", "sequential")
        )


@dataclass
class Gene:
    topology: TopologyType
    agents: list[Agent]
    edges: list[Edge]
    id: str = field(default_factory=lambda: f"gene_{uuid.uuid4().hex[:8]}")
    topology_params: dict[str, Any] = field(default_factory=dict)
    shared_memory: dict[str, Any] = field(default_factory=dict)
    """Gene-level shared memory store — accessible to all agents in the run.

    Supported types:
      ``{}``                    — off (default)
      ``{"type":"scratchpad"}`` — plaintext key→value store; agents write facts
                                  during execution and all subsequent agents receive
                                  the accumulated scratchpad as context, enabling
                                  non-linear knowledge passing across the topology
    """

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "topology": self.topology.value,
            "agents": [a.to_dict() for a in self.agents],
            "edges": [e.to_dict() for e in self.edges],
            "topology_params": dict(self.topology_params),
            "shared_memory": dict(self.shared_memory),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Gene:
        return cls(
            id=d["id"],
            topology=TopologyType(d["topology"]),
            agents=[Agent.from_dict(a) for a in d["agents"]],
            edges=[Edge.from_dict(e) for e in d["edges"]],
            topology_params=dict(d.get("topology_params", {})),
            shared_memory=dict(d.get("shared_memory", {})),
        )

    def copy(self) -> Gene:
        """Return a deep copy. Never mutate a gene in place."""
        return Gene.from_dict(copy.deepcopy(self.to_dict()))
