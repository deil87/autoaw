"""DynamoDB-backed store — same interface as LocalStore."""
from __future__ import annotations

import json
import math
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from backend.shared.experiment import ExperimentConfig
from backend.shared.gene import Gene
from backend.engine.gp.loop import TrialResult


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_dynamo(obj: Any) -> Any:
    """Recursively convert float → Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return Decimal("0")
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_dynamo(i) for i in obj]
    return obj


def _from_dynamo(obj: Any) -> Any:
    """Recursively convert Decimal → float for Python consumption."""
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: _from_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_from_dynamo(i) for i in obj]
    return obj


class DynamoStore:
    """DynamoDB-backed store. Thread-safe (boto3 resource is thread-safe)."""

    def __init__(self) -> None:
        self._dynamo = boto3.resource("dynamodb")
        self._experiments = self._dynamo.Table(
            os.environ["EXPERIMENTS_TABLE"]
        )
        self._trials = self._dynamo.Table(os.environ["TRIALS_TABLE"])
        self._eval_rows = self._dynamo.Table(os.environ["EVAL_ROWS_TABLE"])

    def init_db(self) -> None:
        """No-op — tables are pre-created by CDK."""

    # ── Experiment CRUD ──────────────────────────────────────────────────────

    def create_experiment(
        self, experiment_id: str, config: ExperimentConfig
    ) -> None:
        now = _now()
        self._experiments.put_item(
            Item=_to_dynamo(
                {
                    "id": experiment_id,
                    "name": config.name,
                    "config_json": json.dumps(config.to_dict()),
                    "status": "pending",
                    "created_at": now,
                    "updated_at": now,
                    "best_gene_json": None,
                    "best_fitness": None,
                    "stop_reason": None,
                    "error_message": None,
                    "progress_json": None,
                }
            )
        )

    def get_experiment(self, experiment_id: str) -> dict[str, Any]:
        resp = self._experiments.get_item(Key={"id": experiment_id})
        item = resp.get("Item")
        if item is None:
            raise KeyError(f"Experiment {experiment_id!r} not found")
        result = _from_dynamo(item)
        raw = result.get("progress_json")
        result["progress"] = json.loads(raw) if raw else None
        bf = result.get("best_fitness")
        if bf is not None and not math.isfinite(bf):
            result["best_fitness"] = None
        return result

    def list_experiments(self) -> list[dict[str, Any]]:
        resp = self._experiments.scan(
            ProjectionExpression="id, #n, #s, created_at, updated_at, best_fitness",
            ExpressionAttributeNames={"#n": "name", "#s": "status"},
        )
        results = []
        for item in resp.get("Items", []):
            row = _from_dynamo(item)
            bf = row.get("best_fitness")
            if bf is not None and not math.isfinite(bf):
                row["best_fitness"] = None
            results.append(row)
        results.sort(key=lambda r: r.get("created_at", ""), reverse=True)
        return results

    def update_experiment_status(
        self, experiment_id: str, status: str, error: str | None = None
    ) -> None:
        self._experiments.update_item(
            Key={"id": experiment_id},
            UpdateExpression="SET #s = :s, error_message = :e, updated_at = :u",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":s": status,
                ":e": error,
                ":u": _now(),
            },
        )

    def update_progress(self, experiment_id: str, progress: dict) -> None:
        resp = self._experiments.update_item(
            Key={"id": experiment_id},
            UpdateExpression="SET progress_json = :p, updated_at = :u",
            ExpressionAttributeValues={
                ":p": json.dumps(progress),
                ":u": _now(),
            },
            ConditionExpression="attribute_exists(id)",
            ReturnValues="NONE",
        )

    def get_experiment_config(self, experiment_id: str) -> ExperimentConfig:
        row = self.get_experiment(experiment_id)
        return ExperimentConfig.from_dict(json.loads(row["config_json"]))

    def put_best_gene(
        self,
        experiment_id: str,
        gene: Gene,
        fitness: float,
        stop_reason: str = "completed",
    ) -> None:
        self._experiments.update_item(
            Key={"id": experiment_id},
            UpdateExpression=(
                "SET best_gene_json = :g, best_fitness = :f, "
                "#s = :s, stop_reason = :r, updated_at = :u"
            ),
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues=_to_dynamo(
                {
                    ":g": json.dumps(gene.to_dict()),
                    ":f": fitness,
                    ":s": "completed",
                    ":r": stop_reason,
                    ":u": _now(),
                }
            ),
        )

    # ── Trials ───────────────────────────────────────────────────────────────

    def put_trial_result(self, experiment_id: str, result: TrialResult) -> None:
        trial_id = str(uuid.uuid4())
        now = _now()

        trial_item = _to_dynamo(
            {
                "id": trial_id,
                "experiment_id": experiment_id,
                "generation": result.generation,
                "gene_id": result.gene.id,
                "gene_json": json.dumps(result.gene.to_dict()),
                "fitness": result.fitness,
                "quality": result.pareto.quality,
                "cost_usd": result.pareto.cost_usd,
                "latency_ms": result.pareto.latency_ms,
                "created_at": now,
                "parent_gene_ids": json.dumps(result.parent_gene_ids),
                "mutation_op": result.mutation_op,
            }
        )
        self._trials.put_item(Item=trial_item)

        with self._eval_rows.batch_writer() as batch:
            for row in result.eval_rows:
                batch.put_item(
                    Item=_to_dynamo(
                        {
                            "id": str(uuid.uuid4()),
                            "trial_id": trial_id,
                            "row_index": row.row_index,
                            "input_json": row.input_json,
                            "output_text": row.output_text,
                            "score": row.score,
                            "score_reasoning": row.score_reasoning,
                            "latency_ms": row.latency_ms,
                            "cost_usd": row.cost_usd,
                        }
                    )
                )

    def get_trial(
        self, experiment_id: str, trial_id: str
    ) -> dict[str, Any] | None:
        resp = self._trials.get_item(Key={"id": trial_id})
        item = resp.get("Item")
        if item is None:
            return None
        row = _from_dynamo(item)
        if row.get("experiment_id") != experiment_id:
            return None
        return row

    def list_trials(
        self, experiment_id: str, page: int = 1, limit: int = 50
    ) -> list[dict[str, Any]]:
        # Collect all trial IDs via GSI, then paginate in Python.
        # DynamoDB Limit + ExclusiveStartKey works on the GSI scan order
        # (sort key = created_at ASC), which matches the SQLite ORDER BY.
        kwargs: dict[str, Any] = dict(
            IndexName="experiment-id-index",
            KeyConditionExpression=Key("experiment_id").eq(experiment_id),
            ScanIndexForward=True,
        )
        items: list[dict] = []
        while True:
            resp = self._trials.query(**kwargs)
            items.extend(resp.get("Items", []))
            last = resp.get("LastEvaluatedKey")
            if not last:
                break
            kwargs["ExclusiveStartKey"] = last

        # Python-level pagination
        offset = (page - 1) * limit
        page_items = items[offset : offset + limit]
        return [_from_dynamo(i) for i in page_items]

    def get_eval_rows(self, trial_id: str) -> list[dict[str, Any]]:
        kwargs: dict[str, Any] = dict(
            IndexName="trial-id-index",
            KeyConditionExpression=Key("trial_id").eq(trial_id),
        )
        items: list[dict] = []
        while True:
            resp = self._eval_rows.query(**kwargs)
            items.extend(resp.get("Items", []))
            last = resp.get("LastEvaluatedKey")
            if not last:
                break
            kwargs["ExclusiveStartKey"] = last

        rows = [_from_dynamo(i) for i in items]
        rows.sort(key=lambda r: r.get("row_index", 0))
        return rows

    def list_trials_lineage(self, experiment_id: str) -> list[dict[str, Any]]:
        kwargs: dict[str, Any] = dict(
            IndexName="experiment-id-index",
            KeyConditionExpression=Key("experiment_id").eq(experiment_id),
            ProjectionExpression=(
                "id, gene_id, generation, fitness, quality, "
                "cost_usd, latency_ms, parent_gene_ids, mutation_op, created_at"
            ),
            ScanIndexForward=True,
        )
        items: list[dict] = []
        while True:
            resp = self._trials.query(**kwargs)
            items.extend(resp.get("Items", []))
            last = resp.get("LastEvaluatedKey")
            if not last:
                break
            kwargs["ExclusiveStartKey"] = last

        rows = [_from_dynamo(i) for i in items]
        rows.sort(key=lambda r: (r.get("generation", 0), r.get("created_at", "")))
        return rows
