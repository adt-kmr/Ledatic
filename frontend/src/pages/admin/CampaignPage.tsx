import { useState } from "react";
import { MOCK_CAMPAIGNS } from "../../data/mockCampaigns";
import {
  CampaignCard,
  CampaignDetail,
  CampaignFilters,
} from "../../components/btic/campaign";

export default function CampaignPage() {
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");

  const filtered = MOCK_CAMPAIGNS.filter((c) => {
    if (filter && c.status !== filter) return false;
    return true;
  });

  const selected = MOCK_CAMPAIGNS.find((c) => c.id === selectedCampaign);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header — stacks on mobile */}
      <div
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between"
        style={{ gap: 12 }}
      >
        <CampaignFilters activeFilter={filter} onFilterChange={setFilter} />
      </div>

      {/* Campaign grid — single column on mobile when detail is open */}
      <div
        className={selected ? "grid grid-cols-1 lg:grid-cols-[1fr_380px]" : ""}
        style={{
          display: selected ? undefined : "grid",
          gridTemplateColumns: selected ? undefined : "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        {filtered.map((campaign) => (
          <CampaignCard
            key={campaign.id}
            campaign={campaign}
            isSelected={selectedCampaign === campaign.id}
            onClick={() =>
              setSelectedCampaign(
                selectedCampaign === campaign.id ? null : campaign.id
              )
            }
          />
        ))}
      </div>

      {selected && <CampaignDetail campaign={selected} />}
    </div>
  );
}
