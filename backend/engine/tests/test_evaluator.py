import pytest
from unittest.mock import patch, MagicMock
from openai import RateLimitError
from backend.engine.evaluator.base import Evaluator
from backend.engine.evaluator.llm_judge import LLMJudgeEvaluator
from backend.engine.evaluator.function_eval import FunctionEvaluator


def test_evaluator_is_abstract():
    with pytest.raises(TypeError):
        Evaluator()


def test_llm_judge_returns_score_between_0_and_1(monkeypatch):
    evaluator = LLMJudgeEvaluator(
        model="gpt-4o-mini",
        rubric="Rate 0-1 on accuracy and completeness.",
    )

    def fake_chat(model, messages, temperature):
        return MagicMock(
            choices=[
                MagicMock(
                    message=MagicMock(
                        content='{"score": 0.82, "reason": "mostly correct"}'
                    )
                )
            ],
            usage=MagicMock(prompt_tokens=100, completion_tokens=50),
        )

    monkeypatch.setattr(evaluator, "_call_llm", fake_chat)
    score = evaluator.score(input="What is 2+2?", output="4", expected="4")
    assert 0.0 <= score.quality <= 1.0
    assert "reason" in score.metadata


def test_llm_judge_reports_eval_cost(monkeypatch):
    """LLMJudgeEvaluator populates Score.cost_usd from token usage."""
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric="Rate 0-1.")

    def fake_chat(model, messages, temperature):
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content='{"score": 0.9, "reason": "ok"}'))],
            usage=MagicMock(prompt_tokens=200, completion_tokens=80),
        )

    monkeypatch.setattr(evaluator, "_call_llm", fake_chat)
    score = evaluator.score(input="q", output="a", expected=None)
    # gpt-4o-mini: 0.000150/1k prompt + 0.000600/1k completion
    expected_cost = (200 / 1000) * 0.000150 + (80 / 1000) * 0.000600
    assert score.cost_usd == pytest.approx(expected_cost, rel=1e-6)
    assert score.cost_usd > 0.0


def test_llm_judge_handles_malformed_json(monkeypatch):
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric="Rate 0-1.")

    def fake_chat(model, messages, temperature):
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content="Score: 0.7 - looks good"))],
            usage=MagicMock(prompt_tokens=50, completion_tokens=20),
        )

    monkeypatch.setattr(evaluator, "_call_llm", fake_chat)
    score = evaluator.score(input="q", output="a", expected=None)
    assert 0.0 <= score.quality <= 1.0  # fallback parsing


def test_function_evaluator_calls_user_function():
    def my_scorer(input, output, expected):
        return 1.0 if output.strip() == expected.strip() else 0.0

    evaluator = FunctionEvaluator(fn=my_scorer)
    score = evaluator.score(input="q", output="correct", expected="correct")
    assert score.quality == 1.0

    score2 = evaluator.score(input="q", output="wrong", expected="correct")
    assert score2.quality == 0.0


def test_function_evaluator_clamps_out_of_range():
    def bad_scorer(input, output, expected):
        return 5.0  # out of range

    evaluator = FunctionEvaluator(fn=bad_scorer)
    score = evaluator.score(input="q", output="a", expected="e")
    assert score.quality == 1.0  # clamped to 1.0


def _make_rate_limit_error(message: str) -> RateLimitError:
    mock_resp = MagicMock()
    mock_resp.status_code = 429
    mock_resp.json.return_value = {"error": {"message": message}}
    mock_resp.headers = {}
    return RateLimitError(message, response=mock_resp, body=None)


def test_llm_judge_retries_on_rate_limit():
    """LLMJudgeEvaluator retries via chat_with_retry on RateLimitError."""
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric="Rate 0-1.")

    good_response = MagicMock(
        choices=[MagicMock(message=MagicMock(content='{"score": 0.9, "reason": "ok"}'))],
        usage=MagicMock(prompt_tokens=100, completion_tokens=40),
    )
    rate_err = _make_rate_limit_error("Please wait 1 seconds before retrying.")
    call_results = iter([rate_err, good_response])

    def fake_create(**kwargs):
        val = next(call_results)
        if isinstance(val, Exception):
            raise val
        return val

    mock_client = MagicMock()
    mock_client.chat.completions.create.side_effect = fake_create

    with (
        patch(
            "backend.engine.evaluator.llm_judge.make_client", return_value=mock_client
        ),
        patch("backend.engine.evaluator.llm_judge.provider_from_env"),
        patch("backend.engine.llm_client.time.sleep") as mock_sleep,
    ):
        score = evaluator.score(input="q", output="a", expected=None)

    assert score.quality == pytest.approx(0.9)
    assert mock_sleep.call_count == 1  # one sleep before the retry


import json


def test_evaluator_has_name_property():
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric="Rate 0-1.")
    assert evaluator.name == "LLM Judge"


def test_llm_judge_multidim_rubric_detected():
    rubric = json.dumps({
        "accuracy": "How accurate is the answer?",
        "completeness": "How complete is the answer?",
    })
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric=rubric)
    assert evaluator._dimensions is not None
    assert "accuracy" in evaluator._dimensions


def test_llm_judge_plain_rubric_not_multidim():
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric="Rate 0-1.")
    assert evaluator._dimensions is None


def test_llm_judge_multidim_returns_sub_scores(monkeypatch):
    rubric = json.dumps({
        "accuracy": "How accurate?",
        "fluency": "How fluent?",
    })
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric=rubric)

    def fake_chat(model, messages, temperature):
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content=json.dumps({
                "scores": {"accuracy": 0.9, "fluency": 0.8},
                "reason": "good overall",
            })))],
            usage=MagicMock(prompt_tokens=100, completion_tokens=50),
        )

    monkeypatch.setattr(evaluator, "_call_llm", fake_chat)
    score = evaluator.score(input="What is 2+2?", output="4", expected="4")

    assert score.sub_scores == {"accuracy": 0.9, "fluency": 0.8}
    assert score.quality == pytest.approx(0.85)  # mean of 0.9 and 0.8
    assert score.metadata.get("reason") == "good overall"


def test_llm_judge_multidim_quality_is_mean(monkeypatch):
    rubric = json.dumps({
        "a": "dim a",
        "b": "dim b",
        "c": "dim c",
    })
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric=rubric)

    def fake_chat(model, messages, temperature):
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content=json.dumps({
                "scores": {"a": 1.0, "b": 0.6, "c": 0.8},
                "reason": "",
            })))],
            usage=MagicMock(prompt_tokens=100, completion_tokens=50),
        )

    monkeypatch.setattr(evaluator, "_call_llm", fake_chat)
    score = evaluator.score(input="q", output="a", expected=None)
    assert score.quality == pytest.approx((1.0 + 0.6 + 0.8) / 3)


def test_llm_judge_multidim_malformed_response_fallback(monkeypatch):
    rubric = json.dumps({"accuracy": "How accurate?", "fluency": "How fluent?"})
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric=rubric)

    def fake_chat(model, messages, temperature):
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content="sorry, I can't score that"))],
            usage=MagicMock(prompt_tokens=50, completion_tokens=20),
        )

    monkeypatch.setattr(evaluator, "_call_llm", fake_chat)
    score = evaluator.score(input="q", output="a", expected=None)
    # Fallback: 0.5 per dimension
    assert score.sub_scores == {"accuracy": 0.5, "fluency": 0.5}
    assert score.quality == pytest.approx(0.5)
