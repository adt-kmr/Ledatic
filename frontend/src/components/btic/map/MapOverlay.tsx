import React from "react";
import { Globe, Map, Maximize2, RotateCcw } from "lucide-react";
import { useBticStore } from "../../../stores/bticStore";
import type { ThreatEvent } from "../../../types/btic";

interface MapOverlayProps {
  isLive: boolean;
  onToggleLive: () => void;
  onFitBounds: () => void;
  connectionType: string;
  eventCount: number;
  visibleCells: number;
  connectionCount: number;
  recentThreats: ThreatEvent[];
}

export const MapOverlay = React.memo(function MapOverlay({
  isLive,
  onToggleLive,
  onFitBounds,
  connectionType,
  eventCount,
  visibleCells,
  connectionCount,
  recentThreats,
}: MapOverlayProps) {
  const criticalCount = recentThreats.filter(
    (t) => t.severity === "CRITICAL",
  ).length;
  const highCount = recentThreats.filter(
    (t) => t.severity === "HIGH",
  ).length;

  const lastEvent =
    recentThreats.length > 0 ? new Date(recentThreats[0].timestamp) : null;
  const agoSec = lastEvent
    ? Math.floor((Date.now() - lastEvent.getTime()) / 1000)
    : null;
  const agoText =
    agoSec === null
      ? "—"
      : agoSec < 5
        ? "just now"
        : agoSec < 60
          ? `${agoSec}s ago`
          : `${Math.floor(agoSec / 60)}m ago`;

  return (
    <>
      {/* Stats bar — top right */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 56,
          background: "rgba(255, 255, 255,0.95)",
          backdropFilter: "blur(12px)",
          borderRadius: 10,
          padding: "10px 16px",
          zIndex: 50,
          display: "flex",
          gap: 18,
          alignItems: "center",
          border: "1px solid #EAE4E1",
        }}
      >
        <OverlayStat label="Events" value={String(eventCount)} />
        <Divider />
        <OverlayStat
          label="Critical"
          value={String(criticalCount)}
          color="#B3261E"
        />
        <Divider />
        <OverlayStat
          label="High"
          value={String(highCount)}
          color="#B7791F"
        />
        <Divider />
        <OverlayStat label="Cells" value={String(visibleCells)} />
        <Divider />
        <OverlayStat label="Links" value={String(connectionCount)} color="#2C7A91" />
        <Divider />
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#3D8B5A",
              boxShadow: "none",
            }}
          />
          <span
            style={{
              fontSize: 11.5,
              color: "#767270",
              fontFamily: "'DM Mono', monospace",
            }}
          >
            {agoText}
          </span>
        </div>
      </div>

      {/* Bottom-right button cluster */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          zIndex: 50,
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("btic:resetView"))}
          title="Reset view to default (⌥R)"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid #D7D2D0",
            background: "rgba(255, 255, 255,0.95)",
            backdropFilter: "blur(8px)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.2s",
          }}
        >
          <RotateCcw size={13} color="#767270" />
        </button>
        <button
          onClick={onFitBounds}
          title="Zoom to fit all threats (⌥F)"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid #D7D2D0",
            background: "rgba(255, 255, 255,0.95)",
            backdropFilter: "blur(8px)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.2s",
          }}
        >
          <Maximize2 size={13} color="#767270" />
        </button>
        <GlobeToggle />
      </div>

      {/* Live toggle — bottom right */}
      <button
        onClick={onToggleLive}
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 8,
          border: `1px solid ${isLive ? "rgba(61, 139, 90,0.3)" : "rgba(16, 15, 15,0.1)"}`,
          background: isLive ? "rgba(61, 139, 90,0.1)" : "rgba(255, 255, 255,0.95)",
          backdropFilter: "blur(8px)",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: isLive ? "#3D8B5A" : "#706C69",
            boxShadow: "none",
          }}
        />
        <span
          style={{
            fontSize: 11.5,
            color: isLive ? "#3D8B5A" : "#767270",
            fontFamily: "'DM Mono', monospace",
            fontWeight: 600,
            letterSpacing: "0.05em",
          }}
        >
          {isLive ? "LIVE" : "PAUSED"}
        </span>
        <span
          style={{
            fontSize: 10,
            color:
              connectionType === "sse"
                ? "#3D8B5A"
                : "rgba(20, 19, 19,0.25)",
            fontFamily: "'DM Mono', monospace",
            letterSpacing: "0.05em",
          }}
        >
          {connectionType === "sse" ? "SSE" : "MOCK"}
        </span>
      </button>

      {/* Title — bottom right above live toggle */}
      <div
        style={{
          position: "absolute",
          bottom: 50,
          right: 16,
          textAlign: "right",
          zIndex: 50,
        }}
      >
        <div
          style={{
            fontFamily: "'Newsreader', Georgia, serif",
            fontSize: 20,
            fontWeight: 400,
            color: "#575452",
            letterSpacing: "-0.02em",
          }}
        >
          India Threat Intelligence
        </div>
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11.5,
            color: "#969290",
          }}
        >
          {visibleCells} cells · {connectionCount} connections · {eventCount} events
        </div>
      </div>
    </>
  );
});

function OverlayStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontFamily: "'Newsreader', Georgia, serif",
          fontSize: 20,
          fontWeight: 400,
          color: color || "#100F0F",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          color: "#969290",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        height: 20,
        background: "rgba(16, 15, 15,0.08)",
      }}
    />
  );
}

function GlobeToggle() {
  const globeView = useBticStore((s) => s.globeView);
  const toggleGlobeView = useBticStore((s) => s.toggleGlobeView);

  return (
    <button
      onClick={toggleGlobeView}
      title={globeView ? "Switch to flat map (⌥G)" : "Switch to globe (⌥G)"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "6px 10px",
        height: 32,
        borderRadius: 8,
        border: `1px solid ${globeView ? "rgba(44, 122, 145,0.3)" : "rgba(16, 15, 15,0.1)"}`,
        background: globeView ? "rgba(44, 122, 145,0.1)" : "rgba(255, 255, 255,0.95)",
        backdropFilter: "blur(8px)",
        cursor: "pointer",
        transition: "all 0.2s",
      }}
    >
      {globeView ? <Globe size={12} color="#2C7A91" /> : <Map size={12} color="#767270" />}
      <span
        style={{
          fontSize: 11.5,
          color: globeView ? "#2C7A91" : "#767270",
          fontFamily: "'DM Mono', monospace",
          fontWeight: 600,
          letterSpacing: "0.05em",
        }}
      >
        {globeView ? "GLOBE" : "MAP"}
      </span>
    </button>
  );
}
