from __future__ import annotations
import json
from unittest.mock import patch, MagicMock
import pytest
from backend.shared.gene import Gene, Agent, Edge, TopologyType
from backend.engine.workbench.runner import WorkBenchRunner


def _make_simple_gene() -> Gene:
    return Gene(
        topology=TopologyType.FIXED_PIPELINE,
        agents=[
            Agent(
                id="a1",
                role="assistant",
                model="gpt-4o-mini",
                system_prompt="You are a helpful workplace assistant.",
                tools=["send_email"],
                temperature=0.0,
            )
        ],
        edges=[],
    )


@patch("backend.engine.workbench.runner.AgentExecutor")
@patch("backend.engine.workbench.runner.ChatOpenAI")
def test_run_returns_tool_call_log(mock_chat_cls, mock_executor_cls):
    """Runner returns RunResult whose output is a JSON tool call log."""
    from backend.engine.workbench.tools import (
        reset_tool_call_log,
        build_workbench_tools,
    )

    gene = _make_simple_gene()

    def fake_invoke(inputs, **kwargs):
        # Simulate the agent calling a tool
        tools = build_workbench_tools(["send_email"])
        tools[0].func(to="bob@example.com", subject="Meeting")
        return {"output": "Done"}

    mock_executor_instance = MagicMock()
    mock_executor_instance.invoke.side_effect = fake_invoke
    mock_executor_cls.return_value = mock_executor_instance

    runner = WorkBenchRunner()
    reset_tool_call_log()
    result = runner.run(gene, "Send an email to bob about the meeting")

    log = json.loads(result.output)
    assert isinstance(log, list)
    assert len(log) == 1
    assert log[0]["tool"] == "send_email"
    assert log[0]["args"]["to"] == "bob@example.com"
    assert result.cost_usd >= 0.0
    assert result.latency_ms >= 0


@patch("backend.engine.workbench.runner.AgentExecutor")
@patch("backend.engine.workbench.runner.ChatOpenAI")
def test_run_empty_log_on_no_tool_calls(mock_chat_cls, mock_executor_cls):
    mock_executor_instance = MagicMock()
    mock_executor_instance.invoke.return_value = {"output": "No tools needed"}
    mock_executor_cls.return_value = mock_executor_instance

    from backend.engine.workbench.tools import reset_tool_call_log

    gene = _make_simple_gene()
    runner = WorkBenchRunner()
    reset_tool_call_log()
    result = runner.run(gene, "Hello")
    log = json.loads(result.output)
    assert log == []


@patch("backend.engine.workbench.runner.AgentExecutor")
@patch("backend.engine.workbench.runner.ChatOpenAI")
def test_run_handles_agent_exception(mock_chat_cls, mock_executor_cls):
    """Runner does not crash if an agent raises; output is still valid JSON."""
    mock_executor_instance = MagicMock()
    mock_executor_instance.invoke.side_effect = RuntimeError("LLM timeout")
    mock_executor_cls.return_value = mock_executor_instance

    from backend.engine.workbench.tools import reset_tool_call_log

    gene = _make_simple_gene()
    runner = WorkBenchRunner()
    reset_tool_call_log()
    result = runner.run(gene, "Do something")
    # Should not raise; output is a valid (empty) JSON array
    log = json.loads(result.output)
    assert isinstance(log, list)
