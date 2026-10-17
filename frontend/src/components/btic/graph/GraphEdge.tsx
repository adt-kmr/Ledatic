import React from "react";
import type { GraphEdge as GraphEdgeType } from "../../../types/btic";

interface GraphEdgeProps {
  edge: GraphEdgeType;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  isHighlighted: boolean;
}

export const GraphEdge = React.memo(function GraphEdge({
  edge,
  sourceX,
  sourceY,
  targetX,
  targetY,
  isHighlighted,
}: GraphEdgeProps) {
  return (
    <line
      x1={sourceX}
      y1={sourceY}
      x2={targetX}
      y2={targetY}
      stroke={isHighlighted ? "rgba(20, 19, 19,0.4)" : "rgba(20, 19, 19,0.08)"}
      strokeWidth={isHighlighted ? 1.5 + edge.confidence : 0.5 + edge.confidence * 0.5}
      strokeDasharray={edge.type === "behavior_similarity" ? "4 4" : "none"}
      style={{ transition: "all 0.3s" }}
    />
  );
});
