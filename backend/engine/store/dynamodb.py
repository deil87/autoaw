from __future__ import annotations
import json
import os
import boto3
from backend.shared.gene import Gene
from backend.shared.experiment import ExperimentConfig
from backend.engine.gp.loop import TrialResult


EXPERIMENTS_TABLE = os.environ.get("EXPERIMENTS_TABLE", "autoaw-experiments")
TRIALS_TABLE = os.environ.get("TRIALS_TABLE", "autoaw-trials")


class ExperimentStore:
    def __init__(self) -> None:
        self._dynamo = boto3.resource("dynamodb")
        self._experiments = self._dynamo.Table(EXPERIMENTS_TABLE)
        self._trials = self._dynamo.Table(TRIALS_TABLE)

    def get_experiment_config(self, experiment_id: str) -> ExperimentConfig:
        resp = self._experiments.get_item(Key={"pk": experiment_id, "sk": "config"})
        item = resp["Item"]
        return ExperimentConfig.from_dict(json.loads(item["config_json"]))

    def put_trial_result(self, experiment_id: str, result: TrialResult) -> None:
        self._trials.put_item(
            Item={
                "pk": experiment_id,
                "sk": f"trial#{result.gene.id}#{result.generation:06d}",
                "gene_id": result.gene.id,
                "generation": result.generation,
                "fitness": str(result.fitness),
                "quality": str(result.pareto.quality),
                "cost_usd": str(result.pareto.cost_usd),
                "latency_ms": result.pareto.latency_ms,
                "gene_json": json.dumps(result.gene.to_dict()),
            }
        )

    def put_best_gene(self, experiment_id: str, gene: Gene, fitness: float) -> None:
        self._experiments.update_item(
            Key={"pk": experiment_id, "sk": "config"},
            UpdateExpression="SET best_gene_id = :gid, best_fitness = :fit, #s = :status",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":gid": gene.id,
                ":fit": str(fitness),
                ":status": "completed",
            },
        )
