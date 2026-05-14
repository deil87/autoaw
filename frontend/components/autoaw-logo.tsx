"use client";

import { useEffect, useRef } from "react";

// Graph topology: 6 nodes in a DAG representing agent collaboration
// 0 → 1, 2  →  3, 4  →  5
//  (input)  (agents) (merge) (output)
const NODES_NORM = [
  { x: 0.05, y: 0.50 }, // 0 input
  { x: 0.33, y: 0.22 }, // 1 agent A
  { x: 0.33, y: 0.78 }, // 2 agent B
  { x: 0.62, y: 0.22 }, // 3 agent C
  { x: 0.62, y: 0.78 }, // 4 agent D
  { x: 0.90, y: 0.50 }, // 5 output
];

const EDGES_DEF = [
  { from: 0, to: 1 },
  { from: 0, to: 2 },
  { from: 1, to: 3 },
  { from: 2, to: 4 },
  { from: 1, to: 4 },
  { from: 2, to: 3 },
  { from: 3, to: 5 },
  { from: 4, to: 5 },
];

const SIGNAL_SPEED = 0.55; // normalized units per second
const HOLD_AFTER_COMPLETE = 1400; // ms to hold before reset
const FADE_DURATION = 400; // ms

interface AnimNode {
  visible: boolean;
}
interface AnimEdge {
  from: number;
  to: number;
  drawProgress: number; // 0–1 (how far the line is drawn)
  visible: boolean; // fully drawn
}
interface Signal {
  edgeIdx: number;
  t: number; // 0–1
}

function initState(): { nodes: AnimNode[]; edges: AnimEdge[] } {
  return {
    nodes: NODES_NORM.map((_, i) => ({ visible: i === 0 })),
    edges: EDGES_DEF.map((e) => ({ ...e, drawProgress: 0, visible: false })),
  };
}

interface Props {
  /** Canvas width in px */
  width?: number;
  /** Canvas height in px */
  height?: number;
  /** Show "AutoAW" text label beneath the graph */
  showText?: boolean;
  className?: string;
}

