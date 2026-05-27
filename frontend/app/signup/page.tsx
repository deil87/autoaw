"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";

export default function SignupPage() {
  const { signUp } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signUp(email, password);
      router.push(`/confirm?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      setError(err.message ?? "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: "0 auto", padding: "72px 0 80px" }}>
      <div style={{ marginBottom: 32 }}>
        <div className="section-eyebrow">Get started</div>
        <h1 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.025em", margin: "10px 0 0", color: "var(--ink)" }}>
          Create your account
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 8, lineHeight: 1.55 }}>
          Free for research and personal use.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Email" name="email" type="email" placeholder="you@company.com"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <div>
          <Field label="Password" name="password" type="password" placeholder="8+ characters"
            value={password} onChange={(e) => setPassword(e.target.value)} required />
          <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "5px 0 0", fontFamily: "var(--mono)" }}>
            Min 8 chars, at least one digit
          </p>
        </div>

        {error && <p style={{ fontSize: 13, color: "var(--err)", margin: 0 }}>{error}</p>}

        <button type="submit" disabled={loading} className="btn btn-primary btn-lg"
          style={{ opacity: loading ? 0.7 : 1, marginTop: 4, justifyContent: "center" }}>
          {loading ? "Creating account…" : "Create account →"}
        </button>
      </form>

      <p style={{ marginTop: 24, fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
        Already have an account?{" "}
        <Link href="/login" style={{ color: "var(--accent)" }}>Sign in</Link>
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
