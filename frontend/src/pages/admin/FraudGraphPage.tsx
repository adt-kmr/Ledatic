import { useState, useMemo } from "react";
import { MOCK_GRAPH_DATA } from "../../data/mockGraph";
import { useBticStore } from "../../stores/bticStore";
import { ErrorBoundary } from "../../components/ui/ErrorBoundary";
import {
  GraphNode,
  GraphEdge,
  GraphControls,
  GraphLegend,
  NodeDetailPanel,
} from "../../components/btic/graph";
import type { GraphNodeType } from "../../types/btic";

export default function FraudGraphPage() {
  const selectedGraphNode = useBticStore((s) => s.selectedGraphNode);
  const setSelectedGraphNode = useBticStore((s) => s.setSelectedGraphNode);

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [filter, setFilter] = useState<GraphNodeType | "">("");
  const [expandedHops, setExpandedHops] = useState(1);

  const data = MOCK_GRAPH_DATA;

  const visibleNodes = useMemo(() => {
    let nodes = data.nodes;
    if (filter) {
      nodes = nodes.filter((n) => n.type === filter);
    }
    const maxNodes = expandedHops === 1 ? 30 : expandedHops === 2 ? 80 : 200;
    return nodes.slice(0, maxNodes);
  }, [data.nodes, filter, expandedHops]);

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes]
  );

  const visibleEdges = useMemo(() => {
    return data.edges.filter(
      (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
    );
  }, [data.edges, visibleNodeIds]);

  const selectedNode = data.nodes.find((n) => n.id === selectedGraphNode);

  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const width = 800;
    const height = 500;

    visibleNodes.forEach((node, i) => {
      const angle = (i / visibleNodes.length) * Math.PI * 2;
      const radius = 100 + (node.importance || 1) * 20;
      positions.set(node.id, {
        x: width / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 40,
        y: height / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 40,
      });
    });

    return positions;
  }, [visibleNodes]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: "calc(100vh - 120px)",
      }}
    >
      <GraphControls
        expandedHops={expandedHops}
        onHopsChange={setExpandedHops}
        filter={filter}
        onFilterChange={setFilter}
        nodeCount={visibleNodes.length}
        edgeCount={visibleEdges.length}
      />

      {/* Graph + detail panel — stacks on mobile */}
      <div
        className="flex flex-col md:flex-row"
        style={{ gap: 16, flex: 1, minHeight: 0 }}
      >
        <ErrorBoundary name="Identity Graph">
          <div
            className="glass-card"
            style={{
              flex: 1,
              borderRadius: 12,
              overflow: "hidden",
              position: "relative",
              background:
                "radial-gradient(ellipse at center, #F1F1F1 0%, #F9F8F8 100%)",
              minHeight: 300,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `
                  linear-gradient(rgba(16, 15, 15,0.015) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(16, 15, 15,0.015) 1px, transparent 1px)
                `,
                backgroundSize: "40px 40px",
              }}
            />

            <svg
              viewBox="0 0 800 500"
              style={{ width: "100%", height: "100%", position: "relative" }}
            >
              {visibleEdges.map((edge) => {
                const sourcePos = nodePositions.get(edge.source);
                const targetPos = nodePositions.get(edge.target);
                if (!sourcePos || !targetPos) return null;

                const isHighlighted =
                  hoveredNode === edge.source ||
                  hoveredNode === edge.target ||
                  selectedGraphNode === edge.source ||
                  selectedGraphNode === edge.target;

                return (
                  <GraphEdge
                    key={edge.id}
                    edge={edge}
                    sourceX={sourcePos.x}
                    sourceY={sourcePos.y}
                    targetX={targetPos.x}
                    targetY={targetPos.y}
                    isHighlighted={isHighlighted}
                  />
                );
              })}

              {visibleNodes.map((node) => {
                const pos = nodePositions.get(node.id);
                if (!pos) return null;

                return (
                  <GraphNode
                    key={node.id}
                    node={node}
                    x={pos.x}
                    y={pos.y}
                    isSelected={selectedGraphNode === node.id}
                    isHovered={hoveredNode === node.id}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    onClick={() =>
                      setSelectedGraphNode(
                        selectedGraphNode === node.id ? null : node.id
                      )
                    }
                  />
                );
              })}
            </svg>

            <GraphLegend activeFilter={filter} onFilterChange={setFilter} />
          </div>
        </ErrorBoundary>

        {selectedNode && (
          <div className="md:w-[340px] w-full md:flex-shrink-0">
            <NodeDetailPanel node={selectedNode} edges={data.edges} />
          </div>
        )}
      </div>
    </div>
  );
}
