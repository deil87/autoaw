"use client";
import { useEffect, useState } from "react";
import { GeneViewer } from "@/components/gene-viewer";
import { api } from "@/lib/api";
import type { Gene, Trial } from "@/lib/types";

export default function TrialPage({ params }: { params: { id: string; geneId: string } }) {
  const { id, geneId } = params;
  const [gene, setGene] = useState<Gene | null>(null);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.trials.list(id, 1, 500).then((trials) => {
      const found = trials.find((t) => t.gene_id === geneId);
      if (found) {
        setTrial(found);
        try {
          setGene(JSON.parse(found.gene_json) as Gene);
        } catch {
          // gene_json was malformed
        }
      }
    }).finally(() => setLoading(false));
  }, [id, geneId]);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!gene) return <p className="text-destructive">Trial not found.</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Gene Inspector</h1>
        {trial && (
          <span className="text-sm text-muted-foreground">
            Fitness: <strong>{trial.fitness.toFixed(4)}</strong>
            {" · "}Quality: <strong>{(trial.quality * 100).toFixed(1)}%</strong>
            {" · "}Cost: <strong>${trial.cost_usd.toFixed(5)}</strong>
          </span>
        )}
      </div>
      <GeneViewer gene={gene} />
    </div>
  );
}
