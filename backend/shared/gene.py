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


# Alias for backwards compatibility
TopologyParams = dict

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
            raise ValueError(
                f"temperature must be between 0.0 and 1.0, got {self.temperature}"
            )

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
