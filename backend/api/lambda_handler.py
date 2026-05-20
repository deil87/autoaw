"""
Thin AWS Lambda handler — replaces FastAPI + Mangum.
Only stdlib + boto3 (pre-installed in the Lambda Python 3.12 runtime).
"""
from __future__ import annotations

import base64
import json
import math
import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

# ── AWS clients (reused across warm invocations) ──────────────────────────────
_dynamo      = boto3.resource("dynamodb")
_sqs_client  = boto3.client("sqs")
_s3_client   = boto3.client("s3")

_experiments = _dynamo.Table(os.environ["EXPERIMENTS_TABLE"])
_trials      = _dynamo.Table(os.environ["TRIALS_TABLE"])
_eval_rows   = _dynamo.Table(os.environ["EVAL_ROWS_TABLE"])

_DATASETS_BUCKET = os.environ["DATASETS_BUCKET"]
_JOB_QUEUE_URL   = os.environ["JOB_QUEUE_URL"]

# ── DynamoDB helpers ──────────────────────────────────────────────────────────

def _to_dynamo(obj: Any) -> Any:
    if isinstance(obj, float):
        return Decimal("0") if (math.isnan(obj) or math.isinf(obj)) else Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_dynamo(i) for i in obj]
    return obj

def _from_dynamo(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: _from_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_from_dynamo(i) for i in obj]
    return obj

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

# ── Experiment ops ────────────────────────────────────────────────────────────

def _get_exp(exp_id: str) -> dict:
    item = _experiments.get_item(Key={"id": exp_id}).get("Item")
    if item is None:
        raise KeyError(exp_id)
    row = _from_dynamo(item)
    raw = row.get("progress_json")
    row["progress"] = json.loads(raw) if raw else None
    bf = row.get("best_fitness")
    if bf is not None and not math.isfinite(bf):
        row["best_fitness"] = None
    return row

# ── Route handlers ────────────────────────────────────────────────────────────

def _list_experiments() -> tuple[Any, int]:
    items = []
    kwargs: dict = dict(
        ProjectionExpression="id, #n, #s, created_at, updated_at, best_fitness, progress_json",
        ExpressionAttributeNames={"#n": "name", "#s": "status"},
    )
    while True:
        resp = _experiments.scan(**kwargs)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last

    results = []
    for item in items:
        row = _from_dynamo(item)
        bf = row.get("best_fitness")
        if bf is not None and not math.isfinite(bf):
            row["best_fitness"] = None
        raw = row.pop("progress_json", None)
        row["progress"] = json.loads(raw) if raw else None
        results.append(row)
    results.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return results, 200


def _get_experiment(exp_id: str) -> tuple[Any, int]:
    try:
        return _get_exp(exp_id), 200
    except KeyError:
        return {"detail": f"Experiment {exp_id!r} not found"}, 404


def _create_experiment(body: dict) -> tuple[Any, int]:
    exp_id = f"exp_{uuid.uuid4().hex[:12]}"
    now = _now()
    config = {
        "name": body["name"],
        "task_description": body["task_description"],
        "dataset_id": body["dataset_id"],
        "evaluators": body.get("evaluators", []),
        "objective_weights": body.get("objective_weights", {"quality": 0.7, "cost": 0.2, "speed": 0.1}),
        "population_size": body.get("population_size", 20),
        "budget_max_trials": body.get("budget_max_trials"),
        "budget_max_usd": body.get("budget_max_usd"),
        "convergence_patience": body.get("convergence_patience", 10),
        "concurrency": body.get("concurrency", 5),
        "runner_type": body.get("runner_type", "raw_llm"),
        "dataset_sample_size": body.get("dataset_sample_size"),
    }
    _experiments.put_item(Item=_to_dynamo({
        "id": exp_id,
        "name": body["name"],
        "config_json": json.dumps(config),
        "status": "pending",
        "created_at": now,
        "updated_at": now,
        "best_gene_json": None,
        "best_fitness": None,
        "stop_reason": None,
        "error_message": None,
        "progress_json": None,
    }))
    return _get_exp(exp_id), 201


