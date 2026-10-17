import { useState, useEffect, useRef } from "react";
import { usePerformanceMonitor } from "../../hooks/usePerformanceMonitor";

/**
 * Performance overlay that shows FPS, memory usage, and render metrics.
 * Toggle with Ctrl+Shift+P.
 * Only visible in development mode.
 */
export function PerfOverlay() {
  const [visible, setVisible] = useState(false);
  const metrics = usePerformanceMonitor(visible);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!visible) return null;

  const fpsColor =
    metrics.fps >= 55 ? "#3D8B5A" : metrics.fps >= 30 ? "#B7791F" : "#B3261E";

  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        right: 12,
        zIndex: 9999,
        background: "rgba(255, 255, 255,0.9)",
        backdropFilter: "blur(12px)",
        border: "1px solid #D7D2D0",
        borderRadius: 8,
        padding: "8px 12px",
        fontFamily: "'DM Mono', monospace",
        fontSize: 11.5,
        color: "#575452",
        minWidth: 140,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: fpsColor,
          }}
        />
        <span style={{ fontWeight: 600 }}>PERF</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: "#969290",
          }}
        >
          Ctrl+Shift+P
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Row label="FPS" value={String(metrics.fps)} color={fpsColor} />
        <Row
          label="MEM"
          value={metrics.memoryUsage ? `${metrics.memoryUsage}MB` : "—"}
        />
        <Row label="THR" value={String(document.querySelectorAll("[data-reactroot]").length || 1)} />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "#767270" }}>{label}</span>
      <span style={{ color: color || "rgba(20, 19, 19,0.85)" }}>{value}</span>
    </div>
  );
}
