"use client";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Trial } from "@/lib/types";

interface Props {
  trials: Trial[];
  experimentId: string;
}

export function TrialTable({ trials, experimentId }: Props) {
  const sorted = [...trials].sort((a, b) => b.fitness - a.fitness);

  const totalTrainingCost = trials.reduce((sum, t) => sum + (t.cost_usd ?? 0), 0);
  const totalEvalCost = trials.reduce((sum, t) => sum + (t.eval_cost_usd ?? 0), 0);
  const totalCost = totalTrainingCost + totalEvalCost;

  return (
    <div className="space-y-2">
      {/* Per-trial cost breakdown summary */}
      <div className="flex gap-4 text-sm text-muted-foreground px-1">
        <span>
          <span className="font-medium text-foreground">Training:</span>{" "}
          ${totalTrainingCost.toFixed(5)}
        </span>
        <span className="text-muted-foreground">+</span>
        <span>
          <span className="font-medium text-foreground">Eval:</span>{" "}
          ${totalEvalCost.toFixed(5)}
        </span>
        <span className="text-muted-foreground">=</span>
        <span>
          <span className="font-medium text-foreground">Total:</span>{" "}
          ${totalCost.toFixed(5)}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rank</TableHead>
            <TableHead>Gene ID</TableHead>
            <TableHead>Generation</TableHead>
            <TableHead>Fitness</TableHead>
            <TableHead>Quality</TableHead>
            <TableHead title="Avg workflow cost per row (running gene agents)">Training Cost</TableHead>
            <TableHead title="Avg evaluator cost per row (LLM judge scoring)">Eval Cost</TableHead>
            <TableHead>Latency</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((trial, i) => (
            <TableRow key={trial.gene_id + i}>
              <TableCell className="font-medium">#{i + 1}</TableCell>
              <TableCell className="font-mono text-xs">{trial.gene_id.slice(0, 12)}…</TableCell>
              <TableCell>{trial.generation}</TableCell>
              <TableCell>{trial.fitness.toFixed(4)}</TableCell>
              <TableCell>{(trial.quality * 100).toFixed(1)}%</TableCell>
              <TableCell>${(trial.cost_usd ?? 0).toFixed(5)}</TableCell>
              <TableCell>${(trial.eval_cost_usd ?? 0).toFixed(5)}</TableCell>
              <TableCell>{trial.latency_ms}ms</TableCell>
              <TableCell>
                <Link href={`/experiments/${experimentId}/trial/${trial.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Inspect</Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
