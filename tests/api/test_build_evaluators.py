from unittest.mock import MagicMock
from backend.shared.experiment import EvaluatorConfig
from backend.api.executor import _build_single_evaluator


def test_builds_llm_judge():
    ev_config = EvaluatorConfig(
        type="llm_judge", params={"model": "gpt-4o-mini", "rubric": "rate it"}
    )
    result = _build_single_evaluator(ev_config)
    from backend.engine.evaluator.llm_judge import LLMJudgeEvaluator

    assert isinstance(result, LLMJudgeEvaluator)


def test_builds_workbench():
    ev_config = EvaluatorConfig(type="workbench", params={})
    result = _build_single_evaluator(ev_config)
    from backend.engine.workbench.evaluator import WorkBenchEvaluator

    assert isinstance(result, WorkBenchEvaluator)


def test_returns_none_for_unknown_type():
    ev_config = EvaluatorConfig(type="totally_unknown", params={})
    result = _build_single_evaluator(ev_config)
    assert result is None
