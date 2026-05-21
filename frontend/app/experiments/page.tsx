"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Experiment, EcsStatus } from "@/lib/types";

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

function SkeletonRow() {
  return (
    <div className="exp-row" style={{ cursor: "default" }}>
      <div>
        <div className="skeleton" style={{ height: 14, width: "60%", marginBottom: 6 }} />
        <div className="skeleton" style={{ height: 11, width: "40%" }} />
      </div>
      <div className="skeleton" style={{ height: 20, width: 64, borderRadius: 999 }} />
      <div>
        <div className="skeleton" style={{ height: 11, width: "50%", marginBottom: 6 }} />
        <div className="skeleton" style={{ height: 5, borderRadius: 99 }} />
      </div>
      <div>
        <div className="skeleton" style={{ height: 11, width: "40%", marginBottom: 4 }} />
        <div className="skeleton" style={{ height: 13, width: "30%" }} />
      </div>
      <div>
        <div className="skeleton" style={{ height: 11, width: "40%", marginBottom: 4 }} />
        <div className="skeleton" style={{ height: 13, width: "30%" }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div className="skeleton" style={{ height: 28, width: 70, borderRadius: 6 }} />
        <div className="skeleton" style={{ height: 28, width: 90, borderRadius: 6 }} />
      </div>
    </div>
  );
}

function ExperimentRow({
  exp,
  onStopSuccess,
  onDeleteSuccess,
}: {
  exp: Experiment;
  onStopSuccess: (id: string) => void;
  onDeleteSuccess: (id: string) => void;
}) {
  const router = useRouter();
  const [stopping, setStopping] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setStopping(true);
    try {
      await api.experiments.stop(exp.id);
      onStopSuccess(exp.id);
    } finally {
      setStopping(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete experiment "${exp.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.experiments.delete(exp.id);
      onDeleteSuccess(exp.id);
    } finally {
      setDeleting(false);
    }
  };
  const config = (() => {
    try { return exp.config_json ? JSON.parse(exp.config_json) : null; } catch { return null; }
  })();

  const bestFitness = exp.best_fitness;
  const trials = 0; // we don't have trial count without fetching
  const created = new Date(exp.created_at);
  const dateStr = created.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " + created.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  const progress = exp.progress;
  const pct = progress && progress.rows_total > 0
    ? Math.round((progress.rows_done / progress.rows_total) * 100)
    : exp.status === "completed" ? 100 : 0;

  return (
    <div
      className="exp-row"
      onClick={() => router.push(`/experiments/${exp.id}/monitor`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") router.push(`/experiments/${exp.id}/monitor`); }}
    >
      <div>
        <div className="name">{exp.name}</div>
        <div className="name-sub">{dateStr}</div>
      </div>

      <div>
        <StatusChip status={exp.status} />
      </div>

      <div>
        <div className="col-label">progress</div>
        <div style={{ marginTop: 6 }}>
          <div className="bar">
            <div
              className={`bar-fill${exp.status === "running" ? " running" : ""}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mono faint" style={{ fontSize: 11, marginTop: 4 }}>
            {progress
              ? `gen ${progress.generation} · ${pct}%`
              : exp.status === "completed" ? "100%" : "—"}
          </div>
        </div>
      </div>

      <div>
        <div className="col-label">best fitness</div>
        <div className="col-value">
          {bestFitness != null ? bestFitness.toFixed(3) : "—"}
        </div>
      </div>

      <div>
        <div className="col-label">objective</div>
        <div className="col-value">
          {config?.objective_weights
            ? `q·${config.objective_weights.quality} c·${config.objective_weights.cost} s·${config.objective_weights.speed}`
            : "—"}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn-sm"
          onClick={(e) => { e.stopPropagation(); router.push(`/experiments/${exp.id}/monitor`); }}
        >
          Monitor
        </button>
        {(exp.status === "running" || exp.status === "pending") && (
          <button
            className="btn btn-sm btn-danger"
            onClick={handleStop}
            disabled={stopping}
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
        <button
          className="btn btn-sm btn-ghost mono"
          onClick={(e) => { e.stopPropagation(); router.push(`/experiments/new?from=${exp.id}`); }}
        >
          Fork →
        </button>
        <button
          className="btn btn-sm btn-ghost mono"
          onClick={handleDelete}
          disabled={deleting}
          style={{ color: "var(--err, #ef4444)" }}
        >
          {deleting ? "…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

type FilterKey = "all" | "running" | "completed" | "pending" | "failed";

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [ecsStatus, setEcsStatus] = useState<EcsStatus | null>(null);

  useEffect(() => {
    api.experiments
      .list()
      .then((data) => {
        setExperiments(data);
        if (data.some((e) => e.status === "pending" || e.status === "running")) {
          api.infra.ecsStatus().then(setEcsStatus).catch(() => null);
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const counts = {
    all: experiments.length,
    running: experiments.filter((e) => e.status === "running").length,
    completed: experiments.filter((e) => e.status === "completed").length,
    pending: experiments.filter((e) => e.status === "pending").length,
    failed: experiments.filter((e) => e.status === "failed").length,
  };

  const visible = filter === "all" ? experiments : experiments.filter((e) => e.status === filter);

  return (
    <div>
      <div className="exp-list-head">
        <div>
          <h1>Experiments</h1>
          {!loading && (
            <div className="sub">
              {experiments.length} experiment{experiments.length !== 1 ? "s" : ""}
              {counts.running > 0 && ` · ${counts.running} running`}
            </div>
          )}
        </div>
        <Link href="/experiments/new" className="btn btn-primary">
          + New experiment
        </Link>
      </div>

      {!loading && experiments.length > 0 && (
        <div className="lb-filters" style={{ marginBottom: 16 }}>
          {(["all", "running", "completed", "pending", "failed"] as FilterKey[]).map((key) => {
            const n = counts[key];
            if (key !== "all" && n === 0) return null;
            return (
              <button
                key={key}
                className={`pill${filter === key ? " active" : ""}`}
                onClick={() => setFilter(key)}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
                {n > 0 && <span className="mono" style={{ marginLeft: 4, opacity: 0.65 }}>{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 16px", background: "var(--err-soft)", border: "1px solid rgba(185,28,28,0.2)", borderRadius: "var(--r-3)", color: "var(--err)", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {ecsStatus && ecsStatus.pending > 0 && ecsStatus.running === 0 && (
        <div style={{ padding: "12px 16px", background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.3)", borderRadius: "var(--r-3)", fontSize: 13, marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 15 }}>⚠</span>
          <div>
            <span style={{ fontWeight: 600 }}>Engine tasks not starting</span>
            <span style={{ color: "var(--muted)", marginLeft: 8 }}>
              {ecsStatus.desired} desired · {ecsStatus.pending} pending · {ecsStatus.running} running
            </span>
            {ecsStatus.stopped_tasks.length > 0 && (
              <div style={{ marginTop: 4, color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12 }}>
                Last stop reason: {ecsStatus.stopped_tasks[0].stopped_reason || "unknown"}
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && !error && experiments.length === 0 ? (
        <div className="empty-state">
          <p>No experiments yet.</p>
          <Link href="/experiments/new" className="btn btn-primary">
            Create your first experiment
          </Link>
        </div>
      ) : (
        <div className="exp-list-card">
          <div className="head-row">
            <span>Experiment</span>
            <span>Status</span>
            <span>Progress</span>
            <span>Best fitness</span>
            <span>Objective</span>
            <span></span>
          </div>
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
            : visible.map((exp) => (
                <ExperimentRow
                  key={exp.id}
                  exp={exp}
                  onStopSuccess={(id) =>
                    setExperiments((prev) =>
                      prev.map((e) => e.id === id ? { ...e, status: "cancelled" } : e)
                    )
                  }
                  onDeleteSuccess={(id) =>
                    setExperiments((prev) => prev.filter((e) => e.id !== id))
                  }
                />
              ))}
        </div>
      )}
    </div>
  );
}
