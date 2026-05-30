"use client";
import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Edge as RFEdge,
} from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Agent, Gene } from "@/lib/types";

// ─── Layout ──────────────────────────────────────────────────────────────────
// Simple layered layout: assign each node a column based on BFS depth from
// source nodes (nodes with no incoming edges).

function computeLayout(
  agents: Agent[],
  edges: Gene["edges"]
): Map<string, { x: number; y: number }> {
  const inDegree = new Map<string, number>(agents.map((a) => [a.id, 0]));
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  // BFS columns
  const col = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of Array.from(inDegree.entries())) {
    if (deg === 0) { col.set(id, 0); queue.push(id); }
  }
  // Fallback: if all have in-edges (cycle), start from first
  if (queue.length === 0 && agents.length > 0) {
    col.set(agents[0].id, 0);
    queue.push(agents[0].id);
  }

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curCol = col.get(cur) ?? 0;
    for (const next of adj.get(cur) ?? []) {
      if (!col.has(next) || col.get(next)! < curCol + 1) {
        col.set(next, curCol + 1);
        queue.push(next);
      }
    }
  }

  // Assign unvisited
  for (const a of agents) {
    if (!col.has(a.id)) col.set(a.id, 0);
  }

  // Count nodes per column for vertical spacing
  const colCounts = new Map<number, number>();
  const colIndex = new Map<string, number>();
  for (const a of agents) {
    const c = col.get(a.id)!;
    const idx = colCounts.get(c) ?? 0;
    colIndex.set(a.id, idx);
    colCounts.set(c, idx + 1);
  }

  const NODE_W = 200;
  const NODE_H = 80;
  const COL_GAP = 120;
  const ROW_GAP = 40;

  const positions = new Map<string, { x: number; y: number }>();
  for (const a of agents) {
    const c = col.get(a.id)!;
    const idx = colIndex.get(a.id)!;
    const total = colCounts.get(c)!;
    const totalHeight = total * NODE_H + (total - 1) * ROW_GAP;
    positions.set(a.id, {
      x: c * (NODE_W + COL_GAP),
      y: idx * (NODE_H + ROW_GAP) - totalHeight / 2 + 300,
    });
  }
  return positions;
}

// ─── Custom node ─────────────────────────────────────────────────────────────

const EDGE_TYPE_COLOR: Record<string, string> = {
  sequential: "bg-blue-500",
  broadcast:  "bg-amber-500",
  reduce:     "bg-green-500",
  conditional:"bg-purple-500",
};

/** Return a short human-readable label for an agent's memory config. */
function memoryLabel(memory: Record<string, unknown> | undefined): string | null {
  if (!memory || Object.keys(memory).length === 0) return null;
  const type = memory.type as string | undefined;
  if (type === "buffer") return `buffer·${memory.window ?? "?"}`;
  if (type === "summary") return "summary";
  if (type === "vector") return `rag·${memory.top_k ?? "?"}`;
  return type ?? null;
}

function AgentNode({ data, selected }: NodeProps) {
  const agent = data.agent as Agent;
  const memLabel = memoryLabel(agent.memory);
  return (
    <div
      className={`rounded-xl border bg-card shadow-sm w-48 transition-shadow ${
        selected ? "ring-2 ring-primary shadow-md" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <div className="px-3 py-2">
        <p className="font-semibold text-sm capitalize truncate">{agent.role}</p>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <Badge variant="secondary" className="text-xs px-1.5">{agent.model}</Badge>
          <span className="text-xs text-muted-foreground">t={agent.temperature}</span>
          {memLabel && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300 text-[10px] px-1.5 py-0.5 font-medium cursor-default">
                    🧠 {memLabel}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[200px]">
                  {JSON.stringify(agent.memory, null, 2)}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

// ─── Edge label colours ───────────────────────────────────────────────────────

const EDGE_STROKE: Record<string, string> = {
  sequential:  "#3b82f6",
  broadcast:   "#f59e0b",
  reduce:      "#22c55e",
  conditional: "#a855f7",
};

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  gene: Gene;
  onSelectAgent: (agent: Agent | null) => void;
  selectedAgentId: string | null;
}

export function TopologyGraph({ gene, onSelectAgent, selectedAgentId }: Props) {
  const positions = useMemo(
    () => computeLayout(gene.agents, gene.edges),
    [gene.agents, gene.edges]
  );

  const nodes: Node[] = useMemo(
    () =>
      gene.agents.map((agent) => ({
        id: agent.id,
        type: "agent",
        position: positions.get(agent.id) ?? { x: 0, y: 0 },
        data: { agent },
        selected: agent.id === selectedAgentId,
      })),
    [gene.agents, positions, selectedAgentId]
  );

  const edges: RFEdge[] = useMemo(
    () =>
      gene.edges.map((e, i) => ({
        id: `edge-${i}`,
        source: e.from,
        target: e.to,
        label: e.type,
        animated: e.type === "broadcast",
        style: { stroke: EDGE_STROKE[e.type] ?? "#94a3b8" },
        labelStyle: { fontSize: 10, fill: EDGE_STROKE[e.type] ?? "#94a3b8" },
        labelBgStyle: { fill: "transparent" },
      })),
    [gene.edges]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const agent = gene.agents.find((a) => a.id === node.id) ?? null;
      onSelectAgent(agent?.id === selectedAgentId ? null : agent);
    },
    [gene.agents, onSelectAgent, selectedAgentId]
  );

  const onPaneClick = useCallback(() => onSelectAgent(null), [onSelectAgent]);

  const hasSharedScratchpad = gene.shared_memory?.type === "scratchpad";

  return (
    <div className="w-full rounded-xl border overflow-hidden">
      {hasSharedScratchpad && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-50 dark:bg-cyan-950 border-b text-xs text-cyan-700 dark:text-cyan-300 font-medium">
          <span>🗂️</span>
          <span>Shared scratchpad active — agents share a common key-value memory store</span>
        </div>
      )}
      <div className="h-[420px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.3}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <Controls />
          <MiniMap nodeStrokeWidth={3} zoomable pannable />
        </ReactFlow>
      </div>
    </div>
  );
}
