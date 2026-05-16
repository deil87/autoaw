from __future__ import annotations
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor

from backend.shared.experiment import ExperimentConfig
from backend.engine.runner.base import WorkflowRunner
from backend.engine.evaluator.base import Evaluator

log = logging.getLogger(__name__)


def _build_runner(config: ExperimentConfig) -> WorkflowRunner:
    if config.runner_type == "workbench":
        from backend.engine.workbench.runner import WorkBenchRunner
        return WorkBenchRunner()
    from backend.engine.runner.raw_llm import RawLLMRunner
    return RawLLMRunner()


def _build_evaluators(config: ExperimentConfig) -> list[Evaluator]:
    # Legacy fallback: if evaluators list is empty, check evaluator_type
    if not config.evaluators and config.evaluator_type == "workbench":
        return [WorkBenchEvaluator()]

    evaluators = []
    for ev_config in config.evaluators:
        ev = _build_single_evaluator(ev_config)
        if ev is not None:
            evaluators.append(ev)

    # Fallback to WorkBench if we ended up with nothing and evaluator_type indicates workbench
    if not evaluators and config.evaluator_type == "workbench":
        from backend.engine.workbench.evaluator import WorkBenchEvaluator
        evaluators.append(WorkBenchEvaluator())

    return evaluators


def _build_single_evaluator(ev_config) -> Evaluator | None:
    t = ev_config.type
    p = ev_config.params

    if t == "llm_judge":
        from backend.engine.evaluator.llm_judge import LLMJudgeEvaluator

        return LLMJudgeEvaluator(
            model=p.get("model", "gpt-4o-mini"), rubric=p.get("rubric", "")
        )

    elif t == "workbench":
        from backend.engine.workbench.evaluator import WorkBenchEvaluator
        return WorkBenchEvaluator()

    elif t == "human":
        from backend.engine.evaluator.human_eval import HumanEvaluator

        return HumanEvaluator(table_name=p.get("table_name", "autoaw-human-eval"))

    elif t == "function":
        import importlib
        from backend.engine.evaluator.function_eval import FunctionEvaluator

        module_path, fn_name = p["fn_path"].rsplit(".", 1)
        mod = importlib.import_module(module_path)
        return FunctionEvaluator(fn=getattr(mod, fn_name))

    elif t == "deepeval_answer_relevancy":
        from backend.engine.evaluator.deepeval_eval import (
            DeepEvalAnswerRelevancyEvaluator,
        )

        return DeepEvalAnswerRelevancyEvaluator(
            model=p.get("model", "gpt-4o-mini"), threshold=p.get("threshold", 0.5)
        )

    elif t == "deepeval_faithfulness":
        from backend.engine.evaluator.deepeval_eval import DeepEvalFaithfulnessEvaluator

        return DeepEvalFaithfulnessEvaluator(
            model=p.get("model", "gpt-4o-mini"), threshold=p.get("threshold", 0.5)
        )

    elif t == "deepeval_hallucination":
        from backend.engine.evaluator.deepeval_eval import (
            DeepEvalHallucinationEvaluator,
        )

        return DeepEvalHallucinationEvaluator(
            model=p.get("model", "gpt-4o-mini"), threshold=p.get("threshold", 0.5)
        )

    elif t == "deepeval_tool_correctness":
        from backend.engine.evaluator.deepeval_eval import (
            DeepEvalToolCorrectnessEvaluator,
        )

        return DeepEvalToolCorrectnessEvaluator(threshold=p.get("threshold", 0.5))

    elif t == "deepeval_bias":
        from backend.engine.evaluator.deepeval_eval import DeepEvalBiasEvaluator

        return DeepEvalBiasEvaluator(
            model=p.get("model", "gpt-4o-mini"), threshold=p.get("threshold", 0.5)
        )

    elif t == "ragas_faithfulness":
        from backend.engine.evaluator.ragas_eval import RagasFaithfulnessEvaluator

        return RagasFaithfulnessEvaluator(model=p.get("model", "gpt-4o-mini"))

    elif t == "ragas_answer_relevancy":
        from backend.engine.evaluator.ragas_eval import RagasAnswerRelevancyEvaluator

        return RagasAnswerRelevancyEvaluator(model=p.get("model", "gpt-4o-mini"))

    elif t == "ragas_answer_correctness":
        from backend.engine.evaluator.ragas_eval import RagasAnswerCorrectnessEvaluator

        return RagasAnswerCorrectnessEvaluator(model=p.get("model", "gpt-4o-mini"))

    else:
        log.warning("Unknown evaluator type %r — skipping", t)
        return None


