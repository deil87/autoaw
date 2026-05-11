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
    type: str  # "llm_judge" | "function" | "human"
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
