"use client";
import { useState, useEffect } from "react";
import { ExperimentForm } from "@/components/experiment-form";
import type { ExperimentFormInitialValues } from "@/components/experiment-form";
import { BenchmarkCard } from "@/components/benchmark-card";
import { api } from "@/lib/api";
import type { BenchmarkDescriptor } from "@/lib/types";

export default function NewExperimentPage() {
  const [benchmarks, setBenchmarks] = useState<BenchmarkDescriptor[]>([]);
  const [initialValues, setInitialValues] = useState<ExperimentFormInitialValues | undefined>(
    undefined
  );

  useEffect(() => {
    api.benchmarks.list().then(setBenchmarks).catch(() => {});
  }, []);

  const handleSelectBenchmark = (b: BenchmarkDescriptor) => {
    setInitialValues({
      name: `${b.name} Run ${new Date().toISOString().slice(0, 10)}`,
      task_description: b.description,
      dataset_id: b.dataset_id,
      runner_type: b.runner_type,
      evaluator_type: b.evaluator_type,
      objective_weights: {
        quality: b.default_objective.quality_weight,
        cost: b.default_objective.cost_weight,
        speed: b.default_objective.speed_weight,
      },
    });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">New Experiment</h1>

      {benchmarks.length > 0 && (
        <div className="mb-8 space-y-3">
          <h2 className="text-lg font-semibold">Predefined Benchmarks</h2>
          <p className="text-sm text-muted-foreground">
            Select a benchmark to pre-fill the form below.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {benchmarks.map((b) => (
              <BenchmarkCard key={b.id} benchmark={b} onSelect={handleSelectBenchmark} />
            ))}
          </div>
        </div>
      )}

      <ExperimentForm key={JSON.stringify(initialValues)} initialValues={initialValues} />
    </div>
  );
}
