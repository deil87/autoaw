"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { FitnessChart } from "@/components/fitness-chart";
import { ExperimentDetails } from "@/components/experiment-details";
import { api } from "@/lib/api";
import { useExperimentSocket } from "@/lib/websocket";
import type { Experiment, Trial, ExperimentConfig } from "@/lib/types";

interface FitnessPoint { trial: number; fitness: number; quality: number; }

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string; dot: boolean }> = {
    running:   { cls: "chip chip-running",   label: "running",   dot: true  },
    pending:   { cls: "chip chip-pending",   label: "pending",   dot: false },
    completed: { cls: "chip chip-done",      label: "done",      dot: false },
    failed:    { cls: "chip chip-fail",      label: "failed",    dot: false },
    cancelled: { cls: "chip chip-cancelled", label: "cancelled", dot: false },
  };
  const m = map[status] ?? map.pending;
  return (
    <span className={m.cls}>
      {m.dot && <span className="chip-dot pulse" />}
      {m.label}
    </span>
  );
}

function MetricTile({
  label, value, delta, deltaNeg,
}: {
  label: string; value: string; delta?: string; deltaNeg?: boolean;
}) {
  return (
    <div className="metric-tile">
      <div className="metric-label">{label}</div>
      <div className="metric-value mono tabular">{value}</div>
      {delta && (
        <div className={`metric-delta${deltaNeg ? " neg" : ""}`}>{delta}</div>
      )}
    </div>
  );
}

