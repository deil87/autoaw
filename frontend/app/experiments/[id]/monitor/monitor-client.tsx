"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FitnessChart } from "@/components/fitness-chart";
import { api } from "@/lib/api";
import { useExperimentSocket } from "@/lib/websocket";
import type { Experiment, Trial } from "@/lib/types";

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{experiment.name}</h1>
          <Badge className="mt-1">{experiment.status}</Badge>
        </div>
        <div className="flex gap-2">
          {(experiment.status === "pending") && (
            <button onClick={handleStart} className={cn(buttonVariants())}>Start</button>
          )}
          <Link href={`/experiments/${id}/leaderboard`} className={cn(buttonVariants({ variant: "outline" }))}>Leaderboard</Link>
        </div>
      </div>

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
    </div>
  );
}
