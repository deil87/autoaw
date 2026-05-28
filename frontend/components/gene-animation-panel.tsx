"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import type { Trial, Gene } from "@/lib/types";

const MUTATION_COLORS: Record<string, string> = {
  seed:               "#6366f1",
  survived:           "#64748b",
  mutate_structure:   "#f59e0b",
  mutate_prompt:      "#10b981",
  mutate_param:       "#3b82f6",
  crossover_subgraph: "#ec4899",
  crossover_prompt:   "#8b5cf6",
};

const MUTATION_LABELS: Record<string, string> = {
  seed:               "seed",
  survived:           "survived",
  mutate_structure:   "struct mutation",
  mutate_prompt:      "prompt mutation",
  mutate_param:       "param mutation",
  crossover_subgraph: "subgraph crossover",
  crossover_prompt:   "prompt crossover",
};

const SVG_W = 460;
const SVG_H = 195;
const AGENT_HW = 44;  // half-width of agent rect
const AGENT_HH = 17;  // half-height of agent rect
const IO_R      = 18;

interface LayoutNode {
  id:    string;
  label: string;
  model: string;
  x:     number;
  y:     number;
  kind:  "io" | "agent";
}

interface LayoutEdge {
  id:   string;
  from: string;
  to:   string;
}

// Distance from centre to rect boundary in direction (dx,dy)
function rectOffset(dx: number, dy: number): number {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return AGENT_HW;
  const nx = Math.abs(dx / len);
  const ny = Math.abs(dy / len);
  const tx = nx > 0 ? AGENT_HW / nx : Infinity;
  const ty = ny > 0 ? AGENT_HH / ny : Infinity;
  return Math.min(tx, ty) + 4;
}

function edgeEndpoints(
  ax: number, ay: number, aKind: "io" | "agent",
  bx: number, by: number, bKind: "io" | "agent",
) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / len, ny = dy / len;
  const aOff = aKind === "io" ? IO_R + 2 : rectOffset(dx, dy);
  const bOff = bKind === "io" ? IO_R + 6 : rectOffset(dx, dy) + 2; // extra for arrowhead
  return {
    x1: ax + nx * aOff, y1: ay + ny * aOff,
    x2: bx - nx * bOff, y2: by - ny * bOff,
  };
}

function buildLayout(gene: Gene): { nodes: LayoutNode[]; edges: LayoutEdge[] } | null {
  if (!gene.agents?.length) return null;

  const inCount: Record<string, number> = {};
  const outAdj:  Record<string, string[]> = {};
  for (const a of gene.agents) { inCount[a.id] = 0; outAdj[a.id] = []; }
  for (const e of (gene.edges ?? [])) {
    inCount[e.to] = (inCount[e.to] ?? 0) + 1;
    (outAdj[e.from] ??= []).push(e.to);
  }

  // BFS level assignment
  const levels: Record<string, number> = {};
  const queue: string[] = [];
  for (const a of gene.agents) {
    if (!inCount[a.id]) { levels[a.id] = 0; queue.push(a.id); }
  }
  if (!queue.length && gene.agents.length) {
    levels[gene.agents[0].id] = 0;
    queue.push(gene.agents[0].id);
  }
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (const nxt of (outAdj[cur] ?? [])) {
      const nl = (levels[cur] ?? 0) + 1;
      if (levels[nxt] === undefined || levels[nxt] < nl) {
        levels[nxt] = nl;
        queue.push(nxt);
      }
    }
  }
  for (const a of gene.agents) if (levels[a.id] === undefined) levels[a.id] = 0;

  const byLevel: Record<number, string[]> = {};
  for (const [id, lvl] of Object.entries(levels)) (byLevel[lvl] ??= []).push(id);
  const numLevels = Math.max(...Object.keys(byLevel).map(Number)) + 1;

  const mxL = 54, mxR = 30, myT = 28, myB = 28;
  const availW = SVG_W - mxL - mxR;
  const availH = SVG_H - myT - myB;

  const nodes: LayoutNode[] = [];
  for (const [lvlStr, ids] of Object.entries(byLevel)) {
    const lvl = Number(lvlStr);
    const x = mxL + (numLevels <= 1 ? availW / 2 : (lvl / (numLevels - 1)) * availW);
    ids.forEach((id, i) => {
      const agent = gene.agents.find((a) => a.id === id)!;
      const y = myT + ((i + 0.5) / ids.length) * availH;
      nodes.push({ id, label: agent.role.slice(0, 13), model: agent.model, x, y, kind: "agent" });
    });
  }

  const edges: LayoutEdge[] = (gene.edges ?? []).map((e, i) => ({
    id: `e${i}`, from: e.from, to: e.to,
  }));

  return { nodes, edges };
}

