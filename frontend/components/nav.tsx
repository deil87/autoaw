"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/experiments", label: "Experiments" },
  { href: "/datasets", label: "Datasets" },
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
            <Link
              key={link.href}
              href={link.href}
              className={`aw-nav-link${pathname.startsWith(link.href) ? " active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
