# AutoAW — Design Spec
**Date:** 2026-05-11  
**Status:** Approved

---

## 1. Overview

AutoAW is an AutoML-style framework for automatically discovering optimal multi-agent workflows. Given a task and a benchmark dataset, it searches over the space of possible agentic workflow configurations — topology, agent roles, system prompts, models, and parameters — to find the configuration that best satisfies a user-defined multi-objective criterion (quality, cost, speed).

The core search algorithm is **co-evolutionary genetic programming**: a single unified evolutionary loop where each individual (gene) encodes both topology and prompt/parameter values. Optuna/SMBO runs as a fine-tuning polish step after GP converges.

The system is framework-agnostic: it executes workflows through a thin adapter interface, with built-in raw LLM adapters and community adapters for LangChain, CrewAI, AutoGen, etc.

---

## 2. Key Concepts

| Term | Definition |
|---|---|
| **Workflow Gene** | A serializable JSON document encoding a complete agentic workflow: topology type, agents (role, model, prompt, tools, params), and communication edges |
| **Experiment** | A named optimization run. Configures task, benchmark dataset, evaluator(s), objective weights, and termination criteria |
| **Trial** | A single execution of one workflow gene against one benchmark input. Produces output + scores |
| **Population** | A set of genes in one GP generation |
| **Evaluator** | A pluggable scorer. Three built-in types: LLM-as-judge, custom function, human rating |
| **Search Space** | The full joint space of topology structures × agent configurations × prompt content × numerical params |
| **Topology Diversity Score** | Metric measuring structural variance within the top-k population; used as a GP convergence signal |

---

## 3. Workflow Gene Schema

Each gene is a serializable JSON document:

```json
{
  "id": "gene_abc123",
  "topology": "ai_orchestrated",
  "agents": [
    {
      "id": "agent_0",
      "role": "planner",
      "model": "gpt-4o",
      "system_prompt": "You are a planner who breaks down complex tasks. Think step by step.",
      "tools": ["web_search"],
      "temperature": 0.7
    },
    {
      "id": "agent_1",
      "role": "executor",
      "model": "gpt-4o-mini",
      "system_prompt": "You execute tasks given to you precisely and concisely.",
      "tools": ["code_exec"],
      "temperature": 0.3
    }
  ],
  "edges": [
    { "from": "agent_0", "to": "agent_1", "type": "sequential" }
  ],
  "topology_params": {
    "orchestrator_id": "agent_0",
    "max_rounds": 3,
    "consensus_threshold": 0.8
  }
}
```

### Supported Topology Types

| ID | Description |
|---|---|
| `fixed_pipeline` | Agents run in sequence; output of one feeds input of next |
| `ai_orchestrated` | One orchestrator agent dynamically decides which agent runs next |
| `debate` | N agents argue; a judge agent produces the final answer |
| `parallel_reduce` | Agents run in parallel on the same input; a reducer merges outputs |
| `human_in_loop` | Defined pause points where a human provides input or approval |
| `hybrid` | Combination of the above as sub-graphs |

---

## 4. Search Algorithm

### 4.1 Co-evolutionary GP (Primary)

