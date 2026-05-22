from __future__ import annotations
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any
import openai
from openai import RateLimitError

logger = logging.getLogger(__name__)

_PROVIDER_BASE_URLS: dict[str, str | None] = {
    "openai": None,
    "github": "https://models.inference.ai.azure.com",
}

_MAX_RETRIES = 5
_RETRY_BASE_DELAY = 5.0
_RETRY_MAX_DELAY = 300.0

# Model ID prefixes that should be routed to AWS Bedrock
_BEDROCK_PREFIXES = ("amazon.", "meta.llama")


def is_bedrock_model(model: str) -> bool:
    return any(model.startswith(p) for p in _BEDROCK_PREFIXES)


@dataclass
class _FakeMessage:
    content: str


@dataclass
class _FakeChoice:
    message: _FakeMessage


@dataclass
class _FakeUsage:
    prompt_tokens: int
    completion_tokens: int


@dataclass
class _FakeResponse:
    choices: list[_FakeChoice]
    usage: _FakeUsage


def _to_bedrock_messages(messages: list[dict]) -> tuple[list[dict], list[dict]]:
    """Split OpenAI-style messages into (system, messages) for Bedrock Converse API."""
    system = []
    bedrock_msgs = []
    for m in messages:
        if m["role"] == "system":
            system.append({"text": m["content"]})
        else:
            bedrock_msgs.append({"role": m["role"], "content": [{"text": m["content"]}]})
    return system, bedrock_msgs


def bedrock_chat_with_retry(model: str, messages: list[dict], temperature: float) -> Any:
    """Call AWS Bedrock Converse API with exponential-backoff retry on throttling."""
    import boto3
    from botocore.exceptions import ClientError

    region = os.environ.get("AWS_REGION", "eu-central-1")
    client = boto3.client("bedrock-runtime", region_name=region)
    system, bedrock_msgs = _to_bedrock_messages(messages)

    delay = _RETRY_BASE_DELAY
    for attempt in range(_MAX_RETRIES + 1):
        try:
            kwargs: dict = {
                "modelId": model,
                "messages": bedrock_msgs,
                "inferenceConfig": {"temperature": temperature},
            }
            if system:
                kwargs["system"] = system
            resp = client.converse(**kwargs)
            text = resp["output"]["message"]["content"][0]["text"]
            usage = resp["usage"]
            return _FakeResponse(
                choices=[_FakeChoice(message=_FakeMessage(content=text))],
                usage=_FakeUsage(
                    prompt_tokens=usage["inputTokens"],
                    completion_tokens=usage["outputTokens"],
                ),
            )
        except ClientError as exc:
            if attempt == _MAX_RETRIES or exc.response["Error"]["Code"] != "ThrottlingException":
                raise
            wait = min(delay, _RETRY_MAX_DELAY)
            logger.warning(
                "Bedrock throttled on attempt %d/%d; waiting %.0fs before retry.",
                attempt + 1,
                _MAX_RETRIES,
                wait,
            )
            time.sleep(wait)
            delay = min(delay * 2, _RETRY_MAX_DELAY)


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


def _parse_retry_after(error: RateLimitError) -> float | None:
    """Extract suggested wait seconds from the 429 error message, if present."""
    try:
        match = re.search(r"Please wait (\d+) seconds", str(error))
        if match:
            return float(match.group(1))
    except Exception:
        pass
    return None


def chat_with_retry(
    client: openai.OpenAI,
    *,
    model: str,
    messages: list[dict],
    temperature: float,
) -> Any:
    """Call LLM with exponential-backoff retry. Routes Bedrock model IDs to boto3."""
    if is_bedrock_model(model):
        return bedrock_chat_with_retry(model, messages, temperature)
    delay = _RETRY_BASE_DELAY
    for attempt in range(_MAX_RETRIES + 1):
        try:
            return client.chat.completions.create(
                model=model, messages=messages, temperature=temperature
            )
        except RateLimitError as exc:
            if attempt == _MAX_RETRIES:
                raise
            wait = min(_parse_retry_after(exc) or delay, _RETRY_MAX_DELAY)
            logger.warning(
                "Rate limited on attempt %d/%d; waiting %.0fs before retry.",
                attempt + 1,
                _MAX_RETRIES,
                wait,
            )
            time.sleep(wait)
            delay = min(delay * 2, _RETRY_MAX_DELAY)
