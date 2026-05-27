"use client";
import { useState, useEffect, Fragment } from "react";
import Link from "next/link";

/* ---- Logo ---- */
function Logo({ size = 26, animated = false }: { size?: number; animated?: boolean }) {
  const nodes = [
    { x: 6,  y: 13, r: 2.5 },
    { x: 13, y: 6,  r: 2.5 },
    { x: 13, y: 20, r: 2.5 },
    { x: 20, y: 13, r: 2.5 },
  ];
  const edges = [[0,1],[0,2],[1,3],[2,3],[1,2]];
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none">
      {edges.map(([a,b],i) => (
        <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
          stroke="#0b0d10" strokeWidth="1.1"/>
      ))}
      {nodes.map((n,i) => (
        <circle key={i} cx={n.x} cy={n.y} r={n.r} fill="#0b0d10"/>
      ))}
      {animated && (
        <circle cx="0" cy="0" r="1.4" fill="#119760">
          <animateMotion dur="2.4s" repeatCount="indefinite" path="M 6 13 L 13 6 L 20 13 L 13 20 Z"/>
        </circle>
      )}
    </svg>
  );
}

/* ---- Icon ---- */
function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    "arrow-right": "M5 12h14M13 6l6 6-6 6",
    "check": "M20 6L9 17l-5-5",
    "external": "M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] ?? paths["arrow-right"]}/>
    </svg>
  );
}

/* ---- StatusChip ---- */
function StatusChip({ status }: { status: string }) {
  return (
    <span className="chip chip-running">
      <span className="chip-dot pulse"/>running
    </span>
  );
}