function fallbackLayout(): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  return {
    nodes: [
      { id: "in",  label: "input",    model: "",          x: 48,  y: 97,  kind: "io"    },
      { id: "a0",  label: "planner",  model: "cs-4.5",    x: 175, y: 97,  kind: "agent" },
      { id: "a1",  label: "executor", model: "g2-flash",  x: 305, y: 60,  kind: "agent" },
      { id: "a2",  label: "judge",    model: "haiku",     x: 305, y: 135, kind: "agent" },
      { id: "out", label: "output",   model: "",          x: 420, y: 97,  kind: "io"    },
    ],
    edges: [
      { id: "e0", from: "in",  to: "a0" },
      { id: "e1", from: "a0",  to: "a1" },
      { id: "e2", from: "a0",  to: "a2" },
      { id: "e3", from: "a1",  to: "out" },
      { id: "e4", from: "a2",  to: "out" },
    ],
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  trials: Trial[];
}

export function GeneAnimationPanel({ trials }: Props) {
  const [mounted,    setMounted]    = useState(false);
  const [elapsed,    setElapsed]    = useState(0);
  const [flashing,   setFlashing]   = useState(false);
  const [flashColor, setFlashColor] = useState("#6366f1");
  const [flashOp,    setFlashOp]    = useState("");
  const startRef = useRef(Date.now());
  const prevLen  = useRef(0);

  useEffect(() => {
    setMounted(true);
    const t = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 60);
    return () => clearInterval(t);
  }, []);

  // Sort trials newest-first
  const sorted = useMemo(
    () => [...trials].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ),
    [trials],
  );

  const latest    = sorted[0];
  const mutOp     = latest?.mutation_op ?? "";
  const fitness   = latest?.fitness  ?? 0;
  const quality   = latest?.quality  ?? 0;
  const generation = latest?.generation ?? 0;
  const mutColor  = MUTATION_COLORS[mutOp] ?? "#6366f1";

  const layout = useMemo(() => {
    if (latest?.gene_json && latest.gene_json !== "{}") {
      try {
        const gene = JSON.parse(latest.gene_json) as Gene;
        return buildLayout(gene) ?? fallbackLayout();
      } catch { /* fall through */ }
    }
    return fallbackLayout();
  }, [latest?.gene_json]);

  const nodeMap = useMemo(
    () => Object.fromEntries(layout.nodes.map((n: LayoutNode) => [n.id, n])) as Record<string, LayoutNode>,
    [layout],
  );

  // Trigger flash on new (non-survived) trials
  useEffect(() => {
    if (trials.length > prevLen.current) {
      prevLen.current = trials.length;
      if (mutOp && mutOp !== "survived") {
        setFlashColor(MUTATION_COLORS[mutOp] ?? "#6366f1");
        setFlashOp(mutOp);
        setFlashing(true);
        const t = setTimeout(() => setFlashing(false), 2000);
        return () => clearTimeout(t);
      }
    }
  }, [trials.length, mutOp]);

  // Packet position along each edge: smooth 0→1 cycle
  function packetPos(edgeIdx: number) {
    const cycleLen = 2.2; // seconds per cycle
    const phase    = (edgeIdx * 0.42) % cycleLen;
    return ((elapsed + phase) % cycleLen) / cycleLen;
  }

  const packetFill = flashing ? flashColor : "#119760";

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Live gene</div>
          <div className="card-subtitle">
            {generation > 0 ? `gen ${generation}` : "—"}
            {mutOp ? ` · ${MUTATION_LABELS[mutOp] ?? mutOp}` : ""}
          </div>
        </div>
        {mutOp && (
          <span
            className="chip mono"
            style={{
              borderColor: mutColor,
              color: mutColor,
              fontSize: 10,
              padding: "2px 8px",
              fontFamily: "var(--mono)",
            }}
          >
            {mutOp}
          </span>
        )}
      </div>

      <div className="card-body" style={{ padding: "4px 12px 10px" }}>
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          width="100%"
          style={{ display: "block" }}
        >
          <defs>
            <marker
              id="ga-arrow"
              viewBox="0 0 10 10"
              refX="9" refY="5"
              markerWidth="6" markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#9ca3af" />
            </marker>
            <radialGradient id="ga-glow-grad">
              <stop offset="0%"   stopColor={flashColor} stopOpacity="0.4" />
              <stop offset="100%" stopColor={flashColor} stopOpacity="0"   />
            </radialGradient>
          </defs>

          {/* Dot grid */}
          <g opacity="0.35">
            {Array.from({ length: 12 }).map((_, i) =>
              Array.from({ length: 5 }).map((_, j) => (
                <circle
                  key={`${i}-${j}`}
                  cx={20 + i * 40} cy={18 + j * 40}
                  r="0.7" fill="#d4d7dc"
                />
              ))
            )}
          </g>

          {/* Flash overlay — brief burst when mutation fires */}
          {mounted && flashing && (
            <rect
              x="0" y="0" width={SVG_W} height={SVG_H}
              fill={flashColor}
              opacity="0.04"
              rx="4"
            />
          )}

          {/* Edges */}
          {layout.edges.map((e: LayoutEdge, i: number) => {
            const a = nodeMap[e.from];
            const b = nodeMap[e.to];
            if (!a || !b) return null;
            const { x1, y1, x2, y2 } = edgeEndpoints(a.x, a.y, a.kind, b.x, b.y, b.kind);
            const t = packetPos(i);
            return (
              <g key={e.id}>
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={flashing ? flashColor : "#cbd0d6"}
                  strokeWidth={flashing ? "1.6" : "1.2"}
                  markerEnd="url(#ga-arrow)"
                  style={{ transition: "stroke 0.4s ease" }}
                />
                {mounted && (
                  <circle
                    r="2.8"
                    cx={x1 + (x2 - x1) * t}
                    cy={y1 + (y2 - y1) * t}
                    fill={packetFill}
                  />
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {layout.nodes.map((n: LayoutNode) => {
            const isIO   = n.kind === "io";
            const glowing = mounted && flashing && !isIO;
            return (
              <g key={n.id}>
                {glowing && (
                  <circle
                    cx={n.x} cy={n.y}
                    r="36"
                    fill="url(#ga-glow-grad)"
                  />
                )}
                {isIO ? (
                  <>
                    <circle
                      cx={n.x} cy={n.y} r={IO_R}
                      fill={flashing ? flashColor : "#0b0d10"}
                      style={{ transition: "fill 0.3s ease" }}
                    />
                    <text
                      x={n.x} y={n.y + 4}
                      textAnchor="middle"
                      fontFamily="var(--mono, monospace)"
                      fontSize="8.5"
                      fill="white"
                    >
                      {n.label}
                    </text>
                  </>
                ) : (
                  <>
                    <rect
                      x={n.x - AGENT_HW} y={n.y - AGENT_HH}
                      width={AGENT_HW * 2} height={AGENT_HH * 2}
                      rx="5"
                      fill="#ffffff"
                      stroke={glowing ? flashColor : "#0b0d10"}
                      strokeWidth={glowing ? "2" : "1.2"}
                      style={{ transition: "stroke 0.3s ease, stroke-width 0.3s ease" }}
                    />
                    <text
                      x={n.x} y={n.y - 2}
                      textAnchor="middle"
                      fontFamily="var(--mono, monospace)"
                      fontSize="10" fontWeight="600"
                      fill="#0b0d10"
                    >
                      {n.label}
                    </text>
                    {n.model && (
                      <text
                        x={n.x} y={n.y + 10}
                        textAnchor="middle"
                        fontFamily="var(--mono, monospace)"
                        fontSize="8.5"
                        fill="#6b7280"
                      >
                        {n.model.slice(0, 14)}
                      </text>
                    )}
                  </>
                )}
              </g>
            );
          })}

          {/* Mutation label — briefly shown when flash fires */}
          {mounted && flashing && (
            <text
              x={SVG_W / 2} y={SVG_H - 8}
              textAnchor="middle"
              fontFamily="var(--mono, monospace)"
              fontSize="10"
              fontWeight="600"
              fill={flashColor}
              opacity="0.85"
            >
              {MUTATION_LABELS[flashOp] ?? flashOp}
            </text>
          )}
        </svg>

        {/* Fitness bar + stats */}
        {latest ? (
          <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--muted)",
                marginBottom: 5,
                fontFamily: "var(--mono)",
              }}
            >
              <span>fitness</span>
              <span
                className="tabular"
                style={{ color: "var(--text)", fontWeight: 600 }}
              >
                {fitness.toFixed(4)}
              </span>
            </div>
            <div className="bar">
              <div
                className="bar-fill running"
                style={{
                  width: `${Math.min(Math.abs(fitness) * 100, 100)}%`,
                  transition: "width 1.2s ease",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
                fontSize: 10.5,
                fontFamily: "var(--mono)",
                color: "var(--muted)",
              }}
            >
              <span>trials <span style={{ color: "var(--text)" }}>{trials.length}</span></span>
              <span>quality <span style={{ color: "var(--text)" }}>{quality.toFixed(3)}</span></span>
              <span>gen <span style={{ color: "var(--text)" }}>{generation}</span></span>
            </div>
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "14px 0",
              color: "var(--muted)",
              fontSize: 12,
              fontFamily: "var(--mono)",
            }}
          >
            Waiting for first trial…
          </div>
        )}
      </div>
    </div>
  );
}
