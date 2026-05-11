"use client";
import { useEffect, useRef, useCallback } from "react";

export interface TrialEvent {
  type: "trial_complete";
  experiment_id: string;
  generation: number;
  gene_id: string;
  fitness: number;
  quality: number;
  cost_usd: number;
  latency_ms: number;
}

type LiveEvent = TrialEvent;

/**
 * Hook that connects to a WebSocket for live experiment updates.
 * No-ops if NEXT_PUBLIC_WS_URL is not set (local dev without WS support).
 */
export function useExperimentSocket(
  experimentId: string | null,
  onEvent: (event: LiveEvent) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (!experimentId) return;
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) return; // No-op if WS URL not configured

    const ws = new WebSocket(`${wsUrl}?experiment_id=${experimentId}`);
    wsRef.current = ws;

    ws.onmessage = (msg) => {
      try {
        const event: LiveEvent = JSON.parse(msg.data);
        onEventRef.current(event);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setTimeout(() => {
        if (wsRef.current === ws) connect();
      }, 3000);
    };
  }, [experimentId]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.close();
      }
    };
  }, [connect]);
}
