import { useState, useEffect } from "react";
import { HeroStatCard } from "./HeroStatCard";
import { getHeroStats } from "../../data/mockHeroStats";
import { fetchHeroStats } from "../../lib/bticApi";
import type { HeroStat } from "../../types/btic";

export function HeroStats() {
  const [stats, setStats] = useState<HeroStat[]>([]);
  const [source, setSource] = useState<"mock" | "api">("mock");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Try real API first
      const apiStats = await fetchHeroStats();
      if (cancelled) return;

      if (apiStats) {
        setSource("api");
        setStats([
          {
            label: "Identity Confidence",
            value: apiStats.identityConfidence,
            subtitle: "Avg trust across active sessions (%)",
            trend: apiStats.trend[0]?.trend || [],
            status:
              apiStats.identityConfidence > 80
                ? "green"
                : apiStats.identityConfidence > 60
                  ? "amber"
                  : "red",
            icon: "shield",
          },
          {
            label: "Active Threats",
            value: apiStats.activeThreats,
            subtitle: "Campaigns running in last 1h",
            trend: apiStats.trend[1]?.trend || [],
            status: apiStats.activeThreats > 5 ? "red" : "green",
            icon: "alert",
          },
          {
            label: "Critical Incidents",
            value: apiStats.criticalIncidents,
            subtitle: "Hard blocks in last 24h",
            trend: apiStats.trend[2]?.trend || [],
            status: apiStats.criticalIncidents > 0 ? "red" : "green",
            icon: "incident",
          },
          {
            label: "Protected Transactions",
            value: apiStats.protectedTransactions,
            subtitle: "Approved sessions today",
            trend: apiStats.trend[3]?.trend || [],
            status: "green",
            icon: "lock",
          },
        ]);
      } else {
        // Fall back to mock
        setStats(getHeroStats());
      }
    }

    load();

    // Refresh every 15s
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        {stats.map((stat) => (
          <HeroStatCard key={stat.label} stat={stat} />
        ))}
      </div>
      {source === "api" && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "#969290",
            fontFamily: "'DM Mono', monospace",
            textAlign: "right",
          }}
        >
          source: live API
        </div>
      )}
    </div>
  );
}
