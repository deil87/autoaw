from __future__ import annotations
import json
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
import base64
from fastapi import FastAPI, HTTPException, UploadFile, File, Query, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(".env.local", override=True)
load_dotenv(".env")  # fallback for CI/prod where .env.local may not exist

from backend.shared.experiment import (
    ExperimentConfig,
    ObjectiveWeights,
    EvaluatorConfig,
    DEFAULT_CLOUD_MODELS,
)
from backend.shared.evaluator_catalog import CATALOG
from backend.api.executor import ExperimentExecutor
from backend.api.dataset_store import load_dataset, save_dataset, list_dataset_ids, dataset_exists

_DB_PATH = os.environ.get("DATABASE_PATH", "autoaw.db")
_MAX_WORKERS = int(os.environ.get("MAX_CONCURRENT_EXPERIMENTS", "4"))

if os.environ.get("STORE_BACKEND") == "dynamo":
    from backend.api.dynamo_store import DynamoStore
    _store = DynamoStore()
else:
    from backend.api.store import LocalStore
    _store = LocalStore(db_path=_DB_PATH)

_executor = ExperimentExecutor(
    store=_store, max_workers=_MAX_WORKERS
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if hasattr(_store, 'init_db'):
        _store.init_db()
    yield
    _executor.shutdown(wait=False)


app = FastAPI(title="AutoAW", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://autoaw.app",
        "https://d2dnaqhqu223h4.cloudfront.net",
        "https://d32ilmniiyvkjt.cloudfront.net",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3032",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic request models ───────────────────────────────────────────────────


class EvaluatorConfigIn(BaseModel):
    type: str
    params: dict[str, Any] = {}


class ObjectiveWeightsIn(BaseModel):
    quality: float
    cost: float
    speed: float


class CreateExperimentRequest(BaseModel):
    name: str
    task_description: str
    evaluators: list[EvaluatorConfigIn]
    objective_weights: ObjectiveWeightsIn
    dataset_id: str | None = None
    task_type: str = "objective"  # "objective" | "generative" | "hybrid"
    population_size: int = 20
    budget_max_trials: int | None = None
    budget_max_usd: float | None = None
    convergence_patience: int = 10
    concurrency: int = 5
    runner_type: str = "raw_llm"
    dataset_sample_size: int | None = None
    n_generations: int = 1
    seed_gene: dict | None = None
    allowed_models: list[str] | None = None  # None → use DEFAULT_CLOUD_MODELS


class GeneFromDescriptionRequest(BaseModel):
    text: str


class RubricParseRequest(BaseModel):
    text: str


# ── Routes ────────────────────────────────────────────────────────────────────

_BENCHMARKS = [
    {
        "id": "workbench",
        "name": "WorkBench",
        "description": (
            "690 workplace tasks (calendar, email, database, files). "
            "Evaluated by tool-call trace matching."
        ),
        "paper_url": "https://arxiv.org/abs/2405.00823",
        "dataset_id": "workbench",
        "runner_type": "workbench",
        "evaluators": [{"type": "workbench", "params": {}}],
        "default_objective": {
            "quality_weight": 0.7,
            "cost_weight": 0.2,
            "speed_weight": 0.1,
        },
        "task_count": 690,
    },
    {
        "id": "swe-bench",
        "name": "SWE-bench",
        "description": (
            "GitHub issue resolution across real Python repos. "
            "Evaluated by LLM patch-quality judge against ground-truth fixes."
        ),
        "paper_url": "https://www.swebench.com",
        "dataset_id": "swebench",
        "runner_type": "swebench",
        "evaluators": [{"type": "swebench", "params": {"model": "gpt-4o-mini"}}],
        "default_objective": {
            "quality_weight": 0.6,
            "cost_weight": 0.2,
            "speed_weight": 0.2,
        },
        "task_count": 300,
    },
]


class DemoRequest(BaseModel):
    name: str
    email: str
    company: str = ""
    message: str


_bearer = HTTPBearer()
_ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "spirtik87@gmail.com")


def _require_admin(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    """Decode JWT payload (no signature verification — API Gateway handles that)
    and check that the caller is the admin."""
    token = creds.credentials
    try:
        parts = token.split(".")
        payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        email = payload.get("email", "")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    if email != _ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Forbidden")
    return email


@app.post("/demo", status_code=200)
def request_demo(req: DemoRequest):
    if not req.name or not req.email or not req.message:
        raise HTTPException(status_code=400, detail="name, email, and message are required")

    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="Email service not configured")

    import resend
    resend.api_key = api_key

    from_email = os.environ.get("DEMO_FROM_EMAIL", "onboarding@resend.dev")
    to_email = os.environ.get("DEMO_TO_EMAIL", "spirtik87@gmail.com")

    company_line = f"<p><strong>Company:</strong> {req.company}</p>" if req.company else ""
    company_text = f"\nCompany: {req.company}" if req.company else ""

    params: resend.Emails.SendParams = {
        "from": from_email,
        "to": [to_email],
        "reply_to": req.email,
        "subject": f"Demo request from {req.name}" + (f" ({req.company})" if req.company else ""),
        "html": f"""
            <p><strong>Name:</strong> {req.name}</p>
            <p><strong>Email:</strong> <a href="mailto:{req.email}">{req.email}</a></p>
            {company_line}
            <hr />
            <p>{req.message.replace(chr(10), "<br />")}</p>
        """,
        "text": f"Name: {req.name}\nEmail: {req.email}{company_text}\n\n{req.message}",
    }

    try:
        resend.Emails.send(params)
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to send email")

    if hasattr(_store, "create_demo_request"):
        try:
            _store.create_demo_request(req.name, req.email, req.company, req.message)
        except Exception:
            pass  # Don't fail the request if persistence fails

    return {"ok": True}


class InviteRequest(BaseModel):
    email: str
    name: str
    request_id: str | None = None


@app.get("/admin/requests")
def admin_list_requests(_admin: str = Depends(_require_admin)):
    return _store.list_demo_requests()


@app.post("/admin/invite", status_code=200)
def admin_send_invite(req: InviteRequest, _admin: str = Depends(_require_admin)):
    import boto3
    user_pool_id = os.environ.get("COGNITO_USER_POOL_ID", "")
    if not user_pool_id:
        raise HTTPException(status_code=500, detail="Cognito not configured")

    client = boto3.client("cognito-idp", region_name="eu-central-1")
    try:
        client.admin_create_user(
            UserPoolId=user_pool_id,
            Username=req.email,
            UserAttributes=[
                {"Name": "email", "Value": req.email},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "name", "Value": req.name},
            ],
            DesiredDeliveryMediums=["EMAIL"],
        )
    except client.exceptions.UsernameExistsException:
        raise HTTPException(status_code=409, detail="User already exists")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if req.request_id and hasattr(_store, "update_demo_request_status"):
        try:
            _store.update_demo_request_status(req.request_id, "invited")
        except Exception:
            pass

    return {"ok": True, "email": req.email}


