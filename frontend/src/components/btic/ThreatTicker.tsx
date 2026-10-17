import { useRef, memo, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Pill } from "../ui/Pill";
import { useBticStore } from "../../stores/bticStore";
import type { TickerMessage } from "../../types/btic";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#B3261E",
  HIGH: "#B7791F",
  MEDIUM: "#B8920F",
  LOW: "#3D8B5A",
  INFO: "#2C7A91",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Derive a TickerMessage from a ThreatEvent
function threatToTicker(e: {
  id: string;
  timestamp: string;
  type: string;
  severity: string;
  location: { city: string; state: string };
  customerHash: string;
  sessionId: string;
  details: string;
}): TickerMessage {
  return {
    id: e.id,
    timestamp: e.timestamp,
    severity: e.severity as TickerMessage["severity"],
    type: e.type as TickerMessage["type"],
    location: `${e.location.city}, ${e.location.state}`,
    detail: e.details,
    customerHash: e.customerHash,
    sessionId: e.sessionId,
  };
}

const TickerItem = memo(function TickerItem({
  event,
}: {
  event: TickerMessage;
}) {
  const navigate = useNavigate();
  const onClick = useCallback(() => {
    navigate("/admin/investigate", {
      state: { sessionId: event.sessionId, customerHash: event.customerHash },
    });
  }, [navigate, event.sessionId, event.customerHash]);

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        flexShrink: 0,
        opacity: 0.85,
        transition: "opacity 0.2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.85")}
    >
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11.5,
          color: "#767270",
        }}
      >
        {formatTime(event.timestamp)}
      </span>
      <Pill
        text={event.severity}
        color={SEVERITY_COLORS[event.severity] || "#706C69"}
      />
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11.5,
          color: "#575452",
        }}
      >
        {event.type.replace(/_/g, " ")}
      </span>
      <span style={{ fontSize: 12.5, color: "#767270" }}>
        {event.location}
      </span>
      <span
        style={{
          fontSize: 12.5,
          color: "#969290",
          maxWidth: 300,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {event.detail}
      </span>
    </div>
  );
});

export const ThreatTicker = memo(function ThreatTicker() {
  const feedEvents = useBticStore((s) => s.feedEvents);
  const liveEvents = useBticStore((s) => s.liveEvents);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Derive ticker messages from the unified feed
  const tickerMessages = useMemo(() => {
    // Use feedEvents if available, fall back to liveEvents
    if (feedEvents.length > 0) {
      return feedEvents.slice(0, 30).map(threatToTicker);
    }
    return liveEvents;
  }, [feedEvents, liveEvents]);

  // Duplicate for seamless scrolling
  const displayEvents = useMemo(
    () => [...tickerMessages, ...tickerMessages],
    [tickerMessages],
  );

  return (
    <div
      style={{
        position: "relative",
        zIndex: 50,
        overflow: "hidden",
        background: "rgba(255, 255, 255,0.3)",
        borderBottom: "1px solid #EAE4E1",
        height: 32,
      }}
    >
      {/* Fade edges */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 40,
          background:
            "linear-gradient(to right, rgba(255, 255, 255,0.8), transparent)",
          zIndex: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 40,
          background:
            "linear-gradient(to left, rgba(255, 255, 255,0.8), transparent)",
          zIndex: 2,
        }}
      />

      {/* Scrolling content */}
      <div
        ref={scrollRef}
        style={{
          display: "flex",
          alignItems: "center",
          height: "100%",
          animation: "tickerScroll 60s linear infinite",
          whiteSpace: "nowrap",
          gap: 32,
          paddingLeft: 40,
        }}
      >
        {displayEvents.map((event, i) => (
          <TickerItem
            key={`${event.id}-${i}`}
            event={event}
          />
        ))}
      </div>

      <style>{`
        @keyframes tickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
});
