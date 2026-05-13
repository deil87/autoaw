from __future__ import annotations
import json
import pytest
from backend.engine.workbench.evaluator import WorkBenchEvaluator


@pytest.fixture
def ev():
    return WorkBenchEvaluator()


def _log(calls: list[dict]) -> str:
    return json.dumps(calls)


def _expected(calls: list[dict]) -> str:
    return json.dumps(calls)


def test_perfect_match(ev):
    output = _log([{"tool": "send_email", "args": {"to": "a@b.com", "subject": "hi"}}])
    expected = _expected(
        [{"tool": "send_email", "args": {"to": "a@b.com", "subject": "hi"}}]
    )
    score = ev.score("task", output, expected)
    assert score.quality == 1.0
    assert score.metadata["matched"] == 1
    assert score.metadata["total"] == 1


def test_partial_credit(ev):
    output = _log(
        [
            {"tool": "send_email", "args": {"to": "a@b.com", "subject": "hi"}},
            {"tool": "create_task", "args": {"title": "wrong title"}},
        ]
    )
    expected = _expected(
        [
            {"tool": "send_email", "args": {"to": "a@b.com", "subject": "hi"}},
            {"tool": "create_task", "args": {"title": "correct title"}},
        ]
    )
    score = ev.score("task", output, expected)
    assert score.quality == pytest.approx(0.5)
    assert score.metadata["matched"] == 1


def test_wrong_tool(ev):
    output = _log([{"tool": "send_email", "args": {}}])
    expected = _expected([{"tool": "create_calendar_event", "args": {}}])
    score = ev.score("task", output, expected)
    assert score.quality == 0.0


def test_empty_expected(ev):
    score = ev.score("task", "[]", "[]")
    assert score.quality == 1.0
    assert score.metadata["total"] == 0


def test_bad_output_json(ev):
    score = ev.score("task", "NOT JSON", _expected([{"tool": "foo", "args": {}}]))
    assert score.quality == 0.0
    assert score.metadata.get("error") == "parse_failed"


def test_extra_args_in_log_ok(ev):
    """Extra keys in logged args are ignored."""
    output = _log(
        [
            {
                "tool": "send_email",
                "args": {"to": "a@b.com", "subject": "hi", "extra": "x"},
            }
        ]
    )
    expected = _expected(
        [{"tool": "send_email", "args": {"to": "a@b.com", "subject": "hi"}}]
    )
    score = ev.score("task", output, expected)
    assert score.quality == 1.0


def test_wrong_position_is_miss(ev):
    """Correct tools in wrong order = 0 score."""
    output = _log(
        [
            {"tool": "create_task", "args": {"title": "t"}},
            {"tool": "send_email", "args": {"to": "a@b.com"}},
        ]
    )
    expected = _expected(
        [
            {"tool": "send_email", "args": {"to": "a@b.com"}},
            {"tool": "create_task", "args": {"title": "t"}},
        ]
    )
    score = ev.score("task", output, expected)
    assert score.quality == 0.0
