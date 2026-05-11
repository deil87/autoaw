# AutoAW — Agent Instructions

## Project

AutoAW is an AutoML-style framework for automatically discovering optimal multi-agent workflows. It uses co-evolutionary genetic programming (DEAP) to jointly search topology structures and prompt content, with Optuna SMBO as a fine-tuning polish step.

Full design spec: `docs/superpowers/specs/2026-05-11-autoaw-design.md`

## Repository Structure

```
autoaw/
├── frontend/          # Next.js (App Router) + shadcn/ui, static export
├── backend/
│   ├── api/           # Lambda handlers (Python) — experiment CRUD, job dispatch
│   ├── engine/        # ECS Fargate service — GP loop, SMBO polish, workflow runner
│   └── shared/        # Shared types, gene schema, interfaces
├── infra/             # AWS CDK or Terraform — all infrastructure definitions
└── docs/
    └── superpowers/
        └── specs/     # Design documents
```

## Core Abstractions

- **Gene** (`backend/shared/gene.py`) — JSON schema for a workflow. Carries topology, agents (role/model/prompt/tools/params), and edges. Never mutate a gene in place; always produce a new copy.
- **WorkflowRunner** (`backend/engine/runner/`) — adapter interface. `run(gene, input) → RunResult`. One adapter per framework (raw LLM, LangChain, CrewAI, etc.).
- **Evaluator** (`backend/engine/evaluator/`) — scorer interface. `score(input, output, expected) → Score`. Three built-in: `LLMJudgeEvaluator`, `FunctionEvaluator`, `HumanEvaluator`.
- **GP Loop** (`backend/engine/gp/`) — DEAP-based evolutionary loop. Operators: `mutate_structure`, `mutate_prompt`, `mutate_param`, `crossover_subgraph`, `crossover_prompt`.
- **SMBO Polish** (`backend/engine/smbo/`) — Optuna TPE study. Runs after GP convergence on the best gene's continuous params only.

## Key Rules

- **Gene schema is the contract.** Frontend, GP loop, runner, and evaluator all speak gene JSON. Do not add fields outside the schema without updating the shared type.
- **Runners are stateless.** A runner takes a gene and an input string and returns a RunResult. It holds no state between calls.
- **Fitness is always a scalar + Pareto point.** Every trial records both the weighted scalar fitness and the raw `(quality, cost, speed)` triple. Never discard the triple.
- **Costs are always tracked.** Every RunResult must include `cost_usd`. The engine enforces budget limits; never run a trial without a cost estimate guard.
- **Prompt mutation uses an LLM.** The `mutate_prompt` operator calls a configured LLM with a meta-prompt to rewrite system prompts. This is intentional — do not replace it with random text manipulation.

## Technology Choices

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), shadcn/ui, Tailwind, static export |
| Frontend hosting | S3 + CloudFront |
| API | AWS API Gateway + Lambda (Python 3.12) |
| Job queue | SQS |
| Optimization engine | ECS Fargate, Python 3.12 |
| GP library | DEAP |
| SMBO library | Optuna (TPE sampler) |
| Database | DynamoDB |
| Object storage | S3 |
| IaC | AWS CDK (TypeScript) |

## Development Notes

- All infrastructure lives in `infra/`. Never hardcode AWS resource names or ARNs in application code — use environment variables injected at deploy time.
- The engine runs as a long-lived Fargate task per experiment. It reads experiment config from DynamoDB on startup and writes trial results back incrementally.
- The frontend polls or subscribes via WebSocket (API Gateway) for live updates. The engine publishes progress events to a DynamoDB stream or SNS topic.
- Use the gene schema fixtures in `backend/shared/fixtures/` for all unit tests. Do not create ad-hoc gene dicts in tests.
