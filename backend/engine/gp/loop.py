from __future__ import annotations
import random
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Callable
from deap import base, creator, tools, algorithms

from backend.shared.gene import Gene
from backend.shared.experiment import ExperimentConfig
from backend.shared.results import RunResult, Score, ParetoPoint
from backend.engine.runner.base import WorkflowRunner
from backend.engine.evaluator.base import Evaluator
from backend.engine.gp.operators import (
    mutate_structure,
    mutate_prompt,
    mutate_param,
    crossover_subgraph,
)
from backend.engine.gp.population import seed_population
from backend.engine.gp.diversity import topology_diversity_score


@dataclass
class TrialResult:
    gene: Gene
    generation: int
    input: str
    run_result: RunResult
    scores: list[Score]
    pareto: ParetoPoint
    fitness: float


class GPLoop:
    def __init__(
        self,
        config: ExperimentConfig,
        runner: WorkflowRunner,
        evaluators: list[Evaluator],
        dataset: list[dict],  # list of {"input": str, "expected": str | None}
        on_trial_complete: Callable[[TrialResult], None] | None = None,
    ) -> None:
        self.config = config
        self.runner = runner
        self.evaluators = evaluators
        self.dataset = dataset
        self.on_trial_complete = on_trial_complete
        self._trial_count = 0
        self._total_cost = 0.0
        self._lock = threading.Lock()

    def _evaluate_gene(self, gene: Gene, generation: int) -> tuple[float, ParetoPoint]:
        """Evaluate a gene on a random sample from the dataset. Thread-safe."""
        sample = random.choice(self.dataset)
        run_result = self.runner.run(gene, sample["input"])

        with self._lock:
            self._trial_count += 1
            self._total_cost += run_result.cost_usd

        scores = [
            ev.score(sample["input"], run_result.output, sample.get("expected"))
            for ev in self.evaluators
        ]
        avg_quality = sum(s.quality for s in scores) / len(scores) if scores else 0.0

        max_cost = self.config.budget_max_usd or 1.0
        pareto = ParetoPoint(
            quality=avg_quality,
            cost_usd=run_result.cost_usd,
            latency_ms=run_result.latency_ms,
        )
        fitness = pareto.scalar_fitness(
            self.config.objective_weights,
            max_cost_usd=max_cost / max(self.config.budget_max_trials or 100, 1),
            max_latency_ms=30000,
        )

        if self.on_trial_complete:
            self.on_trial_complete(
                TrialResult(
                    gene=gene,
                    generation=generation,
                    input=sample["input"],
                    run_result=run_result,
                    scores=scores,
                    pareto=pareto,
                    fitness=fitness,
                )
            )
        return fitness, pareto

    def _budget_exceeded(self) -> bool:
        with self._lock:
            if (
                self.config.budget_max_trials
                and self._trial_count >= self.config.budget_max_trials
            ):
                return True
            if (
                self.config.budget_max_usd
                and self._total_cost >= self.config.budget_max_usd
            ):
                return True
        return False

    def _evaluate_generation(
        self, population: list[Gene], generation: int
    ) -> list[tuple[Gene, float]]:
        """Evaluate all genes in a generation, up to config.concurrency in parallel."""
        concurrency = max(1, self.config.concurrency)
        scored: list[tuple[Gene, float]] = []

        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            future_to_gene = {
                executor.submit(self._evaluate_gene, gene, generation): gene
                for gene in population
                if not self._budget_exceeded()
            }
            for future in as_completed(future_to_gene):
                if self._budget_exceeded():
                    break
                fitness, _ = future.result()
                scored.append((future_to_gene[future], fitness))

        return scored

    def run(self) -> Gene:
        """Run the GP loop and return the best gene found."""
        population = seed_population(self.config)
        best_gene = population[0]
        best_fitness = float("-inf")
        no_improvement = 0

        for generation in range(1000):
            if self._budget_exceeded():
                break

            scored = self._evaluate_generation(population, generation)

            if not scored:
                break

            for gene, fitness in scored:
                if fitness > best_fitness:
                    best_fitness = fitness
                    best_gene = gene
                    no_improvement = 0

            if no_improvement >= self.config.convergence_patience:
                break
            no_improvement += 1

            # Selection: keep top half
            scored.sort(key=lambda x: x[1], reverse=True)
            survivors = [g for g, _ in scored[: max(1, len(scored) // 2)]]

            # Reproduce: fill population back to size
            new_population = list(survivors)
            while len(new_population) < self.config.population_size:
                parent1 = random.choice(survivors)
                op = random.choice(
                    ["mutate_structure", "mutate_prompt", "mutate_param", "crossover"]
                )
                if op == "mutate_structure":
                    new_population.append(
                        mutate_structure(
                            parent1,
                            provider_config=self.config.provider,
                            allowed_models=self.config.allowed_models,
                        )
                    )
                elif op == "mutate_prompt":
                    try:
                        new_population.append(
                            mutate_prompt(parent1, provider_config=self.config.provider)
                        )
                    except Exception:
                        new_population.append(mutate_param(parent1))
                elif op == "mutate_param":
                    new_population.append(mutate_param(parent1))
                elif op == "crossover" and len(survivors) > 1:
                    parent2 = random.choice(
                        [s for s in survivors if s is not parent1] or survivors
                    )
                    child1, _ = crossover_subgraph(parent1, parent2)
                    new_population.append(child1)
                else:
                    new_population.append(mutate_param(parent1))

            population = new_population[: self.config.population_size]

        return best_gene