function GenerationsLog({ trials }: { trials: Trial[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [trials.length]);

  const sorted = [...trials].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Trials log</div>
          <div className="card-subtitle">{trials.length} completed</div>
        </div>
      </div>
      <div className="log" ref={ref}>
        {sorted.length === 0 ? (
          <div className="log-row" style={{ color: "var(--faint)" }}>
            <span className="t">—</span>
            <span></span>
            <span className="m">No trials yet</span>
            <span></span>
          </div>
        ) : sorted.map((t, i) => (
          <div key={t.id || i} className="log-row">
            <span className="t">gen {t.generation}</span>
            <span className="l">{t.mutation_op || "INIT"}</span>
            <span className="m">
              <Link href={`/experiments/${t.experiment_id}/trial/${t.id}`}
                    style={{ color: "var(--text)" }}>
                {t.gene_id.slice(0, 12)}…
              </Link>
            </span>
            <span className={`delta${t.fitness < 0 ? " neg" : ""}`}>
              f={t.fitness.toFixed(3)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunStats({ trials, experiment }: { trials: Trial[]; experiment: Experiment }) {
  const totalCost = trials.reduce((s, t) => s + t.cost_usd, 0);
  const avgLatency = trials.length
    ? trials.reduce((s, t) => s + t.latency_ms, 0) / trials.length
    : 0;
  const bestQ = trials.length
    ? Math.max(...trials.map((t) => t.quality))
    : null;

  const config: ExperimentConfig | null = (() => {
    try { return experiment.config_json ? JSON.parse(experiment.config_json) : null; } catch { return null; }
  })();

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Run stats</div>
      </div>
      <div className="card-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
        {[
          { k: "trials", v: String(trials.length) },
          { k: "best fitness", v: experiment.best_fitness?.toFixed(4) ?? "—" },
          { k: "best quality", v: bestQ != null ? bestQ.toFixed(4) : "—" },
          { k: "total cost", v: `$${totalCost.toFixed(4)}` },
          { k: "avg latency", v: avgLatency > 0 ? `${(avgLatency / 1000).toFixed(2)}s` : "—" },
          { k: "population", v: String(config?.population_size ?? "—") },
          { k: "dataset", v: config?.dataset_id ?? "—" },
          { k: "status", v: experiment.status },
        ].map(({ k, v }, i, arr) => (
          <div key={k} className="stat-row" style={{ borderBottom: i < arr.length - 1 ? undefined : "none" }}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TABS = [
  { id: "monitor", label: "Monitor" },
  { id: "details", label: "Details" },
];

export default function MonitorPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [chartData, setChartData] = useState<FitnessPoint[]>([]);
  const [stopping, setStopping] = useState(false);
  const [tab, setTab] = useState("monitor");

  const refresh = useCallback(() => {
    api.experiments.get(id).then(setExperiment);
    api.trials.list(id).then((data) => {
      setTrials(data);
      setChartData(data.map((t, i) => ({ trial: i + 1, fitness: t.fitness, quality: t.quality })));
    });
  }, [id]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, [refresh]);

  useExperimentSocket(id, (event) => {
    if (event.type === "trial_complete") {
      const newTrial: Trial = {
        id: "",
        experiment_id: id,
        generation: event.generation,
        gene_id: event.gene_id,
        gene_json: "{}",
        fitness: event.fitness,
        quality: event.quality,
        cost_usd: event.cost_usd,
        latency_ms: event.latency_ms,
        created_at: new Date().toISOString(),
        parent_gene_ids: [],
        mutation_op: "",
      };
      setTrials((prev) => [newTrial, ...prev]);
      setChartData((prev) => [
        ...prev,
        { trial: prev.length + 1, fitness: event.fitness, quality: event.quality },
      ]);
    }
  });

  const handleStart = () =>
    api.experiments.start(id).then(() => api.experiments.get(id).then(setExperiment));

  const handleStop = () => {
    setStopping(true);
    api.experiments.stop(id)
      .then(() => api.experiments.get(id).then(setExperiment))
      .catch(() => setStopping(false));
  };

  if (!experiment) {
    return (
      <div>
        <div className="skeleton" style={{ height: 24, width: "30%", marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 14, width: "15%", marginBottom: 24 }} />
        <div className="workspace-3" style={{ marginBottom: 18 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="metric-tile">
              <div className="skeleton" style={{ height: 11, width: "50%", marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 28, width: "60%" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  let config: ExperimentConfig | null = null;
  try {
    if (experiment.config_json) config = JSON.parse(experiment.config_json) as ExperimentConfig;
  } catch { /* noop */ }

  const totalCost = trials.reduce((s, t) => s + t.cost_usd, 0);
  const bestFitness = experiment.best_fitness ?? (trials.length > 0 ? Math.max(...trials.map((t) => t.fitness)) : null);

  const progress = experiment.progress;
  const pct = progress && progress.rows_total > 0
    ? Math.round((progress.rows_done / progress.rows_total) * 100)
    : 0;
  const phaseLabel = progress?.phase === "smbo"
    ? "SMBO polish"
    : progress ? `GP · gen ${progress.generation}` : "";

  return (
    <div>
      {/* Header */}
      <div className="detail-head">
        <div>
          <div className="crumb">
            <Link href="/experiments">Experiments</Link>
            <span>/</span>
            <span>{experiment.name}</span>
          </div>
          <h1 className="detail-title">{experiment.name}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <StatusChip status={experiment.status} />
            <div className="detail-meta" style={{ margin: 0 }}>
              <span><span className="k">created </span><span className="v">{new Date(experiment.created_at).toLocaleDateString()}</span></span>
              <span><span className="k">trials </span><span className="v">{trials.length}</span></span>
              {config && <span><span className="k">dataset </span><span className="v mono">{config.dataset_id}</span></span>}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-start" }}>
          {experiment.status === "pending" && (
            <button onClick={handleStart} className="btn btn-primary">Start</button>
          )}
          {experiment.status === "running" && (
            <button onClick={handleStop} disabled={stopping} className="btn btn-danger">
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
          <Link href={`/experiments/new?from=${id}`} className="btn">Fork</Link>
          <Link href={`/experiments/${id}/leaderboard`} className="btn">Leaderboard</Link>
          <Link href={`/experiments/${id}/evolution`} className="btn">Evolution</Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="aw-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`aw-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "monitor" && (
        <div>
          {/* Metric tiles */}
          <div className="workspace-3" style={{ marginBottom: 18 }}>
            <MetricTile
              label="Best fitness"
              value={bestFitness != null ? bestFitness.toFixed(4) : "—"}
            />
            <MetricTile
              label="Trials completed"
              value={String(trials.length)}
            />
            <MetricTile
              label="Total cost"
              value={`$${totalCost.toFixed(4)}`}
            />
          </div>

          {/* Progress bar (when running) */}
          {experiment.status === "running" && progress && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="card-header">
                <div className="card-title">Current trial progress</div>
                <span className="chip mono">{phaseLabel}</span>
              </div>
              <div className="card-body">
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 8, fontFamily: "var(--mono)" }}>
                  <span>Row {progress.rows_done} / {progress.rows_total}</span>
                  <span>
                    {progress.eta_s > 0
                      ? `~${Math.ceil(progress.eta_s / 60)} min remaining`
                      : "finishing…"}
                  </span>
                </div>
                <div className="bar">
                  <div className="bar-fill running" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* Fitness chart + run stats */}
          <div className="workspace" style={{ marginBottom: 18 }}>
            <div className="card">
              <div className="card-header">
                <div className="card-title">Fitness over trials</div>
                <div className="card-subtitle">{chartData.length} data points</div>
              </div>
              <div className="card-body">
                <FitnessChart data={chartData} />
              </div>
            </div>
            <RunStats trials={trials} experiment={experiment} />
          </div>

          {/* Trials log */}
          <GenerationsLog trials={trials} />
        </div>
      )}

      {tab === "details" && (
        <ExperimentDetails config={config} experiment={experiment} />
      )}
    </div>
  );
}
