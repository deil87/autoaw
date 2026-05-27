"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";

export default function ConfirmPage() {
  return (
    <Suspense>
      <ConfirmForm />
    </Suspense>
  );
}

function ConfirmForm() {
  const { confirmSignUp, resendCode } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const emailParam = params.get("email") ?? "";

  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await confirmSignUp(email, code);
      router.replace("/login?confirmed=1");
    } catch (err: any) {
      setError(err.message ?? "Confirmation failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError("");
    try {
      await resendCode(email);
      setResent(true);
      setTimeout(() => setResent(false), 4000);
    } catch (err: any) {
      setError(err.message ?? "Failed to resend");
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: "0 auto", padding: "72px 0 80px" }}>
      <div style={{ marginBottom: 32 }}>
        <div className="section-eyebrow">Verify email</div>
        <h1 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.025em", margin: "10px 0 0", color: "var(--ink)" }}>
          Check your inbox
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 8, lineHeight: 1.55 }}>
          We sent a 6-digit verification code to{" "}
          <span style={{ color: "var(--text)", fontWeight: 500 }}>{email || "your email"}</span>.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {!emailParam && (
          <Field label="Email" name="email" type="email" placeholder="you@company.com"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
        )}
        <Field label="Verification code" name="code" placeholder="123456"
          value={code} onChange={(e) => setCode(e.target.value)} required />

        {error && <p style={{ fontSize: 13, color: "var(--err)", margin: 0 }}>{error}</p>}
        {resent && <p style={{ fontSize: 13, color: "var(--accent)", margin: 0 }}>Code resent — check your inbox.</p>}

        <button type="submit" disabled={loading} className="btn btn-primary btn-lg"
          style={{ opacity: loading ? 0.7 : 1, marginTop: 4, justifyContent: "center" }}>
          {loading ? "Verifying…" : "Verify account →"}
        </button>
      </form>

      <p style={{ marginTop: 20, fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
        Didn&apos;t get a code?{" "}
        <button onClick={handleResend} className="btn btn-ghost btn-sm"
          style={{ fontSize: 13, padding: "2px 4px" }}>
          Resend
        </button>
      </p>
    </div>
  );
}

function Field({ label, name, type = "text", placeholder, value, onChange, required }: {
  label: string; name: string; type?: string; placeholder?: string;
  value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; required?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label htmlFor={name} className="mono"
        style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
        {label}
      </label>
      <input
        id={name} name={name} type={type} placeholder={placeholder}
        value={value} onChange={onChange} required={required}
        style={{
          border: "1px solid var(--border-strong)", borderRadius: 6, padding: "9px 11px",
          fontSize: 14, fontFamily: "inherit", background: "var(--bg)",
          color: "var(--text)", outline: "none", width: "100%", boxSizing: "border-box",
        }}
      />
    </div>
  );
}
