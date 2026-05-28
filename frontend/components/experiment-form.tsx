"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ObjectiveSliders } from "@/components/objective-sliders";
import { EvaluatorList } from "@/components/evaluator-list";
import { EvaluatorPicker } from "@/components/evaluator-picker";
import { ModelPicker } from "@/components/model-picker";
import { PipelineImporter } from "@/components/pipeline-importer";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ExperimentConfig, ObjectiveWeights, EvaluatorConfig, EvaluatorTypeDescriptor, Gene } from "@/lib/types";

const DEFAULT_WEIGHTS: ObjectiveWeights = { quality: 0.6, cost: 0.2, speed: 0.2 };
const DEFAULT_EVALUATORS: EvaluatorConfig[] = [
  { type: "llm_judge", params: { model: "gpt-4o-mini", rubric: "Rate the output 0 to 1 on accuracy, completeness, and clarity." } }
];

const TASK_TYPES = [
  {
    value: "objective",
    label: "Objective",
    description: "Fixed dataset, deterministic validator",
  },
  {
    value: "generative",
    label: "Generative",
    description: "Agent generates tasks + ground truth",
  },
  {
    value: "hybrid",
    label: "Hybrid",
    description: "Generative with deterministic gate",
  },
] as const;

type TaskType = (typeof TASK_TYPES)[number]["value"];

const NEEDS_DATASET: TaskType[] = ["objective", "hybrid"];

// Model pools — must stay in sync with backend/shared/experiment.py
const CLOUD_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "claude-3-5-haiku-20241022",
  "claude-3-5-sonnet-20241022",
  "amazon.nova-micro-v1:0",
  "amazon.nova-lite-v1:0",
  "meta.llama3-2-1b-instruct-v1:0",
  "meta.llama3-2-3b-instruct-v1:0",
  "meta.llama3-1-8b-instruct-v1:0",
];
const LOCAL_MODELS = ["llama3.2:1b"];
const ALL_MODELS = Array.from(new Set([...CLOUD_MODELS, ...LOCAL_MODELS]));

export interface ExperimentFormInitialValues {
  name?: string;
  task_description?: string;
  dataset_id?: string;
  task_type?: string;
  objective_weights?: ObjectiveWeights;
  population_size?: number;
  budget_max_trials?: number;
  runner_type?: string;
  evaluators?: EvaluatorConfig[];
  dataset_sample_size?: number | null;
  n_generations?: number;
  allowed_models?: string[];
}

interface ExperimentFormProps {
  initialValues?: ExperimentFormInitialValues;
}

