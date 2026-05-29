import os
import pytest
from backend.shared.experiment import (
    ExperimentConfig,
    ObjectiveWeights,
    EvaluatorConfig,
)
from backend.engine.llm_client import ProviderConfig


def _base_dict(**overrides):
    d = {
        "name": "Test",
        "task_description": "desc",
        "dataset_id": "ds1",
        "evaluators": [
            {
                "type": "llm_judge",
                "params": {"model": "gpt-4o-mini", "rubric": "Rate 0-1"},
            }
        ],
        "objective_weights": {"quality": 0.6, "cost": 0.2, "speed": 0.2},
        "population_size": 10,
        "budget_max_trials": 50,
        "budget_max_usd": None,
        "convergence_patience": 5,
        "concurrency": 2,
    }
    d.update(overrides)
    return d


def test_experiment_config_parses_provider():
    d = _base_dict(
        provider={"provider": "github", "api_key": "ghp_test"},
        allowed_models=["gpt-4o-mini"],
    )
    cfg = ExperimentConfig.from_dict(d)
    assert isinstance(cfg.provider, ProviderConfig)
    assert cfg.provider.provider == "github"
    assert cfg.provider.api_key == "ghp_test"
    assert cfg.allowed_models == ["gpt-4o-mini"]


def test_experiment_config_defaults_provider_none_when_missing(monkeypatch):
    """from_dict keeps provider=None when no provider key is in the dict.

    Provider resolution is lazy: the engine calls provider_from_env() at the
    point it actually needs an LLM client, not at deserialization time.
    """
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_env")
    cfg = ExperimentConfig.from_dict(_base_dict())
    assert cfg.provider is None


def test_experiment_config_defaults_github_api_key_from_env(monkeypatch):
    """provider=None when no provider key is present, regardless of env vars."""
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("GITHUB_API_KEY", "ghp_apikey")
    cfg = ExperimentConfig.from_dict(_base_dict())
    assert cfg.provider is None


def test_experiment_config_defaults_openai_from_env(monkeypatch):
    """provider=None when no provider key is present, regardless of env vars."""
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
    cfg = ExperimentConfig.from_dict(_base_dict())
    assert cfg.provider is None


def test_experiment_config_defaults_openai_with_base_url_from_env(monkeypatch):
    """Explicit provider in dict is parsed regardless of env vars."""
    d = _base_dict(
        provider={"provider": "openai", "api_key": "sk-env", "base_url": "https://api.githubcopilot.com"}
    )
    cfg = ExperimentConfig.from_dict(d)
    assert cfg.provider.provider == "openai"
    assert cfg.provider.base_url == "https://api.githubcopilot.com"


def test_experiment_config_default_allowed_models(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
    from backend.shared.experiment import DEFAULT_CLOUD_MODELS
    cfg = ExperimentConfig.from_dict(_base_dict())
    assert cfg.allowed_models == DEFAULT_CLOUD_MODELS


def test_experiment_config_roundtrip_with_provider(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
    d = _base_dict(
        provider={"provider": "openai", "api_key": "sk-test"},
        allowed_models=["gpt-4o-mini"],
    )
    cfg = ExperimentConfig.from_dict(d)
    d2 = cfg.to_dict()
    cfg2 = ExperimentConfig.from_dict(d2)
    assert cfg2.provider.provider == "openai"
    assert cfg2.provider.api_key == "sk-test"
    assert cfg2.allowed_models == ["gpt-4o-mini"]


def test_experiment_config_no_provider_no_env_returns_none(monkeypatch):
    """from_dict returns provider=None when no provider in dict, even with no env creds.

    Provider resolution is deferred to the engine; from_dict never raises.
    """
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    cfg = ExperimentConfig.from_dict(_base_dict())
    assert cfg.provider is None
