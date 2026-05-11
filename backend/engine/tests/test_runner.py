import pytest
from unittest.mock import patch, MagicMock, call
from openai import RateLimitError
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


def _make_rate_limit_error(message: str) -> RateLimitError:
    mock_resp = MagicMock()
    mock_resp.status_code = 429
    mock_resp.json.return_value = {"error": {"message": message}}
    mock_resp.headers = {}
    return RateLimitError(message, response=mock_resp, body=None)


def test_raw_llm_runner_retries_on_rate_limit(monkeypatch):
    """Runner retries up to _MAX_RETRIES times on RateLimitError then succeeds."""
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))

    good_response = MagicMock(
        choices=[MagicMock(message=MagicMock(content="ok"))],
        usage=MagicMock(prompt_tokens=5, completion_tokens=5),
    )
    rate_err = _make_rate_limit_error("Please wait 1 seconds before retrying.")

    call_results = [
        rate_err,
        rate_err,
        good_response,
        good_response,
    ]  # agent1 retries + agent2
    call_iter = iter(call_results)

    def fake_once(model, messages, temperature):
        val = next(call_iter)
        if isinstance(val, Exception):
            raise val
        return val

    runner = RawLLMRunner()
    with patch("backend.engine.runner.raw_llm.time.sleep") as mock_sleep:
        monkeypatch.setattr(runner, "_call_llm_once", fake_once)
        result = runner.run(gene, "input")

    assert result.output == "ok"
    assert mock_sleep.call_count == 2  # slept once before each of the two retries


def test_raw_llm_runner_raises_after_max_retries(monkeypatch):
    """Runner re-raises RateLimitError after exhausting all retries."""
    gene = Gene.from_dict(load_fixture("fixed_pipeline"))
    err = _make_rate_limit_error("Rate limit exceeded")

    runner = RawLLMRunner()
    with patch("backend.engine.runner.raw_llm.time.sleep"):
        monkeypatch.setattr(runner, "_call_llm_once", MagicMock(side_effect=err))
        with pytest.raises(RateLimitError):
            runner.run(gene, "input")