export function ExperimentForm({ initialValues }: ExperimentFormProps = {}) {
  const router = useRouter();
  const [taskType, setTaskType] = useState<TaskType>(
    (initialValues?.task_type as TaskType) ?? "objective"
  );
  const [name, setName] = useState(initialValues?.name ?? "");
  const [taskDescription, setTaskDescription] = useState(initialValues?.task_description ?? "");
  const [datasetId, setDatasetId] = useState(initialValues?.dataset_id ?? "");
  const [datasetOptions, setDatasetOptions] = useState<string[]>([]);
  const [evaluators, setEvaluators] = useState<EvaluatorConfig[]>(
    initialValues?.evaluators ?? DEFAULT_EVALUATORS
  );
  const [catalog, setCatalog] = useState<EvaluatorTypeDescriptor[]>([]);
  const [weights, setWeights] = useState<ObjectiveWeights>(
    initialValues?.objective_weights ?? DEFAULT_WEIGHTS
  );
  const [populationSize, setPopulationSize] = useState(initialValues?.population_size ?? 20);
  const [budgetTrials, setBudgetTrials] = useState(initialValues?.budget_max_trials ?? 200);
  const [runnerType, setRunnerType] = useState(initialValues?.runner_type ?? "raw_llm");
  const [datasetSampleSize, setDatasetSampleSize] = useState<number | "">(
    initialValues?.dataset_sample_size ?? ""
  );
  const [nGenerations, setNGenerations] = useState<number>(
    initialValues?.n_generations ?? 1
  );
  const [seedGene, setSeedGene] = useState<Gene | null>(null);
  const [allowedModels, setAllowedModels] = useState<string[]>(
    initialValues?.allowed_models ?? CLOUD_MODELS
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsDataset = NEEDS_DATASET.includes(taskType);

  useEffect(() => {
    api.datasets.list().then((list) => {
      const ids = list.map((d) => d.dataset_id);
      setDatasetOptions(ids);
      if (ids.length > 0 && !datasetId) setDatasetId(ids[0]);
    }).catch(() => {});
    api.evaluatorTypes.list().then(setCatalog).catch(() => {});
  }, []);

  const toggleModel = (model: string) => {
    setAllowedModels((prev) =>
      prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model]
    );
  };

  const applyPreset = (preset: "cloud" | "local") => {
    setAllowedModels(preset === "cloud" ? CLOUD_MODELS : LOCAL_MODELS);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (allowedModels.length === 0) {
      setError("Select at least one model in the model pool.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const config: ExperimentConfig = {
      name,
      task_description: taskDescription,
      task_type: taskType,
      dataset_id: needsDataset ? datasetId : undefined,
      evaluators,
      objective_weights: weights,
      population_size: populationSize,
      budget_max_trials: budgetTrials,
      convergence_patience: 10,
      concurrency: 5,
      runner_type: runnerType,
      dataset_sample_size: needsDataset ? (datasetSampleSize === "" ? null : datasetSampleSize) : null,
      n_generations: taskType === "generative" ? nGenerations : undefined,
      seed_gene: seedGene ?? undefined,
      allowed_models: allowedModels,
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

      <PipelineImporter
        seeded={seedGene}
        onSeed={setSeedGene}
        onClear={() => setSeedGene(null)}
      />

      <div className="space-y-2">
        <Label>Experiment Type</Label>
        <div className="grid grid-cols-3 gap-2">
          {TASK_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTaskType(t.value)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-md border p-3 text-left text-sm transition-colors",
                taskType === t.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent"
              )}
            >
              <span className="font-medium">{t.label}</span>
              <span className="text-xs text-muted-foreground leading-snug">{t.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Experiment Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. summarize-research-v1" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="task">Task Description</Label>
        <Textarea id="task" value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)} required placeholder="Describe the task the workflow should solve..." rows={3} />
      </div>

      {taskType === "generative" && (
        <div className="space-y-2">
          <Label htmlFor="n-generations">Generations per trial</Label>
          <Input
            id="n-generations"
            type="number"
            min={1}
            value={nGenerations}
            onChange={(e) => setNGenerations(Math.max(1, Number(e.target.value)))}
          />
          <p className="text-xs text-muted-foreground">
            Number of synthetic task–answer pairs generated per trial evaluation.
          </p>
        </div>
      )}

      {needsDataset && (
        <>
          <div className="space-y-2">
            <Label htmlFor="dataset">Dataset</Label>
            {datasetOptions.length > 0 ? (
              <Select value={datasetId} onValueChange={(v) => v && setDatasetId(v)} required>
                <SelectTrigger id="dataset">
                  <SelectValue placeholder="Select a dataset" />
                </SelectTrigger>
                <SelectContent>
                  {datasetOptions.map((id) => (
                    <SelectItem key={id} value={id}>{id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="space-y-1">
                <Input id="dataset" value={datasetId} onChange={(e) => setDatasetId(e.target.value)} required placeholder="e.g. ds1" />
                <p className="text-xs text-muted-foreground">
                  No datasets found. <a href="/datasets" className="underline">Upload one</a> or enter an ID manually.
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label htmlFor="sample-size">Dataset Sample Size</Label>
              <Input
                id="sample-size"
                type="number"
                min={1}
                placeholder="All rows"
                value={datasetSampleSize}
                onChange={(e) => setDatasetSampleSize(e.target.value === "" ? "" : Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Number of rows to use. Leave blank to use all rows.
              </p>
            </div>
          </div>
        </>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Evaluators</Label>
          <EvaluatorPicker catalog={catalog} onAdd={(ev) => setEvaluators([...evaluators, ev])} />
        </div>
        <EvaluatorList evaluators={evaluators} catalog={catalog} onChange={setEvaluators} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label>Objective Weights</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs font-mono text-xs leading-relaxed p-3">
                <p className="mb-1 font-sans text-xs font-semibold not-italic">How fitness is calculated:</p>
                <p>fitness =</p>
                <p>&nbsp;&nbsp;<span className="text-green-400">w_quality</span> × quality_score</p>
                <p>&nbsp;&nbsp;− <span className="text-red-400">w_cost</span> × normalized_cost</p>
                <p>&nbsp;&nbsp;− <span className="text-orange-400">w_speed</span> × normalized_latency</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <ObjectiveSliders value={weights} onChange={setWeights} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-1.5">
          <Label>Model Pool</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs p-3">
                Models the GP operator can assign to agents during evolution. Use the <strong>Local</strong> preset if running a local inference server (e.g. Ollama) to avoid downloading multiple large model files.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => applyPreset("cloud")}
            className={cn(
              "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
              JSON.stringify(allowedModels.slice().sort()) === JSON.stringify(CLOUD_MODELS.slice().sort())
                ? "border-primary bg-primary/5 text-primary"
                : "border-border hover:bg-accent"
            )}
          >
            Cloud
          </button>
          <button
            type="button"
            onClick={() => applyPreset("local")}
            className={cn(
              "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
              JSON.stringify(allowedModels.slice().sort()) === JSON.stringify(LOCAL_MODELS.slice().sort())
                ? "border-primary bg-primary/5 text-primary"
                : "border-border hover:bg-accent"
            )}
          >
            Local
          </button>
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {ALL_MODELS.map((model) => (
            <label key={model} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allowedModels.includes(model)}
                onChange={() => toggleModel(model)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span className="font-mono text-xs">{model}</span>
            </label>
          ))}
        </div>
        {allowedModels.length === 0 && (
          <p className="text-xs text-destructive">Select at least one model.</p>
        )}
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
