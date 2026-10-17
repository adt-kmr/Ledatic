import type { GraphEdge } from "../../../types/btic";

interface TimelineProps {
  edges: GraphEdge[];
}

export function Timeline({ edges }: TimelineProps) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 8 }}>
          Timeline
        </div>
      <div style={{ position: "relative", paddingLeft: 16 }}>
        <div
          style={{
            position: "absolute",
            left: 4,
            top: 0,
            bottom: 0,
            width: 1,
            background: "rgba(16, 15, 15,0.08)",
          }}
        />
        {edges.slice(0, 6).map((edge) => (
          <div key={edge.id} style={{ position: "relative", paddingBottom: 12 }}>
            <div
              style={{
                position: "absolute",
                left: -14,
                top: 4,
                width: 7,
                height: 7,
                borderRadius: "50%",
                background:
                  edge.confidence > 0.7
                    ? "#B3261E"
                    : edge.confidence > 0.4
                      ? "#B7791F"
                      : "#3D8B5A",
              }}
            />
            <div style={{ fontSize: 12.5, color: "#575452" }}>
              {edge.type.replace(/_/g, " ")}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#969290",
                fontFamily: "'DM Mono', monospace",
              }}
            >
              {new Date(edge.firstSeen).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