@app.get("/benchmarks")
def list_benchmarks():
    return _BENCHMARKS


@app.get("/evaluator-types")
def list_evaluator_types():
    return [e.to_dict() for e in CATALOG]


@app.get("/health")
def health():
    return {"status": "ok"}


_GENE_CONVERSION_SYSTEM = """You convert agent pipeline descriptions into AutoAW Gene JSON.

Gene schema — output exactly this shape:
{
  "id": "imported_001",
  "topology": "<one of: fixed_pipeline | ai_orchestrated | debate | parallel_reduce | human_in_loop | hybrid>",
  "agents": [
    {"id": "a0", "role": "<role>", "model": "gpt-4o-mini", "system_prompt": "<1-2 sentence prompt>", "tools": [], "temperature": 0.7}
  ],
  "edges": [{"from": "a0", "to": "a1", "type": "<sequential|broadcast|reduce|conditional>"}],
  "topology_params": {}
}

Topology rules:
- linear A→B→C chain → fixed_pipeline
- one agent routes tasks to specialists → ai_orchestrated
- pro/con/judge pattern → debate
- fan-out to parallel workers then merge → parallel_reduce
- requires a human approval step → human_in_loop
- mix of the above → hybrid

Edge types:
- sequential: one output feeds the next
- broadcast: one output fans out to multiple agents simultaneously
- reduce: multiple outputs merge into one agent
- conditional: routing based on content

Infer system_prompt from the role description. Keep system prompts to 1-2 sentences.
Default model to "gpt-4o-mini" unless the input specifies otherwise.
Agent IDs must be short alphanumeric strings (a0, a1, researcher, writer, etc.).

Output ONLY valid JSON — no markdown, no commentary — with this exact shape:
{"gene": <gene object>, "notes": ["<any assumption or clarification>"]}"""


@app.post("/genes/from_description")
def gene_from_description(req: GeneFromDescriptionRequest):
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=_GENE_CONVERSION_SYSTEM,
        messages=[{"role": "user", "content": req.text}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"LLM returned invalid JSON: {exc}")

    gene_dict = result.get("gene")
    if not gene_dict:
        raise HTTPException(status_code=422, detail="LLM response missing 'gene' field")

    from backend.shared.gene import Gene
    try:
        validated = Gene.from_dict(gene_dict)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid gene structure: {exc}")

    return {
        "gene": validated.to_dict(),
        "topology": validated.topology.value,
        "notes": result.get("notes", []),
    }


