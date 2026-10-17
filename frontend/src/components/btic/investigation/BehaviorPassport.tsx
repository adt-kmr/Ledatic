import type { GraphNode, GraphEdge } from "../../../types/btic";

interface BehaviorPassportProps {
  node: GraphNode;
  connectedEdges: GraphEdge[];
}

interface Factor {
  label: string;
  value: number;
}

function getBarColor(value: number): string {
  if (value > 0.7) return "#B3261E";
  if (value > 0.4) return "#B7791F";
  return "#3D8B5A";
}

export function BehaviorPassport({ node, connectedEdges }: BehaviorPassportProps) {
  const factors: Factor[] =
    node.type === "behavior"
      ? [
          { label: "Typing Stability", value: Number(node.metadata.typingStability) || 0.5 },
          { label: "Touch Rhythm", value: Number(node.metadata.touchRhythm) || 0.5 },
          {
            label: "Interaction Consistency",
            value: Number(node.metadata.interactionConsistency) || 0.5,
          },
          { label: "Drift from Baseline", value: Number(node.metadata.driftFromBaseline) || 0.5 },
        ]
      : [];

  const minConf = connectedEdges.length
    ? Math.min(...connectedEdges.map((e) => e.confidence))
    : 0;
  const maxConf = connectedEdges.length
    ? Math.max(...connectedEdges.map((e) => e.confidence))
    : 0;

  return (
    <div>
      <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 12 }}>
          Behavior passport
        </div>

      {factors.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {factors.map((factor) => (
            <div key={factor.label}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, color: "#575452" }}>
                  {factor.label}
                </span>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 12.5,
                    color: getBarColor(factor.value),
                  }}
                >
                  {(factor.value * 100).toFixed(0)}%
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: "rgba(16, 15, 15,0.06)",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${factor.value * 100}%`,
                    background: getBarColor(factor.value),
                    borderRadius: 2,
                    transition: "width 0.5s",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13.5, color: "#767270", lineHeight: 1.6 }}>
            Select a behavior node in the graph to view the full behavioral passport, or
            search for a customer hash to see their identity confidence metrics.
          </div>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              background: "#FFFFFF",
              borderLeft: "2px solid var(--color-accent-emerald)",
            }}
          >
            <div style={{ fontSize: 12.5, color: "#575452" }}>
              Evidence indicates this entity has {connectedEdges.length} measurable
              relationships with confidence scores ranging from{" "}
              {(minConf * 100).toFixed(0)}% to {(maxConf * 100).toFixed(0)}%.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
