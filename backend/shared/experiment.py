from __future__ import annotations
import os
from dataclasses import dataclass, field
from typing import Any

# Default model pools used when the user does not specify allowed_models.
# Cloud pool: full set of remote models available for GP mutation.
# Local pool: single lightweight model so users running a local inference
#   engine (e.g. Ollama via OPENAI_BASE_URL) don't download multiple
#   multi-GB weight files by default.
DEFAULT_CLOUD_MODELS: list[str] = [
    "gpt-4o-mini",
    "gpt-4o",
    "claude-3-5-haiku-20241022",
    "claude-3-5-sonnet-20241022",
    "amazon.nova-micro-v1:0",
    "amazon.nova-lite-v1:0",
    "meta.llama3-2-1b-instruct-v1:0",
    "meta.llama3-2-3b-instruct-v1:0",
    "meta.llama3-1-8b-instruct-v1:0",
]

DEFAULT_LOCAL_MODELS: list[str] = [
    "command-r",          # Cohere Command R 35B — default; best multilingual + JSON output
    "command-r-plus",     # Cohere Command R+ 104B — highest quality, needs ~60 GB RAM
    "mistral-nemo",       # Mistral Nemo 12B — strong multilingual, low footprint
    "llama3.1:8b",        # Meta Llama 3.1 8B — solid reasoning, English-primary
    "mistral:v0.3",       # Mistral 7B Instruct v0.3 — lightweight baseline
]


def _provider_from_env():
    """Thin wrapper; import deferred to avoid circular imports at module load."""
    from backend.engine.llm_client import provider_from_env

    return provider_from_env()


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
    evaluators: list[EvaluatorConfig]
    objective_weights: ObjectiveWeights
    dataset_id: str = ""
    task_type: str = "objective"  # "objective" | "generative" | "hybrid"
    population_size: int = 20
    budget_max_trials: int | None = None
    budget_max_usd: float | None = None
    convergence_patience: int = 10
    concurrency: int = 5
    provider: Any = field(
        default=None
    )  # ProviderConfig (typed as Any to avoid import at module level)
    allowed_models: list[str] = field(default_factory=lambda: list(DEFAULT_CLOUD_MODELS))
    smbo_model: str | None = None  # if set, all agent models are upgraded to this before SMBO polish
    runner_type: str = "raw_llm"
    evaluator_type: str = "llm_judge"
    dataset_sample_size: int | None = None  # None = use all rows; N = use first N rows
    n_generations: int = 1  # generative only: synthetic tasks generated per trial evaluation
    seed_gene: dict | None = None  # user-supplied gene injected at slot 0 of the initial population

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "task_description": self.task_description,
            "dataset_id": self.dataset_id,
            "task_type": self.task_type,
            "evaluators": [e.to_dict() for e in self.evaluators],
            "objective_weights": self.objective_weights.to_dict(),
            "population_size": self.population_size,
            "budget_max_trials": self.budget_max_trials,
            "budget_max_usd": self.budget_max_usd,
            "convergence_patience": self.convergence_patience,
            "concurrency": self.concurrency,
            "provider": self.provider.to_dict() if self.provider else None,
            "allowed_models": list(self.allowed_models),
            "smbo_model": self.smbo_model,
            "runner_type": self.runner_type,
            "evaluator_type": self.evaluator_type,
            "dataset_sample_size": self.dataset_sample_size,
            "n_generations": self.n_generations,
            "seed_gene": self.seed_gene,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ExperimentConfig:
        from backend.engine.llm_client import ProviderConfig

        provider_dict = d.get("provider")
        if provider_dict:
            provider = ProviderConfig.from_dict(provider_dict)
        else:
            provider = None
        return cls(
            name=d["name"],
            task_description=d["task_description"],
            dataset_id=d.get("dataset_id", ""),
            task_type=d.get("task_type", "objective"),
            evaluators=[EvaluatorConfig.from_dict(e) for e in d["evaluators"]],
            objective_weights=ObjectiveWeights.from_dict(d["objective_weights"]),
            population_size=d.get("population_size", 20),
            budget_max_trials=d.get("budget_max_trials"),
            budget_max_usd=d.get("budget_max_usd"),
            convergence_patience=d.get("convergence_patience", 10),
            concurrency=d.get("concurrency", 5),
            provider=provider,
            allowed_models=d.get("allowed_models", list(DEFAULT_CLOUD_MODELS)),
            smbo_model=d.get("smbo_model"),
            runner_type=d.get("runner_type", "raw_llm"),
            evaluator_type=d.get("evaluator_type", "llm_judge"),
            dataset_sample_size=d.get("dataset_sample_size"),
            n_generations=d.get("n_generations", 1),
            seed_gene=d.get("seed_gene"),
        )
