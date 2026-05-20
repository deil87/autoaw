"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { GeneViewer } from "@/components/gene-viewer";
import { api } from "@/lib/api";
import type { Gene, Trial, EvalRow } from "@/lib/types";

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function EvalRowsTable({ rows }: { rows: EvalRow[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No per-row evaluation data recorded for this trial.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 pr-4 w-12 font-medium text-muted-foreground">#</th>
            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Input</th>
            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Output</th>
            <th className="text-right py-2 w-20 font-medium text-muted-foreground">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            let inputDisplay = row.input_json;
            try {
              const parsed = JSON.parse(row.input_json);
              inputDisplay = parsed.input ?? JSON.stringify(parsed);
            } catch {
              // keep raw
            }
            const isExpanded = expanded === row.row_index;
            return (
              <>
                <tr
                  key={row.row_index}
                  className="border-b cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpanded(isExpanded ? null : row.row_index)}
                >
                  <td className="py-2 pr-4 text-muted-foreground">{row.row_index}</td>
                  <td className="py-2 pr-4 max-w-xs truncate">{inputDisplay}</td>
                  <td className="py-2 pr-4 max-w-xs truncate">{row.output_text}</td>
                  <td className="py-2 text-right">
                    <span
                      className={`font-mono ${
                        row.score >= 0.7
                          ? "text-green-600"
                          : row.score >= 0.4
                          ? "text-yellow-600"
                          : "text-red-600"
                      }`}
                    >
                      {(row.score * 100).toFixed(0)}%
                    </span>
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${row.row_index}-expanded`} className="bg-muted/20">
                    <td colSpan={4} className="py-4 px-4">
                      <div className="space-y-2">
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase">Full Input</p>
                          <pre className="mt-1 text-xs whitespace-pre-wrap break-all">{row.input_json}</pre>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase">Full Output</p>
                          <pre className="mt-1 text-xs whitespace-pre-wrap break-all">{row.output_text}</pre>
                        </div>
                        {row.score_reasoning && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase">Judge Reasoning</p>
                            <p className="mt-1 text-xs">{row.score_reasoning}</p>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Latency: {row.latency_ms}ms · Cost: ${row.cost_usd.toFixed(6)}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TrialClient() {
  const { id, trialId } = useParams<{ id: string; trialId: string }>();
  const [gene, setGene] = useState<Gene | null>(null);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [evalRows, setEvalRows] = useState<EvalRow[]>([]);
  const [tab, setTab] = useState<"gene" | "evals">("gene");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.trials.get(id, trialId),
      api.trials.evalRows(id, trialId),
    ])
      .then(([t, rows]) => {
        setTrial(t);
        setEvalRows(rows);
        try {
          setGene(JSON.parse(t.gene_json) as Gene);
        } catch {
          setError("Gene JSON is malformed.");
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, trialId]);

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{error}</p>;
  if (!trial || !gene) return <p className="text-destructive">Trial not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gene Inspector</h1>
          <p className="text-xs text-muted-foreground mt-1 font-mono">{trial.id}</p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>Generation <strong>{trial.generation}</strong></div>
          {trial.mutation_op && (
            <div className="text-xs mt-0.5 font-mono">{trial.mutation_op}</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Fitness" value={trial.fitness.toFixed(4)} />
        <MetricCard label="Quality" value={`${(trial.quality * 100).toFixed(1)}%`} />
        <MetricCard label="Cost" value={`$${trial.cost_usd.toFixed(5)}`} />
        <MetricCard label="Latency" value={`${trial.latency_ms} ms`} />
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-4">
        {(["gene", "evals"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "gene" ? "Gene Inspector" : `Dataset Evaluation (${evalRows.length})`}
          </button>
        ))}
      </div>

      {tab === "gene" && <GeneViewer gene={gene} />}
      {tab === "evals" && <EvalRowsTable rows={evalRows} />}
    </div>
  );
}
