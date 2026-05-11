"""ECS Fargate entrypoint for the AutoAW optimization engine.

Reads EXPERIMENT_ID from environment, loads config from DynamoDB,
runs GP loop followed by SMBO polish, writes results back.
"""

from __future__ import annotations
import os
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


def main() -> None:
    experiment_id = os.environ["EXPERIMENT_ID"]
    log.info("Starting optimization for experiment %s", experiment_id)

    from backend.engine.store.dynamodb import ExperimentStore
    from backend.engine.runner.raw_llm import RawLLMRunner
    from backend.engine.evaluator.llm_judge import LLMJudgeEvaluator
    from backend.engine.evaluator.function_eval import FunctionEvaluator
    from backend.engine.gp.loop import GPLoop
    from backend.engine.smbo.polish import smbo_polish
    import boto3, json

    store = ExperimentStore()
    config = store.get_experiment_config(experiment_id)

    # Load dataset from S3
    s3 = boto3.client("s3")
    bucket = os.environ["DATASETS_BUCKET"]
    obj = s3.get_object(Bucket=bucket, Key=f"datasets/{config.dataset_id}.json")
    dataset = json.loads(obj["Body"].read())

    # Build evaluators
    evaluators = []
    for ev_config in config.evaluators:
        if ev_config.type == "llm_judge":
            evaluators.append(
                LLMJudgeEvaluator(
                    model=ev_config.params["model"],
                    rubric=ev_config.params["rubric"],
                    provider_config=config.provider,
                )
            )
        elif ev_config.type == "function":
            # Function evaluators are loaded via importable path in params["fn_path"]
            import importlib

            module_path, fn_name = ev_config.params["fn_path"].rsplit(".", 1)
            mod = importlib.import_module(module_path)
            evaluators.append(FunctionEvaluator(fn=getattr(mod, fn_name)))

    runner = RawLLMRunner(provider_config=config.provider)

    def on_trial(result):
        store.put_trial_result(experiment_id, result)
        log.info(
            "gen=%d trial=%s fitness=%.4f cost=$%.4f",
            result.generation,
            result.gene.id,
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

    log.info("Running GP loop...")
    best_gene = loop.run()
    log.info("GP converged. Best gene: %s", best_gene.id)

    log.info("Running SMBO polish...")
    polished_gene = smbo_polish(
        gene=best_gene,
        config=config,
        runner=runner,
        evaluators=evaluators,
        dataset=dataset,
        n_trials=30,
    )
    log.info("SMBO complete. Final gene: %s", polished_gene.id)

    store.put_best_gene(experiment_id, polished_gene, fitness=0.0)
    log.info("Done. Results written to DynamoDB.")


if __name__ == "__main__":
    main()
