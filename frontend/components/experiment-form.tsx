"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ObjectiveSliders } from "@/components/objective-sliders";
import { api } from "@/lib/api";
import type { ExperimentConfig, ObjectiveWeights } from "@/lib/types";

const DEFAULT_WEIGHTS: ObjectiveWeights = { quality: 0.6, cost: 0.2, speed: 0.2 };

export function ExperimentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [judgeModel, setJudgeModel] = useState("gpt-4o-mini");
  const [rubric, setRubric] = useState("Rate the output 0 to 1 on accuracy, completeness, and clarity.");
  const [weights, setWeights] = useState<ObjectiveWeights>(DEFAULT_WEIGHTS);
  const [populationSize, setPopulationSize] = useState(20);
  const [budgetTrials, setBudgetTrials] = useState(200);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const config: ExperimentConfig = {
      name,
      task_description: taskDescription,
      dataset_id: datasetId,
      evaluators: [{ type: "llm_judge", params: { model: judgeModel, rubric } }],
      objective_weights: weights,
      population_size: populationSize,
      budget_max_trials: budgetTrials,
      convergence_patience: 10,
      concurrency: 5,
    };
    try {
      const exp = await api.experiments.create(config);
      router.push(`/experiments/${exp.id}/monitor`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      <div className="space-y-2">
        <Label htmlFor="name">Experiment Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. summarize-research-v1" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="task">Task Description</Label>
        <Textarea id="task" value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)} required placeholder="Describe the task the workflow should solve..." rows={3} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="dataset">Dataset ID</Label>
        <Input id="dataset" value={datasetId} onChange={(e) => setDatasetId(e.target.value)} required placeholder="e.g. ds_summarize_001" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="rubric">Evaluation Rubric</Label>
        <Textarea id="rubric" value={rubric} onChange={(e) => setRubric(e.target.value)} rows={2} />
      </div>

      <div className="space-y-2">
        <Label>Objective Weights</Label>
        <ObjectiveSliders value={weights} onChange={setWeights} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="pop">Population Size</Label>
          <Input id="pop" type="number" min={4} max={100} value={populationSize} onChange={(e) => setPopulationSize(Number(e.target.value))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="budget">Max Trials</Label>
          <Input id="budget" type="number" min={10} value={budgetTrials} onChange={(e) => setBudgetTrials(Number(e.target.value))} />
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating..." : "Create & Start Experiment"}
      </Button>
    </form>
  );
}
