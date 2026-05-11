from __future__ import annotations
from abc import ABC, abstractmethod
from backend.shared.gene import Gene
from backend.shared.results import RunResult


class WorkflowRunner(ABC):
    @abstractmethod
    def run(self, gene: Gene, input: str) -> RunResult:
        """Execute a workflow gene on the given input. Stateless."""
        ...
