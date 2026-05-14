"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExperimentCard } from "@/components/experiment-card";
import { AutoAWLogo } from "@/components/autoaw-logo";
import { api } from "@/lib/api";
import type { Experiment } from "@/lib/types";

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.experiments
      .list()
      .then((data) => setExperiments(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Experiments</h1>
          <Link href="/experiments/new" className={cn(buttonVariants())}>New Experiment</Link>
      </div>

      {loading && <p className="text-muted-foreground">Loading...</p>}
      {error && <p className="text-destructive">Error: {error}</p>}
      {!loading && !error && experiments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-6">
          <AutoAWLogo width={320} height={160} />
          <div className="text-center">
            <h2 className="text-xl font-semibold tracking-tight">AutoAW</h2>
            <p className="text-muted-foreground mt-1 text-sm max-w-xs">
              AutoML for agentic workflows — co-evolve topology and prompts automatically.
            </p>
          </div>
          <Link href="/experiments/new" className={cn(buttonVariants())}>
            Create your first experiment
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {experiments.map((exp) => (
          <ExperimentCard key={exp.id} experiment={exp} />
        ))}
      </div>
    </div>
  );
}
