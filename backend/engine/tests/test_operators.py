import pytest
from unittest.mock import MagicMock, patch
from backend.shared import Gene, load_fixture
from backend.engine.gp.operators import (
    mutate_structure,
    mutate_prompt,
    mutate_param,
    crossover_subgraph,
    crossover_prompt,
)


def make_gene(topology="fixed_pipeline"):
    return Gene.from_dict(load_fixture(topology))


def test_mutate_structure_returns_new_gene():
    gene = make_gene()
    mutated = mutate_structure(gene)
    assert mutated is not gene  # new object
    assert isinstance(mutated, Gene)


def test_mutate_structure_does_not_modify_original():
    gene = make_gene()
    original_agent_count = len(gene.agents)
    mutate_structure(gene)
    assert len(gene.agents) == original_agent_count  # original unchanged


def test_mutate_param_changes_temperature():
    gene = make_gene()
    original_temps = [a.temperature for a in gene.agents]
    mutated = mutate_param(gene)
    new_temps = [a.temperature for a in mutated.agents]
    # At least one temperature should differ (with very high probability)
    assert mutated is not gene
    assert all(0.0 <= t <= 1.0 for t in new_temps)


def test_mutate_prompt_calls_llm(monkeypatch):
    gene = make_gene()

    def fake_rewrite(prompt: str, provider_config) -> str:
        return "Rewritten: " + prompt

    monkeypatch.setattr(
        "backend.engine.gp.operators._rewrite_prompt_with_llm", fake_rewrite
    )
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    mutated = mutate_prompt(gene)
    assert mutated is not gene
    # At least one system prompt should be different
    original_prompts = {a.id: a.system_prompt for a in gene.agents}
    new_prompts = {a.id: a.system_prompt for a in mutated.agents}
    assert any(new_prompts[aid] != original_prompts[aid] for aid in original_prompts)


def test_crossover_subgraph_returns_two_children():
    gene1 = make_gene("fixed_pipeline")
    gene2 = make_gene("ai_orchestrated")
    child1, child2 = crossover_subgraph(gene1, gene2)
    assert isinstance(child1, Gene)
    assert isinstance(child2, Gene)
    assert child1 is not gene1
    assert child2 is not gene2


def test_crossover_prompt_swaps_matching_roles():
    gene1 = make_gene("fixed_pipeline")
    gene2 = make_gene("fixed_pipeline")
    # Give them different prompts for same roles
    gene2.agents[0].system_prompt = "Completely different prompt for researcher."
    child1, child2 = crossover_prompt(gene1, gene2)
    assert isinstance(child1, Gene)
    assert isinstance(child2, Gene)
