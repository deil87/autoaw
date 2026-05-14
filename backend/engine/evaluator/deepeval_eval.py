"""DeepEval-backed evaluator implementations.

All deepeval imports are lazy (inside methods) so the module can be imported
even when deepeval is not installed.
"""

from __future__ import annotations
import json

from backend.engine.evaluator.base import Evaluator
from backend.shared.results import Score


# ---------------------------------------------------------------------------
# Module-level factory functions — exist so tests can mock them cheaply
# ---------------------------------------------------------------------------


def _make_answer_relevancy_metric(model: str, threshold: float):
    from deepeval.metrics import AnswerRelevancyMetric  # type: ignore[import]

    return AnswerRelevancyMetric(model=model, threshold=threshold, async_mode=False)


def _make_faithfulness_metric(model: str, threshold: float):
    from deepeval.metrics import FaithfulnessMetric  # type: ignore[import]

    return FaithfulnessMetric(model=model, threshold=threshold, async_mode=False)


def _make_hallucination_metric(model: str, threshold: float):
    from deepeval.metrics import HallucinationMetric  # type: ignore[import]

    return HallucinationMetric(model=model, threshold=threshold, async_mode=False)


def _make_bias_metric(model: str, threshold: float):
    from deepeval.metrics import BiasMetric  # type: ignore[import]

    return BiasMetric(model=model, threshold=threshold, async_mode=False)


def _make_tool_correctness_metric(threshold: float):
    from deepeval.metrics import ToolCorrectnessMetric  # type: ignore[import]

    return ToolCorrectnessMetric(threshold=threshold)


# ---------------------------------------------------------------------------
# Shared helper
# ---------------------------------------------------------------------------


def _run_metric(metric, test_case) -> tuple[float, str]:
    metric.measure(test_case)
    quality = max(0.0, min(1.0, float(metric.score)))
    reason = getattr(metric, "reason", "") or ""
    return quality, reason


# ---------------------------------------------------------------------------
# Evaluator classes
# ---------------------------------------------------------------------------


class DeepEvalAnswerRelevancyEvaluator(Evaluator):
    def __init__(self, model: str = "gpt-4o-mini", threshold: float = 0.5) -> None:
        self.model = model
        self.threshold = threshold

    def score(self, input: str, output: str, expected: str | None) -> Score:
        from deepeval.test_case import LLMTestCase  # type: ignore[import]

        metric = _make_answer_relevancy_metric(self.model, self.threshold)
        test_case = LLMTestCase(input=input, actual_output=output)
        quality, reason = _run_metric(metric, test_case)
        return Score(quality=quality, metadata={"reason": reason})


class DeepEvalFaithfulnessEvaluator(Evaluator):
    def __init__(self, model: str = "gpt-4o-mini", threshold: float = 0.5) -> None:
        self.model = model
        self.threshold = threshold

    def score(self, input: str, output: str, expected: str | None) -> Score:
        from deepeval.test_case import LLMTestCase  # type: ignore[import]

        retrieval_context = [expected] if expected is not None else []
        metric = _make_faithfulness_metric(self.model, self.threshold)
        test_case = LLMTestCase(
            input=input,
            actual_output=output,
            retrieval_context=retrieval_context,
        )
        quality, reason = _run_metric(metric, test_case)
        return Score(quality=quality, metadata={"reason": reason})


class DeepEvalHallucinationEvaluator(Evaluator):
    def __init__(self, model: str = "gpt-4o-mini", threshold: float = 0.5) -> None:
        self.model = model
        self.threshold = threshold

    def score(self, input: str, output: str, expected: str | None) -> Score:
        from deepeval.test_case import LLMTestCase  # type: ignore[import]

        context = [expected] if expected is not None else []
        metric = _make_hallucination_metric(self.model, self.threshold)
        test_case = LLMTestCase(input=input, actual_output=output, context=context)
        raw_quality, reason = _run_metric(metric, test_case)
        quality = 1.0 - raw_quality
        return Score(quality=quality, metadata={"reason": reason})


class DeepEvalBiasEvaluator(Evaluator):
    def __init__(self, model: str = "gpt-4o-mini", threshold: float = 0.5) -> None:
        self.model = model
        self.threshold = threshold

    def score(self, input: str, output: str, expected: str | None) -> Score:
        from deepeval.test_case import LLMTestCase  # type: ignore[import]

        metric = _make_bias_metric(self.model, self.threshold)
        test_case = LLMTestCase(input=input, actual_output=output)
        raw_quality, reason = _run_metric(metric, test_case)
        quality = 1.0 - raw_quality
        return Score(quality=quality, metadata={"reason": reason})


class DeepEvalToolCorrectnessEvaluator(Evaluator):
    def __init__(self, threshold: float = 0.5) -> None:
        self.threshold = threshold

    def score(self, input: str, output: str, expected: str | None) -> Score:
        from deepeval.test_case import LLMTestCase, ToolCall  # type: ignore[import]

        try:
            actual_tools = [ToolCall(name=n) for n in json.loads(output)]
        except (json.JSONDecodeError, TypeError, ValueError):
            actual_tools = []

        try:
            expected_tools = [ToolCall(name=n) for n in json.loads(expected or "[]")]
        except (json.JSONDecodeError, TypeError, ValueError):
            expected_tools = []

        metric = _make_tool_correctness_metric(self.threshold)
        test_case = LLMTestCase(
            input=input,
            actual_output=output,
            tools_called=actual_tools,
            expected_tools=expected_tools,
        )
        quality, reason = _run_metric(metric, test_case)
        return Score(quality=quality, metadata={"reason": reason})
