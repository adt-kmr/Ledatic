import type { GraphEdge } from "../../../types/btic";

interface EvidencePanelProps {
  edges: GraphEdge[];
}

export function EvidencePanel({ edges }: EvidencePanelProps) {
  return (
    <div>
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: "#969290",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Evidence ({edges.length} relationships)
      </div>
      {edges.slice(0, 8).map((edge) => (
        <div
          key={edge.id}
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            background: "#FFFFFF",
            marginBottom: 6,
            borderLeft: "2px solid rgba(16, 15, 15,0.1)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12.5, color: "#575452", fontWeight: 600 }}>
              {edge.type.replace(/_/g, " ")}
            </span>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11.5,
                color: "#767270",
              }}
            >
              {(edge.confidence * 100).toFixed(0)}% conf · {edge.evidenceCount} evidence
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "#767270", marginTop: 4 }}>
            {edge.explanation}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#969290",
              marginTop: 4,
              fontFamily: "'DM Mono', monospace",
            }}
          >
            {new Date(edge.firstSeen).toLocaleDateString()} →{" "}
            {new Date(edge.lastSeen).toLocaleDateString()}
          </div>
        </div>
      ))}
    </div>
  );
}
