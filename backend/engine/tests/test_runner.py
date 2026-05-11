import pytest
from unittest.mock import patch, MagicMock
from backend.shared import Gene, load_fixture
from backend.engine.runner.base import WorkflowRunner
from backend.engine.runner.raw_llm import RawLLMRunner


def test_runner_is_abstract():
    with pytest.raises(TypeError):
        WorkflowRunner()


def test_raw_llm_runner_implements_interface():
    runner = RawLLMRunner()
    assert hasattr(runner, "run")


def test_raw_llm_runner_fixed_pipeline(monkeypatch):
    """RawLLMRunner executes each agent in sequence for fixed_pipeline topology."""
    gene_dict = load_fixture("fixed_pipeline")
    gene = Gene.from_dict(gene_dict)

    call_count = 0

    def fake_chat(model, messages, temperature):
        nonlocal call_count
        call_count += 1
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content=f"response_{call_count}"))],
            usage=MagicMock(prompt_tokens=10, completion_tokens=5),
        )

    runner = RawLLMRunner()
    monkeypatch.setattr(runner, "_call_llm", fake_chat)
    result = runner.run(gene, "test input")

    assert result.output  # non-empty final output
    assert result.cost_usd >= 0
    assert result.latency_ms >= 0
    assert len(result.trace) == len(gene.agents)


def test_raw_llm_runner_cost_always_set(monkeypatch):
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))

    def fake_chat(model, messages, temperature):
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content="answer"))],
            usage=MagicMock(prompt_tokens=100, completion_tokens=50),
        )

    runner = RawLLMRunner()
    monkeypatch.setattr(runner, "_call_llm", fake_chat)
    result = runner.run(gene, "input")
    assert result.cost_usd > 0  # cost must always be tracked
