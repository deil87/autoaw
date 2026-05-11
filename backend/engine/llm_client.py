from __future__ import annotations
from dataclasses import dataclass
import openai

_PROVIDER_BASE_URLS: dict[str, str | None] = {
    "openai": None,
    "github": "https://models.inference.ai.azure.com",
}


@dataclass
class ProviderConfig:
    provider: str  # "openai" | "github"
    api_key: str
    base_url: str | None = None  # explicit override; None = use provider default

    @classmethod
    def from_dict(cls, d: dict) -> "ProviderConfig":
        return cls(
            provider=d["provider"],
            api_key=d["api_key"],
            base_url=d.get("base_url"),
        )

    def to_dict(self) -> dict:
        return {
            "provider": self.provider,
            "api_key": self.api_key,
            "base_url": self.base_url,
        }


def provider_from_env() -> "ProviderConfig":
    """Build a ProviderConfig from environment variables.

    Checks (in order):
    - ``GITHUB_TOKEN`` or ``GITHUB_API_KEY`` → GitHub Models provider
    - ``OPENAI_API_KEY`` → OpenAI provider (uses ``OPENAI_BASE_URL`` if set)

    Raises ``ValueError`` if no credentials are found.
    """
    import os

    github_token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GITHUB_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")

    if github_token:
        return ProviderConfig(provider="github", api_key=github_token)
    if openai_key:
        # Explicitly read OPENAI_BASE_URL so it is tracked in ProviderConfig
        # and passed through make_client, rather than being silently picked up
        # by the OpenAI SDK from the environment (which can cause key/endpoint
        # mismatches when the base URL points to a non-OpenAI endpoint).
        base_url = os.environ.get("OPENAI_BASE_URL") or None
        return ProviderConfig(provider="openai", api_key=openai_key, base_url=base_url)
    raise ValueError(
        "No LLM provider configured. "
        "Set GITHUB_TOKEN (or GITHUB_API_KEY) for GitHub Models, "
        "or OPENAI_API_KEY for OpenAI / compatible endpoints."
    )


def make_client(cfg: ProviderConfig) -> openai.OpenAI:
    """Return a configured OpenAI client for the given provider."""
    if cfg.provider not in _PROVIDER_BASE_URLS:
        raise ValueError(
            f"Unknown provider {cfg.provider!r}. Supported: {list(_PROVIDER_BASE_URLS)}"
        )
    base_url = (
        cfg.base_url if cfg.base_url is not None else _PROVIDER_BASE_URLS[cfg.provider]
    )
    return openai.OpenAI(api_key=cfg.api_key, base_url=base_url)
