import { useNavigate } from "react-router-dom";
import { HeroStats } from "../../components/btic/HeroStats";
import { LiveFeed } from "../../components/btic/LiveFeed";
import { QuickActions } from "../../components/btic/QuickActions";
import { StatusIndicator } from "../../components/btic/StatusIndicator";
import { useThreatFeed } from "../../hooks/useThreatFeed";
import { MOCK_CAMPAIGNS } from "../../data/mockCampaigns";
import { Pill } from "../../components/ui/Pill";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "#B3261E",
  INVESTIGATING: "#B7791F",
  CONTAINED: "#3D8B5A",
  RESOLVED: "#706C69",
};

const TYPE_COLORS: Record<string, string> = {
  SIM_SWAP: "#B3261E",
  CREDENTIAL_THEFT: "#B7791F",
  COERCION: "#B8920F",
  MONEY_MULE: "#8E5BA8",
  BEHAVIORAL_ANOMALY: "#2C7A91",
  MERCHANT_ABUSE: "#3D8B5A",
  IDENTITY_MISMATCH: "#5B5BA8",
};

export default function OverviewPage() {
  const navigate = useNavigate();
  useThreatFeed({ mockIntervalMs: 2500, enabled: true });

  const activeCampaigns = MOCK_CAMPAIGNS.filter((c) => c.status === "ACTIVE");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <HeroStats />

      {/* Main content grid — stacks on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 16 }}>
        {/* Threat Summary */}
        <div className="glass-card" style={{ padding: "18px 22px" }}>
          <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 14 }}>
          Threat summary
        </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { type: "SIM_SWAP", label: "SIM Swaps", count: 47, critical: 12 },
              { type: "CREDENTIAL_THEFT", label: "Credential Theft", count: 83, critical: 28 },
              { type: "COERCION", label: "Coercion", count: 19, critical: 7 },
              { type: "MONEY_MULE", label: "Money Mule", count: 34, critical: 15 },
              { type: "BEHAVIORAL_ANOMALY", label: "Behavior Drift", count: 156, critical: 3 },
            ].map((item) => (
              <div
                key={item.type}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "#FFFFFF",
                  cursor: "pointer",
                }}
                onClick={() => navigate("/admin/threats")}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: TYPE_COLORS[item.type],
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 13.5,
                    color: "#575452",
                    flex: 1,
                  }}
                >
                  {item.label}
                </span>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: "#100F0F",
                  }}
                >
                  {item.count}
                </span>
                {item.critical > 0 && (
                  <Pill text={`${item.critical} CRIT`} color="#B3261E" />
                )}
              </div>
            ))}
          </div>
        </div>

        <LiveFeed />
      </div>

      {/* Quick Actions + System Health — stacks on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 16 }}>
        <QuickActions />
        <StatusIndicator />
      </div>

      {/* Campaign Intelligence */}
      <div className="glass-card" style={{ padding: "18px 22px" }}>
        <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 14 }}>
          Active campaigns
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {activeCampaigns.map((campaign) => (
            <div
              key={campaign.id}
              onClick={() => navigate("/admin/campaigns")}
              className="magnetic-hover"
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                background: "#FFFFFF",
                border: "1px solid #EAE4E1",
                cursor: "pointer",
                borderLeft: `3px solid ${campaign.color}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 400,
                    color: "#100F0F",
                    fontFamily: "'Newsreader', Georgia, serif",
                  }}
                >
                  {campaign.name}
                </span>
                <Pill
                  text={campaign.status}
                  color={STATUS_COLORS[campaign.status]}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  fontSize: 12.5,
                  color: "#767270",
                  fontFamily: "'DM Mono', monospace",
                  flexWrap: "wrap",
                }}
              >
                <span>{campaign.victimCount} victims</span>
                <span>{(campaign.confidence * 100).toFixed(0)}% conf</span>
                <span>{campaign.primaryRegion}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
