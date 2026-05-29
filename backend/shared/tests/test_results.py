import pytest
from backend.shared.results import RunResult, Score, ParetoPoint, EvalRowResult


def test_score_clamps():
    with pytest.raises(ValueError):
        Score(quality=1.5)


def test_score_valid():
    s = Score(quality=0.85, metadata={"reason": "mostly correct"})
    assert s.quality == 0.85


def test_score_cost_usd_defaults_to_zero():
    s = Score(quality=0.7)
    assert s.cost_usd == 0.0


def test_score_cost_usd_roundtrip():
    s = Score(quality=0.9, cost_usd=0.00042)
    d = s.to_dict()
    s2 = Score.from_dict(d)
    assert s2.cost_usd == pytest.approx(0.00042)


def test_run_result_requires_cost():
    with pytest.raises(TypeError):
        RunResult(output="hello", token_usage={}, latency_ms=500)  # missing cost_usd


def test_run_result_roundtrip():
    r = RunResult(
        output="answer text",
        token_usage={"gpt-4o": {"prompt": 100, "completion": 50}},
        latency_ms=1200,
        cost_usd=0.003,
        trace=[{"agent": "a0", "message": "hello"}],
    )
    d = r.to_dict()
    r2 = RunResult.from_dict(d)
    assert r2.output == r.output
    assert r2.cost_usd == r.cost_usd


def test_pareto_point():
    p = ParetoPoint(quality=0.9, cost_usd=0.01, latency_ms=800)
    assert p.quality == 0.9


def test_scalar_fitness():
    from backend.shared.experiment import ObjectiveWeights

    weights = ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2)
    p = ParetoPoint(quality=0.9, cost_usd=0.01, latency_ms=800)
    fitness = p.scalar_fitness(weights, max_cost_usd=0.1, max_latency_ms=5000)
    assert 0.0 < fitness < 1.0


def test_eval_row_result_eval_cost_defaults_to_zero():
    row = EvalRowResult(
        row_index=0, input_json="{}", output_text="ans",
        score=0.8, score_reasoning="ok", latency_ms=100, cost_usd=0.001,
    )
    assert row.eval_cost_usd == 0.0


def test_eval_row_result_roundtrip_with_eval_cost():
    row = EvalRowResult(
        row_index=1, input_json='{"q": "hi"}', output_text="hello",
        score=0.9, score_reasoning="good", latency_ms=200,
        cost_usd=0.0, eval_cost_usd=0.00042,
    )
    d = row.to_dict()
    row2 = EvalRowResult.from_dict(d)
    assert row2.eval_cost_usd == pytest.approx(0.00042)
    assert row2.cost_usd == 0.0


def test_score_sub_scores_default_empty():
    s = Score(quality=0.8)
    assert s.sub_scores == {}


def test_score_sub_scores_roundtrip():
    s = Score(quality=0.8, sub_scores={"accuracy": 0.9, "fluency": 0.7})
    d = s.to_dict()
    assert d["sub_scores"] == {"accuracy": 0.9, "fluency": 0.7}
    s2 = Score.from_dict(d)
    assert s2.sub_scores == {"accuracy": 0.9, "fluency": 0.7}


def test_eval_row_sub_scores_default_empty():
    row = EvalRowResult(
        row_index=0, input_json="{}", output_text="ans",
        score=0.8, score_reasoning="ok", latency_ms=100, cost_usd=0.001,
    )
    assert row.sub_scores == {}


def test_eval_row_sub_scores_roundtrip():
    row = EvalRowResult(
        row_index=0, input_json="{}", output_text="ans",
        score=0.8, score_reasoning="ok", latency_ms=100, cost_usd=0.001,
        sub_scores={"coherence": 0.85, "accuracy": 0.75},
    )
    d = row.to_dict()
    assert d["sub_scores"] == {"coherence": 0.85, "accuracy": 0.75}
    row2 = EvalRowResult.from_dict(d)
    assert row2.sub_scores == {"coherence": 0.85, "accuracy": 0.75}


def test_eval_row_from_dict_missing_sub_scores_defaults_empty():
    """Backwards compatibility: rows without sub_scores deserialise to {}."""
    d = {
        "row_index": 0, "input_json": "{}", "output_text": "a",
        "score": 0.5, "score_reasoning": "", "latency_ms": 0,
        "cost_usd": 0.0,
    }
    row = EvalRowResult.from_dict(d)
    assert row.sub_scores == {}
