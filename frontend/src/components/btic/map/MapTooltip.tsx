import React from "react";
import type { MapHexCell } from "../../../types/btic";

interface MapTooltipProps {
  x: number;
  y: number;
  cell: MapHexCell;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#B3261E",
  HIGH: "#B7791F",
  MEDIUM: "#B8920F",
  LOW: "#3D8B5A",
  INFO: "#2C7A91",
};

export const MapTooltip = React.memo(function MapTooltip({
  x,
  y,
  cell,
}: MapTooltipProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: Math.min(x + 14, window.innerWidth - 310),
        top: y - 14,
        background: "rgba(244, 244, 244,0.92)",
        backdropFilter: "blur(16px) saturate(180%)",
        border: "1px solid #D7D2D0",
        borderRadius: 10,
        padding: "12px 16px",
        minWidth: 210,
        maxWidth: 290,
        pointerEvents: "none",
        zIndex: 100,
        boxShadow: "0 18px 40px -24px rgba(16,15,15,0.22)",
      }}
    >
      <div
        style={{
          fontFamily: "'Newsreader', Georgia, serif",
          fontSize: 20,
          fontWeight: 400,
          color: "#100F0F",
          marginBottom: 8,
          letterSpacing: "-0.01em",
        }}
      >
        {cell.city}, {cell.state}
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
          label="Threats"
          value={String(cell.threatCount)}
        />
        <TooltipRow
          label="Severity"
          value={cell.severity}
          color={SEVERITY_COLORS[cell.severity]}
        />
        <TooltipRow
          label="Confidence"
          value={`${(cell.confidence * 100).toFixed(0)}%`}
        />
        <div
          style={{
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            marginTop: 4,
          }}
        >
          {cell.threatTypes.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 11,
                padding: "2px 7px",
                borderRadius: 4,
                background: "rgba(16, 15, 15,0.06)",
                color: "#767270",
                border: "1px solid #EAE4E1",
              }}
            >
              {t.replace(/_/g, " ")}
            </span>
          ))}
        </div>
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