def _run_experiment(
    experiment_id: str,
    store,
    datasets_dir: str,
    stop_event: threading.Event,
) -> None:
    """Full experiment lifecycle: GP loop + SMBO polish. Runs in a worker thread."""
    try:
        store.update_experiment_status(experiment_id, "running")
        config = store.get_experiment_config(experiment_id)

        dataset_path = os.path.join(datasets_dir, f"{config.dataset_id}.json")
        with open(dataset_path) as f:
            dataset = json.load(f)

        if config.dataset_sample_size is not None:
            dataset = dataset[: config.dataset_sample_size]

        runner = _build_runner(config)
        evaluators = _build_evaluators(config)

        def on_trial(result):
            store.put_trial_result(experiment_id, result)
            log.info(
                "exp=%s gen=%d fitness=%.4f cost=$%.5f",
                experiment_id,
                result.generation,
                result.fitness,
                result.pareto.cost_usd,
            )

        def on_progress(progress: dict) -> None:
            store.update_progress(experiment_id, progress)

        from backend.engine.gp.loop import GPLoop
        loop = GPLoop(
            config=config,
            runner=runner,
            evaluators=evaluators,
            dataset=dataset,
            on_trial_complete=on_trial,
            on_progress=on_progress,
            stop_event=stop_event,
        )

        log.info("exp=%s: GP loop starting", experiment_id)
        gp_result = loop.run()
        log.info(
            "exp=%s: GP loop complete, best=%s stop_reason=%s fitness=%.4f",
            experiment_id,
            gp_result.best_gene.id,
            gp_result.stop_reason,
            gp_result.best_fitness,
        )

        if stop_event.is_set():
            log.info(
                "exp=%s: stop requested, skipping SMBO and marking cancelled",
                experiment_id,
            )
            store.update_experiment_status(experiment_id, "cancelled")
            store.update_progress(experiment_id, {})
            return

        # Transition to SMBO phase
        loop.set_phase("smbo")
        store.update_progress(
            experiment_id,
            {
                "rows_done": 0,
                "rows_total": len(dataset),
                "generation": 0,
                "phase": "smbo",
                "avg_row_ms": 0,
                "eta_s": 0,
            },
        )

        if config.smbo_model:
            for agent in gp_result.best_gene.agents:
                agent.model = config.smbo_model
            log.info("exp=%s: upgraded agent models to %s for SMBO", experiment_id, config.smbo_model)

        from backend.engine.smbo.polish import smbo_polish
        polished_gene = smbo_polish(
            gene=gp_result.best_gene,
            config=config,
            runner=runner,
            evaluators=evaluators,
            dataset=dataset,
            n_trials=30,
        )
        log.info("exp=%s: SMBO complete, final=%s", experiment_id, polished_gene.id)

        store.put_best_gene(
            experiment_id,
            polished_gene,
            fitness=gp_result.best_fitness,
            stop_reason=gp_result.stop_reason,
        )
        store.update_progress(experiment_id, {})

    except Exception as exc:
        log.exception("exp=%s: failed with %s", experiment_id, exc)
        store.update_experiment_status(experiment_id, "failed", error=str(exc))
        try:
            store.update_progress(experiment_id, {})
        except Exception:
            pass


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
        self._stop_events: dict[str, threading.Event] = {}
        self._events_lock = threading.Lock()

    def submit(self, experiment_id: str) -> None:
        """Submit an experiment for async execution. Returns immediately."""
        stop_event = threading.Event()
        with self._events_lock:
            self._stop_events[experiment_id] = stop_event
        self._pool.submit(
            _run_experiment, experiment_id, self._store, self._datasets_dir, stop_event
        )

    def stop(self, experiment_id: str) -> None:
        """Signal a running experiment to stop after the current generation."""
        with self._events_lock:
            event = self._stop_events.get(experiment_id)
        if event:
            event.set()
            log.info("exp=%s: stop signal sent", experiment_id)

    def shutdown(self, wait: bool = False) -> None:
        self._pool.shutdown(wait=wait)
