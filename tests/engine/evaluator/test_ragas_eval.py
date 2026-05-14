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
    mock.assert_called_once()


def test_answer_relevancy_returns_score():
    with patch(MODULE, return_value=0.6) as mock:
        ev = RagasAnswerRelevancyEvaluator()
        result = ev.score("q", "a", "expected")
    assert isinstance(result, Score)
    assert result.quality == 0.6
    assert result.metadata["metric"] == "ragas_answer_relevancy"
    mock.assert_called_once()


def test_answer_correctness_returns_score():
    with patch(MODULE, return_value=0.9) as mock:
        ev = RagasAnswerCorrectnessEvaluator()
        result = ev.score("q", "a", "expected")
    assert isinstance(result, Score)
    assert result.quality == 0.9
    assert result.metadata["metric"] == "ragas_answer_correctness"
    mock.assert_called_once()


def test_scores_clamped_high():
    with patch(MODULE, return_value=1.5):
        ev = RagasFaithfulnessEvaluator()
        result = ev.score("q", "a", None)
    assert result.quality == 1.0


def test_scores_clamped_low():
    with patch(MODULE, return_value=-0.5):
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
        result = RagasAnswerCorrectnessEvaluator().score("q", "a", None)
    assert result.metadata["metric"] == "ragas_answer_correctness"
