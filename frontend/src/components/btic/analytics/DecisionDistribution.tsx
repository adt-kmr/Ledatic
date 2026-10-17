import { DECISION_DATA } from "./data";

interface DecisionDistributionProps {
  totalDecisions: number;
}

export function DecisionDistribution({ totalDecisions }: DecisionDistributionProps) {
  return (
    <div className="glass-card" style={{ padding: "20px 22px" }}>
      <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 16 }}>
          Decision distribution
        </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {DECISION_DATA.map((item) => {
          const pct = (item.count / totalDecisions) * 100;
          return (
            <div key={item.decision}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 13.5, color: "#575452" }}>
                  {item.decision}
                </span>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 13.5,
                    color: item.color,
                    fontWeight: 700,
                  }}
                >
                  {item.count.toLocaleString()} ({pct.toFixed(1)}%)
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: "rgba(16, 15, 15,0.06)",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: item.color,
                    borderRadius: 3,
                    transition: "width 0.5s",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
