"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Hub } from "aws-amplify/utils";
import { useAuth } from "@/contexts/auth-context";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { signIn, signInWithGoogle } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") ?? "/experiments";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Navigate to app after Google OAuth redirect completes
  useEffect(() => {
    const unsub = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signInWithRedirect") {
        router.replace(from);
      }
      if (payload.event === "signInWithRedirect_failure") {
        setError("Google sign-in failed. Please try again.");
        setGoogleLoading(false);
      }
    });
    return unsub;
  }, [router, from]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { needsConfirmation } = await signIn(email, password);
      if (!needsConfirmation) {
        router.replace(from);
      }
    } catch (err: any) {
      setError(err.message ?? "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      // page will navigate via Hub listener above
    } catch (err: any) {
      setError(err.message ?? "Google sign-in failed");
      setGoogleLoading(false);
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

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Google OAuth */}
        <button
          onClick={handleGoogle}
          disabled={googleLoading || loading}
          className="btn btn-lg"
          style={{ justifyContent: "center", gap: 10, opacity: googleLoading ? 0.7 : 1 }}
        >
          <GoogleIcon />
          {googleLoading ? "Redirecting…" : "Continue with Google"}
        </button>

        <Divider />

        {/* Email + password */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Email" name="email" type="email" placeholder="you@company.com"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Field label="Password" name="password" type="password" placeholder="••••••••"
            value={password} onChange={(e) => setPassword(e.target.value)} required />

          {error && <p style={{ fontSize: 13, color: "var(--err)", margin: 0 }}>{error}</p>}

          <button type="submit" disabled={loading || googleLoading} className="btn btn-primary btn-lg"
            style={{ opacity: loading ? 0.7 : 1, justifyContent: "center" }}>
            {loading ? "Signing in…" : "Sign in →"}
          </button>
        </form>
      </div>

      <p style={{ marginTop: 24, fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
        Need access?{" "}
        <Link href="/demo" style={{ color: "var(--accent)" }}>Request an invite</Link>
      </p>
    </div>
  );
}

function Divider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "4px 0" }}>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      <span className="mono faint" style={{ fontSize: 11 }}>or</span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.77c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
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
