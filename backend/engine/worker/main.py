"""Fargate worker — polls SQS and runs GP experiments.

Handles SIGTERM gracefully so Fargate Spot interruptions finish the current
job before the 2-minute drain window expires.
"""
from __future__ import annotations

import json
import logging
import os
import signal
import sys

import boto3

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

QUEUE_URL: str = os.environ["JOB_QUEUE_URL"]
POLL_WAIT_SECONDS = 20  # SQS long-poll

_keep_running = True


def _handle_sigterm(sig: int, frame: object) -> None:
    """Fargate Spot sends SIGTERM ~2 min before termination."""
    global _keep_running
    log.warning("SIGTERM received — will stop after current job")
    _keep_running = False


signal.signal(signal.SIGTERM, _handle_sigterm)


def _process_job(experiment_id: str) -> None:
    store = DynamoStore()
    config = store.get_experiment_config(experiment_id)
    store.update_experiment_status(experiment_id, "running")
    log.info("Starting GP loop for experiment %s", experiment_id)

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
        on_trial_complete=lambda result: store.put_trial_result(
            experiment_id, result
        ),
        on_progress=lambda p: store.update_progress(experiment_id, p),
    )
    try:
        best_gene, best_fitness, stop_reason = loop.run()
        store.put_best_gene(experiment_id, best_gene, best_fitness, stop_reason)
        store.update_experiment_status(experiment_id, "completed")
        log.info(
            "Experiment %s completed — fitness=%.4f reason=%s",
            experiment_id,
            best_fitness,
            stop_reason,
        )
    except Exception as exc:
        log.exception("GP loop failed for experiment %s", experiment_id)
        store.update_experiment_status(experiment_id, "failed", error=str(exc))
        raise


def main() -> None:
    sqs = boto3.client("sqs")
    log.info("Worker started, polling queue: %s", QUEUE_URL)

    while _keep_running:
        resp = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=POLL_WAIT_SECONDS,
            AttributeNames=["ApproximateReceiveCount"],
        )
        messages = resp.get("Messages", [])
        if not messages:
            continue

        msg = messages[0]
        receipt = msg["ReceiptHandle"]
        try:
            body = json.loads(msg["Body"])
            experiment_id: str = body["experiment_id"]
            log.info("Received job: experiment_id=%s", experiment_id)
            _process_job(experiment_id)
            sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt)
        except Exception:
            log.exception("Job processing failed — message left for retry")

    log.info("Worker shutting down cleanly")


if __name__ == "__main__":
    main()
