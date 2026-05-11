export type TopologyType =
  | "fixed_pipeline"
  | "ai_orchestrated"
  | "debate"
  | "parallel_reduce"
  | "human_in_loop"
  | "hybrid";

export interface Agent {
  id: string;
  role: string;
  model: string;
  system_prompt: string;
  tools: string[];
  temperature: number;
}

export interface Edge {
  from: string;
  to: string;
  type: "sequential" | "broadcast" | "reduce" | "conditional";
}

export interface Gene {
  id: string;
  topology: TopologyType;
  agents: Agent[];
  edges: Edge[];
  topology_params: Record<string, unknown>;
}

export interface ObjectiveWeights {
  quality: number;
  cost: number;
  speed: number;
}

export interface EvaluatorConfig {
  type: "llm_judge" | "function" | "human";
  params: Record<string, unknown>;
}

export interface ExperimentConfig {
  name: string;
  task_description: string;
  dataset_id: string;
  evaluators: EvaluatorConfig[];
  objective_weights: ObjectiveWeights;
  population_size: number;
  budget_max_trials?: number;
  budget_max_usd?: number;
  convergence_patience: number;
  concurrency: number;
}

export type ExperimentStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// Matches actual backend response shape
export interface Experiment {
  id: string;
  name: string;
  status: ExperimentStatus;
  created_at: string;
  updated_at: string;
  best_fitness: number | null;
  best_gene_json?: string | null;
  config_json?: string;
  error_message?: string | null;
}

// Matches actual backend trial row shape
export interface Trial {
  id: string;
  experiment_id: string;
  generation: number;
  gene_id: string;
  gene_json: string;
  fitness: number;
  quality: number;
  cost_usd: number;
  latency_ms: number;
  created_at: string;
}
