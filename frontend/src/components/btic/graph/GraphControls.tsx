import type { GraphNodeType } from "../../../types/btic";
import { NODE_COLORS } from "./constants";

interface GraphControlsProps {
  expandedHops: number;
  onHopsChange: (hops: number) => void;
  filter: GraphNodeType | "";
  onFilterChange: (filter: GraphNodeType | "") => void;
  nodeCount: number;
  edgeCount: number;
}

export function GraphControls({
  expandedHops,
  onHopsChange,
  filter,
  onFilterChange,
  nodeCount,
  edgeCount,
}: GraphControlsProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
      <div>
        <h2
          style={{
            fontFamily: "'Newsreader', Georgia, serif",
            fontSize: 24,
            fontWeight: 400,
            color: "#100F0F",
            margin: 0,
          }}
        >
          Identity Graph
        </h2>
        <p style={{ fontSize: 13.5, color: "#767270", margin: "4px 0 0 0" }}>
          {nodeCount} nodes · {edgeCount} relationships
        </p>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span
          style={{
            fontSize: 11.5,
            color: "#767270",
            fontFamily: "'DM Mono', monospace",
          }}
        >
          HOPS:
        </span>
        {[1, 2, 3].map((h) => (
          <button
            key={h}
            onClick={() => onHopsChange(h)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 12.5,
              cursor: "pointer",
              border: "1px solid #D7D2D0",
              background: expandedHops === h ? "rgba(16, 15, 15,0.12)" : "transparent",
              color: expandedHops === h ? "#100F0F" : "rgba(16, 15, 15,0.4)",
              fontFamily: "'DM Mono', monospace",
            }}
          >
            {h}
          </button>
        ))}
      </div>
    </div>
  );
}
