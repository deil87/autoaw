"""RAGAS-backed evaluator implementations.

All ragas/datasets imports are lazy (inside the helper) so the module can be
imported even when those packages are not installed.
"""

from __future__ import annotations

from backend.engine.evaluator.base import Evaluator
from backend.shared.results import Score


def _run_ragas_metric(
    metric_name: str,
    question: str,
    answer: str,
    context: str | None,
    ground_truth: str | None,
    model: str,
) -> float:
    """Run a single RAGAS metric on one row. Returns score in [0, 1]."""
    from datasets import Dataset  # type: ignore[import]
    import ragas.metrics as rm  # type: ignore[import]
    from ragas import evaluate  # type: ignore[import]
    from langchain_openai import ChatOpenAI  # type: ignore[import]

    metric_map = {
        "faithfulness": rm.faithfulness,
        "answer_relevancy": rm.answer_relevancy,
        "answer_correctness": rm.answer_correctness,
    }
    metric = metric_map[metric_name]

    data = {
        "question": [question],
        "answer": [answer],
        "contexts": [[context] if context else [answer]],
        "ground_truth": [ground_truth or ""],
    }
    dataset = Dataset.from_dict(data)
    llm = ChatOpenAI(model=model)
    result = evaluate(dataset, metrics=[metric], llm=llm)
    score = float(result[metric_name][0])
    return max(0.0, min(1.0, score))


class RagasFaithfulnessEvaluator(Evaluator):
    def __init__(self, model: str = "gpt-4o-mini") -> None:
        self.model = model

    def score(self, input: str, output: str, expected: str | None) -> Score:
        quality = _run_ragas_metric(
            "faithfulness", input, output, expected, expected, self.model
        )
        quality = max(0.0, min(1.0, quality))
        return Score(quality=quality, metadata={"metric": "ragas_faithfulness"})


class RagasAnswerRelevancyEvaluator(Evaluator):
    def __init__(self, model: str = "gpt-4o-mini") -> None:
        self.model = model

    def score(self, input: str, output: str, expected: str | None) -> Score:
        quality = _run_ragas_metric(
            "answer_relevancy", input, output, None, expected, self.model
        )
        quality = max(0.0, min(1.0, quality))
        return Score(quality=quality, metadata={"metric": "ragas_answer_relevancy"})


class RagasAnswerCorrectnessEvaluator(Evaluator):
    def __init__(self, model: str = "gpt-4o-mini") -> None:
        self.model = model

    def score(self, input: str, output: str, expected: str | None) -> Score:
        quality = _run_ragas_metric(
            "answer_correctness", input, output, None, expected, self.model
        )
        quality = max(0.0, min(1.0, quality))
        return Score(quality=quality, metadata={"metric": "ragas_answer_correctness"})
