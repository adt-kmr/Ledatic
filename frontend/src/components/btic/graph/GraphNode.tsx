import React from "react";
import type { GraphNode as GraphNodeType } from "../../../types/btic";
import { NODE_COLORS } from "./constants";

interface GraphNodeProps {
  node: GraphNodeType;
  x: number;
  y: number;
  isSelected: boolean;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}

export const GraphNode = React.memo(function GraphNode({
  node,
  x,
  y,
  isSelected,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: GraphNodeProps) {
  const color = NODE_COLORS[node.type];
  const size = 6 + (node.importance || 1) * 1.5;
  const showLabel = isSelected || isHovered || node.importance >= 7;

  return (
    <g>
      {(isSelected || isHovered) && (
        <circle cx={x} cy={y} r={size + 8} fill={color} fillOpacity={0.15} />
      )}
      <circle
        cx={x}
        cy={y}
        r={size}
        fill={color}
        fillOpacity={isSelected ? 1 : isHovered ? 0.9 : 0.6 + node.confidence * 0.4}
        stroke={isSelected ? "#100F0F" : color}
        strokeWidth={isSelected ? 2 : 1}
        style={{ cursor: "pointer", transition: "all 0.2s" }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      />
      {showLabel && (
        <text
          x={x}
          y={y + size + 12}
          textAnchor="middle"
          fill="rgba(20, 19, 19,0.6)"
          fontSize="9"
          fontFamily="'DM Mono', monospace"
        >
          {node.label.slice(0, 20)}
        </text>
      )}
    </g>
  );
});
