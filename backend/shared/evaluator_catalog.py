"""Catalog of evaluator type descriptors for AutoAW experiments."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

_MODEL_OPTIONS = [
    "gpt-4o-mini",
    "gpt-4o",
    "claude-3-5-haiku-20241022",
    "claude-3-5-sonnet-20241022",
]


@dataclass
class EvaluatorParamSpec:
    name: str
    type: Literal["string", "number", "select", "textarea"]
    label: str
    description: str
    default: Any
    required: bool = False
    options: list[str] | None = None  # for "select"
    min: float | None = None  # for "number"
    max: float | None = None  # for "number"
    step: float | None = None  # for "number"

    def to_dict(self) -> dict:
        d = {
            "name": self.name,
            "type": self.type,
            "label": self.label,
            "description": self.description,
            "default": self.default,
            "required": self.required,
        }
        if self.options is not None:
            d["options"] = self.options
        if self.min is not None:
            d["min"] = self.min
        if self.max is not None:
            d["max"] = self.max
        if self.step is not None:
            d["step"] = self.step
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "EvaluatorParamSpec":
        return cls(
            name=d["name"],
            type=d["type"],
            label=d["label"],
            description=d["description"],
            default=d["default"],
            required=d.get("required", False),
            options=d.get("options"),
            min=d.get("min"),
            max=d.get("max"),
            step=d.get("step"),
        )


@dataclass
class EvaluatorTypeDescriptor:
    type: str
    name: str
    description: str
    category: Literal["built_in", "ragas", "deepeval"]
    params: list[EvaluatorParamSpec] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "params": [p.to_dict() for p in self.params],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "EvaluatorTypeDescriptor":
        return cls(
            type=d["type"],
            name=d["name"],
            description=d["description"],
            category=d["category"],
            params=[EvaluatorParamSpec.from_dict(p) for p in d.get("params", [])],
        )


def _model_param() -> EvaluatorParamSpec:
    return EvaluatorParamSpec(
        name="model",
        type="select",
        label="Model",
        description="LLM used for evaluation.",
        default="gpt-4o-mini",
        options=_MODEL_OPTIONS,
    )


def _threshold_param() -> EvaluatorParamSpec:
    return EvaluatorParamSpec(
        name="threshold",
        type="number",
        label="Threshold",
        description="Minimum score (0–1) to consider the evaluation passing.",
        default=0.5,
        min=0.0,
        max=1.0,
        step=0.05,
    )


CATALOG: list[EvaluatorTypeDescriptor] = [
    EvaluatorTypeDescriptor(
        type="llm_judge",
        name="LLM Judge",
        description=(
            "Uses an LLM to score workflow outputs against a user-defined rubric. "
            "Returns a score between 0 and 1."
        ),
        category="built_in",
        params=[
            _model_param(),
            EvaluatorParamSpec(
                name="rubric",
                type="textarea",
                label="Rubric",
                description=(
                    "Scoring rubric that instructs the judge model how to evaluate outputs. "
                    "Should describe what a good answer looks like and how to assign scores."
                ),
                default="",
                required=True,
            ),
        ],
    ),
    EvaluatorTypeDescriptor(
        type="workbench",
        name="WorkBench Trace Match",
        description=(
            "Positional tool-call trace matching against expected action sequences. "
            "Score = matched positions / total expected. "
            "Used for WorkBench benchmark tasks."
        ),
        category="built_in",
        params=[],
    ),
    EvaluatorTypeDescriptor(
        type="human",
        name="Human Review",
        description=(
            "Pauses evaluation and presents the workflow output to a human reviewer "
            "who provides a score and optional feedback."
        ),
        category="built_in",
        params=[],
    ),
    EvaluatorTypeDescriptor(
        type="deepeval_answer_relevancy",
        name="Answer Relevancy (DeepEval)",
        description="DeepEval metric that measures how relevant the generated answer is to the input query.",
        category="deepeval",
        params=[_model_param(), _threshold_param()],
    ),
    EvaluatorTypeDescriptor(
        type="deepeval_faithfulness",
        name="Faithfulness (DeepEval)",
        description="DeepEval metric that measures whether the generated answer is grounded in the provided context.",
        category="deepeval",
        params=[_model_param(), _threshold_param()],
    ),
    EvaluatorTypeDescriptor(
        type="deepeval_hallucination",
        name="Hallucination (DeepEval)",
        description="DeepEval metric that detects hallucinated facts in generated answers.",
        category="deepeval",
        params=[_model_param(), _threshold_param()],
    ),
    EvaluatorTypeDescriptor(
        type="deepeval_tool_correctness",
        name="Tool Correctness (DeepEval)",
        description="DeepEval metric that checks whether the correct tools were called with the correct arguments.",
        category="deepeval",
        params=[_threshold_param()],
    ),
    EvaluatorTypeDescriptor(
        type="deepeval_bias",
        name="Bias (DeepEval)",
        description="DeepEval metric that detects bias in generated answers.",
        category="deepeval",
        params=[_model_param(), _threshold_param()],
    ),
    EvaluatorTypeDescriptor(
        type="ragas_faithfulness",
        name="Faithfulness (RAGAS)",
        description="RAGAS metric that measures factual consistency of the generated answer against the context.",
        category="ragas",
        params=[_model_param()],
    ),
    EvaluatorTypeDescriptor(
        type="ragas_answer_relevancy",
        name="Answer Relevancy (RAGAS)",
        description="RAGAS metric that assesses how relevant the generated answer is to the question.",
        category="ragas",
        params=[_model_param()],
    ),
    EvaluatorTypeDescriptor(
        type="ragas_answer_correctness",
        name="Answer Correctness (RAGAS)",
        description="RAGAS metric that measures the correctness of the generated answer against the ground truth.",
        category="ragas",
        params=[_model_param()],
    ),
]

CATALOG_BY_TYPE: dict[str, EvaluatorTypeDescriptor] = {
    entry.type: entry for entry in CATALOG
}