def _start_experiment(exp_id: str) -> tuple[Any, int]:
    try:
        _get_exp(exp_id)
    except KeyError:
        return {"detail": f"Experiment {exp_id!r} not found"}, 404
    _sqs_client.send_message(
        QueueUrl=_JOB_QUEUE_URL,
        MessageBody=json.dumps({"experiment_id": exp_id}),
    )
    _experiments.update_item(
        Key={"id": exp_id},
        UpdateExpression="SET #s = :s, updated_at = :u",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "pending", ":u": _now()},
    )
    return {"status": "submitted", "experiment_id": exp_id}, 200


def _stop_experiment(exp_id: str) -> tuple[Any, int]:
    try:
        _get_exp(exp_id)
    except KeyError:
        return {"detail": f"Experiment {exp_id!r} not found"}, 404
    _experiments.update_item(
        Key={"id": exp_id},
        UpdateExpression="SET #s = :s, updated_at = :u",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "cancelled", ":u": _now()},
    )
    return {"status": "stopping", "experiment_id": exp_id}, 200


def _delete_experiment(exp_id: str) -> tuple[Any, int]:
    try:
        _get_exp(exp_id)
    except KeyError:
        return {"detail": f"Experiment {exp_id!r} not found"}, 404
    _experiments.update_item(
        Key={"id": exp_id},
        UpdateExpression="SET #s = :s, updated_at = :u",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "cancelled", ":u": _now()},
    )
    return None, 204


def _list_trials(exp_id: str, page: int, limit: int) -> tuple[Any, int]:
    try:
        _get_exp(exp_id)
    except KeyError:
        return {"detail": f"Experiment {exp_id!r} not found"}, 404
    kwargs: dict = dict(
        IndexName="experiment-id-index",
        KeyConditionExpression=Key("experiment_id").eq(exp_id),
        ScanIndexForward=True,
    )
    items: list = []
    while True:
        resp = _trials.query(**kwargs)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    offset = (page - 1) * limit
    return [_from_dynamo(i) for i in items[offset: offset + limit]], 200


def _get_trial(exp_id: str, trial_id: str) -> tuple[Any, int]:
    try:
        _get_exp(exp_id)
    except KeyError:
        return {"detail": f"Experiment {exp_id!r} not found"}, 404
    item = _trials.get_item(Key={"id": trial_id}).get("Item")
    if item is None or _from_dynamo(item).get("experiment_id") != exp_id:
        return {"detail": f"Trial {trial_id!r} not found"}, 404
    return _from_dynamo(item), 200


def _get_eval_rows(exp_id: str, trial_id: str) -> tuple[Any, int]:
    try:
        _get_exp(exp_id)
    except KeyError:
        return {"detail": f"Experiment {exp_id!r} not found"}, 404
    if not _trials.get_item(Key={"id": trial_id}).get("Item"):
        return {"detail": f"Trial {trial_id!r} not found"}, 404
    kwargs: dict = dict(
        IndexName="trial-id-index",
        KeyConditionExpression=Key("trial_id").eq(trial_id),
    )
    items: list = []
    while True:
        resp = _eval_rows.query(**kwargs)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    rows = [_from_dynamo(i) for i in items]
    rows.sort(key=lambda r: r.get("row_index", 0))
    return rows, 200


def _get_lineage(exp_id: str) -> tuple[Any, int]:
    try:
        _get_exp(exp_id)
    except KeyError:
        return {"detail": f"Experiment {exp_id!r} not found"}, 404
    kwargs: dict = dict(
        IndexName="experiment-id-index",
        KeyConditionExpression=Key("experiment_id").eq(exp_id),
        ProjectionExpression=(
            "id, gene_id, generation, fitness, quality, "
            "cost_usd, latency_ms, parent_gene_ids, mutation_op, created_at"
        ),
        ScanIndexForward=True,
    )
    items: list = []
    while True:
        resp = _trials.query(**kwargs)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    rows = [_from_dynamo(i) for i in items]
    rows.sort(key=lambda r: (r.get("generation", 0), r.get("created_at", "")))
    for t in rows:
        t["parent_gene_ids"] = json.loads(t.get("parent_gene_ids") or "[]")
    return rows, 200


# ── Dataset ops ───────────────────────────────────────────────────────────────

def _list_datasets() -> tuple[Any, int]:
    ids: list[str] = []
    paginator = _s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=_DATASETS_BUCKET):
        for obj in page.get("Contents", []):
            key: str = obj["Key"]
            if key.endswith(".json"):
                ids.append(key[: -len(".json")])
    return [{"dataset_id": did} for did in sorted(ids)], 200


