import pytest
from backend.shared.fixtures import load_fixture
from backend.shared.validator import validate_gene
from backend.shared.gene import Gene


TOPOLOGY_TYPES = [
    "fixed_pipeline",
    "ai_orchestrated",
    "debate",
    "parallel_reduce",
    "human_in_loop",
    "hybrid",
]


@pytest.mark.parametrize("topology", TOPOLOGY_TYPES)
def test_fixture_validates(topology):
    gene_dict = load_fixture(topology)
    validate_gene(gene_dict)  # must not raise


@pytest.mark.parametrize("topology", TOPOLOGY_TYPES)
def test_fixture_roundtrip(topology):
    gene_dict = load_fixture(topology)
    gene = Gene.from_dict(gene_dict)
    assert gene.topology.value == topology
    assert len(gene.agents) >= 1
