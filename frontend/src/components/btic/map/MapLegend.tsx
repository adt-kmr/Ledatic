import { memo } from "react";

const SEVERITY_LEVELS = [
  { label: "CRITICAL", color: "#B3261E" },
  { label: "HIGH", color: "#B7791F" },
  { label: "MEDIUM", color: "#B8920F" },
  { label: "LOW", color: "#3D8B5A" },
  { label: "INFO", color: "#2C7A91" },
];

const TowerHeights = memo(function TowerHeights() {
  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: "1px solid #EAE4E1",
      }}
    >
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#767270", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
          Tower Height
        </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
          height: 22,
        }}
      >
        {[4, 8, 12, 16, 22].map((h, i) => (
          <div
            key={i}
            style={{
              width: 8,
              height: h,
              borderRadius: 2,
              background: [
                "rgba(30,144,255,0.7)",
                "rgba(61, 139, 90,0.8)",
                "rgba(184, 146, 15,0.85)",
                "rgba(183, 121, 31,0.9)",
                "rgba(179, 38, 30,0.95)",
              ][i],
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "#969290",
          fontFamily: "'DM Mono', monospace",
          marginTop: 2,
        }}
      >
        <span>Low</span>
        <span>High</span>
      </div>
    </div>
  );
});

export const MapLegend = memo(function MapLegend() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        background: "rgba(255, 255, 255,0.95)",
        backdropFilter: "blur(14px)",
        borderRadius: 10,
        padding: "10px 14px",
        zIndex: 50,
        border: "1px solid #EAE4E1",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#767270", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
          Severity
        </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {SEVERITY_LEVELS.map((level) => (
          <div
            key={level.label}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: level.color,
                boxShadow: "none",
              }}
            />
            <span
              style={{
                fontSize: 11.5,
                color: "#575452",
                fontFamily: "'DM Mono', monospace",
                letterSpacing: "0.05em",
              }}
            >
              {level.label}
            </span>
          </div>
        ))}
      </div>

      <TowerHeights />
    </div>
  );
});
