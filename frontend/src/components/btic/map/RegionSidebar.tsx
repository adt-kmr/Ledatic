import { useMemo } from "react";
import { useBticStore } from "../../../stores/bticStore";
import { MOCK_HEX_CELLS, MOCK_CONNECTIONS } from "../../../data/mockMap";
import { MOCK_CAMPAIGNS } from "../../../data/mockCampaigns";
import { Pill } from "../../ui/Pill";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#B3261E",
  HIGH: "#B7791F",
  MEDIUM: "#B8920F",
  LOW: "#3D8B5A",
  INFO: "#2C7A91",
};

/**
 * Sidebar that appears when a hex cell is selected on the map.
 * Shows regional intelligence: cell details, related campaigns,
 * nearby threats, and connection summary.
 */
export function RegionSidebar() {
  const selectedHexCell = useBticStore((s) => s.selectedHexCell);
  const setSelectedHexCell = useBticStore((s) => s.setSelectedHexCell);

  const cell = useMemo(() => {
    if (!selectedHexCell) return null;
    return MOCK_HEX_CELLS.find((c) => c.h3Index === selectedHexCell) || null;
  }, [selectedHexCell]);

  // Find related connections
  const relatedConnections = useMemo(() => {
    if (!cell) return [];
    return MOCK_CONNECTIONS.filter(
      (c) =>
        c.source.h3Index === cell.h3Index ||
        c.target.h3Index === cell.h3Index,
    );
  }, [cell]);

  // Find related campaigns (by threat type match)
  const relatedCampaigns = useMemo(() => {
    if (!cell) return [];
    return MOCK_CAMPAIGNS.filter((cmp) =>
      cell.threatTypes.some(
        (t) =>
          cmp.type === t ||
          (t === "SIM_SWAP" && cmp.type === "SIM_SWAP") ||
          (t === "CREDENTIAL_THEFT" && cmp.type === "CREDENTIAL_THEFT"),
      ),
    ).slice(0, 3);
  }, [cell]);

  // Find nearby cells (same state)
  const nearbyCells = useMemo(() => {
    if (!cell) return [];
    return MOCK_HEX_CELLS.filter(
      (c) => c.state === cell.state && c.h3Index !== cell.h3Index,
    ).slice(0, 5);
  }, [cell]);

  if (!cell) return null;

  const totalThreatsInRegion =
    cell.threatCount +
    nearbyCells.reduce((sum, c) => sum + c.threatCount, 0);

  return (
    <div
      className="slide-in-right"
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        bottom: 60,
        width: "min(320px, calc(100vw - 32px))",
        background: "rgba(255, 255, 255,0.85)",
        backdropFilter: "blur(16px)",
        border: "1px solid #EAE4E1",
        borderRadius: 12,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #EAE4E1",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'Newsreader', Georgia, serif",
              fontSize: 20,
              fontWeight: 400,
              color: "#100F0F",
            }}
          >
            {cell.city}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "#767270",
              marginTop: 2,
            }}
          >
            {cell.state}
          </div>
        </div>
        <button
          onClick={() => setSelectedHexCell(null)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: "1px solid #D7D2D0",
            background: "rgba(16, 15, 15,0.05)",
            color: "#767270",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13.5,
          }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* Cell Stats */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 8,
          }}
        >
          <StatBlock label="Threats" value={String(cell.threatCount)} />
          <StatBlock
            label="Severity"
            value={cell.severity}
            color={SEVERITY_COLORS[cell.severity]}
          />
          <StatBlock
            label="Confidence"
            value={`${(cell.confidence * 100).toFixed(0)}%`}
          />
          <StatBlock
            label="Region Total"
            value={String(totalThreatsInRegion)}
          />
        </div>

        {/* Threat Types */}
        <div>
          <SectionLabel>Active Threat Types</SectionLabel>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {cell.threatTypes.map((t) => (
              <Pill key={t} text={t.replace(/_/g, " ")} color="#767270" />
            ))}
          </div>
        </div>

        {/* Related Campaigns */}
        {relatedCampaigns.length > 0 && (
          <div>
            <SectionLabel>Related Campaigns</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {relatedCampaigns.map((cmp) => (
                <div
                  key={cmp.id}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "#FFFFFF",
                    borderLeft: `2px solid ${cmp.color}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#100F0F",
                      }}
                    >
                      {cmp.name}
                    </span>
                    <Pill text={cmp.status} color={SEVERITY_COLORS[cmp.status] || "#706C69"} />
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "#767270",
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    {cmp.victimCount} victims · {(cmp.confidence * 100).toFixed(0)}% conf
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Connections */}
        {relatedConnections.length > 0 && (
          <div>
            <SectionLabel>
              Connections ({relatedConnections.length})
            </SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {relatedConnections.slice(0, 5).map((conn, i) => {
                const otherCell =
                  conn.source.h3Index === cell.h3Index
                    ? MOCK_HEX_CELLS.find(
                        (c) => c.h3Index === conn.target.h3Index,
                      )
                    : MOCK_HEX_CELLS.find(
                        (c) => c.h3Index === conn.source.h3Index,
                      );
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "4px 8px",
                      borderRadius: 4,
                      background: "#FFFFFF",
                      fontSize: 11.5,
                    }}
                  >
                    <span style={{ color: "#767270" }}>
                      → {otherCell?.city || "Unknown"}
                    </span>
                    <span
                      style={{
                        fontFamily: "'DM Mono', monospace",
                        color: "#767270",
                      }}
                    >
                      {(conn.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Nearby Regions */}
        {nearbyCells.length > 0 && (
          <div>
            <SectionLabel>Nearby Regions</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {nearbyCells.map((nc) => (
                <div
                  key={nc.h3Index}
                  onClick={() => setSelectedHexCell(nc.h3Index)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    borderRadius: 4,
                    background: "#FFFFFF",
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(16, 15, 15,0.05)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "rgba(16, 15, 15,0.02)")
                  }
                >
                  <span style={{ fontSize: 12.5, color: "#575452" }}>
                    {nc.city}
                  </span>
                  <span
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 11.5,
                      color: SEVERITY_COLORS[nc.severity] || "#706C69",
                    }}
                  >
                    {nc.threatCount} threats
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <ActionButton
            label="Investigate"
            color="var(--color-primary)"
            onClick={() => {
              // Navigate to investigation page
              window.location.href = `/admin/investigate?region=${cell.state}`;
            }}
          />
          <ActionButton
            label="View Graph"
            color="#5B5BA8"
            onClick={() => {
              window.location.href = `/admin/graph`;
            }}
          />
        </div>
      </div>
    </div>
  );
}

function StatBlock({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: 6,
        background: "#FFFFFF",
      }}
    >
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
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
          fontSize: 22,
          fontWeight: 400,
          color: color || "#100F0F",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: 11,
        color: "#969290",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function ActionButton({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "8px 12px",
        borderRadius: 8,
        border: "none",
        background: `${color}20`,
        color: color,
        fontSize: 12.5,
        fontWeight: 600,
        fontFamily: "'Inter', sans-serif",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = `${color}35`)
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = `${color}20`)
      }
    >
      {label}
    </button>
  );
}
