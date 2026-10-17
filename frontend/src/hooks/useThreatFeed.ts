import { useEffect, useRef, useCallback } from "react";
import { generateThreatEvent } from "../data/mockThreats";
import { useBticStore } from "../stores/bticStore";
import type { ThreatEvent, ThreatSeverity, ThreatType } from "../types/btic";
import { getAdminToken } from "../admin/adminAuth";
import { API_BASE } from "../lib/auth";

// ── SSE event shape from backend ───────────────────────────────────────────
interface SSEPayload {
  type: string;
  session_id: string;
  customer_hash: string;
  decision: string;
  risk_score: number;
  channel: string;
  pathway: string;
  timestamp: string;
  location?: { state: string; city: string };
}

// ── Map backend severity → ThreatSeverity ──────────────────────────────────
function riskToSeverity(score: number): ThreatSeverity {
  if (score >= 700) return "CRITICAL";
  if (score >= 500) return "HIGH";
  if (score >= 300) return "MEDIUM";
  return "LOW";
}

function riskToType(score: number, pathway?: string): ThreatType {
  if (pathway === "telecom") return "SIM_SWAP";
  if (pathway === "imei") return "CREDENTIAL_THEFT";
  if (score >= 700) return "SIM_SWAP";
  if (score >= 500) return "COERCION";
  return "BEHAVIORAL_ANOMALY";
}

function riskToDecision(
  severity: ThreatSeverity,
): "APPROVE" | "STEP_UP" | "HARD_BLOCK" {
  if (severity === "CRITICAL") return "HARD_BLOCK";
  if (severity === "HIGH") return "STEP_UP";
  return "APPROVE";
}

// ── Convert SSE payload to ThreatEvent ─────────────────────────────────────
function sseToThreatEvent(data: SSEPayload): ThreatEvent {
  const severity = riskToSeverity(data.risk_score);
  return {
    id: `sse-${data.session_id}-${Date.now()}`,
    timestamp: data.timestamp || new Date().toISOString(),
    type: riskToType(data.risk_score, data.pathway),
    severity,
    confidence: Math.min(1, data.risk_score / 1000),
    location: {
      state: data.location?.state || "Unknown",
      stateCode: "",
      city: data.location?.city || "Unknown",
      lat: 22.5 + (Math.random() - 0.5) * 10,
      lng: 78.9 + (Math.random() - 0.5) * 15,
    },
    customerHash: data.customer_hash || "unknown",
    sessionId: data.session_id || "unknown",
    riskScore: data.risk_score,
    decision: riskToDecision(severity),
    details: `${data.type} via ${data.pathway || "unknown"} on ${data.channel || "unknown"}`,
    channel: data.channel || "unknown",
    pathway: data.pathway || "unknown",
  };
}

// ── SSE connection with auto-reconnect ─────────────────────────────────────
function createSSEConnection(
  url: string,
  token: string,
  onEvent: (data: SSEPayload) => void,
  onStatus: (status: "connecting" | "connected" | "disconnected") => void,
): EventSource {
  const separator = url.includes("?") ? "&" : "?";
  const es = new EventSource(`${url}${separator}token=${encodeURIComponent(token)}`);

  es.onopen = () => onStatus("connected");

  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as SSEPayload;
      onEvent(data);
    } catch {
      // malformed event — ignore
    }
  };

  es.onerror = () => {
    onStatus("disconnected");
    es.close();
    // Auto-reconnect after 5s with backoff
    setTimeout(() => {
      createSSEConnection(url, token, onEvent, onStatus);
    }, 5000);
  };

  return es;
}

// ── Hook: useThreatFeed ────────────────────────────────────────────────────
interface UseThreatFeedOptions {
  /** Mock event interval in ms (default 4000) */
  mockIntervalMs?: number;
  /** Enable real-time generation (default true) */
  enabled?: boolean;
}

export function useThreatFeed(options: UseThreatFeedOptions = {}) {
  const { mockIntervalMs = 4000, enabled = true } = options;

  const addFeedEvent = useBticStore((s) => s.addFeedEvent);
  const addRecentThreat = useBticStore((s) => s.addRecentThreat);
  const feedPaused = useBticStore((s) => s.feedPaused);
  const setConnectionStatus = useBticStore((s) => s.setFeedConnectionStatus);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // ── Mock event generator ───────────────────────────────────────────────
  const generateMockEvent = useCallback(() => {
    const threat = generateThreatEvent();
    addFeedEvent(threat);
    addRecentThreat(threat);
  }, [addFeedEvent, addRecentThreat]);

  // ── SSE event handler ──────────────────────────────────────────────────
  const handleSSEEvent = useCallback(
    (data: SSEPayload) => {
      const threat = sseToThreatEvent(data);
      addFeedEvent(threat);
      addRecentThreat(threat);
    },
    [addFeedEvent, addRecentThreat],
  );

  useEffect(() => {
    if (!enabled || feedPaused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Try SSE first, fall back to mock
    const token = getAdminToken() || "";
    const baseApiUrl = API_BASE;

    if (baseApiUrl && token) {
      setConnectionStatus("connecting");
      const es = createSSEConnection(
        `${baseApiUrl}/api/btic/events/stream`,
        token,
        handleSSEEvent,
        (status) => {
          setConnectionStatus(status);
          // If SSE fails, start mock
          if (status === "disconnected") {
            startMock();
          }
        },
      );
      esRef.current = es;
      return () => {
        es.close();
        esRef.current = null;
      };
    }

    // No backend — start mock
    startMock();

    function startMock() {
      setConnectionStatus("mock");
      // Initial burst
      for (let i = 0; i < 3; i++) {
        setTimeout(() => generateMockEvent(), i * 200);
      }
      // Ongoing stream
      intervalRef.current = setInterval(generateMockEvent, mockIntervalMs);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [
    enabled,
    feedPaused,
    mockIntervalMs,
    generateMockEvent,
    handleSSEEvent,
    setConnectionStatus,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (esRef.current) esRef.current.close();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