_RUBRIC_PARSE_SYSTEM = """You convert evaluation rubrics from any format (CSV, markdown table, plain text, numbered lists) into a structured JSON object used by an LLM judge.

The JSON object maps each criterion/dimension name to a concise description that includes the scoring scale mapped to the 0–1 range.

Input may look like:
- CSV rows: "Criteria,4-Excellent,3-Good,2-Developing,1-Poor\\n1. Criterion name,..."
- Markdown tables
- Numbered lists with scale descriptions
- Free-form prose describing what to evaluate

Output format — a JSON object where each key is a short dimension name and each value describes the 0–1 scale:

{
  "Plausibility of Distractors": "Score 0–1 measuring how plausible the wrong answers are. 1.0 (Excellent): All 3 wrong answers are highly plausible, grammatically fitting, and target common learner misconceptions. 0.75 (Good): 2 wrong answers are plausible; 1 is easily eliminated or slightly out of context. 0.5 (Developing): Only 1 wrong answer is plausible; others are obvious giveaways. 0.25 (Poor): All wrong answers are completely implausible or irrelevant.",
  ...
}

Rules:
- Strip leading numbering from criterion names (e.g. "1. Plausibility" → "Plausibility of Distractors")
- Map the highest scale level (e.g. 4, Excellent, 5/5) to 1.0
- Map the lowest scale level to 0.0 or 0.25 (never negative)
- Map intermediate levels evenly spaced between 0 and 1
- Keep descriptions concise but include all scale level details
- Dimension names should be short and clear (3-6 words max)

Output ONLY valid JSON — no markdown, no commentary:
{"rubric": {<dimension>: <description>, ...}, "notes": ["<any interpretation note>"]}"""


@app.post("/rubric/parse")
def parse_rubric(req: RubricParseRequest):
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=_RUBRIC_PARSE_SYSTEM,
        messages=[{"role": "user", "content": req.text}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"LLM returned invalid JSON: {exc}")

    rubric_dict = result.get("rubric")
    if not rubric_dict or not isinstance(rubric_dict, dict):
        raise HTTPException(status_code=422, detail="LLM response missing 'rubric' field")

    return {
        "rubric_json": json.dumps(rubric_dict, indent=2),
        "dimensions": list(rubric_dict.keys()),
        "notes": result.get("notes", []),
    }



def create_experiment(req: CreateExperimentRequest):
    exp_id = f"exp_{uuid.uuid4().hex[:12]}"
    config = ExperimentConfig(
        name=req.name,
        task_description=req.task_description,
        dataset_id=req.dataset_id or "",
        task_type=req.task_type,
        evaluators=[
            EvaluatorConfig(type=e.type, params=e.params) for e in req.evaluators
        ],
        objective_weights=ObjectiveWeights(
            quality=req.objective_weights.quality,
            cost=req.objective_weights.cost,
            speed=req.objective_weights.speed,
        ),
        population_size=req.population_size,
        budget_max_trials=req.budget_max_trials,
        budget_max_usd=req.budget_max_usd,
        convergence_patience=req.convergence_patience,
        concurrency=req.concurrency,
        runner_type=req.runner_type,
        dataset_sample_size=req.dataset_sample_size,
        n_generations=req.n_generations,
        seed_gene=req.seed_gene,
        allowed_models=req.allowed_models if req.allowed_models is not None else list(DEFAULT_CLOUD_MODELS),
    )
    _store.create_experiment(exp_id, config)
    return _store.get_experiment(exp_id)


@app.get("/experiments")
def list_experiments():
    return _store.list_experiments()


@app.get("/ollama/models")
def list_ollama_models():
    """Return models currently available on the local Ollama instance."""
    from backend.engine.llm_client import ollama_list_local_models
    models = ollama_list_local_models()
    return {"models": models if models is not None else []}


