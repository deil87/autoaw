import { ExperimentForm } from "@/components/experiment-form";
import type { ExperimentFormInitialValues } from "@/components/experiment-form";
import { api } from "@/lib/api";
import type { ExperimentConfig } from "@/lib/types";

interface PageProps {
  searchParams: { from?: string };
}

export default async function NewExperimentPage({ searchParams }: PageProps) {
  let initialValues: ExperimentFormInitialValues | undefined = undefined;

  if (searchParams.from) {
    try {
      const source = await api.experiments.get(searchParams.from);
      let config: ExperimentConfig | null = null;
      if (source.config_json) {
        config = JSON.parse(source.config_json) as ExperimentConfig;
      }
      if (config) {
        const llmEvaluator = config.evaluators.find((e) => e.type === "llm_judge");
        initialValues = {
          name: `Copy of ${config.name}`,
          task_description: config.task_description,
          dataset_id: config.dataset_id,
          rubric: typeof llmEvaluator?.params?.rubric === "string"
            ? llmEvaluator.params.rubric
            : undefined,
          objective_weights: config.objective_weights,
          population_size: config.population_size,
          budget_max_trials: config.budget_max_trials,
        };
      }
    } catch {
      // source fetch failed — fall through to empty form
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">
        {initialValues ? "Fork Experiment" : "New Experiment"}
      </h1>
      <ExperimentForm initialValues={initialValues} />
    </div>
  );
}
