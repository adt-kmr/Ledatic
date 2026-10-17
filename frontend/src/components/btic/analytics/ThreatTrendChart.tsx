import { THREAT_DATA } from "./data";

interface ThreatTrendChartProps {
  maxThreats: number;
}

export function ThreatTrendChart({ maxThreats }: ThreatTrendChartProps) {
  return (
    <div className="glass-card" style={{ padding: "20px 22px" }}>
      <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 16 }}>
          Threat volume trend
        </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
          height: 120,
          padding: "0 10px",
        }}
      >
        {THREAT_DATA.map((day) => {
          const total = day.critical + day.high + day.medium + day.low;
          // Full chart body is 120px tall; scale each day's bar in PIXELS so the
          // nested segments render (percentage heights collapse inside a flex
          // column whose own intrinsic height is 0).
          const CHART_H = 120;
          const barPx = maxThreats > 0 ? (total / maxThreats) * CHART_H : 0;
          return (
            <div
              key={day.date}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 4,
                height: "100%",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${barPx}px`,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: `${(day.low / total) * barPx}px`,
                    background: "#3D8B5A",
                    opacity: 0.7,
                  }}
                />
                <div
                  style={{
                    height: `${(day.medium / total) * barPx}px`,
                    background: "#B8920F",
                    opacity: 0.7,
                  }}
                />
                <div
                  style={{
                    height: `${(day.high / total) * barPx}px`,
                    background: "#B7791F",
                    opacity: 0.7,
                  }}
                />
                <div
                  style={{
                    height: `${(day.critical / total) * barPx}px`,
                    background: "#B3261E",
                    opacity: 0.7,
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "#767270",
                  fontFamily: "'DM Mono', monospace",
                }}
              >
                {day.date}
              </span>
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 12,
          justifyContent: "center",
        }}
      >
        {[
          { label: "Critical", color: "#B3261E" },
          { label: "High", color: "#B7791F" },
          { label: "Medium", color: "#B8920F" },
          { label: "Low", color: "#3D8B5A" },
        ].map((item) => (
          <div
            key={item.label}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: item.color,
              }}
            />
            <span
              style={{
                fontSize: 11.5,
                color: "#767270",
                fontFamily: "'DM Mono', monospace",
              }}
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
