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
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Rank</TableHead>
          <TableHead>Gene ID</TableHead>
          <TableHead>Generation</TableHead>
          <TableHead>Fitness</TableHead>
          <TableHead>Quality</TableHead>
          <TableHead>Cost</TableHead>
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
            <TableCell>${trial.cost_usd.toFixed(5)}</TableCell>
            <TableCell>{trial.latency_ms}ms</TableCell>
            <TableCell>
              <Link href={`/experiments/${experimentId}/trial/${trial.gene_id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Inspect</Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