The full search space is searched jointly — topology structure and prompt/parameter values evolve together in a single GP loop using [DEAP](https://deap.readthedocs.io/).

**Genetic operators:**

| Operator | What it does |
|---|---|
| `mutate_structure` | Add/remove agent, rewire edge, swap topology type |
| `mutate_prompt` | LLM rewrites one agent's system prompt (paraphrase/rewrite, not random noise) |
| `mutate_param` | Gaussian perturbation of temperature, max_rounds, consensus_threshold |
| `crossover_subgraph` | Exchange a sub-graph (agents + edges) between two parent genes |
| `crossover_prompt` | Swap system prompts between same-role agents of two parents |

**Fitness function:**

```
fitness = w_quality * quality_score
        - w_cost    * normalized_cost
        - w_speed   * normalized_latency
```

Weights `w_quality`, `w_cost`, `w_speed` are user-configured per experiment (sum to 1.0). Multi-objective Pareto front is tracked alongside the scalar fitness for analysis.

**Selection:** Tournament selection. Population size and tournament size are configurable.

**Termination criteria (any):**
- Max trials budget (absolute count or $ cost)
- Target fitness score reached
- N consecutive generations without improvement
- User manually stops

### 4.2 SMBO Polish (Secondary)

After GP terminates, the best-scoring gene is passed to an Optuna TPE study for fine-grained continuous parameter tuning (temperatures, max_rounds, etc.) only — topology and prompts are frozen at this stage. This is a cheap polish step, not the primary search.

### 4.3 Approximation Acknowledged

Co-evolution is the correct approach but requires larger populations than a two-level separated search. The tradeoff (more LLM calls, better signal) is intentional. Users configure population size and budget explicitly to control cost.

---

## 5. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js Frontend (Static Export)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ │
│  │Experiments│ │Workflow  │ │Run       │ │Leaderboard│ │
│  │Dashboard  │ │Editor    │ │Monitor   │ │& Compare  │ │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘ │
│  Hosted on S3 + CloudFront                              │
└────────────────────────┬────────────────────────────────┘
                         │ REST + WebSocket
                         ▼
┌─────────────────────────────────────────────────────────┐
│  API Gateway + Lambda (Node.js or Python)               │
│  Experiment CRUD │ Trial status │ Results streaming     │
└────┬──────────────────────┬──────────────────────────────┘
     │                      │ SQS
     ▼                      ▼
┌─────────────┐    ┌─────────────────────────────────────┐
│  DynamoDB   │    │  Optimization Engine (ECS Fargate)  │
│  Experiments│    │  ┌───────────────────────────────┐  │
│  Trials     │    │  │ GP Loop (DEAP)                │  │
│  Genes      │    │  │  mutate → run → score → select│  │
│  Results    │    │  └──────────────┬────────────────┘  │
│             │    │                 │ on GP convergence  │
│  S3         │    │  ┌──────────────▼────────────────┐  │
│  Datasets   │    │  │ SMBO Polish (Optuna/TPE)       │  │
│  Gene blobs │    │  └──────────────┬────────────────┘  │
│  Traces     │    │                 │                    │
└─────────────┘    │  ┌──────────────▼────────────────┐  │
                   │  │ Workflow Runner                │  │
                   │  │ (framework-agnostic adapter)  │  │
                   │  └──────────────┬────────────────┘  │
                   └─────────────────┼───────────────────┘
                                     │ LLM API calls
                                     ▼
                           LLM Providers (OpenAI, Anthropic, etc.)
```

### AWS Services Used

| Service | Purpose |
|---|---|
| S3 + CloudFront | Frontend static hosting + CDN |
| API Gateway | REST + WebSocket endpoint |
| Lambda | API handlers, job dispatch |
| SQS | Job queue between Lambda and Fargate |
| ECS Fargate | Long-running optimization engine |
| DynamoDB | Experiments, trials, genes, results metadata |
| S3 (data) | Benchmark datasets, full gene JSON blobs, conversation traces |

---

## 6. Core Interfaces

### Workflow Runner

```python
class WorkflowRunner:
    def run(self, gene: dict, input: str) -> RunResult:
        ...

@dataclass
class RunResult:
    output: str
    token_usage: dict       # { model: { prompt, completion } }
    latency_ms: int
    cost_usd: float
    trace: list[dict]       # full agent conversation trace
```

Built-in adapter: raw OpenAI/Anthropic API calls (no framework).  
Community adapters (separate packages): LangChain, CrewAI, AutoGen.

### Evaluator

```python
class Evaluator:
    def score(self, input: str, output: str, expected: str | None) -> Score:
        ...

@dataclass
class Score:
    quality: float          # 0.0 – 1.0
    metadata: dict          # evaluator-specific detail
```

**Built-in evaluators:**
- `LLMJudgeEvaluator` — submits output to a judge model with a configurable rubric
- `FunctionEvaluator` — calls a user-supplied Python or JavaScript function
- `HumanEvaluator` — queues a rating task in the UI; trial is blocked until rated

---

## 7. Experiment Lifecycle

```
draft → running → paused → completed
                         → failed
                         → stopped (user)
```

**Experiment config fields:**
- `task_description` — natural language description of the task
- `dataset_id` — reference to benchmark dataset in S3
- `evaluators` — list of evaluator configs (can combine multiple)
- `objective_weights` — `{ quality: 0.6, cost: 0.2, speed: 0.2 }`
- `population_size` — number of genes per generation
- `budget` — max trials count or max $ spend
- `convergence_patience` — generations without improvement before stopping GP

---

## 8. UI Pages

| Page | Purpose |
|---|---|
| **Experiments Dashboard** | List all experiments, status badges, create new |
| **Experiment Setup** | Configure task, dataset, evaluators, objective weight sliders, budget |
| **Live Monitor** | Real-time population fitness chart, topology diversity score, trial log, cost tracker, pause/stop controls |
| **Gene Inspector** | Full gene JSON viewer, agent conversation trace, per-agent score breakdown |
| **Leaderboard** | Compare top genes across experiments. Filter by topology type, model, cost. Export best gene as JSON |

UI is built with Next.js (App Router) + shadcn/ui, exported as a static site.

---

## 9. Out of Scope for v1

- Multi-tenant / team access control
- Streaming token output during trial execution
- Fine-tuning models based on discovered prompts
- Automated dataset generation
- Plugin registry / community adapter marketplace

---

## 10. Resolved Design Decisions

- **Prompt mutation operator:** The `mutate_prompt` operator calls a configured LLM with a meta-prompt instructing it to rewrite the agent's system prompt while maximizing diversity from the original. Example meta-prompt: *"Rewrite the following system prompt to achieve the same goal but with a different phrasing, structure, and strategy. The rewrite must be meaningfully different — not just paraphrased."* The judge LLM for `LLMJudgeEvaluator` uses a user-supplied scoring rubric (evaluation criteria, e.g., "Rate 0–1 on accuracy, completeness, and conciseness").
- **Gene seeding:** The initial population is generated by an LLM with an explicit diversity directive — it produces N structurally varied seed genes covering different topology types, role combinations, and prompt strategies. Users may optionally inject hand-crafted genes into the initial population.
- **Parallel trial execution:** The number of concurrent trials per Fargate task is configurable per experiment (`concurrency` field in experiment config). Default is 5. Higher values reduce wall-clock time but increase peak cost.