/* ---- WorkflowGraph with animated packets ---- */
function WorkflowGraph({ height = 290 }: { height?: number }) {
  const nodes = [
    { id: "task",    label: "task",       x: 60,  y: 140, kind: "io" },
    { id: "planner", label: "planner",    x: 200, y: 140, kind: "agent", model: "cs-4.5" },
    { id: "exec1",   label: "executor·a", x: 360, y: 80,  kind: "agent", model: "g2-flash" },
    { id: "exec2",   label: "executor·b", x: 360, y: 200, kind: "agent", model: "g2-flash" },
    { id: "judge",   label: "judge",      x: 520, y: 140, kind: "agent", model: "haiku" },
    { id: "out",     label: "answer",     x: 650, y: 140, kind: "io" },
  ];
  const edges = [
    { from: "task", to: "planner" },
    { from: "planner", to: "exec1" },
    { from: "planner", to: "exec2" },
    { from: "exec1", to: "judge" },
    { from: "exec2", to: "judge" },
    { from: "judge", to: "out" },
  ];

  const [mounted, setMounted] = useState(false);
  const [tick, setTick] = useState(0);
  const [pulseNode, setPulseNode] = useState<string|null>(null);

  useEffect(() => {
    setMounted(true);
    const a = setInterval(() => setTick(t => t + 1), 1200);
    const b = setInterval(() => {
      const ids = ["planner","exec1","exec2","judge"];
      setPulseNode(ids[Math.floor(Math.random() * ids.length)]);
      setTimeout(() => setPulseNode(null), 800);
    }, 2400);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);

  return (
    <svg viewBox="0 0 720 280" width="100%" height={height} style={{ display: "block" }}>
      <defs>
        <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#9ca3af"/>
        </marker>
        <radialGradient id="nodeGlow">
          <stop offset="0%" stopColor="#119760" stopOpacity="0.32"/>
          <stop offset="100%" stopColor="#119760" stopOpacity="0"/>
        </radialGradient>
      </defs>

      <g opacity="0.5">
        {Array.from({length: 18}).map((_,i) => Array.from({length: 7}).map((_,j) => (
          <circle key={`${i}-${j}`} cx={20+i*40} cy={20+j*40} r="0.8" fill="#d4d7dc"/>
        )))}
      </g>

      {edges.map((e,i) => {
        const a = nodes.find(n => n.id === e.from)!;
        const b = nodes.find(n => n.id === e.to)!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        const nx = dx/len, ny = dy/len;
        const ax = a.x + nx*22, ay = a.y + ny*22;
        const bx = b.x - nx*24, by = b.y - ny*24;
        const packetT = ((tick + i * 0.3) % 3) / 3;
        return (
          <g key={i}>
            <line x1={ax} y1={ay} x2={bx} y2={by}
              stroke="#cbd0d6" strokeWidth="1.2" markerEnd="url(#wf-arrow)"/>
            {mounted && (
              <circle r="3"
                cx={ax + (bx-ax)*packetT}
                cy={ay + (by-ay)*packetT}
                fill="#119760"/>
            )}
          </g>
        );
      })}

      {nodes.map(n => {
        const pulsing = pulseNode === n.id;
        if (n.kind === "io") return (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r="18" fill="#0b0d10"/>
            <text x={n.x} y={n.y+4} textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="9.5" fill="white">{n.label}</text>
          </g>
        );
        if (n.kind === "agent") return (
          <g key={n.id}>
            {mounted && pulsing && (
              <circle cx={n.x} cy={n.y} r="32" fill="url(#nodeGlow)">
                <animate attributeName="r" values="20;42" dur="0.8s"/>
                <animate attributeName="opacity" values="1;0" dur="0.8s"/>
              </circle>
            )}
            <rect x={n.x-50} y={n.y-18} width="100" height="36" rx="6"
              fill="#ffffff" stroke={mounted && pulsing ? "#119760" : "#0b0d10"} strokeWidth="1.2"/>
            <text x={n.x} y={n.y-2} textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="11" fill="#0b0d10" fontWeight="600">{n.label}</text>
            <text x={n.x} y={n.y+11} textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="9.5" fill="#6b7280">{(n as any).model}</text>
          </g>
        );
        return null;
      })}
    </svg>
  );
}

/* ---- Hero ---- */
function HeroLiveCard() {
  const [gen, setGen] = useState(18);
  const [quality, setQuality] = useState(0.732);
  const [cost, setCost] = useState(4.62);

  useEffect(() => {
    const t = setInterval(() => {
      setGen(g => g + 1);
      setQuality(q => Math.min(0.749, q + 0.0008 + Math.random() * 0.001));
      setCost(c => Math.max(4.10, c - 0.005 - Math.random() * 0.02));
    }, 1800);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="live-card">
      <div className="live-card-head">
        <div className="live-card-dots"><span/><span/><span/></div>
        <div className="live-card-title mono">
          exp-7c4e · customer-support-copilot · gen <span className="tabular">{gen}</span>/40
        </div>
        <StatusChip status="running"/>
      </div>
      <div className="live-card-body">
        <WorkflowGraph height={200}/>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 6, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          {[
            { label: "quality", value: quality.toFixed(3), delta: "+0.041 vs gen 1" },
            { label: "cost / run", value: `$${cost.toFixed(2)}`, delta: "−84% vs gen 1" },
            { label: "p50 latency", value: "2.4s", delta: "−72% vs gen 1" },
          ].map(s => (
            <div key={s.label}>
              <div className="metric-label" style={{ fontSize: 10 }}>{s.label}</div>
              <div className="mono tabular" style={{ marginTop: 6, fontSize: 18, fontWeight: 500, letterSpacing: "-0.02em" }}>{s.value}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--accent-ink)", marginTop: 3 }}>{s.delta}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="page hero">
      <div className="hero-grid">
        <div>
          <span className="hero-eyebrow">
            <span className="chip-dot pulse" style={{ color: "#119760" }}/>
            v0.4 · invite-only beta
          </span>
          <h1>
            Optimize any agentic workflow<br/>
            <em>against cost, speed, and quality.</em>
          </h1>
          <p className="lede">
            Drop in a high-level task or an existing graph. AutoAW co-evolves
            topology, prompts, models, and tools — searching the Pareto frontier
            of your utility function so you ship the cheapest version that still hits your bar.
          </p>
          <div className="hero-ctas">
            <Link href="/experiments/new" className="btn btn-primary btn-lg">
              Start an experiment <Icon name="arrow-right" size={13}/>
            </Link>
            <Link href="/experiments" className="btn btn-lg">
              See experiments
            </Link>
          </div>
          <div className="hero-meta">
            <span><b className="mono tabular">74.1%</b> on GAIA · <span className="faint">vs 69.2% Sonnet 4.5 baseline</span></span>
            <span><b className="mono tabular">6.7×</b> cheaper · <span className="faint">vs same-quality GPT-5 single-agent</span></span>
            <span><b className="mono tabular">38min</b> to SOTA · <span className="faint">94 candidates evaluated</span></span>
          </div>
        </div>
        <HeroLiveCard/>
      </div>
    </section>
  );
}

/* ---- Before / After ---- */
function BeforeAfter() {
  return (
    <section className="page" style={{ paddingTop: 28, paddingBottom: 28 }}>
      <div style={{ marginBottom: 26 }}>
        <div className="section-eyebrow">02 · diff</div>
        <h2 className="section-title">From a brittle prototype to a Pareto-optimal pipeline.</h2>
        <p className="section-lede">
          AutoAW doesn&apos;t just tune prompts — it rewrites the graph. Below is the actual diff from the customer-support copilot experiment.
        </p>
      </div>
      <div className="ba-grid">
        <div className="ba-panel left">
          <div className="ba-label">
            <span style={{ width: 6, height: 6, background: "var(--err)", borderRadius: 99, display: "inline-block" }}/>
            before · v0 · hand-written
          </div>
          <svg viewBox="0 0 380 180" width="100%" height={160}>
            <g opacity="0.5">
              {Array.from({length:10}).map((_,i) => Array.from({length:5}).map((_,j) => (
                <circle key={`${i}-${j}`} cx={20+i*38} cy={20+j*36} r="0.8" fill="#d4d7dc"/>
              )))}
            </g>
            <g stroke="#cbd0d6" strokeWidth="1" fill="none">
              <path d="M40 90 L150 90"/><path d="M150 90 L260 30"/><path d="M150 90 L260 90"/>
              <path d="M150 90 L260 150"/><path d="M150 90 L60 30"/><path d="M150 90 L60 150"/>
              <path d="M260 30 L150 90" strokeDasharray="3 3"/><path d="M260 90 L150 90" strokeDasharray="3 3"/>
              <path d="M260 150 L150 90" strokeDasharray="3 3"/><path d="M260 90 L340 90"/>
            </g>
            <circle cx="40" cy="90" r="12" fill="#0b0d10"/>
            <text x="40" y="93" textAnchor="middle" fill="white" fontFamily="Geist Mono, monospace" fontSize="9.5">task</text>
            <rect x="115" y="74" width="70" height="32" rx="5" fill="white" stroke="#0b0d10"/>
            <text x="150" y="89" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="10" fontWeight="600">react-agent</text>
            <text x="150" y="100" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="9" fill="#6b7280">gpt-5</text>
            {([[60,30,"docs"],[60,150,"crm.api"],[260,30,"web.search"],[260,90,"calc"],[260,150,"knowledge"]] as [number,number,string][]).map(([x,y,l],i) => (
              <g key={i}>
                <rect x={x-30} y={y-11} width="60" height="22" rx="11" fill="#fafbfc" stroke="#cbd0d6" strokeDasharray="3 3"/>
                <text x={x} y={y+3} textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="9.5" fill="#6b7280">{l}</text>
              </g>
            ))}
            <circle cx="340" cy="90" r="12" fill="#0b0d10"/>
            <text x="340" y="93" textAnchor="middle" fill="white" fontFamily="Geist Mono, monospace" fontSize="8.5">answer</text>
          </svg>
          <div className="ba-stats">
            <div><div className="faint">quality</div><b>0.41</b></div>
            <div><div className="faint">cost/run</div><b>$38.50</b></div>
            <div><div className="faint">p50</div><b>12.4s</b></div>
            <div><div className="faint">nodes</div><b>6 (1 model)</b></div>
          </div>
        </div>
        <div className="ba-arrow">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <Icon name="arrow-right" size={18}/>
            <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)" }}>22 generations</span>
          </div>
        </div>
        <div className="ba-panel right">
          <div className="ba-label">
            <span style={{ width: 6, height: 6, background: "var(--accent)", borderRadius: 99, display: "inline-block" }}/>
            after · gen 22 · AutoAW-optimized
          </div>
          <svg viewBox="0 0 380 180" width="100%" height={160}>
            <g opacity="0.5">
              {Array.from({length:10}).map((_,i) => Array.from({length:5}).map((_,j) => (
                <circle key={`${i}-${j}`} cx={20+i*38} cy={20+j*36} r="0.8" fill="#d4d7dc"/>
              )))}
            </g>
            <defs>
              <marker id="arrAfter" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#119760"/>
              </marker>
            </defs>
            <g stroke="#119760" strokeWidth="1.2" fill="none" markerEnd="url(#arrAfter)">
              <path d="M50 90 L100 90"/><path d="M170 80 L235 50"/>
              <path d="M170 100 L235 130"/><path d="M295 50 L325 80"/>
              <path d="M295 130 L325 100"/>
            </g>
            <circle cx="40" cy="90" r="12" fill="#0b0d10"/>
            <text x="40" y="93" textAnchor="middle" fill="white" fontFamily="Geist Mono, monospace" fontSize="9.5">task</text>
            <rect x="105" y="74" width="68" height="32" rx="5" fill="white" stroke="#119760"/>
            <text x="139" y="89" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="10" fontWeight="600">planner</text>
            <text x="139" y="100" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="9" fill="#119760">cs-4.5</text>
            <rect x="237" y="34" width="60" height="32" rx="5" fill="white" stroke="#119760"/>
            <text x="267" y="49" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="10" fontWeight="600">exec·a</text>
            <text x="267" y="60" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="9" fill="#119760">g2-flash</text>
            <rect x="237" y="114" width="60" height="32" rx="5" fill="white" stroke="#119760"/>
            <text x="267" y="129" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="10" fontWeight="600">exec·b</text>
            <text x="267" y="140" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="9" fill="#119760">g2-flash</text>
            <rect x="325" y="74" width="44" height="32" rx="5" fill="white" stroke="#119760"/>
            <text x="347" y="89" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="10" fontWeight="600">judge</text>
            <text x="347" y="100" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="9" fill="#119760">haiku</text>
          </svg>
          <div className="ba-stats">
            <div><div className="faint">quality</div><b>0.741</b></div>
            <div><div className="faint">cost/run</div><b>$4.20</b></div>
            <div><div className="faint">p50</div><b>2.4s</b></div>
            <div><div className="faint">nodes</div><b>4 (3 models)</b></div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- Architecture Comparison ---- */
function CommitteeGraph({ height = 148 }: { height?: number }) {
  const agents = [
    { id: "plan", label: "planner",    x: 100, y: 75,  m: "gpt-5" },
    { id: "res",  label: "researcher", x: 195, y: 28,  m: "cs-4.5" },
    { id: "wrt",  label: "writer",     x: 195, y: 122, m: "cs-4.5" },
    { id: "jdg",  label: "validator",  x: 286, y: 75,  m: "haiku" },
  ];
  const mainLines: [number,number,number,number][] = [
    [40,75,60,75],[100,75,195,28],[100,75,195,122],[195,28,286,75],[195,122,286,75],[326,75,340,75],
  ];
  return (
    <svg viewBox="0 0 364 150" width="100%" height={height} style={{ display:"block" }}>
      <defs>
        <marker id="arr-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#9ca3af"/>
        </marker>
      </defs>
      <g opacity="0.35">
        {Array.from({length:11}).map((_,i) => Array.from({length:5}).map((_,j) => (
          <circle key={`${i}-${j}`} cx={16+i*33} cy={15+j*30} r="0.7" fill="#d4d7dc"/>
        )))}
      </g>
      {/* cross-talk & feedback (dashed) */}
      <line x1="195" y1="44" x2="195" y2="106" stroke="#cbd0d6" strokeWidth="1" strokeDasharray="3 3"/>
      <path d="M 286 90 Q 193 148 100 90" fill="none" stroke="#cbd0d6" strokeWidth="1" strokeDasharray="3 3" markerEnd="url(#arr-c)"/>
      {/* main edges */}
      {mainLines.map(([x1,y1,x2,y2],i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9ca3af" strokeWidth="1.1" markerEnd="url(#arr-c)"/>
      ))}
      {/* IO */}
      <circle cx="24" cy="75" r="16" fill="#0b0d10"/>
      <text x="24" y="79" textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="9" fill="white">task</text>
      <circle cx="340" cy="75" r="16" fill="#0b0d10"/>
      <text x="340" y="79" textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="8" fill="white">answer</text>
      {/* agent nodes */}
      {agents.map(n => (
        <g key={n.id}>
          <rect x={n.x-40} y={n.y-16} width="80" height="32" rx="5" fill="white" stroke="#d4d7dc" strokeWidth="1.2"/>
          <text x={n.x} y={n.y-2} textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="10" fill="#0b0d10" fontWeight="600">{n.label}</text>
          <text x={n.x} y={n.y+10} textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="8.5" fill="#9ca3af">{n.m}</text>
        </g>
      ))}
      {/* overhead label */}
      <text x="195" y="9" textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="8.5" fill="#9ca3af">cross-talk</text>
      <text x="192" y="148" textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="8.5" fill="#9ca3af">feedback loop</text>
    </svg>
  );
}

function GlueGraph({ height = 148 }: { height?: number }) {
  const skills = [
    { label: "web_search", x: 82,  y: 118 },
    { label: "sql_query",  x: 165, y: 118 },
    { label: "code_exec",  x: 248, y: 118 },
  ];
  const skillAnchors: [number,number][] = [[132,72],[155,72],[178,72]];
  return (
    <svg viewBox="0 0 364 148" width="100%" height={height} style={{ display:"block" }}>
      <defs>
        <marker id="arr-g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#119760"/>
        </marker>
      </defs>
      <g opacity="0.35">
        {Array.from({length:11}).map((_,i) => Array.from({length:5}).map((_,j) => (
          <circle key={`${i}-${j}`} cx={16+i*33} cy={15+j*30} r="0.7" fill="#d4d7dc"/>
        )))}
      </g>
      {/* skill spokes */}
      {skills.map((s,i) => (
        <line key={i} x1={skillAnchors[i][0]} y1={skillAnchors[i][1]} x2={s.x} y2={s.y-12}
          stroke="#119760" strokeWidth="1" strokeOpacity="0.45" strokeDasharray="2 3"/>
      ))}
      {/* main path */}
      <line x1="40" y1="56" x2="105" y2="56" stroke="#119760" strokeWidth="1.3" markerEnd="url(#arr-g)"/>
      <line x1="215" y1="56" x2="320" y2="56" stroke="#119760" strokeWidth="1.3" markerEnd="url(#arr-g)"/>
      {/* IO */}
      <circle cx="24" cy="56" r="16" fill="#0b0d10"/>
      <text x="24" y="60" textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="9" fill="white">task</text>
      <circle cx="336" cy="56" r="16" fill="#0b0d10"/>
      <text x="336" y="60" textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="8" fill="white">answer</text>
      {/* conductor */}
      <rect x="105" y="38" width="110" height="36" rx="6" fill="white" stroke="#119760" strokeWidth="1.5"/>
      <text x="160" y="54" textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="10.5" fill="#0b0d10" fontWeight="600">conductor</text>
      <text x="160" y="67" textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="9" fill="#119760">claude-sonnet</text>
      {/* skill pills */}
      {skills.map((s,i) => (
        <g key={i}>
          <rect x={s.x-36} y={s.y-12} width="72" height="24" rx="12" fill="#f0fdf7" stroke="#119760" strokeWidth="1" strokeDasharray="3 3"/>
          <text x={s.x} y={s.y+4} textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="8.5" fill="#064d31">{s.label}</text>
        </g>
      ))}
      <text x="165" y="143" textAnchor="middle" fontFamily="Geist Mono,monospace" fontSize="8.5" fill="#119760" opacity="0.7">deterministic tools — no LLM calls</text>
    </svg>
  );
}

function ArchitectureComparison() {
  const tradeoffs = [
    { dim: "Latency",        committee: "High — each hand-off is a fresh LLM call",         glue: "Low — one LLM, tools run as fast code" },
    { dim: "Context",        committee: "Fragmented — state re-interpreted at each hop",     glue: "Unified — one context window, no drift" },
    { dim: "Debugging",      committee: "Complex — trace across N reasoning chains",         glue: "Standard — did the LLM call the skill? Did it run?" },
    { dim: "Cost",           committee: "Proportional to agent count × task length",         glue: "Proportional to conductor reasoning only" },
  ];
  return (
    <section className="page" style={{ paddingTop: 56, paddingBottom: 28 }}>
      <div style={{ marginBottom: 26 }}>
        <div className="section-eyebrow">04 · architectures</div>
        <h2 className="section-title">Two paradigms. One optimizer. No assumptions.</h2>
        <p className="section-lede">
          Multi-agent committees and agentic glue are different bets on where reasoning should live.
          AutoAW makes neither bet upfront — it searches both and lets your fitness function settle the argument.
        </p>
      </div>

      {/* Two panels */}
      <div className="arch-panels" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", border:"1px solid var(--border)", borderRadius:"var(--r-3)", overflow:"hidden", background:"var(--bg-alt)", marginBottom: 14 }}>
        <div style={{ padding: 20, borderRight:"1px solid var(--border)", background:"var(--bg-alt)" }}>
          <div className="ba-label">
            <span style={{ width:6, height:6, background:"var(--muted)", borderRadius:99, display:"inline-block" }}/>
            multi-agent committee
          </div>
          <CommitteeGraph/>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:12 }}>
            {["LLM-to-LLM hand-offs","fragmented context","high coordination overhead"].map(t => (
              <span key={t} className="chip" style={{ fontSize: 10 }}>{t}</span>
            ))}
          </div>
          <div className="mono" style={{ fontSize:12, color:"var(--muted)", marginTop:14 }}>
            <div style={{ fontSize:10, color:"var(--faint)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>wins when</div>
            {[
              "Security or permission isolation is required between agents",
              "Domain knowledge is too large for a single context window",
              "Task genuinely needs competing hypotheses (debate topology)",
            ].map((b,i) => (
              <div key={i} style={{ display:"flex", gap:8, marginBottom:6, alignItems:"flex-start" }}>
                <span style={{ color:"var(--faint)", flexShrink:0 }}>·</span><span>{b}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: 20, background:"var(--bg)" }}>
          <div className="ba-label">
            <span style={{ width:6, height:6, background:"var(--accent)", borderRadius:99, display:"inline-block" }}/>
            agentic glue + skills
          </div>
          <GlueGraph/>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:12 }}>
            {["one conductor","deterministic tools","unified context"].map(t => (
              <span key={t} className="chip chip-running" style={{ fontSize: 10 }}>{t}</span>
            ))}
          </div>
          <div className="mono" style={{ fontSize:12, color:"var(--muted)", marginTop:14 }}>
            <div style={{ fontSize:10, color:"var(--faint)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>wins when</div>
            {[
              "Standard engineering, data extraction, or enterprise automation tasks",
              "Cost and latency are in the objective — the fitness function will find it",
              "One capable model can hold the full reasoning context end-to-end",
            ].map((b,i) => (
              <div key={i} style={{ display:"flex", gap:8, marginBottom:6, alignItems:"flex-start" }}>
                <span style={{ color:"var(--accent)", flexShrink:0 }}>·</span><span>{b}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tradeoff table */}
      <div className="card arch-table-card" style={{ marginBottom: 14 }}>
        <table className="t">
          <thead>
            <tr>
              <th style={{ width:140 }}>Dimension</th>
              <th>Multi-Agent Committee</th>
              <th>Agentic Glue + Skills</th>
            </tr>
          </thead>
          <tbody>
            {tradeoffs.map((r,i) => (
              <tr key={i}>
                <td className="mono" style={{ fontSize:12, fontWeight:600, color:"var(--text)" }}>{r.dim}</td>
                <td style={{ fontSize:12.5, color:"var(--muted)" }}>{r.committee}</td>
                <td style={{ fontSize:12.5, color:"var(--accent-ink)" }}>{r.glue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </section>
  );
}

/* ---- How it works ---- */
const STEPS = [
  {
    num: "01", title: "Describe the task",
    body: `Either give a high-level task — "triage support tickets and propose a draft reply" — or import an existing workflow (LangGraph, DSPy, your own Python).`,
    art: (
      <div className="mono" style={{ padding: 12, fontSize: 11, color: "#6b7280", width: "100%" }}>
        <div style={{ color: "#9ca3af" }}># task.yaml</div>
        <div><span style={{ color: "#0b0d10" }}>goal:</span> &quot;Triage support tickets,</div>
        <div>&nbsp;&nbsp;propose draft reply with citations<span style={{ background: "#0b0d10", color: "white", width: 6, display: "inline-block", height: 11, marginLeft: 1 }}>&nbsp;</span></div>
      </div>
    ),
  },
  {
    num: "02", title: "Pick datasets & weights",
    body: "Choose an eval dataset (yours or one of 18 included). Set the utility weights — quality, $/run, p50 latency. AutoAW does the rest.",
    art: (
      <svg viewBox="0 0 200 60" width="100%" height={60}>
        {([{y:14,label:"quality",v:0.7},{y:30,label:"cost",v:0.25},{y:46,label:"speed",v:0.05}]).map((r,i) => (
          <g key={i}>
            <text x="12" y={r.y+3} fontFamily="Geist Mono, monospace" fontSize="9" fill="#6b7280">{r.label}</text>
            <rect x="56" y={r.y-2} width="120" height="4" rx="2" fill="#eef0f2"/>
            <rect x="56" y={r.y-2} width={120*r.v} height="4" rx="2" fill="#0b0d10"/>
            <circle cx={56+120*r.v} cy={r.y} r="3.5" fill="#0b0d10"/>
          </g>
        ))}
      </svg>
    ),
  },
  {
    num: "03", title: "AutoAW searches",
    body: "A search loop swaps models, splits/merges agents, edits prompts, prunes tools, and re-evaluates every candidate. The Pareto frontier fills in as it runs.",
    art: (
      <svg viewBox="0 0 200 60" width="100%" height={60}>
        {Array.from({length:22}).map((_,i) => {
          const x = 14 + (i*9)%170 + (i%3)*4;
          const y = 50 - Math.min(45, i*1.7+(i%4)*3);
          const onFrontier = i >= 17;
          return <circle key={i} cx={x} cy={y} r={onFrontier?3:1.8} fill={onFrontier?"#119760":"#cbd0d6"}/>;
        })}
        <path d="M14 48 L40 36 L72 24 L110 15 L160 9" fill="none" stroke="#119760" strokeWidth="1" strokeDasharray="2 3" opacity="0.6"/>
      </svg>
    ),
  },
  {
    num: "04", title: "Promote & deploy",
    body: "Pick any point on the frontier. Export as a single graph (JSON, Python, or a hosted endpoint). Fork to keep optimizing.",
    art: (
      <div className="mono" style={{ padding: 12, fontSize: 11, color: "#6b7280", width: "100%" }}>
        <div>$ autoaw promote <span style={{ color: "#0b0d10" }}>candidate-B</span></div>
        <div style={{ color: "#119760" }}>✓ deployed → exp-7c4e/prod</div>
        <div style={{ color: "#9ca3af" }}>endpoint: https://run.autoaw.io/v1/...</div>
      </div>
    ),
  },
];

function HowItWorks() {
  const [active, setActive] = useState(0);
  return (
    <section className="page" style={{ paddingTop: 56, paddingBottom: 28 }}>
      <div style={{ marginBottom: 26 }}>
        <div className="section-eyebrow">05 · how it works</div>
        <h2 className="section-title">Four steps. One Pareto frontier.</h2>
      </div>

      {/* Desktop: 4-column grid */}
      <div className="steps">
        {STEPS.map(s => (
          <div key={s.num} className="step">
            <div className="step-num">STEP {s.num}</div>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            <div className="step-art">{s.art}</div>
          </div>
        ))}
      </div>

      {/* Mobile: single-step carousel */}
      <div className="steps-carousel">
        <div className="step">
          <div className="step-num">STEP {STEPS[active].num}</div>
          <h3>{STEPS[active].title}</h3>
          <p>{STEPS[active].body}</p>
          <div className="step-art">{STEPS[active].art}</div>
        </div>
        <div className="steps-carousel-nav">
          <button
            className="btn btn-sm"
            onClick={() => setActive(a => a - 1)}
            disabled={active === 0}
          >← Prev</button>
          <div className="steps-carousel-dots">
            {STEPS.map((_, i) => (
              <button key={i} onClick={() => setActive(i)} className={`steps-dot${i === active ? " active" : ""}`}/>
            ))}
          </div>
          <button
            className="btn btn-sm"
            onClick={() => setActive(a => a + 1)}
            disabled={active === STEPS.length - 1}
          >Next →</button>
        </div>
      </div>
    </section>
  );
}

/* ---- Benchmark numbers ---- */
const BENCH = [
  { name: "GAIA",               num: "74.1", unit: "%", delta: "+5.3 vs. SOTA",      base: "baseline Sonnet 4.5: 69.2" },
  { name: "Cost / run",         num: "4.20", unit: "$", delta: "−6.7× cheaper",      base: "baseline GPT-5: $26.80" },
  { name: "Latency p50",        num: "2.4",  unit: "s", delta: "−3.6× faster",       base: "baseline GPT-5: 8.7s" },
  { name: "Generations to SOTA",num: "22",   unit: "",  delta: "≈ 38 min wall-clock", base: "94 candidates explored" },
];

function BenchmarkNumbers() {
  return (
    <section className="page" style={{ paddingTop: 56, paddingBottom: 28 }}>
      <div style={{ marginBottom: 26 }}>
        <div className="section-eyebrow">06 · results</div>
        <h2 className="section-title">What it found in our last run.</h2>
        <p className="section-lede">
          Task: customer-support copilot, 1,400-ticket eval. Objective = 0.7·quality + 0.25·cost⁻¹ + 0.05·speed.
        </p>
      </div>
      <div className="bench-grid">
        {BENCH.map((b,i) => (
          <div key={i} className="bench-cell">
            <div className="bench-name">{b.name}</div>
            <div className="bench-num mono tabular">
              {b.unit === "$" && <span className="unit">$</span>}
              {b.num}
              {b.unit && b.unit !== "$" && <span className="unit">{b.unit}</span>}
            </div>
            <div className="bench-delta">{b.delta}</div>
            <div className="bench-base">{b.base}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- Leaderboard preview ---- */
const PUBLIC_LB = [
  { rank: 1, team: "AutoAW · optimized",    model: "ensemble (CS+G5m)", quality: 0.741, cost: 4.20,  latency: 2.4, date: "May 18", best: true },
  { rank: 2, team: "Anthropic baseline",    model: "Claude Sonnet 4.5", quality: 0.692, cost: 14.10, latency: 5.8, date: "Apr 30" },
  { rank: 3, team: "OpenAI baseline",       model: "GPT-5",             quality: 0.688, cost: 26.80, latency: 8.7, date: "Apr 11" },
  { rank: 4, team: "Cosine.ai",             model: "Genie-2",           quality: 0.671, cost: 19.40, latency: 9.2, date: "Mar 22" },
  { rank: 5, team: "Google DeepMind",       model: "Gemini 2.5 Pro",    quality: 0.659, cost: 11.90, latency: 5.1, date: "Apr 04" },
  { rank: 6, team: "Manus AI",              model: "manus-r1",          quality: 0.641, cost: 8.30,  latency: 4.4, date: "Feb 28" },
];

function LeaderboardPreview() {
  return (
    <section className="page" style={{ paddingTop: 56, paddingBottom: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 22 }}>
        <div>
          <div className="section-eyebrow">07 · leaderboard</div>
          <h2 className="section-title">Live: top results on GAIA.</h2>
          <p className="section-lede">
            Public benchmark — anyone can submit. AutoAW-optimized graphs above single-model baselines for both quality and cost.
          </p>
        </div>
        <Link href="/experiments" className="btn" style={{ flexShrink: 0, marginBottom: 8 }}>
          See experiments <Icon name="arrow-right" size={12}/>
        </Link>
      </div>
      <div className="card lb-table-card">
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Team / submission</th>
              <th>Configuration</th>
              <th className="num">Quality</th>
              <th className="num">Cost / run</th>
              <th className="num">Latency p50</th>
            </tr>
          </thead>
          <tbody>
            {PUBLIC_LB.map((r,i) => (
              <tr key={i} className={r.best ? "row-best" : ""}>
                <td className="rank">#{r.rank}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{r.team}</span>
                    {r.best && <span className="lb-best">best · pareto</span>}
                  </div>
                  <div className="mono faint" style={{ fontSize: 11, marginTop: 2 }}>submitted {r.date}</div>
                </td>
                <td className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{r.model}</td>
                <td className="num">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                    <span>{r.quality.toFixed(3)}</span>
                    <div className="bar" style={{ width: 60 }}>
                      <div className={`bar-fill${r.best?" acc":""}`} style={{ width: `${(r.quality/0.85)*100}%` }}/>
                    </div>
                  </div>
                </td>
                <td className="num">${r.cost.toFixed(2)}</td>
                <td className="num">{r.latency.toFixed(1)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---- Pricing ---- */
const CHECK = <Icon name="check" size={13}/>;

function PlanCard({ name, desc, price, period, custom, cta, ctaPrimary, badge, featured, meta, feats, href }: {
  name: string; desc: string; price?: string; period?: string; custom?: string;
  cta: string; ctaPrimary?: boolean; badge?: string; featured?: boolean;
  meta: [string, string][]; feats: (string | { text: string; muted?: boolean })[];
  href?: string;
}) {
  return (
    <div className={`plan${featured ? " plan-featured" : ""}`}>
      {badge && <div className="plan-badge">{badge}</div>}
      <div className="plan-name">{name}</div>
      <div className="plan-desc">{desc}</div>
      <div className="plan-price">
        {custom ? (
          <span className="custom">{custom}</span>
        ) : (
          <><span className="amount">{price}</span><span className="period">{period}</span></>
        )}
      </div>
      <div className="plan-cta">
        <Link href={href ?? "/experiments/new"} className={`btn btn-lg${ctaPrimary ? " btn-primary" : ""}`} style={{ width: "100%", justifyContent: "center" }}>
          {cta} <Icon name="arrow-right" size={12}/>
        </Link>
      </div>
      <div className="plan-divider"/>
      <dl className="plan-meta">
        {meta.map(([k,v],i) => (
          <Fragment key={i}><dt>{k}</dt><dd>{v}</dd></Fragment>
        ))}
      </dl>
      <div className="plan-divider"/>
      <ul className="plan-feats">
        {feats.map((f,i) => {
          const text = typeof f === "object" ? f.text : f;
          const muted = typeof f === "object" && f.muted;
          return (
            <li key={i} className={muted ? "feat-muted" : ""}>
              {CHECK}<span>{text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="page" style={{ paddingTop: 56, paddingBottom: 28 }}>
      <div style={{ marginBottom: 30 }}>
        <div className="section-eyebrow">08 · pricing</div>
        <h2 className="section-title">Free for research. Licensed for commercial use.</h2>
        <p className="section-lede">
          AutoAW is open source under the PolyForm Noncommercial license — free forever for researchers and personal projects.
          Commercial use requires a license; pricing is custom and based on your use case.
        </p>
      </div>
      <div className="pricing-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <PlanCard
          name="Research & Personal"
          desc="For academics, individual researchers, and non-commercial side projects."
          price="$0" period="/ forever"
          cta="Start free"
          meta={[
            ["license","PolyForm Noncommercial 1.0.0"],
            ["concurrent experiments","2"],
            ["candidates / month","500"],
            ["support","GitHub Discussions"],
          ]}
          feats={[
            "Full access to all search algorithms (MIPRO, OPRO, evo)",
            "Bring-your-own API keys",
            "Public leaderboard submissions",
            "All export formats (JSON, Python)",
            { text: "Commercial use", muted: true },
            { text: "SLA / dedicated support", muted: true },
          ]}
        />
        <PlanCard
          name="Enterprise"
          desc="Commercial license for teams shipping agentic products to production."
          custom="Custom pricing"
          cta="Request demo & quote"
          ctaPrimary featured
          href="/demo"
          meta={[
            ["license","Commercial — contact us"],
            ["deployment","SaaS · VPC · on-prem"],
            ["seats","unlimited"],
            ["uptime SLA","99.9%"],
          ]}
          feats={[
            "Everything in Research",
            "Commercial use rights",
            "Unlimited experiments & candidates",
            "SSO (SAML / OIDC) + SCIM",
            "SOC 2 Type II, HIPAA, audit logs",
            "Dedicated solutions engineer",
            "Priority support · 1-hour response",
          ]}
        />
      </div>
      <div className="pricing-foot mono">
        Not sure if your use case is commercial? See <a href="/COMMERCIAL.md" style={{ color: "inherit", textDecoration: "underline" }}>COMMERCIAL.md</a> or email us.
      </div>
    </section>
  );
}

/* ---- Final CTA ---- */
function FinalCTA() {
  return (
    <section className="page" style={{ paddingTop: 70, paddingBottom: 50 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--r-3)", padding: "40px 36px", background: "var(--ink)", color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24 }}>
        <div>
          <div className="mono" style={{ fontSize: 11, color: "#9aa5b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Request a demo &amp; quotation
          </div>
          <h3 style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em", margin: "10px 0 6px" }}>
            See AutoAW in action on your own workflow.
          </h3>
          <div style={{ color: "#9aa5b8", fontSize: 14 }}>
            We&apos;ll walk you through a live demo and put together a custom quote for your team.
          </div>
        </div>
        <Link href="/demo" className="btn btn-lg" style={{ background: "white", color: "#0b0d10", borderColor: "white", flexShrink: 0 }}>
          Request a demo <Icon name="arrow-right" size={13}/>
        </Link>
      </div>
    </section>
  );
}

/* ---- Footer ---- */
function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={20}/>
          <span className="mono">© 2026 AutoAW Labs</span>
          <span className="faint">·</span>
          <span>v0.4.1</span>
        </div>
        <div style={{ display: "flex", gap: 18, color: "var(--faint)", fontSize: 12.5 }}>
          <a href="https://github.com/deil87/autoaw" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>GitHub</a>
          <span style={{ cursor: "default" }}>Docs</span>
          <span style={{ cursor: "default" }}>API</span>
          <span style={{ cursor: "default" }}>Status</span>
          <span style={{ color: "var(--border)" }}>·</span>
          <a href="mailto:admin@optimetrics.ai" style={{ color: "inherit", textDecoration: "none" }}>Investors welcome</a>
        </div>
      </div>
    </footer>
  );
}

/* ---- Page ---- */
export default function HomePage() {
  return (
    <div>
      <Hero/>
      <BeforeAfter/>
      <ArchitectureComparison/>
      <HowItWorks/>
      <BenchmarkNumbers/>
      <LeaderboardPreview/>
      <Pricing/>
      <FinalCTA/>
      <Footer/>
    </div>
  );
}