export function AutoAWLogo({
  width = 160,
  height = 80,
  showText = false,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // HiDPI
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    const gfx = ctx;

    let raf = 0;
    let lastTime = performance.now();

    // --- mutable animation state ---
    let { nodes, edges } = initState();
    let signals: Signal[] = [];
    let phase: "building" | "holding" | "fading" = "building";
    let holdTimer = 0;
    let globalAlpha = 1;

    // seed first signals from node 0
    function spawnSignalsFrom(nodeIdx: number) {
      edges.forEach((e, i) => {
        if (e.from === nodeIdx && !e.visible && e.drawProgress === 0) {
          signals.push({ edgeIdx: i, t: 0 });
        }
      });
    }
    spawnSignalsFrom(0);

    function reset() {
      ({ nodes, edges } = initState());
      signals = [];
      phase = "building";
      holdTimer = 0;
      globalAlpha = 1;
      spawnSignalsFrom(0);
    }

    // pixel coordinates for a normalized node position
    function px(n: (typeof NODES_NORM)[0]) {
      return { x: n.x * width, y: n.y * height };
    }

    function draw(dt: number) {
      gfx.clearRect(0, 0, width, height);
      gfx.globalAlpha = globalAlpha;

      const NODE_R = Math.max(3, width * 0.032);
      const STROKE = Math.max(1, width * 0.012);

      // --- update signals ---
      if (phase === "building") {
        const arrived: number[] = [];

        signals = signals.filter((sig) => {
          sig.t += SIGNAL_SPEED * (dt / 1000);

          const e = edges[sig.edgeIdx];
          // draw progress of edge tracks the signal
          e.drawProgress = Math.min(1, sig.t);

          if (sig.t >= 1) {
            e.visible = true;
            e.drawProgress = 1;
            arrived.push(e.to);
            return false; // remove signal
          }
          return true;
        });

        // mark arrived nodes visible and spawn outgoing signals
        arrived.forEach((nodeIdx) => {
          if (!nodes[nodeIdx].visible) {
            nodes[nodeIdx].visible = true;
            spawnSignalsFrom(nodeIdx);
          }
        });

        // check completion
        if (signals.length === 0 && nodes.every((n) => n.visible)) {
          phase = "holding";
          holdTimer = 0;
        }
      } else if (phase === "holding") {
        holdTimer += dt;
        if (holdTimer >= HOLD_AFTER_COMPLETE) {
          phase = "fading";
        }
      } else if (phase === "fading") {
        globalAlpha -= dt / FADE_DURATION;
        if (globalAlpha <= 0) {
          globalAlpha = 0;
          reset();
        }
      }

      // --- draw fully visible edges ---
      gfx.strokeStyle = "#000";
      gfx.lineWidth = STROKE;
      edges.forEach((e) => {
        if (e.drawProgress <= 0) return;
        const from = px(NODES_NORM[e.from]);
        const to = px(NODES_NORM[e.to]);
        const lx = from.x + (to.x - from.x) * e.drawProgress;
        const ly = from.y + (to.y - from.y) * e.drawProgress;

        gfx.beginPath();
        gfx.moveTo(from.x, from.y);
        gfx.lineTo(lx, ly);
        gfx.stroke();

        // arrowhead only when fully drawn
        if (e.visible) {
          drawArrow(gfx, from.x, from.y, to.x, to.y, NODE_R, STROKE);
        }
      });

      // --- draw signal dots ---
      signals.forEach((sig) => {
        const e = edges[sig.edgeIdx];
        const from = px(NODES_NORM[e.from]);
        const to = px(NODES_NORM[e.to]);
        const x = from.x + (to.x - from.x) * sig.t;
        const y = from.y + (to.y - from.y) * sig.t;
        const r = NODE_R * 0.38;

        // glow ring
        gfx.beginPath();
        gfx.arc(x, y, r * 1.8, 0, Math.PI * 2);
        gfx.fillStyle = "rgba(0,0,0,0.12)";
        gfx.fill();

        // dot
        gfx.beginPath();
        gfx.arc(x, y, r, 0, Math.PI * 2);
        gfx.fillStyle = "#000";
        gfx.fill();
      });

      // --- draw nodes ---
      NODES_NORM.forEach((np, i) => {
        const { x, y } = px(np);
        if (!nodes[i].visible) return;

        const isInput = i === 0;
        const isOutput = i === NODES_NORM.length - 1;

        gfx.beginPath();
        gfx.arc(x, y, NODE_R, 0, Math.PI * 2);

        if (isInput || isOutput) {
          gfx.fillStyle = "#000";
          gfx.fill();
        } else {
          gfx.fillStyle = "#fff";
          gfx.fill();
          gfx.strokeStyle = "#000";
          gfx.lineWidth = STROKE;
          gfx.stroke();
        }
      });

      gfx.globalAlpha = 1;
    }

    function loop(now: number) {
      const dt = Math.min(now - lastTime, 100); // cap at 100ms
      lastTime = now;
      draw(dt);
      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame((now) => {
      lastTime = now;
      loop(now);
    });

    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <canvas
        ref={canvasRef}
        style={{ width, height, display: "block" }}
      />
      {showText && (
        <span
          style={{
            fontWeight: 600,
            fontSize: height * 0.28,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: "#000",
          }}
        >
          AutoAW
        </span>
      )}
    </span>
  );
}

// Draws a filled arrowhead at the `to` end of a line, offset by nodeRadius
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  nodeRadius: number,
  strokeWidth: number
) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const tipX = x2 - Math.cos(angle) * nodeRadius;
  const tipY = y2 - Math.sin(angle) * nodeRadius;
  const arrowLen = strokeWidth * 3.5;
  const arrowAngle = 0.45;

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - arrowLen * Math.cos(angle - arrowAngle),
    tipY - arrowLen * Math.sin(angle - arrowAngle)
  );
  ctx.lineTo(
    tipX - arrowLen * Math.cos(angle + arrowAngle),
    tipY - arrowLen * Math.sin(angle + arrowAngle)
  );
  ctx.closePath();
  ctx.fillStyle = "#000";
  ctx.fill();
}
