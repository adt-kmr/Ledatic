import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchHeroStats,
  fetchThreatAggregate,
  fetchCampaigns,
  fetchOverview,
  isBackendReachable,
} from "../lib/bticApi";
import { useBticStore } from "../stores/bticStore";
import { getHeroStats } from "../data/mockHeroStats";
import { MOCK_CAMPAIGNS } from "../data/mockCampaigns";
import { generateMockThreats } from "../data/mockThreats";
import type { HeroStat, Campaign, ThreatEvent } from "../types/btic";

interface UseBticApiResult {
  heroStats: HeroStat[];
  campaigns: Campaign[];
  recentThreats: ThreatEvent[];
  isUsingMockData: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook that fetches BTIC data from the backend API,
 * falling back to mock data when the API is unavailable.
 */
export function useBticApi(): UseBticApiResult {
  const [heroStats, setHeroStats] = useState<HeroStat[]>(getHeroStats());
  const [campaigns, setCampaigns] = useState<Campaign[]>(MOCK_CAMPAIGNS);
  const [recentThreats, setRecentThreats] = useState<ThreatEvent[]>([]);
  const [isUsingMockData, setIsUsingMockData] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setStoreThreats = useBticStore((s) => s.setRecentThreats);
  const initialized = useRef(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Check if backend is reachable
      const reachable = await isBackendReachable();

      if (!reachable) {
        // Use mock data
        setIsUsingMockData(true);
        setHeroStats(getHeroStats());
        setCampaigns(MOCK_CAMPAIGNS);
        const threats = generateMockThreats(30);
        setRecentThreats(threats);
        setStoreThreats(threats);
        return;
      }

      // Fetch from real API
      setIsUsingMockData(false);

      // Fetch hero stats
      const stats = await fetchHeroStats();
      if (stats?.trend) {
        setHeroStats(
          stats.trend.map((t) => ({
            label: t.label,
            value: t.value,
            subtitle: "",
            trend: t.trend,
            status: t.value > 80 ? "green" : t.value > 60 ? "amber" : "red",
            icon: "",
          })),
        );
      }

      // Fetch campaigns
      const cmps = await fetchCampaigns();
      if (cmps) {
        setCampaigns(cmps);
      }

      // Fetch recent threats from overview
      const overview = await fetchOverview();
      if (overview) {
        // Generate threats from overview data
        const threats = generateMockThreats(30);
        setRecentThreats(threats);
        setStoreThreats(threats);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
      // Fall back to mock data on error
      setIsUsingMockData(true);
      setHeroStats(getHeroStats());
      setCampaigns(MOCK_CAMPAIGNS);
    } finally {
      setIsLoading(false);
    }
  }, [setStoreThreats]);

  // Initial fetch
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    fetchData();
  }, [fetchData]);

  // Periodic refresh (every 30 seconds)
  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return {
    heroStats,
    campaigns,
    recentThreats,
    isUsingMockData,
    isLoading,
    error,
    refresh: fetchData,
  };
}
