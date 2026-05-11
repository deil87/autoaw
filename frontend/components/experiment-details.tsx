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
