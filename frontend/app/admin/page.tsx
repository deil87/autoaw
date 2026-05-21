"use client";
import { useState, useEffect } from "react";

/* ── types ─────────────────────────────────────────────────────── */
type GN = { id: string; x: number; y: number; role: string; dim?: boolean; glow?: boolean };
type GE = { from: string; to: string; dim?: boolean; glow?: boolean; dashed?: boolean };

/* ── role → color ───────────────────────────────────────────────── */
const RC: Record<string, string> = {
  researcher: "#119760", writer: "#1d4ed8", orchestrator: "#7c3aed",
  analyst: "#0891b2", advocate: "#119760", critic: "#b91c1c",
  judge: "#b45309", drafter: "#6366f1", refiner: "#0891b2",
  specialist_a: "#119760", specialist_b: "#1d4ed8", reducer: "#7c3aed",
  synthesizer: "#7c3aed", new_agent: "#119760",
};
const rc = (r: string) => RC[r] ?? "#9ca3af";

/* ── arrow path helper ──────────────────────────────────────────── */
function ap(x1: number, y1: number, x2: number, y2: number, r = 12) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const sx = x1 + ux * r, sy = y1 + uy * r;
  const ex = x2 - ux * r, ey = y2 - uy * r;
  const hx = ex - ux * 6, hy = ey - uy * 6;
  return {
    line: `M${sx},${sy} L${hx},${hy}`,
    head: `M${ex},${ey} L${hx + uy * 4},${hy - ux * 4} L${hx - uy * 4},${hy + ux * 4} Z`,
  };
}

