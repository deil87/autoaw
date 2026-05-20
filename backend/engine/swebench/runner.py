from __future__ import annotations
from backend.shared.gene import Gene
from backend.shared.results import RunResult
from backend.engine.runner.base import WorkflowRunner
from backend.engine.runner.raw_llm import RawLLMRunner

# Appended to every task input so agents always return a parseable patch,
# regardless of how the gene's system prompt is worded.
_PATCH_FORMAT_HINT = (
    "\n\nOutput your fix as a unified diff patch "
    "(--- a/path/to/file ... +++ b/path/to/file ... @@ ... @@ lines). "
    "Do not include any text outside the diff."
)


class SWEBenchRunner(WorkflowRunner):
    """Execute a gene against a SWE-bench task using the raw LLM runner.

    The gene's system prompts are the optimisable surface — AutoAW tunes role
    setup, step ordering, and prompt wording.  The patch-format hint appended
    here keeps output parseable for the evaluator without constraining the
    gene's strategy.

    RunResult.output is the raw text produced by the final agent (expected to
    be a unified diff patch).
    """

    def __init__(self) -> None:
        self._inner = RawLLMRunner()

    def run(self, gene: Gene, input: str) -> RunResult:
        augmented_input = input + _PATCH_FORMAT_HINT
        return self._inner.run(gene, augmented_input)
