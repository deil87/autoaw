"""Tests for MemoryStore and memory-aware message building in RawLLMRunner."""
from __future__ import annotations
from unittest.mock import MagicMock, patch

import pytest

from backend.engine.runner.raw_llm import (
    MemoryStore,
    _chunk_text,
    _tfidf_vector,
    _cosine,
)
from backend.shared.gene import Agent, Edge, Gene, TopologyType


# ─── MemoryStore unit tests ───────────────────────────────────────────────────


def test_buffer_stores_exchanges():
    store = MemoryStore()
    store.buffer_add("a1", "hello", "world", window=5)
    msgs = store.buffer_messages("a1")
    assert msgs == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "world"},
    ]


def test_buffer_respects_window():
    store = MemoryStore()
    for i in range(10):
        store.buffer_add("a1", f"u{i}", f"r{i}", window=3)
    msgs = store.buffer_messages("a1")
    # Only last 3 exchanges = 6 messages
    assert len(msgs) == 6
    assert msgs[0]["content"] == "u7"
    assert msgs[1]["content"] == "r7"


def test_summary_get_set():
    store = MemoryStore()
    assert store.summary_get("a1") is None
    store.summary_set("a1", "The agent researched climate change.")
    assert store.summary_get("a1") == "The agent researched climate change."


def test_vector_index_and_retrieve():
    store = MemoryStore()
    store.vector_index("a1", "The capital of France is Paris. Paris is a beautiful city.")
    store.vector_index("a2", "Python is a programming language used for data science.")
    results = store.vector_retrieve("What city is the capital of France?", top_k=1)
    assert len(results) == 1
    assert "Paris" in results[0] or "France" in results[0]


def test_vector_retrieve_empty_store():
    store = MemoryStore()
    assert store.vector_retrieve("anything", top_k=3) == []


def test_scratchpad_context_empty():
    store = MemoryStore()
    assert store.scratchpad_context() is None


def test_scratchpad_context_with_data():
    store = MemoryStore()
    store.scratchpad["agent_a"] = "Found 3 relevant papers on topic X."
    ctx = store.scratchpad_context()
    assert ctx is not None
    assert "[Shared scratchpad]" in ctx
    assert "agent_a" in ctx
    assert "Found 3 relevant papers" in ctx


# ─── TF-IDF helpers ──────────────────────────────────────────────────────────


def test_chunk_text_splits_long_text():
    words = ["word"] * 500
    text = " ".join(words)
    chunks = _chunk_text(text, size=200)
    assert len(chunks) == 3  # 200 + 200 + 100


def test_chunk_text_short_text():
    chunks = _chunk_text("hello world", size=200)
    assert chunks == ["hello world"]


def test_cosine_identical():
    v = _tfidf_vector("the quick brown fox")
    assert abs(_cosine(v, v) - 1.0) < 1e-9


def test_cosine_orthogonal():
    v1 = _tfidf_vector("apple banana cherry")
    v2 = _tfidf_vector("xyz uvw rst")
    assert _cosine(v1, v2) == 0.0


# ─── _build_messages tests ────────────────────────────────────────────────────


def _make_agent(mem: dict) -> Agent:
    return Agent(
        id="a1", role="researcher", model="gpt-4o-mini",
        system_prompt="You research things.", memory=mem, temperature=0.5,
    )


def _make_gene(agents=None, shared_memory=None) -> Gene:
    agents = agents or []
    return Gene(
        topology=TopologyType.FIXED_PIPELINE,
        agents=agents,
        edges=[],
        shared_memory=shared_memory or {},
    )


def _make_runner():
    from backend.engine.runner.raw_llm import RawLLMRunner
    return RawLLMRunner()


def test_build_messages_stateless():
    runner = _make_runner()
    agent = _make_agent({})
    gene = _make_gene()
    store = MemoryStore()
    msgs = runner._build_messages(agent, "What is AI?", store, gene)
    assert msgs == [
        {"role": "system", "content": "You research things."},
        {"role": "user", "content": "What is AI?"},
    ]


def test_build_messages_buffer_injects_history():
    runner = _make_runner()
    agent = _make_agent({"type": "buffer", "window": 5})
    gene = _make_gene()
    store = MemoryStore()
    store.buffer_add("a1", "prev question", "prev answer", window=5)
    msgs = runner._build_messages(agent, "new question", store, gene)
    assert msgs[0]["role"] == "system"
    assert msgs[1] == {"role": "user", "content": "prev question"}
    assert msgs[2] == {"role": "assistant", "content": "prev answer"}
    assert msgs[-1] == {"role": "user", "content": "new question"}


