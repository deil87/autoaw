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
    """Generate a single-agent base gene whose system_prompt is tailored to the task.

    The base gene intentionally has ONE agent handling the full task.
    Decomposition into multiple agents is the job of mutations (mutate_expand,
    mutate_inject_critique, etc.) — not seeding. run_split_detection will
    populate the agent's subtask graph so those mutations have material to
    work with when they fire during population creation.

    Falls back to a minimal generic agent on any LLM error.
    """
    cfg = provider_config or provider_from_env()
    system = (
        "You are a prompt engineer.\n"
        "Write a single-agent system prompt that instructs one LLM agent to "
        "solve the given task end-to-end. The prompt must:\n"
        "- Be specific to the task domain — no generic 'researcher' or 'writer' framing.\n"
        "- Describe WHAT the agent must do step-by-step to complete the task.\n"
        "- Be written in second person ('You are...') and be self-contained.\n"
        "Return ONLY a JSON object (no markdown fences):\n"
        '{"id": "task_solver", "role": "task_solver", "system_prompt": "<prompt>"}'
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
        agent_id = raw.get("id", "task_solver")
        return Gene(
            id="seed_base",
            topology=TopologyType.FIXED_PIPELINE,
            agents=[
                Agent(
                    id=agent_id,
                    role=raw.get("role", agent_id),
                    model=random.choice(allowed_models),
                    system_prompt=raw["system_prompt"],
                    temperature=0.7,
                )
            ],
            edges=[],
        )
    except Exception:
        return Gene(
            id="seed_base",
            topology=TopologyType.FIXED_PIPELINE,
            agents=[
                Agent(
                    id="task_solver",
                    role="task_solver",
                    model=random.choice(allowed_models),
                    system_prompt=(
                        f"Complete the following task accurately and thoroughly: "
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
