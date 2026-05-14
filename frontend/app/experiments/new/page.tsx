"use client";
import { useState, useEffect } from "react";
import { ExperimentForm } from "@/components/experiment-form";
import type { ExperimentFormInitialValues } from "@/components/experiment-form";
import { BenchmarkCard } from "@/components/benchmark-card";
import { api } from "@/lib/api";
import type { BenchmarkDescriptor } from "@/lib/types";

const COMING_SOON_BENCHMARKS: BenchmarkDescriptor[] = [
  {
    id: "gaia",
    name: "GAIA",
    description: "Diverse real-world tasks with pass/fail ground truth.",
    paper_url: "https://arxiv.org/abs/2311.12983",
    task_count: 466,
    dataset_id: "",
    runner_type: "",
    evaluators: [],
    default_objective: { quality_weight: 0.6, cost_weight: 0.2, speed_weight: 0.2 },
  },
  {
    id: "swe-bench",
    name: "SWE-bench",
    description: "GitHub issue resolution — binary correctness via test suite.",
    paper_url: "https://www.swebench.com",
    task_count: 2294,
    dataset_id: "",
    runner_type: "",
    evaluators: [],
    default_objective: { quality_weight: 0.6, cost_weight: 0.2, speed_weight: 0.2 },
  },
  {
    id: "tau-bench",
    name: "τ-bench",
    description: "Tool-augmented realistic user/agent conversations.",
    paper_url: "https://arxiv.org/abs/2406.12045",
    task_count: 120,
    dataset_id: "",
    runner_type: "",
    evaluators: [],
    default_objective: { quality_weight: 0.6, cost_weight: 0.2, speed_weight: 0.2 },
  },
  {
    id: "agentbench",
    name: "AgentBench",
    description: "Multi-environment agent evaluation (OS, DB, web, games).",
    paper_url: "https://arxiv.org/abs/2308.03688",
    task_count: 1091,
    dataset_id: "",
    runner_type: "",
    evaluators: [],
    default_objective: { quality_weight: 0.6, cost_weight: 0.2, speed_weight: 0.2 },
  },
];

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
      evaluators: b.evaluators,
      objective_weights: {
        quality: b.default_objective.quality_weight,
        cost: b.default_objective.cost_weight,
        speed: b.default_objective.speed_weight,
      },
    });
  };

  const comingSoonIds = new Set(COMING_SOON_BENCHMARKS.map((b) => b.id));
  const liveIds = new Set(benchmarks.map((b) => b.id));
  const visibleComingSoon = COMING_SOON_BENCHMARKS.filter((b) => !liveIds.has(b.id));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">New Experiment</h1>

      <div className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold">Predefined Benchmarks</h2>
        <p className="text-sm text-muted-foreground">
          Select a benchmark to pre-fill the form below, or configure manually.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {benchmarks.map((b) => (
            <BenchmarkCard key={b.id} benchmark={b} onSelect={handleSelectBenchmark} />
          ))}
          {visibleComingSoon.map((b) => (
            <BenchmarkCard key={b.id} benchmark={b} onSelect={() => {}} comingSoon />
          ))}
        </div>
      </div>

      <ExperimentForm key={JSON.stringify(initialValues)} initialValues={initialValues} />
    </div>
  );
}
