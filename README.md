# AutoAW

AutoML for multi-agent workflows. Automatically discovers optimal workflow topologies, agent roles, prompts, and parameters using co-evolutionary genetic programming (DEAP) + Optuna SMBO.

## Prerequisites

- Python 3.12+
- Node.js 18+ (for the frontend)
- An OpenAI API key (and optionally Anthropic)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-org/autoaw.git
cd autoaw
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-local.txt
```

### 2. Configure

```bash
cp .env.example .env.local
# Edit .env.local and add your OPENAI_API_KEY
```

### 3. Install frontend dependencies

```bash
npm install          # installs concurrently at the root
npm install --prefix frontend
```

### 4. Start everything

```bash
npm run dev
```

This starts the FastAPI backend (port 8000) and Next.js frontend (port 3032) together.
Open [http://localhost:3032](http://localhost:3032).

## Running experiments via API

```bash
# Upload a dataset (JSON array of {input, expected} objects)
curl -X POST http://localhost:8000/datasets \
  -F "file=@my_dataset.json"

# Create an experiment
curl -X POST http://localhost:8000/experiments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My first experiment",
    "task_description": "Summarize technical documents clearly and concisely.",
    "dataset_id": "my_dataset",
    "evaluators": [{"type": "llm_judge", "params": {"model": "gpt-4o-mini", "rubric": "Rate 0-1 on clarity and accuracy."}}],
    "objective_weights": {"quality": 0.7, "cost": 0.2, "speed": 0.1},
    "population_size": 10,
    "budget_max_trials": 50,
    "concurrency": 3
  }'

# Start it (replace EXP_ID with the id from the response above)
curl -X POST http://localhost:8000/experiments/EXP_ID/start

# Poll for progress
curl http://localhost:8000/experiments/EXP_ID
curl http://localhost:8000/experiments/EXP_ID/trials
```

## Dataset format

A dataset is a JSON file containing a list of objects:

```json
[
  {"input": "...", "expected": "..."},
  {"input": "...", "expected": "..."}
]
```

`expected` is optional — if omitted, only LLM-judge evaluators can score the output.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | Required for OpenAI models and LLM-judge evaluator |
| `ANTHROPIC_API_KEY` | — | Required for Anthropic models |
| `MAX_CONCURRENT_EXPERIMENTS` | `4` | Max experiments running in parallel |
| `DATABASE_PATH` | `autoaw.db` | SQLite database file path |
| `DATASETS_DIR` | `datasets` | Directory for dataset JSON files |
| `NEXT_PUBLIC_AUTH_DISABLED` | `false` | Set to `true` in `frontend/.env.local` to bypass Cognito auth — all routes open, no sign-in required. Intended for local/self-hosted use. |

## Running tests

```bash
python -m pytest backend/ -v
```