def _get_dataset(dataset_id: str) -> tuple[Any, int]:
    try:
        resp = _s3_client.get_object(Bucket=_DATASETS_BUCKET, Key=f"{dataset_id}.json")
        return json.loads(resp["Body"].read()), 200
    except _s3_client.exceptions.NoSuchKey:
        return {"detail": f"Dataset {dataset_id!r} not found"}, 404


def _upload_dataset(event: dict) -> tuple[Any, int]:
    import email as _email
    headers = event.get("headers") or {}
    content_type = headers.get("content-type") or headers.get("Content-Type") or ""
    raw_body = event.get("body") or ""
    raw = base64.b64decode(raw_body) if event.get("isBase64Encoded") else raw_body.encode()

    msg = _email.message_from_bytes(
        f"Content-Type: {content_type}\r\n\r\n".encode() + raw
    )
    filename = content = None
    for part in msg.walk():
        cd = part.get("Content-Disposition", "")
        if "filename" in cd:
            m = re.search(r'filename="?([^";\r\n]+)"?', cd)
            filename = m.group(1).strip() if m else "upload.json"
            content = part.get_payload(decode=True)
            break

    if content is None:
        return {"detail": "No file in request"}, 422
    try:
        parsed = json.loads(content)
        if not isinstance(parsed, list):
            return {"detail": "Dataset must be a JSON array"}, 422
    except json.JSONDecodeError as exc:
        return {"detail": f"Invalid JSON: {exc}"}, 422

    dataset_id = os.path.splitext(filename)[0]
    _s3_client.put_object(
        Bucket=_DATASETS_BUCKET,
        Key=f"{dataset_id}.json",
        Body=content,
        ContentType="application/json",
    )
    return {"dataset_id": dataset_id, "records": len(parsed)}, 201


# ── Static data ───────────────────────────────────────────────────────────────

_BENCHMARKS = [
    {
        "id": "workbench",
        "name": "WorkBench",
        "description": "690 workplace tasks (calendar, email, database, files). Evaluated by tool-call trace matching.",
        "paper_url": "https://arxiv.org/abs/2405.00823",
        "dataset_id": "workbench",
        "runner_type": "workbench",
        "evaluators": [{"type": "workbench", "params": {}}],
        "default_objective": {"quality_weight": 0.7, "cost_weight": 0.2, "speed_weight": 0.1},
        "task_count": 690,
    },
    {
        "id": "swe-bench",
        "name": "SWE-bench",
        "description": "GitHub issue resolution across real Python repos. Evaluated by LLM patch-quality judge.",
        "paper_url": "https://www.swebench.com",
        "dataset_id": "swebench",
        "runner_type": "swebench",
        "evaluators": [{"type": "swebench", "params": {"model": "gpt-4o-mini"}}],
        "default_objective": {"quality_weight": 0.6, "cost_weight": 0.2, "speed_weight": 0.2},
        "task_count": 300,
    },
]

_MODEL_OPTIONS = ["gpt-4o-mini", "gpt-4o", "claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022"]

def _model_param(default: str = "gpt-4o-mini") -> dict:
    return {"name": "model", "type": "select", "label": "Model",
            "description": "LLM used for evaluation.", "default": default,
            "required": False, "options": _MODEL_OPTIONS}

def _threshold_param() -> dict:
    return {"name": "threshold", "type": "number", "label": "Threshold",
            "description": "Minimum score (0–1) to pass.", "default": 0.5,
            "required": False, "min": 0.0, "max": 1.0, "step": 0.05}

