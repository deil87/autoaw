"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") ?? "/experiments";
  const confirmed = params.get("confirmed") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
      router.replace(from);
    } catch (err: any) {
      if (err.code === "UserNotConfirmedException") {
        router.push(`/confirm?email=${encodeURIComponent(email)}`);
      } else {
        setError(err.message ?? "Sign in failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: "0 auto", padding: "72px 0 80px" }}>
      <div style={{ marginBottom: 32 }}>
        <div className="section-eyebrow">Welcome back</div>
        <h1 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.025em", margin: "10px 0 0", color: "var(--ink)" }}>
          Sign in to AutoAW
        </h1>
      </div>

      {confirmed && (
        <div style={{ marginBottom: 20, padding: "10px 14px", borderRadius: 6, background: "var(--accent-soft)", border: "1px solid rgba(17,151,96,0.2)", fontSize: 13, color: "var(--accent-ink)" }}>
          Account verified — you can now sign in.
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Email" name="email" type="email" placeholder="you@company.com"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="Password" name="password" type="password" placeholder="••••••••"
          value={password} onChange={(e) => setPassword(e.target.value)} required />

        {error && <p style={{ fontSize: 13, color: "var(--err)", margin: 0 }}>{error}</p>}

        <button type="submit" disabled={loading} className="btn btn-primary btn-lg"
          style={{ opacity: loading ? 0.7 : 1, marginTop: 4, justifyContent: "center" }}>
          {loading ? "Signing in…" : "Sign in →"}
        </button>
      </form>

      <p style={{ marginTop: 24, fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
        No account?{" "}
        <Link href="/signup" style={{ color: "var(--accent)" }}>Create one</Link>
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
