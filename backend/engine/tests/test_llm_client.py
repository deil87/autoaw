from __future__ import annotations
import pytest
from unittest.mock import patch
from backend.engine.llm_client import ProviderConfig, make_client


def test_make_client_openai_direct():
    cfg = ProviderConfig(provider="openai", api_key="sk-test")
    with patch("backend.engine.llm_client.openai.OpenAI") as mock_cls:
        make_client(cfg)
        mock_cls.assert_called_once_with(api_key="sk-test", base_url=None)


def test_make_client_github_models():
    cfg = ProviderConfig(provider="github", api_key="ghp_test")
    with patch("backend.engine.llm_client.openai.OpenAI") as mock_cls:
        make_client(cfg)
        mock_cls.assert_called_once_with(
            api_key="ghp_test",
            base_url="https://models.inference.ai.azure.com",
        )


def test_make_client_explicit_base_url_overrides_provider_default():
    cfg = ProviderConfig(
        provider="github",
        api_key="ghp_test",
        base_url="https://custom.endpoint.example.com",
    )
    with patch("backend.engine.llm_client.openai.OpenAI") as mock_cls:
        make_client(cfg)
        mock_cls.assert_called_once_with(
            api_key="ghp_test",
            base_url="https://custom.endpoint.example.com",
        )


def test_make_client_unknown_provider_raises():
    cfg = ProviderConfig(provider="unknown", api_key="x")
    with pytest.raises(ValueError, match="Unknown provider"):
        make_client(cfg)


def test_provider_config_round_trips():
    cfg = ProviderConfig(provider="github", api_key="ghp_test", base_url=None)
    assert ProviderConfig.from_dict(cfg.to_dict()) == cfg
