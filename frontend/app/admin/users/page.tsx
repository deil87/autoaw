"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";

const ADMIN_EMAIL = "spirtik87@gmail.com";
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface DemoRequest {
  id: string;
  name: string;
  email: string;
  company: string;
  message: string;
  status: string;
  created_at: string;
}

export default function AdminUsersPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [requests, setRequests] = useState<DemoRequest[]>([]);
  const [fetchError, setFetchError] = useState("");
  const [inviting, setInviting] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  const isAdmin = user?.email === ADMIN_EMAIL;

  useEffect(() => {
    if (!loading && !isAdmin) {
      router.replace("/login");
    }
  }, [loading, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin || !user) return;
    fetch(`${API_BASE}/admin/requests`, {
      headers: { Authorization: `Bearer ${user.idToken}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then(setRequests)
      .catch((e) => setFetchError(e.message));
  }, [isAdmin, user]);

  async function handleInvite(req: DemoRequest) {
    if (!user) return;
    setInviting(req.id);
    try {
      const r = await fetch(`${API_BASE}/admin/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.idToken}`,
        },
        body: JSON.stringify({ email: req.email, name: req.name, request_id: req.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? r.statusText);
      setMessages((m) => ({ ...m, [req.id]: "Invite sent" }));
      setRequests((prev) =>
        prev.map((d) => (d.id === req.id ? { ...d, status: "invited" } : d))
      );
    } catch (e: any) {
      setMessages((m) => ({ ...m, [req.id]: e.message ?? "Error" }));
    } finally {
      setInviting(null);
    }
  }

  if (loading || !isAdmin) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <span className="mono faint" style={{ fontSize: 12 }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 0 80px" }}>
      <div style={{ marginBottom: 32 }}>
        <div className="section-eyebrow">Admin</div>
        <h1 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.025em", margin: "10px 0 0", color: "var(--ink)" }}>
          Demo requests
        </h1>
      </div>

      {fetchError && (
        <p style={{ color: "var(--err)", fontSize: 13 }}>Failed to load: {fetchError}</p>
      )}

      {requests.length === 0 && !fetchError && (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>No requests yet.</p>
      )}

      {requests.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Date", "Name", "Email", "Company", "Message", "Status", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "var(--muted)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--mono)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {requests.map((req) => (
              <tr key={req.id} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                <td style={{ padding: "10px 12px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                  {new Date(req.created_at).toLocaleDateString()}
                </td>
                <td style={{ padding: "10px 12px" }}>{req.name}</td>
                <td style={{ padding: "10px 12px" }}>
                  <a href={`mailto:${req.email}`} style={{ color: "var(--accent)" }}>{req.email}</a>
                </td>
                <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{req.company || "—"}</td>
                <td style={{ padding: "10px 12px", maxWidth: 260, color: "var(--muted)" }}>
                  <span title={req.message} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {req.message}
                  </span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{
                    fontSize: 11, fontFamily: "var(--mono)", padding: "2px 7px", borderRadius: 4,
                    background: req.status === "invited" ? "rgba(17,151,96,0.1)" : "rgba(0,0,0,0.05)",
                    color: req.status === "invited" ? "var(--accent)" : "var(--muted)",
                  }}>
                    {req.status}
                  </span>
                </td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                  {messages[req.id] ? (
                    <span style={{ fontSize: 12, color: messages[req.id] === "Invite sent" ? "var(--accent)" : "var(--err)" }}>
                      {messages[req.id]}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleInvite(req)}
                      disabled={inviting === req.id || req.status === "invited"}
                      className="btn"
                      style={{ fontSize: 12, padding: "4px 10px", opacity: req.status === "invited" ? 0.4 : 1 }}
                    >
                      {inviting === req.id ? "Sending…" : "Send invite"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
