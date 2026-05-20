from __future__ import annotations
import json
import re
from typing import Any

from backend.engine.evaluator.base import Evaluator
from backend.shared.results import Score
from backend.engine.llm_client import (
    ProviderConfig,
    make_client,
    provider_from_env,
    chat_with_retry,
)

_JUDGE_SYSTEM = """\
You are an expert software engineer evaluating an AI-generated patch for a GitHub issue.
Score the patch from 0.0 to 1.0 using this rubric:

1.0 — Patch directly and completely fixes the described issue; targets the same
      files/functions as the reference; logic is sound; would plausibly make
      the failing tests pass.
0.75 — Patch addresses the core issue but misses edge cases or has minor flaws.
0.5  — Patch partially fixes the issue; substantial gaps or wrong approach.
0.25 — Patch is in the right area of the code but does not correctly fix the issue.
0.0  — Patch is empty, irrelevant, syntactically broken, or would break behaviour.

Reply ONLY with valid JSON: {"score": <float 0–1>, "reason": "<one sentence>"}"""

_JUDGE_USER_TMPL = """\
## Problem statement
{problem}

## Reference patch (ground truth)
```diff
{reference}
```

## Generated patch
```diff
{generated}
```"""


class SWEBenchEvaluator(Evaluator):
    """Evaluate a SWE-bench trial with an LLM judge.

    input    — issue description (problem statement + repo context)
    output   — generated patch text (unified diff)
    expected — ground-truth patch (unified diff)

    The judge scores how well the generated patch addresses the same issue as
    the reference, without requiring a live test sandbox.
    """

    def __init__(
        self,
        model: str = "gpt-4o-mini",
        provider_config: ProviderConfig | None = None,
    ) -> None:
        self.model = model
        self._provider_config = provider_config

    def _call_llm(self, messages: list[dict]) -> Any:
        cfg = self._provider_config or provider_from_env()
        client = make_client(cfg)
        return chat_with_retry(client, model=self.model, messages=messages, temperature=0.1)

    def score(self, input: str, output: str, expected: str | None) -> Score:
        reference = expected or ""
        user_msg = _JUDGE_USER_TMPL.format(
            problem=input,
            reference=reference.strip(),
            generated=output.strip(),
        )
        response = self._call_llm([
            {"role": "system", "content": _JUDGE_SYSTEM},
            {"role": "user", "content": user_msg},
        ])
        content = response.choices[0].message.content
        return Score(**self._parse(content))

    def _parse(self, content: str) -> dict:
        try:
            data = json.loads(content)
            quality = max(0.0, min(1.0, float(data["score"])))
            return {"quality": quality, "metadata": {"reason": data.get("reason", "")}}
        except (json.JSONDecodeError, KeyError, ValueError):
            match = re.search(r"0?\.\d+|[01]\.0*", content)
            quality = max(0.0, min(1.0, float(match.group()))) if match else 0.5
            return {"quality": quality, "metadata": {"raw": content, "parse_error": True}}
