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
class EvalRowResult:
    row_index: int
    input_json: str  # JSON string of the dataset row dict
    output_text: str
    score: float  # quality 0–1
    score_reasoning: str  # LLM judge reason or empty string
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
        return {
            "quality": self.quality,
            "cost_usd": self.cost_usd,
            "latency_ms": self.latency_ms,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ParetoPoint:
        return cls(
            quality=d["quality"], cost_usd=d["cost_usd"], latency_ms=d["latency_ms"]
        )
