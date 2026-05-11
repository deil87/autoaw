from __future__ import annotations
import json
import re
from typing import Any
from backend.shared.results import Score
from backend.engine.evaluator.base import Evaluator


class LLMJudgeEvaluator(Evaluator):
    """Scores workflow output using an LLM judge with a user-defined rubric."""

    def __init__(self, model: str, rubric: str) -> None:
        self.model = model
        self.rubric = rubric

    def _call_llm(self, model: str, messages: list[dict], temperature: float) -> Any:
        import openai

        client = openai.OpenAI()
        return client.chat.completions.create(
            model=model, messages=messages, temperature=temperature
        )

    def score(self, input: str, output: str, expected: str | None) -> Score:
        expected_section = f"\n\nExpected answer: {expected}" if expected else ""
        prompt = (
            f"You are an evaluator. Score the following AI output using this rubric:\n{self.rubric}\n\n"
            f"Input: {input}\n\nAI Output: {output}{expected_section}\n\n"
            "Respond ONLY with valid JSON in this format: "
            '{"score": <float between 0 and 1>, "reason": "<brief explanation>"}'
        )
        response = self._call_llm(
            self.model,
            [{"role": "user", "content": prompt}],
            temperature=0.1,
        )
        content = response.choices[0].message.content
        quality, metadata = self._parse_score(content)
        return Score(quality=quality, metadata=metadata)

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
