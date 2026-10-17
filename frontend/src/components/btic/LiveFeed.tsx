import { memo, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useBticStore } from "../../stores/bticStore";
import { Pill } from "../ui/Pill";
import type { ThreatEvent } from "../../types/btic";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#B3261E",
  HIGH: "#B7791F",
  MEDIUM: "#B8920F",
  LOW: "#3D8B5A",
  INFO: "#2C7A91",
};

const DECISION_COLORS: Record<string, string> = {
  HARD_BLOCK: "#B3261E",
  STEP_UP: "#B7791F",
  APPROVE: "#3D8B5A",
};

const FeedItem = memo(function FeedItem({
  threat,
}: {
  threat: ThreatEvent;
}) {
  const navigate = useNavigate();
  const onClick = useCallback(() => {
    navigate("/admin/investigate", {
      state: {
        sessionId: threat.sessionId,
        customerHash: threat.customerHash,
      },
    });
  }, [navigate, threat.sessionId, threat.customerHash]);
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      onClick={onClick}
      className="magnetic-hover"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 8,
        background: "#FFFFFF",
        cursor: "pointer",
        transition: "background 0.2s",
      }}
    >
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11.5,
          color: "#969290",
          flexShrink: 0,
        }}
      >
        {formatTime(threat.timestamp)}
      </span>
      <Pill
        text={threat.severity}
        color={SEVERITY_COLORS[threat.severity] || "#706C69"}
      />
      <span
        style={{
          fontSize: 12.5,
          color: "#575452",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {threat.type.replace(/_/g, " ")}
      </span>
      <Pill
        text={threat.decision}
        color={DECISION_COLORS[threat.decision] || "rgba(20, 19, 19,0.4)"}
      />
    </div>
  );
});

export const LiveFeed = memo(function LiveFeed() {
  const navigate = useNavigate();
  const recentThreats = useBticStore((s) => s.recentThreats);

  const displayThreats = useMemo(
    () => recentThreats.slice(0, 20),
    [recentThreats],
  );

  return (
    <div
      className="glass-card"
      style={{
        padding: "16px 20px",
        maxHeight: 360,
        overflowY: "auto",
      }}
    >
      <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 12 }}>
          Live feed
        </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {displayThreats.map((threat) => (
          <FeedItem
            key={threat.id}
            threat={threat}
          />
        ))}
        {displayThreats.length === 0 && (
          <div
            style={{
              fontSize: 13.5,
              color: "#969290",
              textAlign: "center",
              padding: 20,
            }}
          >
            Monitoring for threats...
          </div>
        )}
      </div>
    </div>
  );
});
