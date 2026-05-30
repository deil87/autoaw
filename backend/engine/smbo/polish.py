from __future__ import annotations
import random
import optuna

optuna.logging.set_verbosity(optuna.logging.WARNING)

from backend.shared.gene import Gene, AgentMetaType, TEMPERATURE_BOUNDS
from backend.shared.experiment import ExperimentConfig
from backend.engine.runner.base import WorkflowRunner
from backend.engine.evaluator.base import Evaluator


def smbo_polish(
    gene: Gene,
    config: ExperimentConfig,
    runner: WorkflowRunner,
    evaluators: list[Evaluator],
    dataset: list[dict],
    n_trials: int = 30,
) -> Gene:
    """Use Optuna TPE to fine-tune continuous params (temperatures, max_rounds) of the best gene.

    Topology and system prompts are frozen. Only numerical parameters are searched.
    Returns the best gene found by Optuna.
    """
    best_gene = gene.copy()
    best_fitness = float("-inf")

    def objective(trial: optuna.Trial) -> float:
        nonlocal best_gene, best_fitness
        candidate = gene.copy()

        # Tune temperature for each agent independently, within meta type bounds
        for agent in candidate.agents:
            lo, hi = TEMPERATURE_BOUNDS[agent.meta_type] if agent.meta_type is not None else (0.0, 1.0)
            if lo == hi:
                # Fixed temperature (e.g. critic) — pin it, nothing to optimise
                agent.temperature = lo
            else:
                agent.temperature = trial.suggest_float(
                    f"temp_{agent.id}", lo, hi, step=0.05
                )

        # Tune max_rounds if present in topology_params
        if "max_rounds" in candidate.topology_params:
            candidate.topology_params["max_rounds"] = trial.suggest_int(
                "max_rounds", 1, 10
            )

        sample = random.choice(dataset)
        run_result = runner.run(candidate, sample.get("input", ""))
        scores = [
            ev.score(sample.get("input", ""), run_result.output, sample.get("expected"))
            for ev in evaluators
        ]
        avg_quality = sum(s.quality for s in scores) / len(scores) if scores else 0.0
        max_cost = config.budget_max_usd or 1.0
        norm_cost = run_result.cost_usd / (max_cost / max(n_trials, 1))
        norm_latency = run_result.latency_ms / 30000
        w = config.objective_weights
        fitness = w.quality * avg_quality - w.cost * norm_cost - w.speed * norm_latency

        if fitness > best_fitness:
            best_fitness = fitness
            best_gene = candidate

        return fitness

    study = optuna.create_study(
        direction="maximize", sampler=optuna.samplers.TPESampler()
    )
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)
    return best_gene
