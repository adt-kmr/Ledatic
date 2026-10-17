import { useEffect, useRef, useCallback, useState } from "react";
import { generateThreatEvent } from "../data/mockThreats";
import { createLiveEventStream, isBackendReachable } from "../lib/bticApi";
import { useBticStore } from "../stores/bticStore";
import type { ThreatEvent } from "../types/btic";

/**
 * Hook that provides real-time threat events for the map.
 * Connects to the SSE endpoint when the backend is available,
 * otherwise falls back to mock data generation.
 */
export function useMapRealTime(options?: {
  intervalMs?: number;
  maxEvents?: number;
  enabled?: boolean;
}) {
  const { intervalMs = 1500, maxEvents = 200, enabled = true } = options || {};
  const addRecentThreat = useBticStore((s) => s.addRecentThreat);
  const addLiveEvent = useBticStore((s) => s.addLiveEvent);
  const [isLive, setIsLive] = useState(true);
  const [eventCount, setEventCount] = useState(0);
  const [connectionType, setConnectionType] = useState<"sse" | "mock" | "none">("none");
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const sseRef = useRef<EventSource | null>(null);

  const addEvent = useCallback(() => {
    const threat = generateThreatEvent();
    addRecentThreat(threat);
    addLiveEvent({
      id: threat.id,
      timestamp: threat.timestamp,
      severity: threat.severity,
      type: threat.type,
      location: `${threat.location.city}, ${threat.location.stateCode}`,
      detail: threat.details,
      sessionId: threat.sessionId,
      customerHash: threat.customerHash,
    });
    setEventCount((c) => c + 1);
  }, [addRecentThreat, addLiveEvent]);

  // Try to connect to SSE, fall back to mock
  useEffect(() => {
    if (!enabled || !isLive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const connect = async () => {
      // Try SSE first
      const reachable = await isBackendReachable();

      if (reachable && !cancelled) {
        const es = createLiveEventStream(
          (data: any) => {
            if (cancelled) return;
            // Convert SSE event to ThreatEvent
            const threat: ThreatEvent = {
              id: data.session_id || crypto.randomUUID(),
              timestamp: data.timestamp || new Date().toISOString(),
              type: data.type || "BEHAVIORAL_ANOMALY",
              severity: data.risk_score > 700 ? "CRITICAL" : data.risk_score > 500 ? "HIGH" : "MEDIUM",
              confidence: 0.7 + Math.random() * 0.3,
              location: {
                state: data.location?.state || "Unknown",
                stateCode: data.location?.stateCode || "XX",
                city: data.location?.city || "Unknown",
                lat: data.location?.lat || 22.5,
                lng: data.location?.lng || 78.9,
              },
              customerHash: data.customer_hash || "",
              sessionId: data.session_id || "",
              riskScore: data.risk_score || 500,
              decision: data.decision || "STEP_UP",
              details: `Session ${data.decision} — risk ${data.risk_score}`,
              channel: data.channel || "web",
              pathway: data.pathway || "behavioral",
            };
            addRecentThreat(threat);
            addLiveEvent({
              id: threat.id,
              timestamp: threat.timestamp,
              severity: threat.severity,
              type: threat.type,
              location: `${threat.location.city}, ${threat.location.stateCode}`,
              detail: threat.details,
              sessionId: threat.sessionId,
              customerHash: threat.customerHash,
            });
            setEventCount((c) => c + 1);
          },
          () => {
            // SSE failed, fall back to mock
            if (!cancelled) {
              setConnectionType("mock");
              startMockEvents();
            }
          },
        );

        if (es && !cancelled) {
          sseRef.current = es;
          setConnectionType("sse");
          return;
        }
      }

      // Fall back to mock events
      if (!cancelled) {
        setConnectionType("mock");
        startMockEvents();
      }
    };

    const startMockEvents = () => {
      // Generate initial burst (more events for demo)
      for (let i = 0; i < 12; i++) {
        setTimeout(() => {
          if (!cancelled) addEvent();
        }, i * 120);
      }

      // Then regular interval
      intervalRef.current = setInterval(() => {
        if (!cancelled) addEvent();
      }, intervalMs);
    };

    connect();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, [enabled, isLive, intervalMs, addEvent, addRecentThreat, addLiveEvent]);

  const toggleLive = useCallback(() => setIsLive((l) => !l), []);

  return { isLive, toggleLive, eventCount, connectionType };
}
