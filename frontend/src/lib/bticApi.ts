/**
 * BTIC API client — wraps all backend endpoints for the Threat Intelligence
 * Command Center. Falls back to mock data when the API is unavailable.
 */
import { adminFetch, getAdminToken } from "../admin/adminAuth";
import { apiUrl } from "./auth";
import type {
  ThreatEvent,
  MapHexCell,
  GraphData,
  Campaign,
  HeroStat,
  TickerMessage,
  ThreatTrend,
  DecisionDistribution,
  GeographicDensity,
  ThreatType,
} from "../types/btic";

// ── API Response Types ────────────────────────────────────────────────────
interface ThreatAggregateResponse {
  hexCells: MapHexCell[];
  connections: { source: MapHexCell; target: MapHexCell; confidence: number; type: ThreatType }[];
  totalThreats: number;
  lastUpdated: string;
}

interface HeroStatsResponse {
  identityConfidence: number;
  activeThreats: number;
  criticalIncidents: number;
  protectedTransactions: number;
  trend: { label: string; value: number; trend: number[] }[];
}

interface GraphResponse {
  nodes: GraphData["nodes"];
  edges: GraphData["edges"];
}

interface CampaignsResponse {
  campaigns: Campaign[];
  total: number;
}

interface AnalyticsResponse {
  trends: ThreatTrend[];
  decisions: DecisionDistribution[];
  geographic: GeographicDensity[];
}

// ── API Functions ─────────────────────────────────────────────────────────

/**
 * Fetch aggregated threat data for the map.
 * Groups sessions by H3 cell with severity and confidence.
 */
export async function fetchThreatAggregate(
  hours: number = 24,
): Promise<ThreatAggregateResponse | null> {
  try {
    const res = await adminFetch(`/api/btic/threats/aggregate?hours=${hours}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch hero statistics for the overview dashboard.
 */
export async function fetchHeroStats(): Promise<HeroStatsResponse | null> {
  try {
    const res = await adminFetch("/api/btic/hero/stats");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch identity graph data centered on a customer.
 */
export async function fetchGraphData(
  customerHash: string,
  depth: number = 1,
): Promise<GraphResponse | null> {
  try {
    const res = await adminFetch(
      `/api/btic/graph/${encodeURIComponent(customerHash)}?depth=${depth}`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch active fraud campaigns.
 */
export async function fetchCampaigns(): Promise<Campaign[] | null> {
  try {
    const res = await adminFetch("/api/btic/campaigns");
    if (!res.ok) return null;
    const data = await res.json();
    return data.campaigns || null;
  } catch {
    return null;
  }
}

/**
 * Fetch campaign detail by ID.
 */
export async function fetchCampaignDetail(
  campaignId: string,
): Promise<Campaign | null> {
  try {
    const res = await adminFetch(`/api/btic/campaigns/${campaignId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch threat analytics trends.
 */
export async function fetchAnalyticsTrends(
  period: string = "7d",
): Promise<ThreatTrend[] | null> {
  try {
    const res = await adminFetch(`/api/btic/analytics/trends?period=${period}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch geographic threat distribution.
 */
export async function fetchGeographicDistribution(): Promise<
  GeographicDensity[] | null
> {
  try {
    const res = await adminFetch("/api/btic/analytics/geo");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch live overview data (existing endpoint).
 */
export async function fetchOverview(): Promise<any | null> {
  try {
    const res = await adminFetch("/api/admin/overview");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch sessions with filters.
 */
export async function fetchSessions(params: {
  decision?: string;
  limit?: number;
  offset?: number;
}): Promise<any | null> {
  try {
    const q = new URLSearchParams();
    if (params.decision) q.set("decision", params.decision);
    if (params.limit) q.set("limit", String(params.limit));
    if (params.offset) q.set("offset", String(params.offset));
    const res = await adminFetch(`/api/admin/sessions?${q}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch session forensics.
 */
export async function fetchSessionForensics(
  sessionId: string,
): Promise<any | null> {
  try {
    const res = await adminFetch(
      `/api/admin/sessions/${sessionId}/forensics`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch customer 360 view.
 */
export async function fetchCustomer360(
  customerHash: string,
): Promise<any | null> {
  try {
    const res = await adminFetch(
      `/api/admin/customers/${encodeURIComponent(customerHash)}`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch trust score for a customer.
 */
export async function fetchTrustScore(
  customerHash: string,
): Promise<any | null> {
  try {
    const res = await adminFetch(
      `/api/admin/customers/${encodeURIComponent(customerHash)}/trust`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── SSE Connection ────────────────────────────────────────────────────────

/**
 * Create an SSE connection to the live event stream.
 * Falls back to null if SSE is not supported or connection fails.
 */
export function createLiveEventStream(
  onEvent: (data: any) => void,
  onError?: (error: Event) => void,
): EventSource | null {
  if (typeof EventSource === "undefined") return null;

  const token = getAdminToken();

  if (!token) return null;

  const url = apiUrl(`/api/btic/events/stream?token=${encodeURIComponent(token)}`);
  const es = new EventSource(url);

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent(data);
    } catch {
      // Non-JSON, ignore
    }
  };

  es.onerror = (error) => {
    onError?.(error);
  };

  return es;
}

// ── Mock Data Fallback ────────────────────────────────────────────────────

/**
 * Check if the backend is reachable.
 * Returns true if the API responds, false otherwise.
 */
export async function isBackendReachable(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl("/health"), { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}
