import Link from "next/link";

function Logo({ size = 56 }: { size?: number }) {
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
        <line key={i}
          x1={nodes[a].x} y1={nodes[a].y}
          x2={nodes[b].x} y2={nodes[b].y}
          stroke="var(--ink)" strokeWidth="1.1"/>
      ))}
      {nodes.map((n,i) => (
        <circle key={i} cx={n.x} cy={n.y} r={n.r} fill="var(--ink)"/>
      ))}
      <circle cx="0" cy="0" r="1.4" fill="#119760">
        <animateMotion dur="2.4s" repeatCount="indefinite"
          path="M 6 13 L 13 6 L 20 13 L 13 20 Z"/>
      </circle>
    </svg>
  );
}

const STEPS = [
  {
    num: "01",
    title: "Describe the task",
    body: "Give a high-level task — \"triage support tickets and propose a draft reply\" — or import an existing workflow.",
    art: (
      <div className="mono" style={{ padding: 12, fontSize: 11, color: "var(--muted)", width: "100%" }}>
        <div style={{ color: "var(--faint)" }}># task.yaml</div>
        <div><span style={{ color: "var(--text)" }}>goal:</span> "Triage support tickets,</div>
        <div style={{ color: "var(--muted)" }}>  propose draft reply with citations</div>
      </div>
    ),
  },
  {
    num: "02",
    title: "Pick datasets & weights",
    body: "Choose an eval dataset. Set the utility weights — quality, $/run, p50 latency. AutoAW does the rest.",
    art: (
      <svg viewBox="0 0 200 60" width="100%" height="60">
        {[
          { y: 14, label: "quality", v: 0.7 },
          { y: 30, label: "cost",    v: 0.25 },
          { y: 46, label: "speed",   v: 0.05 },
        ].map((r, i) => (
          <g key={i}>
            <text x="12" y={r.y + 3} fontFamily="var(--mono)" fontSize="9" fill="var(--muted)">{r.label}</text>
            <rect x="56" y={r.y - 2} width="120" height="4" rx="2" fill="var(--surface-2)"/>
            <rect x="56" y={r.y - 2} width={120 * r.v} height="4" rx="2" fill="var(--ink)"/>
            <circle cx={56 + 120 * r.v} cy={r.y} r="3.5" fill="var(--ink)"/>
          </g>
        ))}
      </svg>
    ),
  },
  {
    num: "03",
    title: "AutoAW searches",
    body: "A search loop swaps models, splits/merges agents, edits prompts, prunes tools, and re-evaluates every candidate. The Pareto frontier fills in as it runs.",
    art: (
      <svg viewBox="0 0 200 60" width="100%" height="60">
        {Array.from({ length: 22 }).map((_, i) => {
          const x = 14 + (i * 9) % 170 + (i % 3) * 4;
          const y = 50 - Math.min(45, i * 1.7 + (i % 4) * 3);
          const onFrontier = i >= 17;
          return <circle key={i} cx={x} cy={y} r={onFrontier ? 3 : 1.8}
            fill={onFrontier ? "var(--accent)" : "var(--border-strong)"}/>;
        })}
        <path d="M14 48 L40 36 L72 24 L110 15 L160 9"
          fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 3" opacity="0.6"/>
      </svg>
    ),
  },
  {
    num: "04",
    title: "Promote & deploy",
    body: "Pick any point on the frontier. Export as a single graph (JSON or Python). Fork to keep optimizing.",
    art: (
      <div className="mono" style={{ padding: 12, fontSize: 11, color: "var(--muted)", width: "100%" }}>
        <div>$ autoaw promote <span style={{ color: "var(--text)" }}>candidate-B</span></div>
        <div style={{ color: "var(--accent-ink)" }}>✓ deployed → exp-7c4e/prod</div>
      </div>
    ),
  },
];

