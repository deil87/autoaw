from unittest.mock import MagicMock, patch
from backend.engine.llm_client import ProviderConfig
from backend.engine.gp.operators import mutate_prompt, mutate_structure
from backend.shared.gene import Gene, Agent, TopologyType


def _gene():
    return Gene(
        topology=TopologyType.FIXED_PIPELINE,
        agents=[
            Agent(
                id="a0",
                role="writer",
                model="gpt-4o-mini",
                system_prompt="Write clearly.",
                temperature=0.5,
            ),
        ],
        edges=[],
    )


def test_mutate_prompt_uses_provider_client():
    cfg = ProviderConfig(provider="github", api_key="ghp_test")
    fake_response = MagicMock()
    fake_response.choices[0].message.content = "rewritten prompt"

    with patch("backend.engine.llm_client.openai.OpenAI") as mock_cls:
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance
        mock_instance.chat.completions.create.return_value = fake_response
        result = mutate_prompt(_gene(), provider_config=cfg)

    assert result.agents[0].system_prompt == "rewritten prompt"
    mock_cls.assert_called_with(
        api_key="ghp_test",
        base_url="https://models.inference.ai.azure.com",
    )


def test_mutate_structure_add_agent_picks_from_allowed_models():
    cfg = ProviderConfig(provider="github", api_key="ghp_test")
    allowed = ["gpt-4o-mini", "gpt-4o"]
    all_models = set()
    for _ in range(60):
        g = mutate_structure(_gene(), provider_config=cfg, allowed_models=allowed)
        for a in g.agents:
            all_models.add(a.model)
    assert all_models.issubset(set(allowed))


def test_mutate_structure_single_allowed_model():
    cfg = ProviderConfig(provider="github", api_key="ghp_test")
    allowed = ["gpt-4o-mini"]
    for _ in range(20):
        g = mutate_structure(_gene(), provider_config=cfg, allowed_models=allowed)
        for a in g.agents:
            assert a.model == "gpt-4o-mini"


def test_mutate_prompt_no_provider_falls_back_to_env(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
    fake_response = MagicMock()
    fake_response.choices[0].message.content = "env prompt"

    with patch("backend.engine.llm_client.openai.OpenAI") as mock_cls:
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance
        mock_instance.chat.completions.create.return_value = fake_response
        result = mutate_prompt(_gene())

    assert result.agents[0].system_prompt == "env prompt"
    mock_cls.assert_called_with(api_key="sk-env", base_url=None)
