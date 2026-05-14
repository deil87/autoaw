"""Tests for DeepEval evaluator implementations. Uses mocks so deepeval need not be installed."""

from __future__ import annotations
import sys
import types
from unittest.mock import MagicMock, patch
import pytest

# ---------------------------------------------------------------------------
# Stub out deepeval before any import of the module under test
# ---------------------------------------------------------------------------


def _build_deepeval_stubs():
    """Create minimal deepeval stub modules in sys.modules."""
    deepeval = types.ModuleType("deepeval")
    metrics_mod = types.ModuleType("deepeval.metrics")
    test_case_mod = types.ModuleType("deepeval.test_case")

    # Stub LLMTestCase: just records kwargs
    class _LLMTestCase:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    # Stub ToolCall
    class _ToolCall:
        def __init__(self, name: str):
            self.name = name

    test_case_mod.LLMTestCase = _LLMTestCase
    test_case_mod.ToolCall = _ToolCall
    deepeval.metrics = metrics_mod
    deepeval.test_case = test_case_mod

    sys.modules.setdefault("deepeval", deepeval)
    sys.modules.setdefault("deepeval.metrics", metrics_mod)
    sys.modules.setdefault("deepeval.test_case", test_case_mod)


_build_deepeval_stubs()

# Now safe to import the module under test
from backend.engine.evaluator.deepeval_eval import (  # noqa: E402
    DeepEvalAnswerRelevancyEvaluator,
    DeepEvalFaithfulnessEvaluator,
    DeepEvalHallucinationEvaluator,
    DeepEvalBiasEvaluator,
    DeepEvalToolCorrectnessEvaluator,
)
from backend.shared.results import Score


def _make_mock_metric(score: float, reason: str = "test reason") -> MagicMock:
    m = MagicMock()
    m.score = score
    m.reason = reason
    return m


class TestDeepEvalAnswerRelevancyEvaluator:
    def test_returns_score(self):
        mock_metric = _make_mock_metric(0.8)
        with patch(
            "backend.engine.evaluator.deepeval_eval._make_answer_relevancy_metric",
            return_value=mock_metric,
        ):
            ev = DeepEvalAnswerRelevancyEvaluator()
            result = ev.score("question", "answer", None)
        assert isinstance(result, Score)
        assert result.quality == pytest.approx(0.8)
        assert "reason" in result.metadata

    def test_score_clamped_high(self):
        mock_metric = _make_mock_metric(1.5)
        with patch(
            "backend.engine.evaluator.deepeval_eval._make_answer_relevancy_metric",
            return_value=mock_metric,
        ):
            ev = DeepEvalAnswerRelevancyEvaluator()
            result = ev.score("q", "a", None)
        assert result.quality == pytest.approx(1.0)


class TestDeepEvalFaithfulnessEvaluator:
    def test_returns_score(self):
        mock_metric = _make_mock_metric(0.6)
        with patch(
            "backend.engine.evaluator.deepeval_eval._make_faithfulness_metric",
            return_value=mock_metric,
        ):
            ev = DeepEvalFaithfulnessEvaluator()
            result = ev.score("q", "a", "expected context")
        assert result.quality == pytest.approx(0.6)

    def test_fallback_when_expected_none(self):
        mock_metric = _make_mock_metric(0.4)
        with patch(
            "backend.engine.evaluator.deepeval_eval._make_faithfulness_metric",
            return_value=mock_metric,
        ):
            ev = DeepEvalFaithfulnessEvaluator()
            result = ev.score("q", "a", None)
        assert result.quality == pytest.approx(0.4)


class TestDeepEvalHallucinationEvaluator:
    def test_inverts_score(self):
        mock_metric = _make_mock_metric(0.3)
        with patch(
            "backend.engine.evaluator.deepeval_eval._make_hallucination_metric",
            return_value=mock_metric,
        ):
            ev = DeepEvalHallucinationEvaluator()
            result = ev.score("q", "a", "context")
        assert result.quality == pytest.approx(0.7)

    def test_inversion_clamped(self):
        # raw score 1.5 → clamped to 1.0 → inverted to 0.0
        mock_metric = _make_mock_metric(1.5)
        with patch(
            "backend.engine.evaluator.deepeval_eval._make_hallucination_metric",
            return_value=mock_metric,
        ):
            ev = DeepEvalHallucinationEvaluator()
            result = ev.score("q", "a", None)
        assert result.quality == pytest.approx(0.0)


class TestDeepEvalBiasEvaluator:
    def test_inverts_score(self):
        mock_metric = _make_mock_metric(0.2)
        with patch(
            "backend.engine.evaluator.deepeval_eval._make_bias_metric",
            return_value=mock_metric,
        ):
            ev = DeepEvalBiasEvaluator()
            result = ev.score("q", "a", None)
        assert result.quality == pytest.approx(0.8)

    def test_inversion_clamped(self):
        # raw score -0.5 → clamped to 0.0 → inverted to 1.0
        mock_metric = _make_mock_metric(-0.5)
        with patch(
            "backend.engine.evaluator.deepeval_eval._make_bias_metric",
            return_value=mock_metric,
        ):
            ev = DeepEvalBiasEvaluator()
            result = ev.score("q", "a", None)
        assert result.quality == pytest.approx(1.0)


class TestDeepEvalToolCorrectnessEvaluator:
    def test_returns_score(self):
        mock_metric = _make_mock_metric(0.9)
        with patch(
            "backend.engine.evaluator.deepeval_eval._make_tool_correctness_metric",
            return_value=mock_metric,
        ):
            ev = DeepEvalToolCorrectnessEvaluator()
            result = ev.score(
                "q",
                '["tool1", "tool2"]',
                '["tool1", "tool2"]',
            )
        assert result.quality == pytest.approx(0.9)

    def test_invalid_json_uses_empty_lists(self):
        mock_metric = _make_mock_metric(0.5)
        with patch(
            "backend.engine.evaluator.deepeval_eval._make_tool_correctness_metric",
            return_value=mock_metric,
        ):
            ev = DeepEvalToolCorrectnessEvaluator()
            result = ev.score("q", "not-json", "also-not-json")
        assert result.quality == pytest.approx(0.5)
