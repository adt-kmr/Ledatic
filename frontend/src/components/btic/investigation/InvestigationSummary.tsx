import type { GraphNode, GraphEdge } from "../../../types/btic";
import { Pill } from "../../ui/Pill";

interface InvestigationSummaryProps {
  node: GraphNode;
  connectedEdges: GraphEdge[];
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "8px 10px", borderRadius: 6, background: "#FFFFFF" }}>
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: "#969290",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'Newsreader', Georgia, serif",
          fontSize: 20,
          fontWeight: 400,
          color: "#100F0F",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function InvestigationSummary({ node, connectedEdges }: InvestigationSummaryProps) {
  return (
    <div className="glass-card" style={{ padding: "20px 22px" }}>
      <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 12 }}>
          Investigation summary
        </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span
          style={{
            fontFamily: "'Newsreader', Georgia, serif",
            fontSize: 22,
            fontWeight: 400,
            color: "#100F0F",
          }}
        >
          {node.label}
        </span>
        <Pill text={node.type.toUpperCase()} color="var(--color-primary)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <InfoBlock label="Confidence" value={`${(node.confidence * 100).toFixed(0)}%`} />
        <InfoBlock label="Risk Level" value={String(node.metadata.riskLevel || "UNKNOWN")} />
        <InfoBlock
          label="Sessions"
          value={String(node.metadata.sessions || connectedEdges.length)}
        />
        <InfoBlock
          label="First Seen"
          value={
            node.metadata.firstSeen
              ? new Date(String(node.metadata.firstSeen)).toLocaleDateString()
              : "—"
          }
        />
      </div>
    </div>
  );
}
