"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/experiments", label: "Experiments" },
  { href: "/leaderboard", label: "Leaderboard", disabled: true },
  { href: "/docs",        label: "Docs",        disabled: true },
  { href: "/pricing",     label: "Pricing",     disabled: true },
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
          {onLanding ? (
            <>
              <span className="mono faint" style={{ fontSize: 12 }}>github · 1.2k ★</span>
              <button className="btn btn-sm">Sign in</button>
              <Link href="/experiments" className="btn btn-primary btn-sm">
                Open app →
              </Link>
            </>
          ) : (
            <span className="mono faint" style={{ fontSize: 11.5 }}>workspace · autoaw</span>
          )}
        </div>
      </div>
    </nav>
  );
}
