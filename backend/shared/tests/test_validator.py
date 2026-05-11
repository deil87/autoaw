import pytest
from backend.shared.validator import validate_gene, GeneValidationError


def test_valid_gene_passes():
    gene = {
        "id": "gene_001",
        "topology": "fixed_pipeline",
        "agents": [
            {
                "id": "a0",
                "role": "planner",
                "model": "gpt-4o",
                "system_prompt": "Plan.",
                "tools": [],
                "temperature": 0.7,
            }
        ],
        "edges": [{"from": "a0", "to": "a1", "type": "sequential"}],
        "topology_params": {},
    }
    validate_gene(gene)  # should not raise


def test_missing_topology_raises():
    with pytest.raises(GeneValidationError):
        validate_gene({"id": "x", "agents": [], "edges": [], "topology_params": {}})


def test_invalid_topology_value_raises():
    with pytest.raises(GeneValidationError):
        validate_gene(
            {
                "id": "x",
                "topology": "invalid_type",
                "agents": [],
                "edges": [],
                "topology_params": {},
            }
        )


def test_agent_missing_role_raises():
    with pytest.raises(GeneValidationError):
        validate_gene(
            {
                "id": "x",
                "topology": "fixed_pipeline",
                "agents": [
                    {
                        "id": "a0",
                        "model": "gpt-4o",
                        "system_prompt": "x",
                        "tools": [],
                        "temperature": 0.7,
                    }
                ],
                "edges": [],
                "topology_params": {},
            }
        )
