from unittest.mock import MagicMock, patch
from backend.engine.llm_client import ProviderConfig
from backend.engine.runner.raw_llm import RawLLMRunner
from backend.shared import Gene, load_fixture


def _fake_response(content="answer"):
    return MagicMock(
        choices=[MagicMock(message=MagicMock(content=content))],
        usage=MagicMock(prompt_tokens=10, completion_tokens=5),
    )


def test_runner_uses_provider_client():
    cfg = ProviderConfig(provider="github", api_key="ghp_test")
    runner = RawLLMRunner(provider_config=cfg)
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))

    with patch("backend.engine.llm_client.openai.OpenAI") as mock_cls:
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance
        mock_instance.chat.completions.create.return_value = _fake_response()
        result = runner.run(gene, "hello")

    assert result.output == "answer"
    mock_cls.assert_called_with(
        api_key="ghp_test",
        base_url="https://models.inference.ai.azure.com",
    )


def test_runner_no_provider_config_falls_back_to_env(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env-test")
    runner = RawLLMRunner()
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))

    with patch("backend.engine.llm_client.openai.OpenAI") as mock_cls:
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance
        mock_instance.chat.completions.create.return_value = _fake_response()
        runner.run(gene, "hello")

    mock_cls.assert_called_with(api_key="sk-env-test", base_url=None)