/* ── MiniGraph ─────────────────────────────────────────────────── */
function MG({ nodes, edges, w = 200, h = 110 }: { nodes: GN[]; edges: GE[]; w?: number; h?: number }) {
  const nm = Object.fromEntries(nodes.map(n => [n.id, n]));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
      {edges.map((e, i) => {
        const a = nm[e.from], b = nm[e.to];
        if (!a || !b) return null;
        const { line, head } = ap(a.x, a.y, b.x, b.y);
        const col = e.dim ? "#dce0e6" : e.glow ? "#119760" : "#c2c6cc";
        return (
          <g key={i} style={{ opacity: e.dim ? 0.22 : 1, transition: "opacity 0.4s ease" }}>
            <path d={line} stroke={col} strokeWidth={e.glow ? 2 : 1.5} fill="none"
              strokeDasharray={e.dashed ? "4 3" : undefined} />
            <path d={head} fill={col} />
          </g>
        );
      })}
      {nodes.map(n => {
        const col = rc(n.role);
        return (
          <g key={n.id} style={{ opacity: n.dim ? 0.1 : 1, transition: "opacity 0.4s ease" }}>
            {n.glow && (
              <circle cx={n.x} cy={n.y} r={17} fill={col} opacity={0.1}>
                <animate attributeName="r" values="14;20;14" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.1;0.01;0.1" dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={n.x} cy={n.y} r={12}
              fill={n.glow ? col : "#f5f6f8"} stroke={col} strokeWidth={n.glow ? 2.5 : 1.5}
              style={{ transition: "fill 0.4s ease" }} />
            <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central"
              fontSize={8} fontFamily="var(--mono)" fill={n.glow ? "white" : col}
              fontWeight="600" style={{ userSelect: "none", transition: "fill 0.4s ease", pointerEvents: "none" }}>
              {n.role.slice(0, 4).toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── phase hook: 0 ↔ 1 ─────────────────────────────────────────── */
function usePh(ms = 2200) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setP(x => (x + 1) % 2), ms);
    return () => clearInterval(id);
  }, [ms]);
  return p;
}

/* ── phase label ────────────────────────────────────────────────── */
function PhLabel({ p, before, after, col }: { p: number; before: string; after: string; col?: string }) {
  return (
    <div className="mono" style={{
      fontSize: 10.5, height: 16, marginTop: 8,
      color: p === 0 ? "var(--faint)" : col ?? "var(--accent-ink)",
      transition: "color 0.3s",
    }}>
      {p === 0 ? before : after}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  SEED PHASE                                                     */
/* ═══════════════════════════════════════════════════════════════ */

const TOPOS = [
  {
    name: "fixed_pipeline", label: "Fixed Pipeline", desc: "researcher → writer",
    nodes: [{ id: "a0", x: 45, y: 55, role: "researcher" }, { id: "a1", x: 155, y: 55, role: "writer" }] as GN[],
    edges: [{ from: "a0", to: "a1" }] as GE[],
  },
  {
    name: "ai_orchestrated", label: "AI Orchestrated", desc: "conditional dispatch",
    nodes: [
      { id: "a0", x: 28, y: 55, role: "orchestrator" },
      { id: "a1", x: 132, y: 22, role: "analyst" },
      { id: "a2", x: 132, y: 88, role: "writer" },
    ] as GN[],
    edges: [{ from: "a0", to: "a1" }, { from: "a0", to: "a2" }] as GE[],
  },
  {
    name: "debate", label: "Debate", desc: "advocate + critic → judge",
    nodes: [
      { id: "a0", x: 28, y: 22, role: "advocate" },
      { id: "a1", x: 28, y: 88, role: "critic" },
      { id: "a2", x: 152, y: 55, role: "judge" },
    ] as GN[],
    edges: [{ from: "a0", to: "a2" }, { from: "a1", to: "a2" }] as GE[],
  },
  {
    name: "parallel_reduce", label: "Parallel Reduce", desc: "specialists → synthesize",
    nodes: [
      { id: "a0", x: 28, y: 22, role: "specialist_a" },
      { id: "a1", x: 28, y: 88, role: "specialist_b" },
      { id: "a2", x: 152, y: 55, role: "reducer" },
    ] as GN[],
    edges: [{ from: "a0", to: "a2" }, { from: "a1", to: "a2" }] as GE[],
  },
  {
    name: "human_in_loop", label: "Human-in-Loop", desc: "human review mid-chain",
    nodes: [{ id: "a0", x: 45, y: 45, role: "drafter" }, { id: "a1", x: 155, y: 45, role: "refiner" }] as GN[],
    edges: [{ from: "a0", to: "a1" }] as GE[],
    humanLoop: true,
  },
  {
    name: "hybrid", label: "Hybrid", desc: "broadcast + reduce",
    nodes: [
      { id: "a0", x: 18, y: 55, role: "orchestrator" },
      { id: "a1", x: 92, y: 18, role: "researcher" },
      { id: "a2", x: 92, y: 92, role: "analyst" },
      { id: "a3", x: 166, y: 55, role: "synthesizer" },
    ] as GN[],
    edges: [
      { from: "a0", to: "a1" }, { from: "a0", to: "a2" },
      { from: "a1", to: "a3" }, { from: "a2", to: "a3" },
    ] as GE[],
  },
];

function SeedPhaseSection() {
  const [revealed, setRevealed] = useState(0);
  useEffect(() => {
    if (revealed >= TOPOS.length) return;
    const id = setTimeout(() => setRevealed(r => r + 1), 270);
    return () => clearTimeout(id);
  }, [revealed]);

  return (
    <div style={{ marginBottom: 44 }}>
      <div style={{ marginBottom: 18 }}>
        <div className="section-eyebrow" style={{ marginBottom: 6 }}>Phase 0 — Seed</div>
        <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 600, letterSpacing: "-0.016em" }}>
          Initial population
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6, maxWidth: "70ch" }}>
          The GP loop loads one canonical <span className="mono">gene</span> per topology type from a fixture file.
          Each seed receives random temperature jitter across its agents before generation 0 begins.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
        {TOPOS.map((t, i) => (
          <div key={t.name} className="card" style={{
            opacity: i < revealed ? 1 : 0,
            transform: i < revealed ? "none" : "translateY(10px)",
            transition: "opacity 0.32s ease, transform 0.32s ease",
          }}>
            <div style={{ padding: "12px 14px 6px" }}>
              <div className="mono" style={{ fontSize: 9, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                fixture {String(i + 1).padStart(2, "0")}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.01em", margin: "4px 0 2px" }}>
                {t.label}
              </div>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{t.desc}</div>
            </div>

            <div style={{ padding: "6px 14px 8px", display: "flex", justifyContent: "center", position: "relative" }}>
              <MG nodes={t.nodes} edges={t.edges} w={188} h={100} />
              {t.humanLoop && (
                <svg width={188} height={28} viewBox="0 0 188 28"
                  style={{ position: "absolute", bottom: 4, left: 14, overflow: "visible", pointerEvents: "none" }}>
                  <path d="M157,4 Q95,26 45,4" fill="none" stroke="#bdc1c9" strokeWidth={1.2} strokeDasharray="4 3" />
                  <text x={100} y={23} textAnchor="middle" fontSize={7.5} fill="#bdc1c9" fontFamily="var(--mono)">human</text>
                </svg>
              )}
            </div>

            <div style={{ padding: "6px 14px 10px", borderTop: "1px solid var(--border)", display: "flex", gap: 5 }}>
              <span className="chip chip-done" style={{ fontSize: 9.5 }}>seed</span>
              <span className="chip" style={{ fontSize: 9.5 }}>{t.nodes.length} agents</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  mutate_structure — four sub-animations                        */
/* ═══════════════════════════════════════════════════════════════ */

function AddAgentAnim() {
  const p = usePh(2400);
  const nodes: GN[] = [
    { id: "a0", x: 45, y: 36, role: "researcher" },
    { id: "a1", x: 155, y: 36, role: "writer" },
    { id: "a2", x: 155, y: 78, role: "new_agent", dim: p === 0, glow: p === 1 },
  ];
  const edges: GE[] = [
    { from: "a0", to: "a1" },
    { from: "a0", to: "a2", dim: p === 0, glow: p === 1 },
  ];
  return (
    <div style={{ padding: "14px 16px", borderRight: "1px solid var(--border)" }}>
      <div className="mono" style={{ fontSize: 9, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
        add_agent
      </div>
      <MG nodes={nodes} edges={edges} w={193} h={105} />
      <PhLabel p={p} before="before" after="+ new agent connected from researcher" />
    </div>
  );
}

function RemoveAgentAnim() {
  const p = usePh(2400);
  const nodes: GN[] = [
    { id: "a0", x: 24, y: 55, role: "researcher" },
    { id: "a1", x: 99, y: 55, role: "analyst", dim: p === 1 },
    { id: "a2", x: 174, y: 55, role: "writer" },
  ];
  const edges: GE[] = [
    { from: "a0", to: "a1", dim: p === 1 },
    { from: "a1", to: "a2", dim: p === 1 },
    { from: "a0", to: "a2", dim: p === 0, glow: p === 1 },
  ];
  return (
    <div style={{ padding: "14px 16px", borderRight: "1px solid var(--border)" }}>
      <div className="mono" style={{ fontSize: 9, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
        remove_agent
      </div>
      <MG nodes={nodes} edges={edges} w={193} h={105} />
      <PhLabel p={p} before="before" after="analyst removed, edge rewired" col="var(--err)" />
    </div>
  );
}

function SwapTopologyAnim() {
  const p = usePh(2800);
  const pipeNodes: GN[] = [
    { id: "a0", x: 45, y: 55, role: "researcher" },
    { id: "a1", x: 155, y: 55, role: "writer" },
  ];
  const pipeEdges: GE[] = [{ from: "a0", to: "a1" }];
  const debateNodes: GN[] = [
    { id: "b0", x: 28, y: 22, role: "advocate" },
    { id: "b1", x: 28, y: 88, role: "critic" },
    { id: "b2", x: 152, y: 55, role: "judge" },
  ];
  const debateEdges: GE[] = [{ from: "b0", to: "b2" }, { from: "b1", to: "b2" }];
  return (
    <div style={{ padding: "14px 16px", borderRight: "1px solid var(--border)" }}>
      <div className="mono" style={{ fontSize: 9, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
        swap_topology
      </div>
      <div style={{ position: "relative", width: 193, height: 105 }}>
        <div style={{ position: "absolute", inset: 0, opacity: p === 0 ? 1 : 0, transition: "opacity 0.5s ease" }}>
          <MG nodes={pipeNodes} edges={pipeEdges} w={193} h={105} />
        </div>
        <div style={{ position: "absolute", inset: 0, opacity: p === 1 ? 1 : 0, transition: "opacity 0.5s ease" }}>
          <MG nodes={debateNodes} edges={debateEdges} w={193} h={105} />
        </div>
      </div>
      <PhLabel p={p} before="fixed_pipeline" after="→ debate (topology cleared & reseeded)" col="var(--warn)" />
    </div>
  );
}

function RewireEdgeAnim() {
  const p = usePh(2400);
  const nodes: GN[] = [
    { id: "a0", x: 28, y: 55, role: "orchestrator" },
    { id: "a1", x: 130, y: 22, role: "analyst" },
    { id: "a2", x: 130, y: 88, role: "writer" },
  ];
  const edges: GE[] = [
    { from: "a0", to: "a1" },
    { from: "a0", to: "a2", dim: p === 1 },
    { from: "a1", to: "a2", dim: p === 0, glow: p === 1 },
  ];
  return (
    <div style={{ padding: "14px 16px" }}>
      <div className="mono" style={{ fontSize: 9, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
        rewire_edge
      </div>
      <MG nodes={nodes} edges={edges} w={193} h={105} />
      <PhLabel p={p} before="before" after="a0→a2 rewired to a1→a2" col="var(--info)" />
    </div>
  );
}

function MutateStructureCard() {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <div>
          <div className="card-title" style={{ fontFamily: "var(--mono)", letterSpacing: 0 }}>mutate_structure</div>
          <div className="card-subtitle">randomly selects one of four structural changes to apply</div>
        </div>
        <span className="chip chip-running">mutation</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
        <AddAgentAnim />
        <RemoveAgentAnim />
        <SwapTopologyAnim />
        <RewireEdgeAnim />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  mutate_prompt                                                  */
/* ═══════════════════════════════════════════════════════════════ */

const PROMPT_PAIR = {
  role: "writer",
  before: "Write clear, concise summaries based on research provided to you. Focus on key insights.",
  after: "Craft comprehensive, structured analyses that highlight key insights, implications, and actionable conclusions.",
};

function MutatePromptCard() {
  const p = usePh(3000);
  const col = rc(PROMPT_PAIR.role);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title" style={{ fontFamily: "var(--mono)", letterSpacing: 0 }}>mutate_prompt</div>
          <div className="card-subtitle">GPT-4o-mini rewrites one agent&apos;s system_prompt with a diversity directive</div>
        </div>
        <span className="chip chip-running">mutation</span>
      </div>
      <div className="card-body">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span className="chip" style={{ background: `${col}18`, color: col, borderColor: `${col}40` }}>
            {PROMPT_PAIR.role}
          </span>
          <div style={{
            opacity: p === 1 ? 1 : 0, transition: "opacity 0.35s ease",
            display: "flex", alignItems: "center", gap: 5,
          }}>
            <span className="chip chip-done" style={{ fontSize: 10 }}>⟳ LLM rewrite</span>
          </div>
        </div>

        <div style={{
          fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.6,
          background: "var(--surface)", borderRadius: "var(--r-2)",
          padding: "12px 14px", border: "1px solid var(--border)",
          position: "relative", minHeight: 72, overflow: "hidden",
        }}>
          <div style={{ opacity: p === 0 ? 1 : 0, transition: "opacity 0.35s ease" }}>
            &ldquo;{PROMPT_PAIR.before}&rdquo;
          </div>
          <div style={{
            position: "absolute", inset: "12px 14px",
            opacity: p === 1 ? 1 : 0, transition: "opacity 0.35s ease",
            color: "var(--accent-ink)",
          }}>
            &ldquo;{PROMPT_PAIR.after}&rdquo;
          </div>
        </div>

        <PhLabel p={p} before="original system_prompt" after="rewritten — more specific and directive" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  mutate_param                                                   */
/* ═══════════════════════════════════════════════════════════════ */

const TEMP_BEFORE = 0.42;
const TEMP_AFTER  = 0.71;

function MutateParamCard() {
  const p = usePh(2600);
  const temp = p === 0 ? TEMP_BEFORE : TEMP_AFTER;
  const col = rc("writer");

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title" style={{ fontFamily: "var(--mono)", letterSpacing: 0 }}>mutate_param</div>
          <div className="card-subtitle">Gaussian perturbation on one agent&apos;s temperature (σ = 0.1, clamped [0, 1])</div>
        </div>
        <span className="chip chip-running">mutation</span>
      </div>
      <div className="card-body">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
          <span className="chip" style={{ background: `${col}18`, color: col, borderColor: `${col}40` }}>writer</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>agent.temperature</span>
        </div>

        {/* Gauge */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>temperature</span>
            <span className="mono" style={{
              fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em",
              color: p === 1 ? "var(--accent-ink)" : "var(--text)",
              transition: "color 0.4s ease",
            }}>
              {temp.toFixed(2)}
            </span>
          </div>
          <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 99,
              background: `linear-gradient(90deg, #119760, #1d4ed8)`,
              width: `${temp * 100}%`,
              transition: "width 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 9.5, color: "var(--faint)" }}>0.0 · deterministic</span>
            <span className="mono" style={{ fontSize: 9.5, color: "var(--faint)" }}>creative · 1.0</span>
          </div>
        </div>

        {/* Normal distribution hint */}
        <div style={{
          background: "var(--surface)", borderRadius: "var(--r-2)",
          padding: "8px 12px", border: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <svg width={60} height={30} viewBox="0 0 60 30">
            <path d={`M0,28 Q${p === 0 ? 28 : 32},2 60,28`}
              fill="none" stroke="#c2c6cc" strokeWidth={1.5} />
            <circle cx={28} cy={4} r={3.5} fill="#9ca3af"
              style={{ opacity: p === 0 ? 1 : 0, transition: "opacity 0.35s ease" }} />
            <circle cx={42} cy={11} r={3.5} fill="#119760"
              style={{ opacity: p === 1 ? 1 : 0, transition: "opacity 0.35s ease" }} />
          </svg>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>
            Δ ~ 𝒩(0, 0.1) → {p === 0 ? TEMP_BEFORE.toFixed(2) : `${TEMP_BEFORE.toFixed(2)} + ${(TEMP_AFTER - TEMP_BEFORE).toFixed(2)} = ${TEMP_AFTER.toFixed(2)}`}
          </span>
        </div>

        <PhLabel p={p} before="before perturbation" after="temperature shifted +0.29" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  crossover_subgraph                                             */
/* ═══════════════════════════════════════════════════════════════ */

function CrossoverSubgraphCard() {
  const p = usePh(2800);

  /* Gene 1: researcher → writer → judge  (split after writer) */
  /* Gene 2: analyst → drafter → critic   (split after drafter) */
  /* After swap: Gene1 tail=critic, Gene2 tail=judge            */

  const g1Before: { nodes: GN[]; edges: GE[] } = {
    nodes: [
      { id: "g1a", x: 24, y: 55, role: "researcher" },
      { id: "g1b", x: 95, y: 55, role: "writer" },
      { id: "g1c", x: 166, y: 55, role: "judge" },
    ],
    edges: [{ from: "g1a", to: "g1b" }, { from: "g1b", to: "g1c" }],
  };
  const g2Before: { nodes: GN[]; edges: GE[] } = {
    nodes: [
      { id: "g2a", x: 24, y: 55, role: "analyst" },
      { id: "g2b", x: 95, y: 55, role: "drafter" },
      { id: "g2c", x: 166, y: 55, role: "critic" },
    ],
    edges: [{ from: "g2a", to: "g2b" }, { from: "g2b", to: "g2c" }],
  };

  /* After: tails swapped — Gene1 ends with critic, Gene2 ends with judge */
  const g1After: { nodes: GN[]; edges: GE[] } = {
    nodes: [
      { id: "g1a", x: 24, y: 55, role: "researcher" },
      { id: "g1b", x: 95, y: 55, role: "writer" },
      { id: "g1c", x: 166, y: 55, role: "critic", glow: true },
    ],
    edges: [{ from: "g1a", to: "g1b" }, { from: "g1b", to: "g1c", glow: true }],
  };
  const g2After: { nodes: GN[]; edges: GE[] } = {
    nodes: [
      { id: "g2a", x: 24, y: 55, role: "analyst" },
      { id: "g2b", x: 95, y: 55, role: "drafter" },
      { id: "g2c", x: 166, y: 55, role: "judge", glow: true },
    ],
    edges: [{ from: "g2a", to: "g2b" }, { from: "g2b", to: "g2c", glow: true }],
  };

  const g1 = p === 0 ? g1Before : g1After;
  const g2 = p === 0 ? g2Before : g2After;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title" style={{ fontFamily: "var(--mono)", letterSpacing: 0 }}>crossover_subgraph</div>
          <div className="card-subtitle">swaps agent tails between two genes at random split points</div>
        </div>
        <span className="chip" style={{ background: "#7c3aed18", color: "#7c3aed", borderColor: "#7c3aed40" }}>crossover</span>
      </div>
      <div className="card-body">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[{ label: "gene A", data: g1, parentIds: ["seed_0001"] }, { label: "gene B", data: g2, parentIds: ["seed_0003"] }].map(({ label, data, parentIds }, gi) => (
            <div key={gi} style={{
              background: "var(--surface)", borderRadius: "var(--r-2)",
              border: "1px solid var(--border)", padding: "10px 12px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                <span className="chip" style={{ fontSize: 9 }}>{parentIds[0]}</span>
              </div>
              <MG nodes={data.nodes} edges={data.edges} w={220} h={80} />
              {p === 1 && (
                <div className="mono" style={{ fontSize: 9.5, color: "#7c3aed", marginTop: 6 }}>
                  ↑ tail swapped from {gi === 0 ? "gene B" : "gene A"}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Split point indicator */}
        <div style={{
          marginTop: 12, padding: "8px 12px",
          background: "var(--surface)", borderRadius: "var(--r-2)", border: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <svg width={20} height={20} viewBox="0 0 20 20">
            <line x1={10} y1={0} x2={10} y2={20} stroke="#c2c6cc" strokeWidth={1.5} strokeDasharray="3 2" />
            <circle cx={10} cy={10} r={3} fill="#7c3aed" opacity={0.7} />
          </svg>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>
            split after <strong>writer / drafter</strong> — tails exchanged between genes
          </span>
        </div>

        <PhLabel p={p} before="two parent genes" after="offspring with swapped tails" col="#7c3aed" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  crossover_prompt                                               */
/* ═══════════════════════════════════════════════════════════════ */

const XPROMPTS = [
  {
    gene: "gene A",
    role: "writer",
    before: "Write concise technical summaries. Prioritize accuracy over style.",
    after: "Craft engaging narratives that explain complex topics to a general audience.",
  },
  {
    gene: "gene B",
    role: "writer",
    before: "Craft engaging narratives that explain complex topics to a general audience.",
    after: "Write concise technical summaries. Prioritize accuracy over style.",
  },
];

function CrossoverPromptCard() {
  const p = usePh(3000);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title" style={{ fontFamily: "var(--mono)", letterSpacing: 0 }}>crossover_prompt</div>
          <div className="card-subtitle">swaps system_prompt between agents sharing the same role (50 % probability per shared role)</div>
        </div>
        <span className="chip" style={{ background: "#7c3aed18", color: "#7c3aed", borderColor: "#7c3aed40" }}>crossover</span>
      </div>
      <div className="card-body">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {XPROMPTS.map((xp, i) => {
            const col = rc(xp.role);
            const text = p === 0 ? xp.before : xp.after;
            const changed = p === 1;
            return (
              <div key={i} style={{
                background: "var(--surface)", borderRadius: "var(--r-2)",
                border: `1px solid ${changed ? "#7c3aed40" : "var(--border)"}`,
                padding: "10px 12px",
                transition: "border-color 0.4s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {xp.gene}
                  </span>
                  <span className="chip" style={{ fontSize: 9, background: `${col}18`, color: col, borderColor: `${col}40` }}>
                    {xp.role}
                  </span>
                </div>

                {/* Agent visual */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: col, display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <span style={{ color: "white", fontSize: 8, fontFamily: "var(--mono)", fontWeight: 700 }}>
                      {xp.role.slice(0, 4).toUpperCase()}
                    </span>
                  </div>
                  <span className="mono" style={{ fontSize: 9.5, color: "var(--muted)" }}>system_prompt</span>
                </div>

                {/* Prompt text with crossfade */}
                <div style={{
                  position: "relative", minHeight: 60,
                  fontFamily: "var(--mono)", fontSize: 10.5, lineHeight: 1.55,
                  background: "var(--bg)", borderRadius: "var(--r-1)",
                  padding: "8px 10px", border: "1px solid var(--border)",
                }}>
                  <div style={{ opacity: p === 0 ? 1 : 0, transition: "opacity 0.35s ease", color: "var(--ink-soft)" }}>
                    &ldquo;{xp.before}&rdquo;
                  </div>
                  <div style={{
                    position: "absolute", inset: "8px 10px",
                    opacity: p === 1 ? 1 : 0, transition: "opacity 0.35s ease",
                    color: "#7c3aed",
                  }}>
                    &ldquo;{xp.after}&rdquo;
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <PhLabel p={p} before="both writer agents retain original prompts" after="prompts swapped — shared role matched" col="#7c3aed" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Page                                                           */
/* ═══════════════════════════════════════════════════════════════ */

export default function AdminPage() {
  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 36, paddingBottom: 24, borderBottom: "1px solid var(--border)" }}>
        <div className="section-eyebrow" style={{ marginBottom: 8 }}>Internal reference</div>
        <h1 style={{ margin: "0 0 10px", fontSize: 30, fontWeight: 500, letterSpacing: "-0.025em" }}>
          GP Operators
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--muted)", lineHeight: 1.6, maxWidth: "72ch" }}>
          A visual guide to how AutoAW&apos;s genetic programming loop initialises and evolves agent configurations.
          All animations run live — each card loops through the before → after transition autonomously.
        </p>
      </div>

      {/* Seed Phase */}
      <SeedPhaseSection />

      {/* Mutation Operators */}
      <div style={{ marginBottom: 12 }}>
        <div className="section-eyebrow" style={{ marginBottom: 6 }}>Operators — Mutation</div>
        <h2 style={{ margin: "0 0 18px", fontSize: 20, fontWeight: 600, letterSpacing: "-0.016em" }}>
          Mutation operators
        </h2>
      </div>

      <MutateStructureCard />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 36 }}>
        <MutatePromptCard />
        <MutateParamCard />
      </div>

      {/* Crossover Operators */}
      <div style={{ marginBottom: 12 }}>
        <div className="section-eyebrow" style={{ marginBottom: 6 }}>Operators — Crossover</div>
        <h2 style={{ margin: "0 0 18px", fontSize: 20, fontWeight: 600, letterSpacing: "-0.016em" }}>
          Crossover operators
        </h2>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 48 }}>
        <CrossoverSubgraphCard />
        <CrossoverPromptCard />
      </div>
    </div>
  );
}
