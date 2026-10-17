import { Pill } from "../../ui/Pill";
import { STATUS_COLORS } from "./constants";
import type { Campaign } from "../../../types/btic";

interface CampaignDetailProps {
  campaign: Campaign;
}

export function CampaignDetail({ campaign }: CampaignDetailProps) {
  return (
    <div
      className="glass-card"
      style={{ padding: "22px 24px", borderLeft: `3px solid ${campaign.color}` }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <h3
            style={{
              fontFamily: "'Newsreader', Georgia, serif",
              fontSize: 22,
              fontWeight: 400,
              color: "#100F0F",
              margin: 0,
            }}
          >
            {campaign.name}
          </h3>
          <p style={{ fontSize: 13.5, color: "#767270", margin: "4px 0 0 0" }}>
            {campaign.behaviorPattern}
          </p>
        </div>
        <Pill text={campaign.status} color={STATUS_COLORS[campaign.status]} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
        }}
      >
        {[
          { label: "Victims", value: campaign.victimCount.toString() },
          { label: "Confidence", value: `${(campaign.confidence * 100).toFixed(0)}%` },
          {
            label: "Financial Exposure",
            value: `₹${(campaign.estimatedLoss / 100000).toFixed(1)}L`,
          },
          { label: "Money Mules", value: campaign.moneyMuleCount.toString() },
          { label: "Growth Rate", value: `+${campaign.growthRate.toFixed(1)}%` },
          { label: "Primary Region", value: campaign.primaryRegion },
        ].map((item) => (
          <div
            key={item.label}
            style={{ padding: "10px 14px", borderRadius: 8, background: "#FFFFFF" }}
          >
            <div
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: "#969290",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontFamily: "'Newsreader', Georgia, serif",
                fontSize: 22,
                fontWeight: 400,
                color: "#100F0F",
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "#767270", marginRight: 8 }}>
          Affected Banks:
        </span>
        {campaign.affectedBanks.map((bank) => (
          <Pill key={bank} text={bank} color="#767270" />
        ))}
      </div>
    </div>
  );
}
