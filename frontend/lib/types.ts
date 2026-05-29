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

export interface EvaluatorParamSpec {
  name: string;
  type: "string" | "number" | "select" | "textarea";
  label: string;
  description: string;
  default: unknown;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface EvaluatorTypeDescriptor {
  type: string;
  name: string;
  description: string;
  category: "built_in" | "ragas" | "deepeval";
  params: EvaluatorParamSpec[];
}

export interface EvaluatorConfig {
  type: string;
  params: Record<string, unknown>;
}

export interface BenchmarkDescriptor {
  id: string;
  name: string;
  description: string;
  paper_url: string;
  dataset_id: string;
  runner_type: string;
  evaluators: EvaluatorConfig[];
  default_objective: {
    quality_weight: number;
    cost_weight: number;
    speed_weight: number;
  };
  task_count: number;
}

export interface ExperimentConfig {
  name: string;
  task_description: string;
  evaluators: EvaluatorConfig[];
  objective_weights: ObjectiveWeights;
  dataset_id?: string;
  task_type?: string;
  population_size: number;
  budget_max_trials?: number;
  budget_max_usd?: number;
  convergence_patience: number;
  concurrency: number;
  runner_type?: string;
  dataset_sample_size?: number | null;
  n_generations?: number;
  seed_gene?: Gene | null;
  allowed_models?: string[];
}

export interface GeneConversionResult {
  gene: Gene;
  topology: string;
  notes: string[];
}

export interface RubricParseResult {
  rubric_json: string;          // JSON string ready to paste into the rubric field
  dimensions: string[];         // extracted dimension names
  notes: string[];              // LLM interpretation notes
}

export interface ExperimentProgress {
  rows_done: number;
  rows_total: number;
  generation: number;
  phase: "gp" | "smbo" | "init";
  avg_row_ms: number;
  eta_s: number;
  message?: string; // human-readable status during "init" phase
}

export type ExperimentStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type StopReason =
  | "converged"
  | "budget_trials"
  | "budget_usd"
  | "cancelled"
  | "max_generations"
  | "empty_generation";

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
  stop_reason?: StopReason | null;
  progress?: ExperimentProgress | null;
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
  cost_usd: number;       // average workflow (training) cost per row
  eval_cost_usd: number;  // average evaluator cost per row
  latency_ms: number;
  created_at: string;
  parent_gene_ids: string[];
  mutation_op: string;
}

export interface EvalRow {
  id: string;
  trial_id: string;
  row_index: number;
  input_json: string;
  output_text: string;
  score: number;
  score_reasoning: string;
  latency_ms: number;
  cost_usd: number;       // workflow execution cost for this row
  eval_cost_usd: number;  // evaluator cost for this row
  sub_scores?: Record<string, number>;  // per-metric/dimension scores (empty when single evaluator without dimensions)
}

export interface EcsTaskContainer {
  name: string;
  status?: string;
  exit_code?: number | null;
  reason: string;
}

export interface EcsPendingTask {
  task_id: string;
  containers: EcsTaskContainer[];
}

export interface EcsStoppedTask {
  task_id: string;
  stopped_reason: string;
  stopped_at: string | null;
  containers: EcsTaskContainer[];
}

export interface EcsStatus {
  desired: number;
  pending: number;
  running: number;
  status: string;
  pending_tasks: EcsPendingTask[];
  stopped_tasks: EcsStoppedTask[];
}

export interface LineageNode {
  id: string;
  gene_id: string;
  generation: number;
  fitness: number;
  quality: number;
  cost_usd: number;
  latency_ms: number;
  parent_gene_ids: string[];
  mutation_op: string;
  created_at: string;
}
