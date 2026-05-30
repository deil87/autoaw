import pytest
from backend.shared.gene import Agent, Edge, TopologyParams, Gene, TopologyType, AgentMetaType, TEMPERATURE_BOUNDS


def test_agent_defaults():
    agent = Agent(
        id="a0", role="planner", model="gpt-4o", system_prompt="You are a planner."
    )
    assert agent.tools == []
    assert agent.memory == {}
    assert agent.temperature == 0.7


def test_agent_memory_roundtrip():
    memory = {"type": "buffer", "window": 10}
    agent = Agent(
        id="a0", role="planner", model="gpt-4o", system_prompt="Plan.", memory=memory
    )
    d = agent.to_dict()
    assert d["memory"] == memory
    agent2 = Agent.from_dict(d)
    assert agent2.memory == memory


def test_agent_memory_defaults_on_legacy_dict():
    """Agents serialised before memory was added should deserialise cleanly."""
    d = {"id": "a0", "role": "r", "model": "gpt-4o", "system_prompt": "s"}
    agent = Agent.from_dict(d)
    assert agent.memory == {}


def test_agent_rejects_invalid_temperature():
    with pytest.raises(ValueError):
        Agent(
            id="a0", role="planner", model="gpt-4o", system_prompt="x", temperature=1.5
        )


def test_edge_types():
    edge = Edge(from_agent="a0", to_agent="a1", type="sequential")
    assert edge.type == "sequential"


def test_topology_type_enum():
    assert TopologyType.FIXED_PIPELINE.value == "fixed_pipeline"
    assert TopologyType.AI_ORCHESTRATED.value == "ai_orchestrated"
    assert TopologyType.DEBATE.value == "debate"
    assert TopologyType.PARALLEL_REDUCE.value == "parallel_reduce"
    assert TopologyType.HUMAN_IN_LOOP.value == "human_in_loop"
    assert TopologyType.HYBRID.value == "hybrid"


def test_gene_to_dict_roundtrip():
    agent = Agent(id="a0", role="planner", model="gpt-4o", system_prompt="Plan things.")
    edge = Edge(from_agent="a0", to_agent="a1", type="sequential")
    gene = Gene(
        id="gene_001",
        topology=TopologyType.FIXED_PIPELINE,
        agents=[agent],
        edges=[edge],
    )
    d = gene.to_dict()
    gene2 = Gene.from_dict(d)
    assert gene2.id == gene.id
    assert gene2.topology == gene.topology
    assert gene2.agents[0].role == "planner"


def test_gene_copy_is_independent():
    agent = Agent(id="a0", role="planner", model="gpt-4o", system_prompt="Plan things.")
    gene = Gene(
        id="gene_001", topology=TopologyType.FIXED_PIPELINE, agents=[agent], edges=[]
    )
    copy = gene.copy()
    copy.agents[0].role = "mutated"
    assert gene.agents[0].role == "planner"  # original unchanged


def test_agent_meta_type_critic_temperature_zero():
    agent = Agent(
        id="c0", role="critic", model="gpt-4o", system_prompt="Audit.",
        meta_type=AgentMetaType.CRITIC, temperature=0.0,
    )
    assert agent.temperature == 0.0
    assert agent.meta_type == AgentMetaType.CRITIC


def test_agent_meta_type_critic_rejects_nonzero():
    with pytest.raises(ValueError, match="meta_type"):
        Agent(
            id="c0", role="critic", model="gpt-4o", system_prompt="Audit.",
            meta_type=AgentMetaType.CRITIC, temperature=0.3,
        )


def test_agent_meta_type_profiler_bounds():
    # valid
    agent = Agent(
        id="p0", role="profiler", model="gpt-4o", system_prompt="Profile.",
        meta_type=AgentMetaType.PROFILER, temperature=0.1,
    )
    assert agent.temperature == 0.1
    # invalid — too high
    with pytest.raises(ValueError, match=r"\[0\.0, 0\.2\]"):
        Agent(
            id="p1", role="profiler", model="gpt-4o", system_prompt="Profile.",
            meta_type=AgentMetaType.PROFILER, temperature=0.5,
        )


def test_agent_meta_type_author_bounds():
    agent = Agent(
        id="au0", role="author", model="gpt-4o", system_prompt="Write.",
        meta_type=AgentMetaType.AUTHOR, temperature=0.6,
    )
    assert agent.temperature == 0.6
    with pytest.raises(ValueError, match=r"\[0\.5, 0\.7\]"):
        Agent(
            id="au1", role="author", model="gpt-4o", system_prompt="Write.",
            meta_type=AgentMetaType.AUTHOR, temperature=0.1,
        )


def test_agent_meta_type_none_uses_global_bounds():
    # no meta_type → original 0–1 check applies
    with pytest.raises(ValueError):
        Agent(id="x", role="r", model="m", system_prompt="s", temperature=1.5)


def test_agent_meta_type_roundtrip():
    agent = Agent(
        id="c0", role="critic", model="gpt-4o", system_prompt="Audit.",
        meta_type=AgentMetaType.CRITIC, temperature=0.0,
    )
    d = agent.to_dict()
    assert d["meta_type"] == "critic"
    agent2 = Agent.from_dict(d)
    assert agent2.meta_type == AgentMetaType.CRITIC
    assert agent2.temperature == 0.0


def test_agent_no_meta_type_not_serialised():
    agent = Agent(id="a0", role="r", model="m", system_prompt="s", temperature=0.5)
    d = agent.to_dict()
    assert "meta_type" not in d


def test_temperature_bounds_coverage():
    for meta_type in AgentMetaType:
        assert meta_type in TEMPERATURE_BOUNDS
        lo, hi = TEMPERATURE_BOUNDS[meta_type]
        assert 0.0 <= lo <= hi <= 1.0
