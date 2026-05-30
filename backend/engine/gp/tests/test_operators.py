"""Tests for GP mutation operators, focused on mutate_memory."""
from __future__ import annotations
import pytest
from backend.shared.gene import Agent, Edge, Gene, TopologyType
from backend.engine.gp.operators import mutate_memory


def _make_gene(shared_memory=None) -> Gene:
    return Gene(
        topology=TopologyType.FIXED_PIPELINE,
        agents=[
            Agent(id="a0", role="researcher", model="gpt-4o-mini",
                  system_prompt="Research.", memory={}),
            Agent(id="a1", role="writer", model="gpt-4o-mini",
                  system_prompt="Write.", memory={}),
        ],
        edges=[Edge(from_agent="a0", to_agent="a1", type="sequential")],
        shared_memory=shared_memory or {},
    )


def test_mutate_memory_returns_copy():
    """mutate_memory must return a new gene, not mutate in place."""
    gene = _make_gene()
    result = mutate_memory(gene)
    assert result is not gene
    assert result.id != gene.id or result.agents is not gene.agents


def test_mutate_memory_changes_at_least_one_agent():
    """After mutation, at least one agent should have a non-default memory (over many runs)."""
    gene = _make_gene()
    seen_non_empty = False
    for _ in range(50):
        result = mutate_memory(gene)
        for agent in result.agents:
            if agent.memory:
                seen_non_empty = True
                break
        if seen_non_empty:
            break
    assert seen_non_empty, "Expected mutate_memory to produce non-empty memory at least once in 50 tries"


def test_mutate_memory_valid_types():
    """All produced memory configs must be valid known types or empty."""
    valid_types = {"buffer", "summary", "vector"}
    gene = _make_gene()
    for _ in range(100):
        result = mutate_memory(gene)
        for agent in result.agents:
            mem = agent.memory
            if mem:
                assert mem.get("type") in valid_types, f"Unexpected memory type: {mem}"
                if mem["type"] == "buffer":
                    assert mem.get("window") in [3, 5, 10, 20]
                elif mem["type"] == "vector":
                    assert mem.get("top_k") in [1, 2, 3, 5]


def test_mutate_memory_shared_memory_toggled():
    """Over many runs, the shared_memory field should be toggled at least once."""
    gene = _make_gene()
    saw_scratchpad = False
    for _ in range(100):
        result = mutate_memory(gene)
        if result.shared_memory.get("type") == "scratchpad":
            saw_scratchpad = True
            break
    assert saw_scratchpad, "Expected shared_memory to be toggled to scratchpad in 100 tries"


def test_mutate_memory_toggles_off_scratchpad():
    """Starting with scratchpad active, it should eventually be toggled off."""
    gene = _make_gene(shared_memory={"type": "scratchpad"})
    saw_off = False
    for _ in range(100):
        result = mutate_memory(gene)
        if not result.shared_memory:
            saw_off = True
            break
    assert saw_off, "Expected shared_memory to be toggled off in 100 tries"


def test_mutate_memory_empty_gene_is_safe():
    """mutate_memory on a gene with no agents should return a valid gene."""
    gene = Gene(
        topology=TopologyType.FIXED_PIPELINE,
        agents=[],
        edges=[],
    )
    result = mutate_memory(gene)
    assert result is not None
    assert result.agents == []


def test_mutate_memory_does_not_modify_other_agents():
    """Only one agent should be changed per mutation call."""
    # With a 2-agent gene, at most 1 agent's memory changes per call
    gene = _make_gene()
    # Set both to a known state
    gene.agents[0].memory = {}
    gene.agents[1].memory = {}

    # Over 1000 runs, we should never see BOTH agents mutated at once
    for _ in range(200):
        result = mutate_memory(gene)
        changed = sum(1 for a in result.agents if a.memory)
        assert changed <= 1, f"Expected at most 1 agent mutated, got {changed}"
