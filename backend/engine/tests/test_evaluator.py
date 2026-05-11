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
            ]
        )

    monkeypatch.setattr(evaluator, "_call_llm", fake_chat)
    score = evaluator.score(input="What is 2+2?", output="4", expected="4")
    assert 0.0 <= score.quality <= 1.0
    assert "reason" in score.metadata


def test_llm_judge_handles_malformed_json(monkeypatch):
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric="Rate 0-1.")

    def fake_chat(model, messages, temperature):
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content="Score: 0.7 - looks good"))]
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
        choices=[MagicMock(message=MagicMock(content='{"score": 0.9, "reason": "ok"}'))]
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
