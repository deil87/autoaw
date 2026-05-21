"""Fargate worker — runs a single GP experiment given by EXPERIMENT_ID env var."""
from __future__ import annotations

import logging
import os
import signal
import sys

from backend.api.dynamo_store import DynamoStore
from backend.api.executor import _build_runner, _build_evaluators
from backend.api.dataset_store import load_dataset
from backend.engine.gp.loop import GPLoop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

_experiment_id: str | None = None


def _handle_sigterm(sig: int, frame: object) -> None:
    """Fargate Spot sends SIGTERM ~2 min before reclaiming the task."""
    log.warning("SIGTERM received — marking experiment as failed")
    if _experiment_id:
        try:
            DynamoStore().update_experiment_status(
                _experiment_id, "failed", error="Task interrupted (Fargate Spot reclaim)"
            )
        except Exception:
            pass
    sys.exit(1)


signal.signal(signal.SIGTERM, _handle_sigterm)


def _process_job(experiment_id: str) -> None:
    store = DynamoStore()
    config = store.get_experiment_config(experiment_id)
    store.update_experiment_status(experiment_id, "running")
    log.info("Starting GP loop for experiment %s", experiment_id)

    if config.task_type == "generative":
        dataset = [{"index": i} for i in range(config.n_generations)]
    else:
        dataset = load_dataset(config.dataset_id)
        if config.dataset_sample_size is not None:
            dataset = dataset[: config.dataset_sample_size]

    runner = _build_runner(config)
    evaluators = _build_evaluators(config)

    loop = GPLoop(
        config=config,
        runner=runner,
        evaluators=evaluators,
        dataset=dataset,
        on_trial_complete=lambda result: store.put_trial_result(experiment_id, result),
        on_progress=lambda p: store.update_progress(experiment_id, p),
    )
    try:
        result = loop.run()
        store.put_best_gene(experiment_id, result.best_gene, result.best_fitness, result.stop_reason)
        store.update_experiment_status(experiment_id, "completed")
        log.info(
            "Experiment %s completed — fitness=%.4f reason=%s",
            experiment_id, result.best_fitness, result.stop_reason,
        )
    except Exception as exc:
        log.exception("GP loop failed for experiment %s", experiment_id)
        store.update_experiment_status(experiment_id, "failed", error=str(exc))
        raise


def main() -> None:
    global _experiment_id
    _experiment_id = os.environ.get("EXPERIMENT_ID")
    if not _experiment_id:
        log.error("EXPERIMENT_ID env var not set")
        sys.exit(1)
    log.info("Worker started for experiment %s", _experiment_id)
    _process_job(_experiment_id)
    log.info("Worker done")


if __name__ == "__main__":
    main()