def test_build_messages_summary_prefix():
    runner = _make_runner()
    agent = _make_agent({"type": "summary"})
    gene = _make_gene()
    store = MemoryStore()
    store.summary_set("a1", "The agent found key data about climate change.")
    msgs = runner._build_messages(agent, "Continue research", store, gene)
    assert "[Running context:" in msgs[0]["content"]
    assert "climate change" in msgs[0]["content"]
    assert msgs[-1]["content"] == "Continue research"


def test_build_messages_summary_no_prefix_when_empty():
    runner = _make_runner()
    agent = _make_agent({"type": "summary"})
    gene = _make_gene()
    store = MemoryStore()
    msgs = runner._build_messages(agent, "Start", store, gene)
    assert msgs[0]["content"] == "You research things."


def test_build_messages_vector_injects_chunks():
    runner = _make_runner()
    agent = _make_agent({"type": "vector", "top_k": 2})
    gene = _make_gene()
    store = MemoryStore()
    store.vector_index("other", "Paris is the capital of France and a cultural hub.")
    msgs = runner._build_messages(agent, "Tell me about Paris", store, gene)
    # Should have: system, assistant (retrieved context), user
    roles = [m["role"] for m in msgs]
    assert "assistant" in roles
    assert msgs[-1]["role"] == "user"


def test_build_messages_shared_scratchpad_prepended():
    runner = _make_runner()
    agent = _make_agent({})
    gene = _make_gene(shared_memory={"type": "scratchpad"})
    store = MemoryStore()
    store.scratchpad["prev_agent"] = "Key finding: X is true."
    msgs = runner._build_messages(agent, "What do we know?", store, gene)
    user_msg = msgs[-1]["content"]
    assert "[Shared scratchpad]" in user_msg
    assert "Key finding" in user_msg
    assert "What do we know?" in user_msg


def test_build_messages_scratchpad_empty_no_prefix():
    runner = _make_runner()
    agent = _make_agent({})
    gene = _make_gene(shared_memory={"type": "scratchpad"})
    store = MemoryStore()
    msgs = runner._build_messages(agent, "question", store, gene)
    assert msgs[-1]["content"] == "question"


# ─── Integration: runner wires memory through full pipeline ──────────────────


def _mock_response(content: str) -> MagicMock:
    resp = MagicMock()
    resp.choices[0].message.content = content
    resp.usage.prompt_tokens = 10
    resp.usage.completion_tokens = 5
    return resp


def test_run_stateless_pipeline_unchanged():
    """Stateless agents: behaviour identical to original runner."""
    from backend.engine.runner.raw_llm import RawLLMRunner

    runner = RawLLMRunner()
    gene = Gene(
        topology=TopologyType.FIXED_PIPELINE,
        agents=[
            Agent(id="a0", role="r", model="m", system_prompt="p0", memory={}),
            Agent(id="a1", role="r", model="m", system_prompt="p1", memory={}),
        ],
        edges=[Edge(from_agent="a0", to_agent="a1", type="sequential")],
    )

    with patch.object(runner, "_call_llm_once") as mock_llm:
        mock_llm.side_effect = [
            _mock_response("output_a0"),
            _mock_response("output_a1"),
        ]
        result = runner.run(gene, "initial input")

    assert result.output == "output_a1"
    assert mock_llm.call_count == 2


def test_run_scratchpad_populates_store():
    """Shared scratchpad: second agent receives first agent's output in context."""
    from backend.engine.runner.raw_llm import RawLLMRunner

    runner = RawLLMRunner()
    gene = Gene(
        topology=TopologyType.FIXED_PIPELINE,
        agents=[
            Agent(id="a0", role="r", model="m", system_prompt="p0", memory={}),
            Agent(id="a1", role="r", model="m", system_prompt="p1", memory={}),
        ],
        edges=[Edge(from_agent="a0", to_agent="a1", type="sequential")],
        shared_memory={"type": "scratchpad"},
    )

    captured_messages: list[list[dict]] = []

    def fake_llm(model, messages, temperature):
        captured_messages.append(messages)
        return _mock_response(f"out_{len(captured_messages)}")

    with patch.object(runner, "_call_llm_once", side_effect=fake_llm):
        runner.run(gene, "start")

    # Second agent's user message should contain the scratchpad
    second_user = captured_messages[1][-1]["content"]
    assert "[Shared scratchpad]" in second_user
