from __future__ import annotations
import json
import random
from backend.shared.gene import Gene, Agent, TopologyType
from backend.shared.experiment import ExperimentConfig, DEFAULT_CLOUD_MODELS
from backend.engine.llm_client import ProviderConfig, make_client, provider_from_env
from backend.engine.gp.operators import (
    mutate_structure,
    mutate_prompt,
    mutate_param,
    mutate_inject_critique,
    mutate_expand,
    mutate_compact,
    run_split_detection,
)


def _generate_base_gene(
    task_description: str,
    provider_config: ProviderConfig | None,
    allowed_models: list[str],
) -> Gene:
    """Call an LLM to generate a task-specific base gene as a fixed_pipeline.

    Prompts the LLM to produce 2–3 agents whose roles and system prompts are
    directly relevant to the given task. Falls back to a minimal single-agent
    gene on any LLM error.
    """
    cfg = provider_config or provider_from_env()
    model = allowed_models[0] if allowed_models else "gpt-4o-mini"
    system = (
        "You are a multi-agent workflow architect.\n"
        "Given a task description, design a minimal fixed_pipeline gene: "
        "2–3 sequential agents whose roles and system prompts are tailored "
        "specifically to solve that task.\n\n"
        "Return ONLY a JSON object with this exact shape:\n"
        "{\n"
        '  "id": "seed_base",\n'
        '  "topology": "fixed_pipeline",\n'
        '  "agents": [\n'
        "    {\n"
        '      "id": "<snake_case_role>",\n'
        '      "role": "<role_name>",\n'
        f'      "model": "{model}",\n'
        '      "system_prompt": "<specific instruction for this task>",\n'
        '      "tools": [],\n'
        '      "temperature": 0.7,\n'
        '      "subtasks": []\n'
        "    }\n"
        "  ],\n"
        '  "edges": [\n'
        '    {"from": "<agent1_id>", "to": "<agent2_id>", "type": "sequential"}\n'
        "  ],\n"
        '  "topology_params": {}\n'
        "}\n\n"
        "Rules:\n"
        "- Exactly 2 or 3 agents.\n"
        "- Each agent id must be a unique snake_case string.\n"
        "- Each system_prompt must be tailored to the task — not generic.\n"
        "- Agents form a sequential pipeline; the last agent writes the final answer.\n"
        "- Return ONLY the JSON object, no markdown fences, no explanation."
    )
    try:
        client = make_client(cfg)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": f"Task: {task_description}"},
            ],
            temperature=0.7,
            response_format={"type": "json_object"},
        )
        raw = json.loads(response.choices[0].message.content)
        gene = Gene.from_dict(raw)
        gene.id = "seed_base"
        for agent in gene.agents:
            agent.model = random.choice(allowed_models)
        return gene
    except Exception:
        return Gene(
            id="seed_base",
            topology=TopologyType.FIXED_PIPELINE,
            agents=[
                Agent(
                    id="main_agent",
                    role="agent",
                    model=random.choice(allowed_models),
                    system_prompt=(
                        f"You are an expert agent. Complete the following task accurately: "
                        f"{task_description[:400]}"
                    ),
                    temperature=0.7,
                )
            ],
            edges=[],
        )


def _apply_mutations(
    gene: Gene,
    n_mutations: int,
    allowed_models: list[str],
    provider_config: ProviderConfig | None,
    allow_structural: bool = True,
) -> Gene:
    """Apply up to n_mutations sequential random mutations, returning a new gene copy.

    Mutation weights when allow_structural=True:
        mutate_structure       35%  — topology swap / rewire / remove (cheap)
        mutate_inject_critique 25%  — insert critic after a random agent (cheap)
        mutate_compact         15%  — merge two adjacent agents (cheap)
        mutate_param           15%  — temperature jitter (cheap)
        mutate_expand           5%  — split agent into subtasks (LLM call)
        mutate_prompt           5%  — rewrite one agent's prompt (LLM call)

    When allow_structural=False, mutate_structure is excluded so topology
    variants created during seeding keep their assigned topology label.
    Each mutation failure is silently swallowed and the current gene state
    is preserved, guaranteeing the function always returns a valid gene.
    """
    if allow_structural:
        pool = (
            ["mutate_structure"] * 35
            + ["mutate_inject_critique"] * 25
            + ["mutate_compact"] * 15
            + ["mutate_param"] * 15
            + ["mutate_expand"] * 5
            + ["mutate_prompt"] * 5
        )
    else:
        pool = (
            ["mutate_inject_critique"] * 40
            + ["mutate_compact"] * 25
            + ["mutate_param"] * 25
            + ["mutate_expand"] * 5
            + ["mutate_prompt"] * 5
        )

    g = gene.copy()
    for _ in range(n_mutations):
        op = random.choice(pool)
        try:
            if op == "mutate_structure":
                g = mutate_structure(g, provider_config=provider_config, allowed_models=allowed_models)
            elif op == "mutate_inject_critique":
                g = mutate_inject_critique(g, allowed_models=allowed_models)
            elif op == "mutate_compact":
                g = mutate_compact(g)
            elif op == "mutate_param":
                g = mutate_param(g)
            elif op == "mutate_expand":
                g = mutate_expand(g, allowed_models=allowed_models, provider_config=provider_config)
            elif op == "mutate_prompt":
                g = mutate_prompt(g, provider_config=provider_config, allowed_models=allowed_models)
        except Exception:
            pass  # keep current state on failure
    return g


def seed_population(config: ExperimentConfig) -> list[Gene]:
    """Generate an initial diverse population for a GP run.

    Strategy:
    1. Obtain a task-specific base gene: use config.seed_gene if provided,
       otherwise generate one via LLM so all agents reflect the actual task.
    2. Cover all 6 topology types: for each topology that differs from the
       base, copy the base, force the topology, and apply 1 content mutation
       (structural mutations excluded here so the assigned topology is kept).
    3. Fill remaining slots with 1–3 chained random mutations of the base,
       drawn from the full operator set, for additional structural and
       prompt-level variety.
    """
    models = config.allowed_models if config.allowed_models else DEFAULT_CLOUD_MODELS
    population: list[Gene] = []

    # Step 1: base gene — task-specific or user-supplied.
    # Run split detection immediately so all agents have their subtask graphs
    # populated before any mutation (e.g. mutate_expand) fires during seeding.
    if config.seed_gene:
        base = Gene.from_dict(config.seed_gene)
        base.id = "seed_user"
    else:
        base = _generate_base_gene(config.task_description, config.provider, models)
    run_split_detection(base, provider_config=config.provider)
    population.append(base)

    # Step 2: one variant per remaining topology
    other_topologies = [t for t in TopologyType if t != base.topology]
    for i, topology in enumerate(other_topologies):
        if len(population) >= config.population_size:
            break
        g = base.copy()
        g.topology = topology
        g.topology_params = {}
        g.id = f"seed_topo_{i:02d}"
        g = _apply_mutations(
            g,
            n_mutations=1,
            allowed_models=models,
            provider_config=config.provider,
            allow_structural=False,
        )
        population.append(g)

    # Step 3: fill remaining slots with multi-step mutation variants
    while len(population) < config.population_size:
        n = random.randint(1, 3)
        g = _apply_mutations(
            base,
            n_mutations=n,
            allowed_models=models,
            provider_config=config.provider,
            allow_structural=True,
        )
        g.id = f"seed_{len(population):04d}"
        population.append(g)

    return population
