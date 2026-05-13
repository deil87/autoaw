from __future__ import annotations
import threading
from dataclasses import dataclass, field
from typing import Any
from langchain_core.tools import Tool

# --------------------------------------------------------------------------- #
# All 26 WorkBench tool names                                                  #
# --------------------------------------------------------------------------- #
ALL_TOOL_NAMES: list[str] = [
    # Calendar
    "create_calendar_event",
    "delete_calendar_event",
    "update_calendar_event",
    "get_calendar_events",
    # Email
    "send_email",
    "reply_to_email",
    "forward_email",
    "get_emails",
    # Contacts
    "add_contact",
    "delete_contact",
    "update_contact",
    "get_contacts",
    # Tasks
    "create_task",
    "delete_task",
    "update_task",
    "get_tasks",
    # Notes
    "create_note",
    "delete_note",
    "update_note",
    "get_notes",
    # Files
    "create_file",
    "delete_file",
    "rename_file",
    "move_file",
    # Misc
    "set_reminder",
    "search_web",
]

# --------------------------------------------------------------------------- #
# Thread-local call log                                                        #
# --------------------------------------------------------------------------- #


@dataclass
class ToolCall:
    tool: str
    args: dict[str, Any] = field(default_factory=dict)


_local = threading.local()


def reset_tool_call_log() -> None:
    """Reset the thread-local tool call log. Call at the start of each run."""
    _local.log = []


def get_tool_call_log() -> list[ToolCall]:
    """Return the current thread-local tool call log."""
    if not hasattr(_local, "log"):
        _local.log = []
    return _local.log


# --------------------------------------------------------------------------- #
# Stub tool factory                                                            #
# --------------------------------------------------------------------------- #


def _make_stub(tool_name: str) -> Tool:
    """Return a LangChain Tool that logs calls and returns a canned response."""

    def _stub(**kwargs: Any) -> str:
        log = get_tool_call_log()
        log.append(ToolCall(tool=tool_name, args=dict(kwargs)))
        return f"OK: {tool_name} executed"

    return Tool(
        name=tool_name,
        func=_stub,
        description=f"WorkBench stub for {tool_name}",
    )


_ALL_TOOLS: list[Tool] = [_make_stub(name) for name in ALL_TOOL_NAMES]
_TOOL_MAP: dict[str, Tool] = {t.name: t for t in _ALL_TOOLS}


def build_workbench_tools(allowed: list[str] | None = None) -> list[Tool]:
    """Return LangChain Tool stubs. If allowed is None, return all 26."""
    if allowed is None:
        return list(_ALL_TOOLS)
    return [_TOOL_MAP[name] for name in allowed if name in _TOOL_MAP]
