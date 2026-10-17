import { Pill } from "../../ui/Pill";
import { STATUS_COLORS, TYPE_COLORS } from "./constants";
import type { Campaign } from "../../../types/btic";

interface CampaignCardProps {
  campaign: Campaign;
  isSelected: boolean;
  onClick: () => void;
}

export function CampaignCard({ campaign, isSelected, onClick }: CampaignCardProps) {
  return (
    <div
      onClick={onClick}
      className="glass-card magnetic-hover"
      style={{
        padding: "18px 20px",
        cursor: "pointer",
        borderLeft: `3px solid ${campaign.color}`,
        transition: "all 0.2s",
        outline: isSelected ? "1px solid rgba(16, 15, 15,0.2)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
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
        <Pill text={campaign.status} color={STATUS_COLORS[campaign.status]} />
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
        <StatItem label="victims" value={campaign.victimCount.toString()} />
        <StatItem label="confidence" value={`${(campaign.confidence * 100).toFixed(0)}%`} />
        <StatItem label="exposure" value={`₹${(campaign.estimatedLoss / 100000).toFixed(1)}L`} />
        <StatItem label="mules" value={campaign.moneyMuleCount.toString()} />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Pill text={campaign.type.replace(/_/g, " ")} color={TYPE_COLORS[campaign.type]} />
        <Pill text={campaign.primaryRegion} color="#767270" />
        {campaign.growthRate > 2 && (
          <Pill text={`+${campaign.growthRate.toFixed(1)}% growth`} color="#B3261E" />
        )}
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 12.5, color: "#767270" }}>
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontWeight: 700,
          color: "#100F0F",
        }}
      >
        {value}
      </span>{" "}
      {label}
    </div>
  );
}
