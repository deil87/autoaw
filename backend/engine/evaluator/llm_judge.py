from __future__ import annotations
import json
import os
import re
from typing import Any
from backend.shared.results import Score
from backend.engine.evaluator.base import Evaluator
from backend.engine.llm_client import (
    ProviderConfig,
    make_client,
    provider_from_env,
    chat_with_retry,
    llm_cost_usd,
)


def _parse_rubric_dimensions(rubric: str) -> dict[str, str] | None:
    """Return dict of {dimension: description} if rubric is a JSON object, else None."""
    if not rubric or not isinstance(rubric, str):
        return None
    try:
        parsed = json.loads(rubric)
        if isinstance(parsed, dict) and all(isinstance(v, str) for v in parsed.values()):
            return parsed
    except (json.JSONDecodeError, ValueError):
        pass
    return None


class LLMJudgeEvaluator(Evaluator):
    """Scores workflow output using an LLM judge with a user-defined rubric.

    Rubric can be a plain string (single score) or a JSON object whose keys are
    dimension names and values are per-dimension descriptions (multi-dimensional
    mode).  In multi-dimensional mode the returned Score carries each dimension
    score in ``sub_scores`` and ``quality`` is their mean.
    """

    @property
    def name(self) -> str:
        return "LLM Judge"

    def __init__(
        self,
        model: str,
        rubric: str,
        provider_config: ProviderConfig | None = None,
    ) -> None:
        self.model = model
        self.rubric = rubric
        self._provider_config = provider_config  # None = lazy env lookup
        self._dimensions = _parse_rubric_dimensions(rubric)

    def _call_llm(self, model: str, messages: list[dict], temperature: float, response_format: dict | None = None) -> Any:
        from backend.engine.llm_client import is_ollama_model
        if is_ollama_model(model):
            from backend.engine.llm_client import ollama_chat_with_retry
            return ollama_chat_with_retry(model, messages, temperature)
        cfg = self._provider_config or provider_from_env()
        client = make_client(cfg)
        return chat_with_retry(
            client, model=model, messages=messages, temperature=temperature,
            response_format=response_format,
        )

    def score(self, input: str, output: str, expected: str | None) -> Score:
        if self._dimensions:
            return self._score_multidim(input, output, expected)
        return self._score_single(input, output, expected)

    def _score_single(self, input: str, output: str, expected: str | None) -> Score:
        expected_section = f"\n\nExpected answer: {expected}" if expected else ""
        system_msg = (
            "You are a rigorous, critical evaluator. Score strictly.\n"
            "1.0 = absolutely flawless (rare). 0.75 = good with minor issues. "
            "0.5 = acceptable with clear flaws. 0.25 = poor. 0.0 = fails completely.\n"
            "Be a skeptic: cite specific evidence; do not assume quality."
        )
        user_msg = (
            f"Score the following AI output using this rubric:\n{self.rubric}\n\n"
            f"Input: {input}\n\nAI Output: {output}{expected_section}\n\n"
            "Return ONLY a JSON object: "
            '{"score": 0.0, "reason": "<one sentence citing specific evidence>"}\n'
            "Replace 0.0 with the actual float score (0.0–1.0)."
        )
        response = self._call_llm(
            self.model,
            [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        quality, metadata = self._parse_score(content)

        usage = response.usage
        cost = llm_cost_usd(self.model, usage.prompt_tokens, usage.completion_tokens)
        return Score(quality=quality, cost_usd=cost, metadata=metadata)

    def _score_multidim(self, input: str, output: str, expected: str | None) -> Score:
        assert self._dimensions is not None
        expected_section = f"\n\nExpected answer: {expected}" if expected else ""
        dim_lines = "\n".join(
            f"  {dim}:\n    {desc}" for dim, desc in self._dimensions.items()
        )
        dim_score_keys = json.dumps({dim: 0.0 for dim in self._dimensions})
        dim_reasoning_keys = json.dumps({dim: "" for dim in self._dimensions})
        system_msg = (
            "You are a rigorous, critical evaluator. Your job is to score AI outputs strictly.\n\n"
            "Calibration rules (read carefully):\n"
            "- 1.0 means absolutely flawless — use it only when the output perfectly meets EVERY criterion at the top level. It should be rare.\n"
            "- 0.75 means good with at most one minor issue.\n"
            "- 0.5 means acceptable but with clear, notable flaws.\n"
            "- 0.25 means poor — major issues that undermine quality.\n"
            "- 0.0 means completely fails the criterion.\n"
            "If the rubric uses a discrete scale (e.g. '4 - Excellent / 3 - Good / 2 - Developing / 1 - Poor'), "
            "determine which level best describes the output, then map: 4→1.0, 3→0.75, 2→0.5, 1→0.25.\n"
            "Be a skeptic: if you cannot confirm the output meets the top level with specific evidence, score lower."
        )
        user_msg = (
            f"Score this AI output on each dimension below.\n\n"
            f"RUBRIC DIMENSIONS:\n{dim_lines}\n\n"
            f"INPUT: {input}\n\nAI OUTPUT: {output}{expected_section}\n\n"
            "For each dimension:\n"
            "1. Find specific evidence (or absence of evidence) in the output.\n"
            "2. Determine the applicable rubric level.\n"
            "3. Assign the mapped score.\n\n"
            "Return ONLY a JSON object in exactly this format (no prose outside JSON):\n"
            f'{{"scores": {dim_score_keys}, '
            f'"reasoning": {dim_reasoning_keys}, '
            '"reason": "<one sentence overall summary>"}}\n'
            "Replace each 0.0 with the actual float score and each \"\" with a one-sentence justification citing evidence from the output."
        )
        response = self._call_llm(
            self.model,
            [{"role": "system", "content": system_msg}, {"role": "user", "content": user_msg}],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        sub_scores, reason = self._parse_multidim_score(content)

        quality = sum(sub_scores.values()) / len(sub_scores) if sub_scores else 0.5
        quality = max(0.0, min(1.0, quality))
        usage = response.usage
        cost = llm_cost_usd(self.model, usage.prompt_tokens, usage.completion_tokens)
        return Score(
            quality=quality,
            cost_usd=cost,
            metadata={"reason": reason},
            sub_scores=sub_scores,
        )

    def _parse_score(self, content: str) -> tuple[float, dict]:
        try:
            data = json.loads(content)
            quality = float(data["score"])
            quality = max(0.0, min(1.0, quality))
            return quality, {"reason": data.get("reason", "")}
        except (json.JSONDecodeError, KeyError, ValueError):
            # Fallback: extract first float found in response
            match = re.search(r"0?\.\d+|[01]\.0*", content)
            quality = float(match.group()) if match else 0.5
            quality = max(0.0, min(1.0, quality))
            return quality, {"raw": content, "parse_error": True}

    def _parse_multidim_score(self, content: str) -> tuple[dict[str, float], str]:
        """Parse multi-dimensional score response. Returns (sub_scores, reason)."""
        assert self._dimensions is not None
        try:
            data = json.loads(content)
            raw_scores = data.get("scores", {})
            sub_scores: dict[str, float] = {}
            for dim in self._dimensions:
                val = raw_scores.get(dim, 0.5)
                sub_scores[dim] = max(0.0, min(1.0, float(val)))
            # Combine overall reason with per-dimension reasoning for richer metadata
            reason = data.get("reason", "")
            per_dim = data.get("reasoning", {})
            if per_dim and isinstance(per_dim, dict):
                detail = " | ".join(f"{k}: {v}" for k, v in per_dim.items() if v)
                if detail:
                    reason = f"{reason} | {detail}" if reason else detail
            return sub_scores, reason
        except (json.JSONDecodeError, KeyError, ValueError):
            sub_scores = {dim: 0.5 for dim in self._dimensions}
            return sub_scores, ""
