import random
from backend.shared import Gene, ExperimentConfig, ObjectiveWeights, EvaluatorConfig
from backend.shared.gene import TopologyType
from backend.shared.fixtures import load_fixture
from backend.shared.validator import validate_gene
from backend.engine.gp.population import seed_population
from backend.engine.gp.diversity import topology_diversity_score


def make_config(population_size=6):
    return ExperimentConfig(
        name="test",
        task_description="Summarize documents",
        dataset_id="ds_001",
        evaluators=[
            EvaluatorConfig(
                type="llm_judge", params={"model": "gpt-4o-mini", "rubric": "Rate 0-1."}
            )
        ],
        objective_weights=ObjectiveWeights(quality=0.6, cost=0.2, speed=0.2),
        population_size=population_size,
    )


def _fixture_base_gene(task=None, provider=None, models=None) -> Gene:
    """Return a fixture gene with agent models updated to use the supplied model list."""
    g = Gene.from_dict(load_fixture("fixed_pipeline"))
    if models:
        for a in g.agents:
            a.model = random.choice(models)
    return g


def _noop_apply_mutations(gene, n_mutations, allowed_models, provider_config, allow_structural=True):
    return gene.copy()


def test_seed_population_returns_correct_count(monkeypatch):
    monkeypatch.setattr("backend.engine.gp.population._generate_base_gene", _fixture_base_gene)
    monkeypatch.setattr("backend.engine.gp.population._apply_mutations", _noop_apply_mutations)
    config = make_config(population_size=6)
    pop = seed_population(config)
    assert len(pop) == 6


def test_seed_population_all_valid_genes(monkeypatch):
    monkeypatch.setattr("backend.engine.gp.population._generate_base_gene", _fixture_base_gene)
    monkeypatch.setattr("backend.engine.gp.population._apply_mutations", _noop_apply_mutations)
    config = make_config(population_size=6)
    pop = seed_population(config)
    for gene in pop:
        validate_gene(gene.to_dict())


def test_seed_population_respects_allowed_models(monkeypatch):
    custom_models = ["llama3.2:1b"]
    monkeypatch.setattr("backend.engine.gp.population._generate_base_gene", _fixture_base_gene)
    monkeypatch.setattr("backend.engine.gp.population._apply_mutations", _noop_apply_mutations)
    config = make_config(population_size=6)
    config.allowed_models = custom_models
    pop = seed_population(config)
    # Base gene agents receive models from allowed_models via _fixture_base_gene
    for agent in pop[0].agents:
        assert agent.model in custom_models, (
            f"Agent {agent.id} has model {agent.model!r}, expected one of {custom_models}"
        )


def test_seed_population_has_topology_diversity(monkeypatch):
    monkeypatch.setattr("backend.engine.gp.population._generate_base_gene", _fixture_base_gene)
    monkeypatch.setattr("backend.engine.gp.population._apply_mutations", _noop_apply_mutations)
    config = make_config(population_size=12)
    pop = seed_population(config)
    # Step 2 injects one variant per topology, guaranteeing diversity
    score = topology_diversity_score(pop)
    assert score > 0.0


def test_seed_population_covers_all_topologies(monkeypatch):
    monkeypatch.setattr("backend.engine.gp.population._generate_base_gene", _fixture_base_gene)
    monkeypatch.setattr("backend.engine.gp.population._apply_mutations", _noop_apply_mutations)
    # population_size >= 6 ensures all 6 TopologyTypes appear
    config = make_config(population_size=6)
    pop = seed_population(config)
    topologies = {g.topology for g in pop}
    assert topologies == set(TopologyType)


def test_seed_population_uses_seed_gene_when_provided(monkeypatch):
    monkeypatch.setattr("backend.engine.gp.population._apply_mutations", _noop_apply_mutations)
    seed = load_fixture("debate")
    config = make_config(population_size=6)
    config.seed_gene = seed
    pop = seed_population(config)
    assert pop[0].id == "seed_user"
    assert pop[0].topology.value == seed["topology"]


def test_seed_population_base_uses_task_description(monkeypatch):
    """_generate_base_gene is called with the config's task_description."""
    received = {}

    def capture_base(task, provider, models):
        received["task"] = task
        return _fixture_base_gene(task, provider, models)

    monkeypatch.setattr("backend.engine.gp.population._generate_base_gene", capture_base)
    monkeypatch.setattr("backend.engine.gp.population._apply_mutations", _noop_apply_mutations)
    config = make_config()
    seed_population(config)
    assert received["task"] == "Summarize documents"
