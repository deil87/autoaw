from __future__ import annotations
import json
import time
from collections import defaultdict, deque
from typing import Any

from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_react_agent
from langchain_core.prompts import PromptTemplate
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

from backend.shared.gene import Gene
from backend.shared.results import RunResult
from backend.engine.runner.base import WorkflowRunner
from backend.engine.workbench.tools import (
    reset_tool_call_log,
    get_tool_call_log,
    build_workbench_tools,
)


class _TokenTracker(BaseCallbackHandler):
    """Lightweight callback that accumulates token usage from LLM responses."""

    def __init__(self) -> None:
        self.total_tokens: int = 0
        self.prompt_tokens: int = 0
        self.completion_tokens: int = 0

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        if response.llm_output:
            usage = response.llm_output.get("token_usage", {})
            self.total_tokens += usage.get("total_tokens", 0)
            self.prompt_tokens += usage.get("prompt_tokens", 0)
            self.completion_tokens += usage.get("completion_tokens", 0)


# Price per 1 M tokens (blended input+output average), USD.
# Used to estimate cost_usd so the cost dimension carries signal in fitness.
_COST_PER_1M: dict[str, float] = {
    "gpt-4o": 10.0,
    "gpt-4o-mini": 0.375,
    "gpt-4-turbo": 15.0,
    "gpt-4": 45.0,
    "gpt-3.5-turbo": 1.0,
}
_DEFAULT_COST_PER_1M = 5.0


def _estimate_cost(model: str, total_tokens: int) -> float:
    rate = _COST_PER_1M.get(model, _DEFAULT_COST_PER_1M)
    return rate * total_tokens / 1_000_000


# Minimal ReAct prompt — raw string avoids escape-sequence warnings
_REACT_TEMPLATE = r"""You are a helpful workplace assistant.

{tools}

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [{tool_names}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

Begin!

Question: {input}
Thought:{agent_scratchpad}"""

_REACT_PROMPT = PromptTemplate.from_template(_REACT_TEMPLATE)


class WorkBenchRunner(WorkflowRunner):
    """Execute a gene against a WorkBench task using LangChain ReAct agents.

    Tool calls are captured in a thread-local ToolCallLog. RunResult.output is a
    JSON-serialised list of {"tool": str, "args": dict} entries.

    Token usage is tracked via a lightweight BaseCallbackHandler so cost_usd
    """

    def run(self, gene: Gene, input: str) -> RunResult:
        reset_tool_call_log()
        start = time.monotonic()

        ordered_agents = self._topological_order(gene)
        current_input = input
        total_tokens = 0
        total_cost_usd = 0.0

        for agent_def in ordered_agents:
            tools = build_workbench_tools(agent_def.tools if agent_def.tools else None)
            llm = ChatOpenAI(
                model=agent_def.model,
                temperature=agent_def.temperature,
            )

            react_agent = create_react_agent(llm=llm, tools=tools, prompt=_REACT_PROMPT)
            tracker = _TokenTracker()
            executor = AgentExecutor(
                agent=react_agent,
                tools=tools,
                max_iterations=10,
                handle_parsing_errors=True,
                verbose=False,
                callbacks=[tracker],
            )
            try:
                result = executor.invoke({"input": current_input})
                total_tokens += tracker.total_tokens
                total_cost_usd += _estimate_cost(agent_def.model, tracker.total_tokens)
                current_input = result.get("output", "")
            except Exception as exc:
                current_input = f"ERROR: {exc}"

        log = get_tool_call_log()
        output = json.dumps([{"tool": c.tool, "args": c.args} for c in log])
        latency_ms = int((time.monotonic() - start) * 1000)

        return RunResult(
            output=output,
            token_usage={"total_tokens": total_tokens},
            latency_ms=latency_ms,
            cost_usd=total_cost_usd,
            trace=[],
        )

    def _topological_order(self, gene: Gene) -> list:
        """Return agents in edge-defined topological order, fallback to list order."""
        agent_map = {a.id: a for a in gene.agents}
        in_degree: dict[str, int] = {a.id: 0 for a in gene.agents}
        adjacency: dict[str, list[str]] = defaultdict(list)
        for edge in gene.edges:
            if edge.type == "sequential":
                adjacency[edge.from_agent].append(edge.to_agent)
                in_degree[edge.to_agent] = in_degree.get(edge.to_agent, 0) + 1
        queue = deque([aid for aid, deg in in_degree.items() if deg == 0])
        ordered = []
        while queue:
            aid = queue.popleft()
            if aid in agent_map:
                ordered.append(agent_map[aid])
            for nxt in adjacency[aid]:
                in_degree[nxt] -= 1
                if in_degree[nxt] == 0:
                    queue.append(nxt)
        seen = {a.id for a in ordered}
        ordered += [a for a in gene.agents if a.id not in seen]
        return ordered
