"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Trial } from "@/lib/types";

type SortKey = "fitness" | "quality" | "cost" | "latency";

function Bar({ value, max, accent }: { value: number; max: number; accent?: boolean }) {
  return (
    <div className="bar" style={{ width: 56 }}>
      <div
        className={`bar-fill${accent ? " acc" : ""}`}
        style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
      />
    </div>
  );
}

export default function LeaderboardPage() {
  const { id } = useParams<{ id: string }>();
  const [trials, setTrials] = useState<Trial[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>("fitness");

  useEffect(() => {
    api.trials.list(id).then((data) => setTrials(data)).finally(() => setLoading(false));
  }, [id]);

  const sorted = useMemo(() => {
    const s = [...trials];
    if (sort === "fitness")  s.sort((a, b) => b.fitness - a.fitness);
    if (sort === "quality")  s.sort((a, b) => b.quality - a.quality);
    if (sort === "cost")     s.sort((a, b) => a.cost_usd - b.cost_usd);
    if (sort === "latency")  s.sort((a, b) => a.latency_ms - b.latency_ms);
    return s;
  }, [trials, sort]);

  const maxQ = useMemo(() => Math.max(...trials.map((t) => t.quality), 1), [trials]);
  const maxF = useMemo(() => Math.max(...trials.map((t) => t.fitness), 1), [trials]);
  const best = sorted[0];

  return (
    <div>
      <div className="detail-head">
        <div>
          <div className="crumb">
            <Link href="/experiments">Experiments</Link>
            <span>/</span>
            <Link href={`/experiments/${id}/monitor`}>Monitor</Link>
            <span>/</span>
            <span>Leaderboard</span>
          </div>
          <h1 className="detail-title">Leaderboard</h1>
          {!loading && (
            <div className="detail-meta">
              <span><span className="k">trials </span><span className="v">{trials.length}</span></span>
            </div>
          )}
        </div>
        <Link href={`/experiments/${id}/monitor`} className="btn">← Monitor</Link>
      </div>

      <div className="lb-filters">
        {(
          [
            { key: "fitness",  label: "Fitness ↓" },
            { key: "quality",  label: "Quality ↓" },
            { key: "cost",     label: "Cost ↑" },
            { key: "latency",  label: "Latency ↑" },
          ] as { key: SortKey; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            className={`pill${sort === key ? " active" : ""}`}
            onClick={() => setSort(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
              <div className="skeleton" style={{ height: 13, width: `${40 + (i % 3) * 15}%` }} />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <p>No trials yet.</p>
          <Link href={`/experiments/${id}/monitor`} className="btn btn-primary">
            Go to Monitor
          </Link>
        </div>
      ) : (
        <div className="card">
          <table className="t">
            <thead>
              <tr>
                <th style={{ width: 48 }}>#</th>
                <th>Candidate</th>
                <th className="num">Gen</th>
                <th>Mutation</th>
                <th className="num">Quality</th>
                <th className="num">Cost / run</th>
                <th className="num">Latency p50</th>
                <th className="num">Fitness</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 50).map((t, i) => {
                const isBest = best && t.id === best.id;
                return (
                  <tr key={t.id} className={isBest ? "row-best" : ""}>
                    <td className="rank">#{i + 1}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="mono" style={{ fontWeight: 600, fontSize: 12 }}>
                          {t.gene_id.slice(0, 12)}…
                        </span>
                        {isBest && <span className="lb-best">best</span>}
                      </div>
                    </td>
                    <td className="num">{t.generation}</td>
                    <td>
                      <span className="mono faint" style={{ fontSize: 11.5 }}>
                        {t.mutation_op || "init"}
                      </span>
                    </td>
                    <td className="num">
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <span>{t.quality.toFixed(3)}</span>
                        <Bar value={t.quality} max={maxQ} accent={isBest} />
                      </div>
                    </td>
                    <td className="num">${t.cost_usd.toFixed(4)}</td>
                    <td className="num">{(t.latency_ms / 1000).toFixed(2)}s</td>
                    <td className="num">
                      <b>{t.fitness.toFixed(4)}</b>
                    </td>
                    <td>
                      <Link
                        href={`/experiments/${id}/trial/${t.id}`}
                        className="btn btn-sm btn-ghost mono"
                      >
                        →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
