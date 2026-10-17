import type { GraphNodeType } from "../../../types/btic";
import { NODE_COLORS } from "./constants";

interface GraphLegendProps {
  activeFilter: GraphNodeType | "";
  onFilterChange: (filter: GraphNodeType | "") => void;
}

export function GraphLegend({ activeFilter, onFilterChange }: GraphLegendProps) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      {Object.entries(NODE_COLORS).map(([type, color]) => (
        <button
          key={type}
          onClick={() => onFilterChange(activeFilter === type ? "" : (type as GraphNodeType))}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            borderRadius: 4,
            border:
              activeFilter === type
                ? `1px solid ${color}`
                : "1px solid rgba(16, 15, 15,0.08)",
            background: activeFilter === type ? `${color}20` : "rgba(255, 255, 255,0.5)",
            cursor: "pointer",
            fontSize: 11,
            color: "#767270",
            fontFamily: "'DM Mono', monospace",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
          {type}
        </button>
      ))}
    </div>
  );
}
