from __future__ import annotations
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor

from backend.shared.experiment import ExperimentConfig
from backend.engine.runner.raw_llm import RawLLMRunner
from backend.engine.evaluator.llm_judge import LLMJudgeEvaluator
from backend.engine.evaluator.function_eval import FunctionEvaluator
from backend.engine.gp.loop import GPLoop
from backend.engine.smbo.polish import smbo_polish
from backend.api.store import LocalStore

log = logging.getLogger(__name__)


def _build_evaluators(config: ExperimentConfig):
    evaluators = []
    for ev_config in config.evaluators:
        if ev_config.type == "llm_judge":
            evaluators.append(
                LLMJudgeEvaluator(
                    model=ev_config.params["model"],
                    rubric=ev_config.params["rubric"],
                )
            )
        elif ev_config.type == "function":
            import importlib

            module_path, fn_name = ev_config.params["fn_path"].rsplit(".", 1)
            mod = importlib.import_module(module_path)
            evaluators.append(FunctionEvaluator(fn=getattr(mod, fn_name)))
    return evaluators


def _run_experiment(
    experiment_id: str,
    store: LocalStore,
    datasets_dir: str,
) -> None:
    """Full experiment lifecycle: GP loop + SMBO polish. Runs in a worker thread."""
    try:
        store.update_experiment_status(experiment_id, "running")
        config = store.get_experiment_config(experiment_id)

        dataset_path = os.path.join(datasets_dir, f"{config.dataset_id}.json")
        with open(dataset_path) as f:
            dataset = json.load(f)

        evaluators = _build_evaluators(config)
        runner = RawLLMRunner()

        def on_trial(result):
            store.put_trial_result(experiment_id, result)
            log.info(
                "exp=%s gen=%d fitness=%.4f cost=$%.5f",
                experiment_id,
                result.generation,
                result.fitness,
                result.pareto.cost_usd,
            )

        loop = GPLoop(
            config=config,
            runner=runner,
            evaluators=evaluators,
            dataset=dataset,
            on_trial_complete=on_trial,
        )

        log.info("exp=%s: GP loop starting", experiment_id)
        best_gene = loop.run()
        log.info("exp=%s: GP loop complete, best=%s", experiment_id, best_gene.id)

        polished_gene = smbo_polish(
            gene=best_gene,
            config=config,
            runner=runner,
            evaluators=evaluators,
            dataset=dataset,
            n_trials=30,
        )
        log.info("exp=%s: SMBO complete, final=%s", experiment_id, polished_gene.id)

        store.put_best_gene(experiment_id, polished_gene, fitness=0.0)

    except Exception as exc:
        log.exception("exp=%s: failed with %s", experiment_id, exc)
        store.update_experiment_status(experiment_id, "failed", error=str(exc))


class ExperimentExecutor:
    """Manages concurrent experiment execution via a ThreadPoolExecutor."""

    def __init__(
        self,
        store: LocalStore,
        datasets_dir: str,
        max_workers: int = 4,
    ) -> None:
        self._store = store
        self._datasets_dir = datasets_dir
        self._pool = ThreadPoolExecutor(max_workers=max_workers)

    def submit(self, experiment_id: str) -> None:
        """Submit an experiment for async execution. Returns immediately."""
        self._pool.submit(
            _run_experiment, experiment_id, self._store, self._datasets_dir
        )

    def shutdown(self, wait: bool = False) -> None:
        self._pool.shutdown(wait=wait)
