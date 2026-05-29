from __future__ import annotations
from abc import ABC, abstractmethod
from backend.shared.results import Score


class Evaluator(ABC):
    @property
    def name(self) -> str:
        """Human-readable display name used for labelling sub-scores."""
        return type(self).__name__

    @abstractmethod
    def score(self, input: str, output: str, expected: str | None) -> Score:
        """Score a workflow output. Returns Score with quality in [0, 1]."""
        ...
