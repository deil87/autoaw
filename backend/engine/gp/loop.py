from __future__ import annotations
import json
import random
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable
from deap import base, creator, tools, algorithms

from backend.shared.gene import Gene
from backend.shared.experiment import ExperimentConfig
from backend.shared.results import RunResult, Score, ParetoPoint, EvalRowResult
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

_PROGRESS_HEARTBEAT_ROWS = 10


@dataclass
class TrialResult:
    gene: Gene
    generation: int
    input: str
    run_result: RunResult
    scores: list[Score]
    pareto: ParetoPoint
    fitness: float
    parent_gene_ids: list[str] = field(default_factory=list)
    mutation_op: str = "seed"
    eval_rows: list[EvalRowResult] = field(default_factory=list)


@dataclass
class GPResult:
    best_gene: Gene
    stop_reason: str  # "converged" | "budget_trials" | "budget_usd" | "cancelled" | "max_generations" | "empty_generation"
    generations_run: int
    best_fitness: float


class GPLoop:
    def __init__(
        self,
        config: ExperimentConfig,
        runner: WorkflowRunner,
        evaluators: list[Evaluator],
        dataset: list[dict],  # list of {"input": str, "expected": str | None}
        on_trial_complete: Callable[[TrialResult], None] | None = None,
        on_progress: Callable[[dict], None] | None = None,
        stop_event: threading.Event | None = None,
    ) -> None:
        self.config = config
        self.runner = runner
        self.evaluators = evaluators
        self.dataset = dataset
        self.on_trial_complete = on_trial_complete
        self.on_progress = on_progress
        self._stop_event = stop_event or threading.Event()
        self._trial_count = 0
        self._total_cost = 0.0
        self._lock = threading.Lock()
        self._current_phase = "gp"

    def _evaluate_gene(
        self,
        gene: Gene,
        generation: int,
        parent_gene_ids: list[str] | None = None,
        mutation_op: str = "seed",
    ) -> tuple[float, ParetoPoint, list[EvalRowResult]]:
        """Evaluate a gene on ALL dataset rows. Thread-safe."""
        eval_rows: list[EvalRowResult] = []
        total_quality = 0.0
        total_cost = 0.0
        total_latency = 0
        last_scores: list[Score] = []

        for idx, sample in enumerate(self.dataset):
            run_result = self.runner.run(gene, sample["input"])

            with self._lock:
                self._trial_count += 1
                self._total_cost += run_result.cost_usd

            scores = [
                ev.score(sample["input"], run_result.output, sample.get("expected"))
                for ev in self.evaluators
            ]
            last_scores = scores
            avg_quality = (
                sum(s.quality for s in scores) / len(scores) if scores else 0.0
            )
            reasoning = scores[0].metadata.get("reason", "") if scores else ""

            eval_rows.append(
                EvalRowResult(
                    row_index=idx,
                    input_json=json.dumps(sample),
                    output_text=run_result.output,
                    score=avg_quality,
                    score_reasoning=reasoning,
                    latency_ms=run_result.latency_ms,
                    cost_usd=run_result.cost_usd,
                )
            )
            total_quality += avg_quality
            total_cost += run_result.cost_usd
            total_latency += run_result.latency_ms

            # Heartbeat every _PROGRESS_HEARTBEAT_ROWS rows
            rows_done = len(eval_rows)
            if self.on_progress and rows_done % _PROGRESS_HEARTBEAT_ROWS == 0:
                avg_ms = int(total_latency / rows_done) if rows_done else 0
                remaining = len(self.dataset) - rows_done
                eta_s = int(remaining * avg_ms / 1000) if avg_ms else 0
                self.on_progress(
                    {
                        "rows_done": rows_done,
                        "rows_total": len(self.dataset),
                        "generation": generation,
                        "phase": self._current_phase,
                        "avg_row_ms": avg_ms,
                        "eta_s": eta_s,
                    }
                )

            if self._budget_exceeded():
                break

        n = len(eval_rows) or 1
        avg_quality = total_quality / n
        max_cost = self.config.budget_max_usd or 1.0
        pareto = ParetoPoint(
            quality=avg_quality,
            cost_usd=total_cost / n,
            latency_ms=int(total_latency / n),
        )
        fitness = pareto.scalar_fitness(
            self.config.objective_weights,
            max_cost_usd=max_cost / max(self.config.budget_max_trials or 100, 1),
            max_latency_ms=30000,
        )

        first_run = RunResult(
            output=eval_rows[0].output_text if eval_rows else "",
            token_usage={},
            latency_ms=eval_rows[0].latency_ms if eval_rows else 0,
            cost_usd=eval_rows[0].cost_usd if eval_rows else 0.0,
        )

        if self.on_trial_complete:
            self.on_trial_complete(
                TrialResult(
                    gene=gene,
                    generation=generation,
                    input=self.dataset[0]["input"] if self.dataset else "",
                    run_result=first_run,
                    scores=last_scores,
                    pareto=pareto,
                    fitness=fitness,
                    parent_gene_ids=parent_gene_ids or [],
                    mutation_op=mutation_op,
                    eval_rows=eval_rows,
                )
            )
        return fitness, pareto, eval_rows

    def set_phase(self, phase: str) -> None:
        """Update the phase label emitted in progress heartbeats ('gp' or 'smbo')."""
        self._current_phase = phase

    def _budget_exceeded(self) -> bool:
        if self._stop_event.is_set():
            return True
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

    def _budget_stop_reason(self) -> str:
        """Return the specific budget-related stop reason."""
        if self._stop_event.is_set():
            return "cancelled"
        with self._lock:
            if (
                self.config.budget_max_trials
                and self._trial_count >= self.config.budget_max_trials
            ):
                return "budget_trials"
            if (
                self.config.budget_max_usd
                and self._total_cost >= self.config.budget_max_usd
            ):
                return "budget_usd"
        return "budget_trials"  # fallback

    def _evaluate_generation(
        self,
        population: list[tuple[Gene, list[str], str]],
        generation: int,
    ) -> list[tuple[Gene, float]]:
        """Evaluate all genes in a generation, up to config.concurrency in parallel."""
        concurrency = max(1, self.config.concurrency)
        scored: list[tuple[Gene, float]] = []

        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            future_to_gene = {
                executor.submit(
                    self._evaluate_gene, gene, generation, parent_ids, mut_op
                ): gene
                for gene, parent_ids, mut_op in population
                if not self._budget_exceeded()
            }
            for future in as_completed(future_to_gene):
                if self._budget_exceeded():
                    break
                fitness, _, _ = future.result()
                scored.append((future_to_gene[future], fitness))

        return scored

    def run(self) -> GPResult:
        """Run the GP loop and return a GPResult with the best gene and stop reason."""
        seed_genes = seed_population(self.config)
        # Wrap: (gene, parent_ids, mutation_op)
        population: list[tuple[Gene, list[str], str]] = [
            (g, [], "seed") for g in seed_genes
        ]
        best_gene = seed_genes[0]
        best_fitness = float("-inf")
        no_improvement = 0
        stop_reason = "max_generations"
        generation = 0

        for generation in range(1000):
            if self._stop_event.is_set():
                stop_reason = "cancelled"
                break
            if self._budget_exceeded():
                stop_reason = self._budget_stop_reason()
                break

            scored = self._evaluate_generation(population, generation)

            if not scored:
                stop_reason = (
                    self._budget_stop_reason()
                    if self._budget_exceeded()
                    else "empty_generation"
                )
                break

            for gene, fitness in scored:
                if fitness > best_fitness:
                    best_fitness = fitness
                    best_gene = gene
                    no_improvement = 0

            if no_improvement >= self.config.convergence_patience:
                stop_reason = "converged"
                break
            no_improvement += 1

            # Selection: keep top half
            scored.sort(key=lambda x: x[1], reverse=True)
            survivors = [g for g, _ in scored[: max(1, len(scored) // 2)]]

            # Reproduce: fill population back to size
            new_population: list[tuple[Gene, list[str], str]] = [
                (g, [], "survived") for g in survivors
            ]
            while len(new_population) < self.config.population_size:
                parent1 = random.choice(survivors)
                op = random.choice(
                    ["mutate_structure", "mutate_prompt", "mutate_param", "crossover"]
                )
                if op == "mutate_structure":
                    child = mutate_structure(
                        parent1,
                        provider_config=self.config.provider,
                        allowed_models=self.config.allowed_models,
                    )
                    new_population.append((child, [parent1.id], "mutate_structure"))
                elif op == "mutate_prompt":
                    try:
                        child = mutate_prompt(
                            parent1, provider_config=self.config.provider
                        )
                        new_population.append((child, [parent1.id], "mutate_prompt"))
                    except Exception:
                        child = mutate_param(parent1)
                        new_population.append((child, [parent1.id], "mutate_param"))
                elif op == "mutate_param":
                    child = mutate_param(parent1)
                    new_population.append((child, [parent1.id], "mutate_param"))
                elif op == "crossover" and len(survivors) > 1:
                    parent2 = random.choice(
                        [s for s in survivors if s is not parent1] or survivors
                    )
                    child1, _ = crossover_subgraph(parent1, parent2)
                    new_population.append(
                        (child1, [parent1.id, parent2.id], "crossover_subgraph")
                    )
                else:
                    child = mutate_param(parent1)
                    new_population.append((child, [parent1.id], "mutate_param"))

            population = new_population[: self.config.population_size]
        else:
            # for-loop exhausted all 1000 iterations without a break
            stop_reason = "max_generations"

        return GPResult(
            best_gene=best_gene,
            stop_reason=stop_reason,
            generations_run=generation + 1,
            best_fitness=best_fitness,
        )