_EVALUATOR_TYPES = [
    {"type": "llm_judge", "name": "LLM Judge", "category": "built_in",
     "description": "Uses an LLM to score workflow outputs against a user-defined rubric.",
     "params": [_model_param(), {"name": "rubric", "type": "textarea", "label": "Rubric",
                                  "description": "Scoring rubric.", "default": "", "required": True}]},
    {"type": "workbench", "name": "WorkBench Trace Match", "category": "built_in",
     "description": "Positional tool-call trace matching.", "params": []},
    {"type": "human", "name": "Human Review", "category": "built_in",
     "description": "Human reviewer scores the output.", "params": []},
    {"type": "deepeval_answer_relevancy", "name": "Answer Relevancy (DeepEval)",
     "category": "deepeval", "description": "How relevant the answer is to the query.",
     "params": [_model_param(), _threshold_param()]},
    {"type": "deepeval_faithfulness", "name": "Faithfulness (DeepEval)",
     "category": "deepeval", "description": "Whether the answer is grounded in context.",
     "params": [_model_param(), _threshold_param()]},
    {"type": "deepeval_hallucination", "name": "Hallucination (DeepEval)",
     "category": "deepeval", "description": "Detects hallucinated facts.",
     "params": [_model_param(), _threshold_param()]},
    {"type": "deepeval_tool_correctness", "name": "Tool Correctness (DeepEval)",
     "category": "deepeval", "description": "Checks correct tool calls.",
     "params": [_threshold_param()]},
    {"type": "deepeval_bias", "name": "Bias (DeepEval)",
     "category": "deepeval", "description": "Detects bias in generated answers.",
     "params": [_model_param(), _threshold_param()]},
    {"type": "ragas_faithfulness", "name": "Faithfulness (RAGAS)",
     "category": "ragas", "description": "Factual consistency against context.",
     "params": [_model_param()]},
    {"type": "ragas_answer_relevancy", "name": "Answer Relevancy (RAGAS)",
     "category": "ragas", "description": "Relevance of the answer to the question.",
     "params": [_model_param()]},
    {"type": "ragas_answer_correctness", "name": "Answer Correctness (RAGAS)",
     "category": "ragas", "description": "Correctness against ground truth.",
     "params": [_model_param()]},
]

# ── Router ────────────────────────────────────────────────────────────────────

def _route(method: str, path: str, qs: dict, body: dict, event: dict) -> tuple[Any, int]:
    p = path.rstrip("/") or "/"

    if p == "/health":
        return {"status": "ok"}, 200
    if p == "/benchmarks" and method == "GET":
        return _BENCHMARKS, 200
    if p == "/evaluator-types" and method == "GET":
        return _EVALUATOR_TYPES, 200

    # /experiments
    if p == "/experiments":
        if method == "GET":
            return _list_experiments()
        if method == "POST":
            return _create_experiment(body)

    m = re.fullmatch(r"/experiments/([^/]+)", p)
    if m:
        eid = m.group(1)
        if method == "GET":    return _get_experiment(eid)
        if method == "DELETE": return _delete_experiment(eid)

    m = re.fullmatch(r"/experiments/([^/]+)/(start|stop)", p)
    if m and method == "POST":
        return _start_experiment(m.group(1)) if m.group(2) == "start" else _stop_experiment(m.group(1))

    m = re.fullmatch(r"/experiments/([^/]+)/trials", p)
    if m and method == "GET":
        return _list_trials(m.group(1), int(qs.get("page", 1)), int(qs.get("limit", 200)))

    m = re.fullmatch(r"/experiments/([^/]+)/trials/([^/]+)", p)
    if m and method == "GET":
        return _get_trial(m.group(1), m.group(2))

    m = re.fullmatch(r"/experiments/([^/]+)/trials/([^/]+)/eval-rows", p)
    if m and method == "GET":
        return _get_eval_rows(m.group(1), m.group(2))

    m = re.fullmatch(r"/experiments/([^/]+)/lineage", p)
    if m and method == "GET":
        return _get_lineage(m.group(1))

    # /datasets
    if p == "/datasets":
        if method == "GET":  return _list_datasets()
        if method == "POST": return _upload_dataset(event)

    m = re.fullmatch(r"/datasets/([^/]+)", p)
    if m and method == "GET":
        return _get_dataset(m.group(1))

    return {"detail": "Not found"}, 404


# ── Entry point ───────────────────────────────────────────────────────────────

def handler(event: dict, context: Any) -> dict:
    http = (event.get("requestContext") or {}).get("http") or {}
    method = http.get("method", "GET").upper()
    path   = event.get("rawPath", "/")
    qs     = event.get("queryStringParameters") or {}

    headers = event.get("headers") or {}
    ct = (headers.get("content-type") or headers.get("Content-Type") or "").lower()
    raw_body = event.get("body") or ""
    body: dict = {}
    if "application/json" in ct and raw_body:
        try:
            body = json.loads(raw_body)
        except json.JSONDecodeError:
            pass

    try:
        result, status = _route(method, path, qs, body, event)
    except Exception as exc:
        result, status = {"detail": str(exc)}, 500

    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(result) if result is not None else "",
    }
