import type { Experiment, ExperimentConfig, Trial, EvalRow, LineageNode, BenchmarkDescriptor, EvaluatorTypeDescriptor, EcsStatus } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail ?? `HTTP ${resp.status}`);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

export const api = {
  experiments: {
    /** Returns a plain array of experiments */
    list: () => request<Experiment[]>("/experiments"),

    get: (id: string) => request<Experiment>(`/experiments/${id}`),

    create: (config: ExperimentConfig) =>
      request<Experiment>("/experiments", {
        method: "POST",
        body: JSON.stringify(config),
      }),

    delete: (id: string) =>
      request<void>(`/experiments/${id}`, { method: "DELETE" }),

    start: (id: string) =>
      request<{ status: string; experiment_id: string }>(`/experiments/${id}/start`, {
        method: "POST",
      }),

    stop: (id: string) =>
      request<{ status: string; experiment_id: string }>(`/experiments/${id}/stop`, {
        method: "POST",
      }),

    lineage: (id: string) =>
      request<LineageNode[]>(`/experiments/${id}/lineage`),
  },

  trials: {
    /** Returns a plain array of trials */
    list: (experimentId: string, page = 1, limit = 200) =>
      request<Trial[]>(
        `/experiments/${experimentId}/trials?page=${page}&limit=${limit}`
      ),

    get: (experimentId: string, trialId: string) =>
      request<Trial>(`/experiments/${experimentId}/trials/${trialId}`),

    evalRows: (experimentId: string, trialId: string) =>
      request<EvalRow[]>(
        `/experiments/${experimentId}/trials/${trialId}/eval-rows`
      ),
  },

  datasets: {
    list: () => request<{ dataset_id: string }[]>("/datasets"),

    get: (id: string) =>
      request<{ input: string; expected: string }[]>(`/datasets/${id}`),

    upload: async (file: File): Promise<{ dataset_id: string; records: number }> => {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch(`${API_BASE}/datasets`, { method: "POST", body: form });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail ?? `HTTP ${resp.status}`);
      }
      return resp.json();
    },
  },

  benchmarks: {
    list: () => request<BenchmarkDescriptor[]>("/benchmarks"),
  },

  evaluatorTypes: {
    list: () => request<EvaluatorTypeDescriptor[]>("/evaluator-types"),
  },

  infra: {
    ecsStatus: (experimentId?: string) =>
      request<EcsStatus>(experimentId ? `/infra/ecs?experiment_id=${experimentId}` : "/infra/ecs"),
  },
};
