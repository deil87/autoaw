"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/experiments", label: "Experiments" },
  { href: "/leaderboard", label: "Leaderboard", disabled: true },
  { href: "/docs",        label: "Docs",        disabled: true },
  { href: "/#pricing",    label: "Pricing" },
  { href: "/admin",       label: "GP Operators" },
];

function Logo({ size = 22 }: { size?: number }) {
  const nodes = [
    { x: 6, y: 13, r: 2.2 },
    { x: 13, y: 6, r: 2.2 },
    { x: 13, y: 20, r: 2.2 },
    { x: 20, y: 13, r: 2.2 },
  ];
  const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [1, 2]];
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none">
      {edges.map(([a, b], i) => (
        <line key={i}
          x1={nodes[a].x} y1={nodes[a].y}
          x2={nodes[b].x} y2={nodes[b].y}
          stroke="var(--ink)" strokeWidth="1.1" />
      ))}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={n.r} fill="var(--ink)" />
      ))}
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const onLanding = pathname === "/";

  return (
    <nav className="aw-nav">
      <div className="aw-nav-inner">
        <Link href="/" className="aw-brand">
          <Logo size={22} />
          <span className="aw-brand-name">AutoAW</span>
          <span className="aw-brand-version mono">v0.4</span>
        </Link>
        <div className="aw-nav-links">
          {links.map((link) => (
            link.disabled ? (
              <span
                key={link.href}
                className="aw-nav-link"
                style={{ color: "var(--faint)", cursor: "default" }}
              >
                {link.label}
                <span className="mono" style={{ fontSize: 10, marginLeft: 5, opacity: 0.7 }}>soon</span>
              </span>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className={`aw-nav-link${pathname.startsWith(link.href) ? " active" : ""}`}
              >
                {link.label}
              </Link>
            )
          ))}
        </div>
        <div className="aw-nav-right">
          <a href="https://github.com/deil87/autoaw" target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", color: "var(--muted)", lineHeight: 0 }}
            aria-label="GitHub">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.461-1.11-1.461-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
            </svg>
          </a>
          {mounted && (onLanding ? (
            <>
              <a href="mailto:spirtik87@gmail.com?subject=AutoAW%20demo%20%26%20quotation" className="btn btn-sm">
                Request demo
              </a>
              <Link href="/experiments" className="btn btn-primary btn-sm">
                Open app →
              </Link>
            </>
          ) : (
            <span className="mono faint" style={{ fontSize: 11.5 }}>workspace · autoaw</span>
          ))}
        </div>
      </div>
    </nav>
  );
}
