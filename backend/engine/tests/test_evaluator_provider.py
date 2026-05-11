from unittest.mock import MagicMock, patch
from backend.engine.llm_client import ProviderConfig
from backend.engine.evaluator.llm_judge import LLMJudgeEvaluator


def _fake_response(content):
    return MagicMock(choices=[MagicMock(message=MagicMock(content=content))])


def test_evaluator_uses_provider_client():
    cfg = ProviderConfig(provider="github", api_key="ghp_test")
    evaluator = LLMJudgeEvaluator(
        model="gpt-4o-mini",
        rubric="Rate 0-1 on accuracy.",
        provider_config=cfg,
    )
    with patch("backend.engine.llm_client.openai.OpenAI") as mock_cls:
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance
        mock_instance.chat.completions.create.return_value = _fake_response(
            '{"score": 0.8, "reason": "good"}'
        )
        score = evaluator.score("q", "a", "expected")

    assert score.quality == 0.8
    mock_cls.assert_called_with(
        api_key="ghp_test",
        base_url="https://models.inference.ai.azure.com",
    )


def test_evaluator_no_provider_falls_back_to_env(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    evaluator = LLMJudgeEvaluator(model="gpt-4o-mini", rubric="Rate 0-1.")

    with patch("backend.engine.llm_client.openai.OpenAI") as mock_cls:
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance
        mock_instance.chat.completions.create.return_value = _fake_response(
            '{"score": 0.5, "reason": "ok"}'
        )
        score = evaluator.score("q", "a", None)

    assert score.quality == 0.5
    mock_cls.assert_called_with(api_key="sk-env", base_url=None)
