"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ExperimentCard } from "@/components/experiment-card";
import { api } from "@/lib/api";
import type { Experiment } from "@/lib/types";

function ExperimentCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
          <div className="h-5 w-16 rounded-full bg-muted animate-pulse" />
        </div>
        <div className="h-3 w-1/3 rounded bg-muted animate-pulse mt-1" />
      </CardHeader>
      <CardFooter className="gap-2">
        <div className="h-8 w-20 rounded bg-muted animate-pulse" />
        <div className="h-8 w-24 rounded bg-muted animate-pulse" />
        <div className="h-8 w-12 rounded bg-muted animate-pulse" />
      </CardFooter>
    </Card>
  );
}

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
      {/* Hero */}
      <div className="flex flex-col items-center justify-center py-8 gap-2 border-b mb-8">
        <p className="text-muted-foreground text-sm max-w-sm text-center">
          Auto Agentic Workflows — co-evolve topology and prompts automatically.
        </p>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Experiments</h1>
        <Link href="/experiments/new" className={cn(buttonVariants())}>New Experiment</Link>
      </div>

      {error && <p className="text-destructive">Error: {error}</p>}
      {!loading && !error && experiments.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-muted-foreground text-sm">No experiments yet.</p>
          <Link href="/experiments/new" className={cn(buttonVariants())}>
            Create your first experiment
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => <ExperimentCardSkeleton key={i} />)
          : experiments.map((exp) => <ExperimentCard key={exp.id} experiment={exp} />)}
      </div>
    </div>
  );
}