@app.get("/infra/ecs")
def get_ecs_status(experiment_id: str | None = None):
    """ECS cluster status. In local dev (no ECS_CLUSTER_NAME set) returns a
    zeroed-out stub so the monitor page doesn't error."""
    import boto3

    cluster = os.environ.get("ECS_CLUSTER_NAME", "")
    if not cluster:
        return {
            "desired": 0,
            "pending": 0,
            "running": 0,
            "status": "LOCAL",
            "pending_tasks": [],
            "stopped_tasks": [],
        }

    ecs = boto3.client("ecs")

    def _exp_id(task: dict) -> str:
        for ov in task.get("overrides", {}).get("containerOverrides", []):
            for e in ov.get("environment", []):
                if e.get("name") == "EXPERIMENT_ID":
                    return e["value"]
        return ""

    pending_tasks: list = []
    running_count = 0
    try:
        arns = ecs.list_tasks(cluster=cluster, desiredStatus="RUNNING").get("taskArns", [])
        if arns:
            for t in ecs.describe_tasks(cluster=cluster, tasks=arns[:100]).get("tasks", []):
                exp_id = _exp_id(t)
                if experiment_id and exp_id != experiment_id:
                    continue
                if t.get("lastStatus") == "PENDING":
                    pending_tasks.append({
                        "task_id": t.get("taskArn", "").split("/")[-1],
                        "experiment_id": exp_id,
                        "containers": [
                            {"name": c.get("name"), "status": c.get("lastStatus"), "reason": c.get("reason", "")}
                            for c in t.get("containers", [])
                        ],
                    })
                elif t.get("lastStatus") == "RUNNING":
                    running_count += 1
    except Exception:
        pass

    stopped_tasks: list = []
    try:
        sarns = ecs.list_tasks(cluster=cluster, desiredStatus="STOPPED").get("taskArns", [])[:20]
        if sarns:
            for t in ecs.describe_tasks(cluster=cluster, tasks=sarns).get("tasks", []):
                exp_id = _exp_id(t)
                if experiment_id and exp_id != experiment_id:
                    continue
                stopped_at = t.get("stoppedAt")
                stopped_tasks.append({
                    "task_id": t.get("taskArn", "").split("/")[-1],
                    "experiment_id": exp_id,
                    "stopped_reason": t.get("stoppedReason", ""),
                    "stopped_at": stopped_at.isoformat() if hasattr(stopped_at, "isoformat") else None,
                    "containers": [
                        {"name": c.get("name"), "exit_code": c.get("exitCode"), "reason": c.get("reason", "")}
                        for c in t.get("containers", [])
                    ],
                })
        stopped_tasks = stopped_tasks[:5]
    except Exception:
        pass

    total = len(pending_tasks) + running_count
    return {
        "desired": total,
        "pending": len(pending_tasks),
        "running": running_count,
        "status": "ACTIVE",
        "pending_tasks": pending_tasks,
        "stopped_tasks": stopped_tasks,
    }


@app.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: str):
    try:
        return _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )


@app.post("/experiments/{experiment_id}/start")
def start_experiment(experiment_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    _executor.submit(experiment_id)
    return {"status": "submitted", "experiment_id": experiment_id}


@app.post("/experiments/{experiment_id}/stop")
def stop_experiment(experiment_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    _executor.stop(experiment_id)
    _store.update_experiment_status(experiment_id, "cancelled")
    return {"status": "stopping", "experiment_id": experiment_id}


@app.delete("/experiments/{experiment_id}", status_code=204)
def delete_experiment(experiment_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    _store.update_experiment_status(experiment_id, "cancelled")


@app.get("/experiments/{experiment_id}/trials/{trial_id}")
def get_trial(experiment_id: str, trial_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    trial = _store.get_trial(experiment_id, trial_id)
    if trial is None:
        raise HTTPException(status_code=404, detail=f"Trial {trial_id!r} not found")
    return trial


@app.get("/experiments/{experiment_id}/trials/{trial_id}/eval-rows")
def get_trial_eval_rows(experiment_id: str, trial_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    trial = _store.get_trial(experiment_id, trial_id)
    if trial is None:
        raise HTTPException(status_code=404, detail=f"Trial {trial_id!r} not found")
    return _store.get_eval_rows(trial_id)


@app.get("/experiments/{experiment_id}/lineage")
def get_experiment_lineage(experiment_id: str):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    trials = _store.list_trials_lineage(experiment_id)
    for t in trials:
        t["parent_gene_ids"] = json.loads(t.get("parent_gene_ids") or "[]")
    return trials


@app.get("/experiments/{experiment_id}/trials")
def list_trials(
    experiment_id: str,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
):
    try:
        _store.get_experiment(experiment_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Experiment {experiment_id!r} not found"
        )
    return _store.list_trials(experiment_id, page=page, limit=limit)


@app.post("/datasets", status_code=201)
async def upload_dataset(file: UploadFile = File(...)):
    dataset_id = os.path.splitext(file.filename)[0]
    content = await file.read()
    try:
        parsed = json.loads(content)
        if not isinstance(parsed, list):
            raise HTTPException(status_code=422, detail="Dataset must be a JSON array")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"Invalid JSON: {e}")
    save_dataset(dataset_id, content)
    return {"dataset_id": dataset_id, "records": len(parsed)}


@app.get("/datasets")
def list_datasets_route():
    return [{"dataset_id": did} for did in list_dataset_ids()]


@app.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str):
    if not dataset_exists(dataset_id):
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id!r} not found")
    return load_dataset(dataset_id)
