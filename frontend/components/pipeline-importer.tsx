"use client";
import { useState } from "react";
import { Wand2, ChevronDown, ChevronUp, X, Check, Loader2, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import type { Gene, GeneConversionResult } from "@/lib/types";

const TOPOLOGY_LABELS: Record<string, string> = {
  fixed_pipeline:   "Fixed Pipeline",
  ai_orchestrated:  "AI Orchestrated",
};

const EXAMPLES = [
  {
    label: "Chain",
    text: "A researcher agent searches the web and feeds its findings to a writer agent, which produces a polished summary.",
  },
  {
    label: "Debate",
    text: "An advocate argues strongly for a proposed solution. A critic challenges it and identifies weaknesses. A judge synthesizes both perspectives into a balanced final answer.",
  },
  {
    label: "Parallel",
    text: "A planner breaks the task into three subtasks and broadcasts them to three specialist workers running in parallel. A synthesizer merges all results into a final output.",
  },
  {
    label: "CrewAI",
    text: `crew:
  agents:
    - name: researcher
      role: Research Analyst
      goal: Find accurate information on the topic
      model: gpt-4o
    - name: writer
      role: Content Writer
      goal: Write a clear, concise report
      model: gpt-4o-mini
  tasks:
    - agent: researcher
      description: Research the topic thoroughly
    - agent: writer
      description: Write a summary based on the research
      depends_on: [researcher]`,
  },
];

interface PipelineImporterProps {
  seeded: Gene | null;
  onSeed: (gene: Gene) => void;
  onClear: () => void;
}

export function PipelineImporter({ seeded, onSeed, onClear }: PipelineImporterProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneConversionResult | null>(null);

  const convert = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.genes.fromDescription(text);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setLoading(false);
    }
  };

  const useSeed = () => {
    if (!result) return;
    onSeed(result.gene);
    setOpen(false);
  };

  if (seeded) {
    return (
      <div style={{
        border: "1px solid rgba(17,151,96,0.35)",
        borderRadius: "var(--r-3)",
        background: "var(--accent-soft)",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: "var(--r-2)",
            background: "var(--accent)", display: "flex",
            alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Check size={13} color="white" strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-ink)" }}>
              Seed pipeline attached
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--accent-ink)", opacity: 0.7, marginTop: 1 }}>
              {TOPOLOGY_LABELS[seeded.topology] ?? seeded.topology}
              {" · "}
              {seeded.agents.length} agent{seeded.agents.length !== 1 ? "s" : ""}
              {" · "}
              {seeded.edges.length} edge{seeded.edges.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onClear}
          style={{ borderColor: "rgba(6,77,49,0.2)", background: "transparent", color: "var(--accent-ink)" }}
        >
          <X size={12} />
          Remove
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          background: "none", border: "none", padding: "4px 0",
          color: "var(--muted)", fontSize: 13, fontWeight: 500, cursor: "pointer",
          transition: "color 0.12s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
      >
        <Wand2 size={13} />
        Seed from existing pipeline
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="card-header">
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 3 }}>Import existing pipeline</div>
              <div className="card-title">Paste anything — code, config, or plain description</div>
            </div>
          </div>

          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Example pills */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{
                fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)",
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>
                Try
              </span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)" }}
                  onClick={() => { setText(ex.text); setResult(null); setError(null); }}
                >
                  {ex.label}
                </button>
              ))}
            </div>

            {/* Textarea */}
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setResult(null); setError(null); }}
              placeholder={"Paste Python code, LangChain / CrewAI / AutoGen config, YAML, or describe your pipeline in plain language.\n\nExample: \"A researcher feeds findings to a writer, then a critic reviews the output before it's published.\""}
              rows={7}
              style={{
                width: "100%",
                resize: "vertical",
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                background: "var(--bg-alt)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-2)",
                padding: "10px 12px",
                color: "var(--text)",
                lineHeight: 1.6,
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.12s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--border-strong)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
            />

            {error && (
              <div style={{
                background: "var(--err-soft)",
                border: "1px solid rgba(185,28,28,0.2)",
                borderRadius: "var(--r-2)",
                padding: "8px 12px",
                fontSize: 12.5,
                color: "var(--err)",
              }}>
                {error}
              </div>
            )}

            <div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={convert}
                disabled={loading || !text.trim()}
                style={{ opacity: !text.trim() ? 0.5 : 1 }}
              >
                {loading
                  ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                  : <Wand2 size={13} />}
                {loading ? "Converting…" : "Convert with AI"}
              </button>
            </div>

            {result && <GenePreview result={result} onUse={useSeed} />}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function GenePreview({ result, onUse }: { result: GeneConversionResult; onUse: () => void }) {
  const { gene, notes } = result;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--r-3)", overflow: "hidden" }}>

      {/* Preview header */}
      <div style={{
        padding: "10px 14px",
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)",
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            Detected
          </span>
          <span className="chip chip-done">
            {TOPOLOGY_LABELS[gene.topology] ?? gene.topology}
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)" }}>
            {gene.agents.length} agent{gene.agents.length !== 1 ? "s" : ""}
            {" · "}
            {gene.edges.length} edge{gene.edges.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={onUse}>
          <Check size={12} />
          Use as seed
        </button>
      </div>

      {/* Agents */}
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {gene.agents.map((agent) => (
          <div
            key={agent.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--r-2)",
              padding: "10px 12px",
              background: "var(--bg)",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              alignItems: "start",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                  {agent.role}
                </span>
                <span className="chip" style={{ fontSize: 10.5 }}>{agent.id}</span>
                {agent.tools && agent.tools.length > 0 && agent.tools.map((t) => (
                  <span key={t} className="chip" style={{ fontSize: 10.5, color: "var(--accent-ink)", background: "var(--accent-soft)", borderColor: "rgba(17,151,96,0.2)" }}>
                    {t}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.55 }}>
                {agent.system_prompt}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)" }}>
                {agent.model}
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)", marginTop: 2 }}>
                T={agent.temperature}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Edges */}
      {gene.edges.length > 0 && (
        <div style={{
          padding: "0 14px 12px",
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          alignItems: "center",
        }}>
          <span style={{
            fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)",
            textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 2,
          }}>
            Edges
          </span>
          {gene.edges.map((edge, i) => (
            <span key={i} className="chip" style={{ fontSize: 11, gap: 5 }}>
              {edge.from}
              <ArrowRight size={10} style={{ color: "var(--faint)" }} />
              {edge.to}
              {edge.type && edge.type !== "sequential" && (
                <span style={{ color: "var(--faint)" }}>·{edge.type}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Conversion notes */}
      {notes && notes.length > 0 && (
        <div style={{
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
          background: "var(--warn-soft)",
        }}>
          <div style={{
            fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--warn)",
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5,
          }}>
            Conversion notes
          </div>
          {notes.map((note, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--warn)", lineHeight: 1.55 }}>
              · {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
