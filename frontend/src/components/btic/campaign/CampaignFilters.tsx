interface CampaignFiltersProps {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
}

const FILTERS = ["", "ACTIVE", "INVESTIGATING", "CONTAINED", "RESOLVED"];

export function CampaignFilters({ activeFilter, onFilterChange }: CampaignFiltersProps) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {FILTERS.map((s) => (
        <button
          key={s || "all"}
          onClick={() => onFilterChange(s)}
          style={{
            padding: "5px 12px",
            borderRadius: 8,
            fontSize: 12.5,
            cursor: "pointer",
            fontFamily: "'DM Mono', monospace",
            border: "1px solid #D7D2D0",
            background: activeFilter === s ? "rgba(16, 15, 15,0.12)" : "transparent",
            color: activeFilter === s ? "#100F0F" : "rgba(16, 15, 15,0.4)",
            transition: "all 0.2s",
          }}
        >
          {s || "ALL"}
        </button>
      ))}
    </div>
  );
}
