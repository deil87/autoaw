# Experiment Details Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Details" tab to the experiment monitor page showing the full experiment configuration (task, dataset, evaluators, objective weights, GP parameters, metadata).

**Architecture:** A new `ExperimentDetails` presentational component receives the parsed `ExperimentConfig` and renders it in grouped `Card` sections. The monitor page wraps its existing content and the new component in a shadcn `<Tabs>` shell — no routing or API changes required.

**Tech Stack:** Next.js App Router, React, TypeScript, shadcn/ui (Tabs, Card, Badge, Progress), Tailwind CSS.

---

### Task 1: Create ExperimentDetails component

**Files:**
- Create: `frontend/components/experiment-details.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// frontend/components/experiment-details.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { Experiment, ExperimentConfig } from "@/lib/types";

interface ExperimentDetailsProps {
  config: ExperimentConfig | null;
  experiment: Experiment;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export function ExperimentDetails({ config, experiment }: ExperimentDetailsProps) {
  if (!config) {
    return (
      <p className="text-muted-foreground text-sm">
        Configuration details are not available for this experiment.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Task */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Task</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{config.task_description}</p>
        </CardContent>
      </Card>

      {/* Dataset */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Dataset</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="outline">{config.dataset_id}</Badge>
        </CardContent>
      </Card>

      {/* Evaluators */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Evaluators / Rubric</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {config.evaluators.length === 0 ? (
            <p className="text-sm text-muted-foreground">No evaluators configured.</p>
          ) : (
            config.evaluators.map((ev, i) => (
              <div key={i} className="flex flex-col gap-1 border rounded p-3">
                <Badge className="w-fit">{ev.type}</Badge>
                {ev.params && Object.keys(ev.params).length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    {Object.entries(ev.params).map(([k, v]) => (
                      <div key={k}>
                        <span className="font-medium">{k}:</span>{" "}
                        {typeof v === "string" ? v : JSON.stringify(v)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Objective Weights */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Objective Weights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["quality", "cost", "speed"] as const).map((key) => (
            <div key={key} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="capitalize">{key}</span>
                <span>{Math.round(config.objective_weights[key] * 100)}%</span>
              </div>
              <Progress value={config.objective_weights[key] * 100} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* GP & Budget Parameters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">GP & Budget Parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Population Size</dt>
            <dd className="font-medium">{config.population_size}</dd>
            <dt className="text-muted-foreground">Max Trials</dt>
            <dd className="font-medium">{config.budget_max_trials ?? "—"}</dd>
            <dt className="text-muted-foreground">Max Budget (USD)</dt>
            <dd className="font-medium">
              {config.budget_max_usd != null ? `$${config.budget_max_usd.toFixed(2)}` : "—"}
            </dd>
            <dt className="text-muted-foreground">Convergence Patience</dt>
            <dd className="font-medium">{config.convergence_patience}</dd>
            <dt className="text-muted-foreground">Concurrency</dt>
            <dd className="font-medium">{config.concurrency}</dd>
          </dl>
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Experiment ID</dt>
            <dd className="font-mono text-xs break-all">{experiment.id}</dd>
            <dt className="text-muted-foreground">Created At</dt>
            <dd className="font-medium">{formatDate(experiment.created_at)}</dd>
            <dt className="text-muted-foreground">Updated At</dt>
            <dd className="font-medium">{formatDate(experiment.updated_at)}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file was created**

Run: `ls frontend/components/experiment-details.tsx`
Expected: file listed without error.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/experiment-details.tsx
git commit -m "feat: add ExperimentDetails component"
```

---

### Task 2: Add Tabs to monitor-client.tsx

**Files:**
- Modify: `frontend/app/experiments/[id]/monitor/monitor-client.tsx`

- [ ] **Step 1: Install shadcn Tabs if not present**

Check `frontend/components/ui/tabs.tsx` exists. If not, run:
```bash
cd frontend && npx shadcn@latest add tabs
```
Expected: `components/ui/tabs.tsx` created (or already exists — either is fine).

- [ ] **Step 2: Replace monitor-client.tsx with the tabbed version**

```tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FitnessChart } from "@/components/fitness-chart";
import { ExperimentDetails } from "@/components/experiment-details";
import { api } from "@/lib/api";
import { useExperimentSocket } from "@/lib/websocket";
import type { Experiment, Trial, ExperimentConfig } from "@/lib/types";

interface FitnessPoint { trial: number; fitness: number; quality: number; }

export default function MonitorPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [chartData, setChartData] = useState<FitnessPoint[]>([]);

  const refresh = useCallback(() => {
    api.experiments.get(id).then(setExperiment);
    api.trials.list(id).then((data) => {
      setTrials(data);
      setChartData(data.map((t, i) => ({ trial: i + 1, fitness: t.fitness, quality: t.quality })));
    });
  }, [id]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, [refresh]);

  useExperimentSocket(id, (event) => {
    if (event.type === "trial_complete") {
      setTrials((prev) => {
        const newTrial: Trial = {
          id: "",
          experiment_id: id,
          generation: event.generation,
          gene_id: event.gene_id,
          gene_json: "{}",
          fitness: event.fitness,
          quality: event.quality,
          cost_usd: event.cost_usd,
          latency_ms: event.latency_ms,
          created_at: new Date().toISOString(),
        };
        return [newTrial, ...prev];
      });
      setChartData((prev) => [
        ...prev,
        { trial: prev.length + 1, fitness: event.fitness, quality: event.quality },
      ]);
    }
  });

  const handleStart = () =>
    api.experiments.start(id).then(() => api.experiments.get(id).then(setExperiment));

  if (!experiment) return <p className="text-muted-foreground">Loading...</p>;

  let config: ExperimentConfig | null = null;
  try {
    if (experiment.config_json) config = JSON.parse(experiment.config_json) as ExperimentConfig;
  } catch {
    // config remains null — ExperimentDetails handles graceful fallback
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{experiment.name}</h1>
          <Badge className="mt-1">{experiment.status}</Badge>
        </div>
        <div className="flex gap-2">
          {experiment.status === "pending" && (
            <button onClick={handleStart} className={cn(buttonVariants())}>Start</button>
          )}
          <Link href={`/experiments/${id}/leaderboard`} className={cn(buttonVariants({ variant: "outline" }))}>Leaderboard</Link>
        </div>
      </div>

      <Tabs defaultValue="monitor">
        <TabsList>
          <TabsTrigger value="monitor">Monitor</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="monitor" className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Trials</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{trials.length}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Best Fitness</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {experiment.best_fitness != null ? experiment.best_fitness.toFixed(3) : trials.length > 0 ? Math.max(...trials.map((t) => t.fitness)).toFixed(3) : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Cost</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  ${trials.reduce((sum, t) => sum + t.cost_usd, 0).toFixed(4)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Fitness Over Trials</CardTitle></CardHeader>
            <CardContent>
              <FitnessChart data={chartData} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="details" className="mt-4">
          <ExperimentDetails config={config} experiment={experiment} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/experiments/[id]/monitor/monitor-client.tsx
git commit -m "feat: add Details tab to experiment monitor page"
```
