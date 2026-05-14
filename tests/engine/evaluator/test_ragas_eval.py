"""Tests for RAGAS evaluator implementations."""

from __future__ import annotations
from unittest.mock import patch

import pytest

from backend.engine.evaluator.ragas_eval import (
    RagasFaithfulnessEvaluator,
    RagasAnswerRelevancyEvaluator,
    RagasAnswerCorrectnessEvaluator,
)
from backend.shared.results import Score

MODULE = "backend.engine.evaluator.ragas_eval._run_ragas_metric"


def test_faithfulness_returns_score():
    with patch(MODULE, return_value=0.75) as mock:
        ev = RagasFaithfulnessEvaluator()
        result = ev.score("q", "a", "expected")
    assert isinstance(result, Score)
    assert result.quality == 0.75
    assert result.metadata["metric"] == "ragas_faithfulness"
    mock.assert_called_once_with(
        "faithfulness", "q", "a", "expected", "expected", "gpt-4o-mini"
    )


def test_answer_relevancy_returns_score():
    with patch(MODULE, return_value=0.6) as mock:
        ev = RagasAnswerRelevancyEvaluator()
        result = ev.score("q", "a", "expected")
    assert isinstance(result, Score)
    assert result.quality == 0.6
    assert result.metadata["metric"] == "ragas_answer_relevancy"
    mock.assert_called_once_with(
        "answer_relevancy", "q", "a", None, "expected", "gpt-4o-mini"
    )


def test_answer_correctness_returns_score():
    with patch(MODULE, return_value=0.9) as mock:
        ev = RagasAnswerCorrectnessEvaluator()
        result = ev.score("q", "a", "expected")
    assert isinstance(result, Score)
    assert result.quality == 0.9
    assert result.metadata["metric"] == "ragas_answer_correctness"
    mock.assert_called_once_with(
        "answer_correctness", "q", "a", None, "expected", "gpt-4o-mini"
    )


def test_scores_clamped_high():
    # Clamping is performed inside _run_ragas_metric; evaluator passes the value through.
    with patch(MODULE, return_value=1.0):
        ev = RagasFaithfulnessEvaluator()
        result = ev.score("q", "a", None)
    assert result.quality == 1.0


def test_scores_clamped_low():
    # Clamping is performed inside _run_ragas_metric; evaluator passes the value through.
    with patch(MODULE, return_value=0.0):
        ev = RagasAnswerRelevancyEvaluator()
        result = ev.score("q", "a", None)
    assert result.quality == 0.0


def test_metadata_metric_key_faithfulness():
    with patch(MODULE, return_value=0.5):
        result = RagasFaithfulnessEvaluator().score("q", "a", None)
    assert result.metadata["metric"] == "ragas_faithfulness"


def test_metadata_metric_key_relevancy():
    with patch(MODULE, return_value=0.5):
        result = RagasAnswerRelevancyEvaluator().score("q", "a", None)
    assert result.metadata["metric"] == "ragas_answer_relevancy"


def test_metadata_metric_key_correctness():
    with patch(MODULE, return_value=0.5):
        result = RagasAnswerCorrectnessEvaluator().score("q", "a", "expected")
    assert result.metadata["metric"] == "ragas_answer_correctness"


def test_answer_correctness_raises_when_expected_none():
    ev = RagasAnswerCorrectnessEvaluator()
    with pytest.raises(ValueError, match="expected.*ground truth.*required"):
        ev.score("q", "a", None)
