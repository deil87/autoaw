from __future__ import annotations
from abc import ABC, abstractmethod
from backend.shared.results import Score


class Evaluator(ABC):
    @abstractmethod
    def score(self, input: str, output: str, expected: str | None) -> Score:
        """Score a workflow output. Returns Score with quality in [0, 1]."""
        ...
