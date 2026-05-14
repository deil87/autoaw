"""Tests for the EvaluatorTypeDescriptor catalog."""

import pytest
from backend.shared.evaluator_catalog import (
    CATALOG,
    CATALOG_BY_TYPE,
    EvaluatorParamSpec,
    EvaluatorTypeDescriptor,
)

VALID_PARAM_TYPES = {"string", "number", "select", "textarea"}
VALID_CATEGORIES = {"built_in", "ragas", "deepeval"}


def test_catalog_is_nonempty():
    assert len(CATALOG) == 11


def test_all_entries_have_required_fields():
    for entry in CATALOG:
        assert entry.type, f"Missing type in {entry}"
        assert entry.name, f"Missing name in {entry}"
        assert entry.description, f"Missing description in {entry}"
        assert entry.category in VALID_CATEGORIES, (
            f"Invalid category '{entry.category}' in {entry.type}"
        )


def test_param_specs_have_valid_types():
    for entry in CATALOG:
        for param in entry.params:
            assert param.type in VALID_PARAM_TYPES, (
                f"Invalid param type '{param.type}' in {entry.type}.{param.name}"
            )
            if param.type == "select":
                assert param.options is not None and len(param.options) > 0, (
                    f"Select param '{param.name}' in {entry.type} must have options"
                )


def test_llm_judge_in_catalog():
    assert "llm_judge" in CATALOG_BY_TYPE
    entry = CATALOG_BY_TYPE["llm_judge"]
    assert entry.category == "built_in"
    param_names = [p.name for p in entry.params]
    assert "model" in param_names
    assert "rubric" in param_names
    rubric = next(p for p in entry.params if p.name == "rubric")
    assert rubric.required is True
    assert rubric.type == "textarea"


def test_workbench_in_catalog():
    assert "workbench" in CATALOG_BY_TYPE
    entry = CATALOG_BY_TYPE["workbench"]
    assert entry.category == "built_in"
    assert entry.name == "WorkBench Trace Match"
    assert (
        "trace" in entry.description.lower() or "tool-call" in entry.description.lower()
    )


def test_deepeval_tool_correctness_in_catalog():
    assert "deepeval_tool_correctness" in CATALOG_BY_TYPE
    entry = CATALOG_BY_TYPE["deepeval_tool_correctness"]
    assert entry.category == "deepeval"
    param_names = [p.name for p in entry.params]
    assert "threshold" in param_names
    assert "model" not in param_names


def test_deepeval_answer_relevancy_in_catalog():
    assert "deepeval_answer_relevancy" in CATALOG_BY_TYPE
    entry = CATALOG_BY_TYPE["deepeval_answer_relevancy"]
    assert entry.category == "deepeval"
    param_names = [p.name for p in entry.params]
    assert "model" in param_names
    assert "threshold" in param_names
    threshold = next(p for p in entry.params if p.name == "threshold")
    assert threshold.type == "number"
    assert threshold.min == 0
    assert threshold.max == 1
    assert threshold.step == 0.05
    assert threshold.default == 0.5


def test_ragas_faithfulness_in_catalog():
    assert "ragas_faithfulness" in CATALOG_BY_TYPE
    entry = CATALOG_BY_TYPE["ragas_faithfulness"]
    assert entry.category == "ragas"
    param_names = [p.name for p in entry.params]
    assert "model" in param_names


def test_catalog_by_type_lookup():
    for entry in CATALOG:
        assert CATALOG_BY_TYPE[entry.type] is entry


def test_from_dict_round_trip():
    entry = CATALOG_BY_TYPE["llm_judge"]
    assert EvaluatorTypeDescriptor.from_dict(entry.to_dict()) == entry
