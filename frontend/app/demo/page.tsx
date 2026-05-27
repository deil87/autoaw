"use client";
import { useState } from "react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://5oahxb0xj7.execute-api.eu-central-1.amazonaws.com";

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    "arrow-right": "M5 12h14M13 6l6 6-6 6",
    "check": "M20 6L9 17l-5-5",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] ?? paths["arrow-right"]} />
    </svg>
  );
}

export default function DemoPage() {
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch(`${API_URL}/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? "Something went wrong");
      }
      setStatus("success");
    } catch (err: any) {
      setErrorMsg(err.message ?? "Failed to send. Please email us directly.");
      setStatus("error");
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "56px 0 80px" }}>
      <div style={{ marginBottom: 36 }}>
        <div className="section-eyebrow">Request a demo</div>
        <h1 style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.1, margin: "10px 0 0", color: "var(--ink)" }}>
          See AutoAW on your workflow.
        </h1>
        <p style={{ fontSize: 16, color: "var(--muted)", marginTop: 12, lineHeight: 1.55 }}>
          We&apos;ll reach out within one business day to schedule a live walkthrough and put together a custom quote for your team.
        </p>
      </div>

      {status === "success" ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "32px 28px", background: "var(--bg-alt)", textAlign: "center" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#f0fdf7", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#119760" }}>
            <Icon name="check" size={18} />
          </div>
          <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 6 }}>Request sent</div>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            Thanks, {form.name.split(" ")[0]}! We&apos;ll be in touch shortly.
          </p>
          <Link href="/" className="btn btn-sm" style={{ marginTop: 20, display: "inline-flex" }}>
            Back to home
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Name" name="name" placeholder="Ada Lovelace" value={form.name} onChange={handleChange} required />
            <Field label="Work email" name="email" type="email" placeholder="ada@company.com" value={form.email} onChange={handleChange} required />
          </div>
          <Field label="Company" name="company" placeholder="Acme Corp (optional)" value={form.company} onChange={handleChange} />
          <TextareaField
            label="What are you trying to optimize?"
            name="message"
            placeholder="Describe your workflow, current approach, and what you'd like to improve — e.g. latency, cost, accuracy..."
            value={form.message}
            onChange={handleChange}
            required
            rows={5}
          />

          {status === "error" && (
            <p style={{ fontSize: 13, color: "#b91c1c", margin: 0 }}>{errorMsg}</p>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <span style={{ fontSize: 12.5, color: "var(--faint)", fontFamily: "var(--mono)" }}>
              No spam. We&apos;ll only use this to schedule your demo.
            </span>
            <button
              type="submit"
              disabled={status === "loading"}
              className="btn btn-primary btn-lg"
              style={{ flexShrink: 0, opacity: status === "loading" ? 0.7 : 1 }}
            >
              {status === "loading" ? "Sending…" : <>Send request <Icon name="arrow-right" size={13} /></>}
            </button>
          </div>
        </form>
      )}

      <div style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
        <div className="mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>
          What happens next
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            ["We review your workflow", "We look at what you described and prepare a relevant demo tailored to your use case."],
            ["Live walkthrough (30 min)", "We run AutoAW on a workflow similar to yours so you can see real results, not slides."],
            ["Custom quote", "Pricing depends on deployment model and scale — we&apos;ll send a proposal the same day."],
          ].map(([title, body], i) => (
            <div key={i} style={{ display: "flex", gap: 14 }}>
              <div className="mono" style={{ fontSize: 11, color: "var(--faint)", width: 20, flexShrink: 0, paddingTop: 2 }}>0{i + 1}</div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{title}</div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: body }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, name, type = "text", placeholder, value, onChange, required }: {
  label: string; name: string; type?: string; placeholder?: string;
  value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; required?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label htmlFor={name} className="mono" style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
        {label}{required && <span style={{ color: "var(--accent)", marginLeft: 3 }}>*</span>}
      </label>
      <input
        id={name} name={name} type={type} placeholder={placeholder}
        value={value} onChange={onChange} required={required}
        style={{
          border: "1px solid var(--border-strong)", borderRadius: 6, padding: "8px 10px",
          fontSize: 14, fontFamily: "inherit", background: "var(--bg)",
          color: "var(--text)", outline: "none", width: "100%", boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function TextareaField({ label, name, placeholder, value, onChange, required, rows = 4 }: {
  label: string; name: string; placeholder?: string;
  value: string; onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  required?: boolean; rows?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label htmlFor={name} className="mono" style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
        {label}{required && <span style={{ color: "var(--accent)", marginLeft: 3 }}>*</span>}
      </label>
      <textarea
        id={name} name={name} placeholder={placeholder}
        value={value} onChange={onChange} required={required} rows={rows}
        style={{
          border: "1px solid var(--border-strong)", borderRadius: 6, padding: "8px 10px",
          fontSize: 14, fontFamily: "inherit", background: "var(--bg)",
          color: "var(--text)", outline: "none", resize: "vertical", width: "100%", boxSizing: "border-box",
        }}
      />
    </div>
  );
}
