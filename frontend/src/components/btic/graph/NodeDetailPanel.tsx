import type { GraphNode, GraphEdge } from "../../../types/btic";
import { Pill } from "../../ui/Pill";
import { NODE_COLORS } from "./constants";

interface NodeDetailPanelProps {
  node: GraphNode;
  edges: GraphEdge[];
}

export function NodeDetailPanel({ node, edges }: NodeDetailPanelProps) {
  const connectedEdges = edges.filter(
    (e) => e.source === node.id || e.target === node.id
  );

  return (
    <div
      className="glass-card w-full md:w-[320px]"
      style={{
        borderRadius: 12,
        padding: "18px 20px",
        overflowY: "auto",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: NODE_COLORS[node.type],
          }}
        />
        <span
          style={{
            fontFamily: "'Newsreader', Georgia, serif",
            fontSize: 20,
            fontWeight: 400,
            color: "#100F0F",
          }}
        >
          {node.label}
        </span>
      </div>

      <Pill text={node.type.toUpperCase()} color={NODE_COLORS[node.type]} />

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <InfoRow label="Confidence" value={`${(node.confidence * 100).toFixed(0)}%`} />
        <InfoRow label="Importance" value={node.importance.toString()} />
        {Object.entries(node.metadata).map(([key, val]) => (
          <InfoRow key={key} label={key} value={String(val)} />
        ))}
      </div>

      <div
        style={{
          marginTop: 14,
          borderTop: "1px solid #EAE4E1",
          paddingTop: 12,
        }}
      >
        <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 8 }}>
          Connected edges
        </div>
        {connectedEdges.slice(0, 10).map((edge) => (
          <div
            key={edge.id}
            style={{
              padding: "6px 0",
              borderBottom: "1px solid #EAE4E1",
              fontSize: 11.5,
              color: "#767270",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{edge.type.replace(/_/g, " ")}</span>
              <span style={{ fontFamily: "'DM Mono', monospace" }}>
                {(edge.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#969290", marginTop: 2 }}>
              {edge.explanation}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span
        style={{
          fontSize: 12.5,
          color: "#767270",
          fontFamily: "'DM Mono', monospace",
        }}
      >
        {label.replace(/_/g, " ")}
      </span>
      <span
        style={{
          fontSize: 12.5,
          color: "#2A2726",
          fontFamily: "'DM Mono', monospace",
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}
