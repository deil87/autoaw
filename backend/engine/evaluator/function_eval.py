from __future__ import annotations
from typing import Callable
from backend.shared.results import Score
from backend.engine.evaluator.base import Evaluator


class FunctionEvaluator(Evaluator):
    """Evaluates output using a user-supplied Python callable."""

    def __init__(self, fn: Callable[[str, str, str | None], float]) -> None:
        self.fn = fn

    def score(self, input: str, output: str, expected: str | None) -> Score:
        raw = self.fn(input, output, expected)
        quality = max(0.0, min(1.0, float(raw)))
        return Score(quality=quality, metadata={"raw_score": raw})
