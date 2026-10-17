import React from "react";
import type { ThreatEvent } from "../../../types/btic";

interface FeedTooltipProps {
  x: number;
  y: number;
  event: ThreatEvent;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#B3261E",
  HIGH: "#B7791F",
  MEDIUM: "#B8920F",
  LOW: "#3D8B5A",
  INFO: "#2C7A91",
};

const TYPE_LABELS: Record<string, string> = {
  SIM_SWAP: "SIM Swap",
  CREDENTIAL_THEFT: "Credential Theft",
  COERCION: "Coercion",
  MONEY_MULE: "Money Mule",
  BEHAVIORAL_ANOMALY: "Behavior Drift",
  MERCHANT_ABUSE: "Merchant Abuse",
  IDENTITY_MISMATCH: "Identity Mismatch",
};

export const FeedTooltip = React.memo(function FeedTooltip({
  x,
  y,
  event,
}: FeedTooltipProps) {
  const time = formatTimeAgo(event.timestamp);

  return (
    <div
      style={{
        position: "absolute",
        left: Math.min(x + 14, window.innerWidth - 340),
        top: y - 14,
        background: "rgba(244, 244, 244,0.95)",
        backdropFilter: "blur(16px) saturate(180%)",
        border: "1px solid #D7D2D0",
        borderRadius: 10,
        padding: "12px 16px",
        minWidth: 240,
        maxWidth: 320,
        pointerEvents: "none",
        zIndex: 100,
        boxShadow: "0 18px 40px -24px rgba(16,15,15,0.22)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: SEVERITY_COLORS[event.severity],
            boxShadow: `0 0 6px ${SEVERITY_COLORS[event.severity]}80`,
          }}
        />
        <div
          style={{
            fontFamily: "'Newsreader', Georgia, serif",
            fontSize: 20,
            fontWeight: 400,
            color: "#100F0F",
            letterSpacing: "-0.01em",
          }}
        >
          {TYPE_LABELS[event.type] || event.type}
        </div>
        <span
          style={{
            fontSize: 11,
            padding: "1px 6px",
            borderRadius: 4,
            background: `${SEVERITY_COLORS[event.severity]}20`,
            color: SEVERITY_COLORS[event.severity],
            fontWeight: 600,
            fontFamily: "'DM Mono', monospace",
          }}
        >
          {event.severity}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          fontSize: 12.5,
          fontFamily: "'DM Mono', monospace",
        }}
      >
        <TooltipRow
          label="Location"
          value={`${event.location.city}, ${event.location.state}`}
        />
        <TooltipRow
          label="Risk Score"
          value={String(Math.round(event.riskScore))}
          color={SEVERITY_COLORS[event.severity]}
        />
        <TooltipRow
          label="Confidence"
          value={`${(event.confidence * 100).toFixed(0)}%`}
        />
        <TooltipRow
          label="Decision"
          value={event.decision.replace(/_/g, " ")}
          color={
            event.decision === "HARD_BLOCK"
              ? "#B3261E"
              : event.decision === "STEP_UP"
                ? "#B7791F"
                : "#3D8B5A"
          }
        />
        <TooltipRow label="Channel" value={event.channel} />
        <TooltipRow label="Time" value={time} />
      </div>

      <div
        style={{
          marginTop: 8,
          padding: "6px 8px",
          borderRadius: 6,
          background: "#FFFFFF",
          border: "1px solid #EAE4E1",
          fontSize: 11.5,
          color: "#767270",
          lineHeight: 1.4,
        }}
      >
        {event.details}
      </div>
    </div>
  );
});

function TooltipRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "#767270" }}>{label}</span>
      <span
        style={{
          color: color || "rgba(20, 19, 19,0.85)",
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
