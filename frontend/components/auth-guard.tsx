"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";

const PUBLIC_PATHS = ["/", "/demo", "/login", "/signup", "/confirm"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "?"));
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const pub = isPublic(pathname);

  useEffect(() => {
    if (!loading && !user && !pub) {
      router.replace(`/login?from=${encodeURIComponent(pathname)}`);
    }
  }, [user, loading, pub, pathname, router]);

  if (loading && !pub) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <span className="mono faint" style={{ fontSize: 12 }}>Loading…</span>
      </div>
    );
  }

  if (!user && !pub) return null;

  return <>{children}</>;
}
