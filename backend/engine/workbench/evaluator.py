from __future__ import annotations
import json
from backend.engine.evaluator.base import Evaluator
from backend.shared.results import Score


class WorkBenchEvaluator(Evaluator):
    """Evaluate a WorkBench trial by comparing the tool call log to expected actions.

    output   — JSON string: list[{"tool": str, "args": dict}]
    expected — JSON string: list[{"tool": str, "args": dict}]

    Scoring: partial credit = matched_positions / len(expected).
    Matching is positional and strict on tool name; args match if all keys
    in expected[i].args are present in logged[i].args with equal values
    (extra keys in the logged call are ignored).
    """

    def score(self, input: str, output: str, expected: str | None) -> Score:
        # Parse output (tool call log)
        try:
            logged: list[dict] = json.loads(output)
            if not isinstance(logged, list):
                raise ValueError("not a list")
        except Exception:
            return Score(quality=0.0, metadata={"error": "parse_failed"})

        # Parse expected actions
        try:
            expected_actions: list[dict] = json.loads(expected or "[]")
            if not isinstance(expected_actions, list):
                raise ValueError("not a list")
        except Exception:
            expected_actions = []

        if not expected_actions:
            return Score(quality=1.0, metadata={"matched": 0, "total": 0})

        matched = 0
        for i, exp in enumerate(expected_actions):
            if i >= len(logged):
                break
            log_entry = logged[i]
            if log_entry.get("tool") != exp.get("tool"):
                continue
            exp_args: dict = exp.get("args", {})
            log_args: dict = log_entry.get("args", {})
            if all(log_args.get(k) == v for k, v in exp_args.items()):
                matched += 1

        quality = matched / len(expected_actions)
        return Score(
            quality=quality,
            metadata={"matched": matched, "total": len(expected_actions)},
        )