const STATS = [
  { num: "74.1%", label: "on GAIA", sub: "vs 69.2% Sonnet 4.5 baseline" },
  { num: "6.7×",  label: "cheaper", sub: "vs same-quality GPT-5 single-agent" },
  { num: "38 min", label: "to SOTA", sub: "94 candidates evaluated" },
  { num: "22",    label: "generations", sub: "customer-support copilot" },
];

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section style={{ padding: "64px 0 40px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "5px 12px 5px 8px", border: "1px solid var(--border)",
              borderRadius: 999, background: "var(--bg)",
              fontFamily: "var(--mono)", fontSize: 11.5,
              letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--accent)", animation: "aw-pulse 1.6s ease-in-out infinite", display: "inline-block" }}/>
              v0.4 · beta
            </span>

            <h1 style={{
              fontSize: 52, lineHeight: 1.05, letterSpacing: "-0.035em",
              fontWeight: 500, margin: "18px 0 0", color: "var(--text)",
            }}>
              Optimize any agentic workflow{" "}
              <span style={{ color: "var(--muted)" }}>against cost, speed, and quality.</span>
            </h1>

            <p style={{ marginTop: 18, fontSize: 17, color: "var(--muted)", lineHeight: 1.55, maxWidth: "52ch" }}>
              Drop in a task or an existing graph. AutoAW co-evolves topology, prompts,
              models, and tools — searching the Pareto frontier of your utility function
              so you ship the cheapest version that still hits your bar.
            </p>

            <div style={{ marginTop: 26, display: "flex", gap: 10, alignItems: "center" }}>
              <Link href="/experiments/new" className="btn btn-primary btn-lg">
                Start an experiment →
              </Link>
              <Link href="/experiments" className="btn btn-lg">
                View experiments
              </Link>
            </div>

            <div style={{ marginTop: 30, display: "flex", gap: 28, flexWrap: "wrap", fontSize: 12.5, color: "var(--faint)" }}>
              <span><b className="mono tabular" style={{ color: "var(--text)" }}>74.1%</b> on GAIA</span>
              <span><b className="mono tabular" style={{ color: "var(--text)" }}>6.7×</b> cheaper</span>
              <span><b className="mono tabular" style={{ color: "var(--text)" }}>38 min</b> to SOTA</span>
            </div>
          </div>

          {/* Live card preview */}
          <div style={{
            border: "1px solid var(--border)", borderRadius: "var(--r-4)",
            background: "radial-gradient(600px 300px at 100% 0%, rgba(17,151,96,0.05), transparent 60%), var(--bg)",
            boxShadow: "var(--shadow-2)", overflow: "hidden",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg)",
            }}>
              <div style={{ display: "flex", gap: 6 }}>
                {["var(--border-strong)","var(--border-strong)","var(--border-strong)"].map((c,i) =>
                  <span key={i} style={{ width: 9, height: 9, borderRadius: 99, background: c }}/>)}
              </div>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)", flex: 1 }}>
                exp-7c4e · customer-support-copilot
              </span>
              <span className="chip chip-running"><span className="chip-dot pulse"/>running</span>
            </div>
            <div style={{ padding: 20 }}>
              {/* Mini workflow diagram */}
              <svg viewBox="0 0 440 200" width="100%" style={{ display: "block" }}>
                <defs>
                  <marker id="lp-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="var(--border-strong)"/>
                  </marker>
                </defs>
                {/* dot grid */}
                {Array.from({length:11}).map((_,i)=>Array.from({length:5}).map((_,j)=>
                  <circle key={`${i}-${j}`} cx={20+i*40} cy={20+j*40} r="0.8" fill="var(--border)"/>
                ))}
                {/* edges */}
                {[
                  [60,100,160,100],[160,100,280,65],[160,100,280,140],
                  [340,65,390,100],[340,140,390,100],
                ].map(([x1,y1,x2,y2],i)=>(
                  <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="var(--border-strong)" strokeWidth="1.2" markerEnd="url(#lp-arr)"/>
                ))}
                {/* task node */}
                <circle cx="50" cy="100" r="16" fill="var(--ink)"/>
                <text x="50" y="103" textAnchor="middle" fontFamily="var(--mono)" fontSize="9.5" fill="white">task</text>
                {/* planner */}
                <rect x="110" y="84" width="90" height="32" rx="6" fill="white" stroke="var(--accent)" strokeWidth="1.4"/>
                <text x="155" y="99" textAnchor="middle" fontFamily="var(--mono)" fontSize="10.5" fontWeight="600" fill="var(--ink)">planner</text>
                <text x="155" y="111" textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--accent)">cs-4.5</text>
                {/* exec a */}
                <rect x="245" y="48" width="80" height="32" rx="6" fill="white" stroke="var(--border-strong)" strokeWidth="1.2"/>
                <text x="285" y="63" textAnchor="middle" fontFamily="var(--mono)" fontSize="10.5" fontWeight="600" fill="var(--ink)">exec·a</text>
                <text x="285" y="75" textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--muted)">g2-flash</text>
                {/* exec b */}
                <rect x="245" y="124" width="80" height="32" rx="6" fill="white" stroke="var(--border-strong)" strokeWidth="1.2"/>
                <text x="285" y="139" textAnchor="middle" fontFamily="var(--mono)" fontSize="10.5" fontWeight="600" fill="var(--ink)">exec·b</text>
                <text x="285" y="151" textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--muted)">g2-flash</text>
                {/* judge */}
                <rect x="355" y="84" width="68" height="32" rx="6" fill="white" stroke="var(--accent)" strokeWidth="1.4"/>
                <text x="389" y="99" textAnchor="middle" fontFamily="var(--mono)" fontSize="10.5" fontWeight="600" fill="var(--ink)">judge</text>
                <text x="389" y="111" textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--accent)">haiku</text>
              </svg>

              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                gap: 10, marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)",
              }}>
                {[
                  { label: "quality", value: "0.741", delta: "+0.329 vs init" },
                  { label: "cost / run", value: "$4.20", delta: "−$34.30 vs init" },
                  { label: "p50 latency", value: "2.4s", delta: "−10.0s vs init" },
                ].map(s => (
                  <div key={s.label}>
                    <div className="metric-label" style={{ fontSize: 10 }}>{s.label}</div>
                    <div className="mono tabular" style={{ marginTop: 5, fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em" }}>{s.value}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--accent-ink)", marginTop: 2 }}>{s.delta}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "0 0 56px" }}/>

      {/* Stats strip */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        border: "1px solid var(--border)", borderRadius: "var(--r-3)", overflow: "hidden",
        marginBottom: 56,
      }}>
        {STATS.map((s, i) => (
          <div key={i} style={{
            padding: "22px 24px",
            borderRight: i < STATS.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
            <div className="mono tabular" style={{ fontSize: 34, fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1, marginTop: 10 }}>{s.num}</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--accent-ink)", marginTop: 8 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <section style={{ marginBottom: 64 }}>
        <div style={{ marginBottom: 26 }}>
          <div className="section-eyebrow">how it works</div>
          <h2 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.025em", margin: "8px 0 0" }}>
            Four steps. One Pareto frontier.
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {STEPS.map((s) => (
            <div key={s.num} style={{
              border: "1px solid var(--border)", borderRadius: "var(--r-3)",
              padding: 18, background: "var(--bg)",
            }}>
              <div className="mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: "0.06em" }}>STEP {s.num}</div>
              <h3 style={{ margin: "8px 0 6px", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>{s.title}</h3>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{s.body}</p>
              <div style={{
                marginTop: 12, minHeight: 72,
                border: "1px solid var(--border)", borderRadius: "var(--r-2)",
                background: "var(--bg-alt)", display: "flex", alignItems: "center", overflow: "hidden",
              }}>
                {s.art}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA banner */}
      <section style={{ marginBottom: 64 }}>
        <div style={{
          border: "1px solid var(--border)", borderRadius: "var(--r-3)",
          padding: "40px 36px",
          background: "var(--ink)", color: "white",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24,
        }}>
          <div>
            <div className="mono" style={{ fontSize: 11, color: "#9aa5b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Ready when you are
            </div>
            <h3 style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em", margin: "10px 0 6px" }}>
              Bring a task or a workflow. We&apos;ll search the frontier.
            </h3>
            <div style={{ color: "#9aa5b8", fontSize: 14 }}>
              Free during beta · works with LangGraph, DSPy, Inspect, or raw Python.
            </div>
          </div>
          <Link href="/experiments/new"
            className="btn btn-lg"
            style={{ background: "white", color: "var(--ink)", borderColor: "white", flexShrink: 0 }}>
            Open the dashboard →
          </Link>
        </div>
      </section>
    </div>
  );
}
