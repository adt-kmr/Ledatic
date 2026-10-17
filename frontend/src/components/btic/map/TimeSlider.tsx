import { useState, useCallback } from "react";
import { useBticStore } from "../../../stores/bticStore";

const TIME_RANGES = [
  { label: "30m", value: 30 * 60 * 1000 },
  { label: "6h", value: 6 * 60 * 60 * 1000 },
  { label: "24h", value: 24 * 60 * 60 * 1000 },
  { label: "7d", value: 7 * 24 * 60 * 60 * 1000 },
  { label: "30d", value: 30 * 24 * 60 * 60 * 1000 },
];

export function TimeSlider() {
  const mapTimeRange = useBticStore((s) => s.mapTimeRange);
  const setMapTimeRange = useBticStore((s) => s.setMapTimeRange);
  const [activeRange, setActiveRange] = useState("24h");
  const [isPlaying, setIsPlaying] = useState(false);

  const handleRangeSelect = useCallback(
    (label: string, ms: number) => {
      setActiveRange(label);
      setMapTimeRange({
        start: new Date(Date.now() - ms),
        end: new Date(),
      });
    },
    [setMapTimeRange],
  );

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(255, 255, 255,0.95)",
        backdropFilter: "blur(12px)",
        borderRadius: 10,
        padding: "8px 14px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        zIndex: 50,
      }}
    >
      {/* Play/Pause */}
      <button
        onClick={() => setIsPlaying(!isPlaying)}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: "1px solid #D7D2D0",
          background: isPlaying ? "rgba(179, 38, 30,0.15)" : "rgba(16, 15, 15,0.05)",
          color: isPlaying ? "#B3261E" : "#575452",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13.5,
          flexShrink: 0,
        }}
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? "⏸" : "▶"}
      </button>

      {/* Time range buttons */}
      <div style={{ display: "flex", gap: 4 }}>
        {TIME_RANGES.map((range) => (
          <button
            key={range.label}
            onClick={() => handleRangeSelect(range.label, range.value)}
            style={{
              padding: "3px 8px",
              borderRadius: 4,
              border: "none",
              background:
                activeRange === range.label
                  ? "rgba(16, 15, 15,0.12)"
                  : "transparent",
              color:
                activeRange === range.label
                  ? "#100F0F"
                  : "rgba(20, 19, 19,0.35)",
              fontSize: 11.5,
              fontFamily: "'DM Mono', monospace",
              fontWeight: activeRange === range.label ? 600 : 400,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {range.label}
          </button>
        ))}
      </div>

      {/* Time display */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11.5,
          color: "#767270",
          fontFamily: "'DM Mono', monospace",
          flexShrink: 0,
        }}
      >
        <span>{formatTime(mapTimeRange.start)}</span>
        <span style={{ color: "#969290" }}>→</span>
        <span>{formatTime(mapTimeRange.end)}</span>
      </div>

      {/* Speed indicator (when playing) */}
      {isPlaying && (
        <div
          style={{
            fontSize: 11,
            color: "#B3261E",
            fontFamily: "'DM Mono', monospace",
            letterSpacing: "0.05em",
          }}
        >
          LIVE
        </div>
      )}
    </div>
  );
}
