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
