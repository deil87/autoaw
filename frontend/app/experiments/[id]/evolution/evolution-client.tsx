"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/api";
import type { LineageNode } from "@/lib/types";
import { useRouter, usePathname } from "next/navigation";

const MUTATION_COLORS: Record<string, string> = {
  seed: "#6366f1",
  survived: "#64748b",
  mutate_structure: "#f59e0b",
  mutate_prompt: "#10b981",
  mutate_param: "#3b82f6",
  crossover_subgraph: "#ec4899",
  crossover_prompt: "#8b5cf6",
};

const NODE_WIDTH = 160;
const NODE_HEIGHT = 80;
const H_GAP = 40;
const V_GAP = 120;

function buildGraph(
  lineage: LineageNode[],
  experimentId: string
): { nodes: Node[]; edges: Edge[] } {
  const byGen = new Map<number, LineageNode[]>();
  for (const n of lineage) {
    const arr = byGen.get(n.generation) ?? [];
    arr.push(n);
    byGen.set(n.generation, arr);
  }

  // Best trial per generation (gold border)
  const bestByGen = new Map<number, string>();
  for (const [gen, nodes] of Array.from(byGen.entries())) {
    const best = nodes.reduce((a: LineageNode, b: LineageNode) => (b.fitness > a.fitness ? b : a));
    bestByGen.set(gen, best.id);
  }

  // gene_id → trial id (latest trial per gene)
  const geneToTrial = new Map<string, string>();
  for (const n of lineage) {
    geneToTrial.set(n.gene_id, n.id);
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const [gen, genNodes] of Array.from(byGen.entries()).sort(
    ([a], [b]) => a - b
  )) {
    genNodes.forEach((n, idx) => {
      const x = idx * (NODE_WIDTH + H_GAP);
      const y = gen * (NODE_HEIGHT + V_GAP);
      const isBest = bestByGen.get(gen) === n.id;
      const color = MUTATION_COLORS[n.mutation_op] ?? "#94a3b8";

      nodes.push({
        id: n.id,
        position: { x, y },
        data: {
          label: (
            <div
              style={{
                fontSize: 11,
                lineHeight: 1.4,
                textAlign: "center",
                padding: "4px 6px",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  color,
                  textTransform: "uppercase",
                  fontSize: 9,
                  letterSpacing: "0.05em",
                }}
              >
                {n.mutation_op}
              </div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {(n.fitness * 100).toFixed(1)}%
              </div>
              <div style={{ color: "#64748b", fontSize: 10 }}>
                {n.gene_id.slice(0, 10)}
              </div>
            </div>
          ),
          trialId: n.id,
          experimentId,
        },
        style: {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          border: isBest ? "2px solid #f59e0b" : `1px solid ${color}`,
          borderRadius: 8,
          background: isBest ? "#fffbeb" : "#f8fafc",
          cursor: "pointer",
        },
      });

      for (const parentGeneId of n.parent_gene_ids) {
        const parentTrialId = geneToTrial.get(parentGeneId);
        if (parentTrialId) {
          edges.push({
            id: `${parentTrialId}->${n.id}`,
            source: parentTrialId,
            target: n.id,
            label: n.mutation_op,
            style: { stroke: color, strokeWidth: 1.5 },
            labelStyle: { fontSize: 9, fill: color },
          });
        }
      }
    });
  }

  return { nodes, edges };
}

export function EvolutionClient() {
  const experimentId = usePathname().split("/")[2];
  const [lineage, setLineage] = useState<LineageNode[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    api.experiments
      .lineage(experimentId)
      .then((data) => {
        setLineage(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [experimentId]);

  const { nodes, edges } = useMemo(
    () => buildGraph(lineage, experimentId),
    [lineage, experimentId]
  );

  // Generation lane labels as non-interactive overlay nodes
  const laneNodes: Node[] = useMemo(() => {
    const gens = new Set(lineage.map((n) => n.generation));
    return Array.from(gens).map((gen) => ({
      id: `lane-${gen}`,
      position: { x: -120, y: gen * (NODE_HEIGHT + V_GAP) + NODE_HEIGHT / 4 },
      data: { label: `Gen ${gen}` },
      style: {
        width: 80,
        height: 32,
        fontSize: 12,
        fontWeight: 600,
        color: "#64748b",
        background: "transparent",
        border: "none",
        pointerEvents: "none" as const,
      },
      selectable: false,
      draggable: false,
    }));
  }, [lineage]);

  if (loading) {
    return <p className="p-8 text-muted-foreground">Loading evolution data…</p>;
  }

  if (lineage.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-2">Evolution Canvas</h1>
        <p className="text-muted-foreground">
          No trials recorded yet. Start the experiment to see the population evolve.
        </p>
      </div>
    );
  }

  const generationCount = new Set(lineage.map((n) => n.generation)).size;

  return (
    <div className="flex flex-col h-screen">
      <div className="p-6 border-b flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Evolution Canvas</h1>
          <p className="text-sm text-muted-foreground">
            {lineage.length} trials across {generationCount} generation
            {generationCount !== 1 ? "s" : ""}. Click a node to inspect the
            trial.
          </p>
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(MUTATION_COLORS).map(([op, color]) => (
            <span
              key={op}
              className="text-xs px-2 py-0.5 rounded-full border"
              style={{ borderColor: color, color }}
            >
              {op}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1">
        <ReactFlow
          nodes={[...laneNodes, ...nodes]}
          edges={edges}
          fitView
          onNodeClick={(_, node) => {
            if (node.data?.trialId) {
              router.push(
                `/experiments/${experimentId}/trial/${node.data.trialId}`
              );
            }
          }}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}
