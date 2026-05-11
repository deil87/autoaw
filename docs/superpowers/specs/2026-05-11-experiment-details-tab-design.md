# Experiment Details Tab — Design Spec

**Date:** 2026-05-11

## Overview

Add a read-only "Details" tab to the experiment monitor page that displays the full experiment configuration: task description, dataset, evaluators/rubric, objective weights, GP/budget parameters, and metadata.

## Problem

The current monitor page (`/experiments/[id]/monitor`) shows only live runtime stats (trial count, best fitness, total cost, fitness chart). There is no way to review what the experiment is configured to do — the task definition, rubric, and parameters — without going back to the creation form.

## Solution

Wrap the monitor page content in shadcn `<Tabs>`. The existing stats + chart become the **Monitor** tab. A new **Details** tab renders a read-only view of `experiment.config_json`.

No new routes, no new API endpoints, no data model changes.

## Architecture

### Component Changes

| File | Change |
|---|---|
| `frontend/app/experiments/[id]/monitor/monitor-client.tsx` | Add `<Tabs>` wrapper; move existing monitor JSX into "Monitor" tab; add "Details" tab rendering `<ExperimentDetails config={config} experiment={experiment}/>` |
| `frontend/components/experiment-details.tsx` | New presentational component — receives parsed `ExperimentConfig` and `Experiment`; renders all config sections |

### Data Flow

`monitor-client.tsx` already fetches the `Experiment` object which contains `config_json: string`. On render, `config_json` is `JSON.parse`d and passed as a prop to `ExperimentDetails`. No additional API calls.

## ExperimentDetails Component

Props:
```ts
interface ExperimentDetailsProps {
  config: ExperimentConfig | null;  // null if parse fails
  experiment: Experiment;
}
```

Sections rendered (each in a `<Card>`):

1. **Task** — `config.task_description` as a prose block (`<p>`)
2. **Dataset** — `config.dataset_id` displayed as a `<Badge>`
3. **Evaluators / Rubric** — list of evaluator entries; each shows type badge + any criteria/description field present
4. **Objective Weights** — three read-only `<Progress>` bars: Quality, Cost, Speed; values from `config.objective_weights` (0–1 scaled to 0–100)
5. **GP & Budget Parameters** — key/value grid: Population Size, Max Trials, Max USD, Convergence Patience, Concurrency
6. **Metadata** — Experiment ID (monospace), Created At, Updated At (formatted timestamps)

**Error state:** If `config_json` is absent or `JSON.parse` throws, render a muted message: "Configuration details are not available for this experiment."

## Constraints

- Read-only — no edit controls.
- Purely presentational — no side effects, no API calls.
- Follows existing shadcn/ui + Tailwind patterns in the codebase.
- Graceful degradation if optional fields (`budget_max_trials`, `budget_max_usd`) are absent.
