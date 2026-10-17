const METRICS = [
  { label: "Accuracy", value: "94.2%", color: "#3D8B5A" },
  { label: "Precision", value: "91.8%", color: "#3D8B5A" },
  { label: "Recall", value: "89.5%", color: "#B7791F" },
  { label: "F1 Score", value: "90.6%", color: "#3D8B5A" },
  { label: "False Positive Rate", value: "2.1%", color: "#3D8B5A" },
  { label: "Avg Latency", value: "42ms", color: "#3D8B5A" },
];

export function ModelPerformance() {
  return (
    <div className="glass-card" style={{ padding: "20px 22px" }}>
      <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 12 }}>
          Model performance
        </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
        }}
      >
        {METRICS.map((metric) => (
          <div
            key={metric.label}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              background: "#FFFFFF",
              borderTop: `2px solid ${metric.color}`,
            }}
          >
            <div
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: "#969290",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              {metric.label}
            </div>
            <div
              style={{
                fontFamily: "'Newsreader', Georgia, serif",
                fontSize: 24,
                fontWeight: 400,
                color: "#100F0F",
              }}
            >
              {metric.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
