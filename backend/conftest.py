import os
import pytest


@pytest.fixture(autouse=True, scope="session")
def _clear_provider_env():
    """Remove real LLM credentials from the environment for the entire test session.

    Tests that need a specific provider must set credentials explicitly via
    monkeypatch.setenv(). This prevents accidental real API calls when
    developer credentials are present in .env.local.
    """
    for var in ("GITHUB_TOKEN", "GITHUB_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL"):
        os.environ.pop(var, None)
