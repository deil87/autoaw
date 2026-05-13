from __future__ import annotations
import threading
import pytest
from backend.engine.workbench.tools import (
    reset_tool_call_log,
    get_tool_call_log,
    build_workbench_tools,
    ToolCall,
    ALL_TOOL_NAMES,
)


def test_tool_call_logged():
    reset_tool_call_log()
    tools = build_workbench_tools()
    tool = next(t for t in tools if t.name == "create_calendar_event")
    result = tool.func(title="standup", datetime="2026-01-01T09:00:00")
    log = get_tool_call_log()
    assert len(log) == 1
    assert log[0].tool == "create_calendar_event"
    assert log[0].args["title"] == "standup"
    assert "OK" in result


def test_reset_clears_log():
    reset_tool_call_log()
    tools = build_workbench_tools()
    tool = next(t for t in tools if t.name == "send_email")
    tool.func(to="a@b.com", subject="hi", body="hello")
    reset_tool_call_log()
    assert get_tool_call_log() == []


def test_allowed_filter():
    allowed = ["send_email", "get_emails"]
    tools = build_workbench_tools(allowed=allowed)
    names = {t.name for t in tools}
    assert names == {"send_email", "get_emails"}


def test_all_26_tools_present():
    tools = build_workbench_tools()
    names = {t.name for t in tools}
    assert len(names) == 26
    assert names == set(ALL_TOOL_NAMES)


def test_thread_local_isolation():
    """Two threads each have their own independent log."""
    barrier = threading.Barrier(2)
    results: dict[int, list[ToolCall]] = {}

    def worker(thread_id: int, tool_name: str, kwargs: dict):
        reset_tool_call_log()
        barrier.wait()
        tools = build_workbench_tools()
        tool = next(t for t in tools if t.name == tool_name)
        tool.func(**kwargs)
        results[thread_id] = list(get_tool_call_log())

    t1 = threading.Thread(target=worker, args=(1, "search_web", {"query": "test"}))
    t2 = threading.Thread(
        target=worker,
        args=(2, "set_reminder", {"message": "hi", "datetime": "2026-01-01T10:00:00"}),
    )
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert len(results[1]) == 1 and results[1][0].tool == "search_web"
    assert len(results[2]) == 1 and results[2][0].tool == "set_reminder"
