import { create } from "zustand";
import type {
  NavItem,
  MapLayer,
  MapHexCell,
  MapConnection,
  ThreatEvent,
  TickerMessage,
  ThreatSeverity,
  ThreatType,
} from "../types/btic";

// ── Feed filter state ──────────────────────────────────────────────────────
export interface FeedFilters {
  severities: ThreatSeverity[];
  types: ThreatType[];
  search: string;
  timeRange: "5m" | "15m" | "1h" | "6h" | "24h";
}

const DEFAULT_FILTERS: FeedFilters = {
  severities: [],
  types: [],
  search: "",
  timeRange: "1h",
};

// ── TTL constants (ms) ─────────────────────────────────────────────────────
const EVENT_TTL = 60 * 60 * 1000; // 1 hour
const MAX_RECENT_THREATS = 200;
const MAX_LIVE_EVENTS = 150;

// ── Dedup + TTL prune helpers ──────────────────────────────────────────────
function dedupAndPrune<T extends { id: string; timestamp: string }>(
  items: T[],
  max: number,
): T[] {
  const seen = new Set<string>();
  const cutoff = Date.now() - EVENT_TTL;
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    if (new Date(item.timestamp).getTime() < cutoff) continue;
    seen.add(item.id);
    result.push(item);
    if (result.length >= max) break;
  }
  return result;
}

// ── Store ──────────────────────────────────────────────────────────────────
interface BticState {
  // Navigation
  activeNav: NavItem;
  setActiveNav: (nav: NavItem) => void;

  // Map
  activeMapLayers: MapLayer[];
  toggleMapLayer: (layer: MapLayer) => void;
  selectedHexCell: string | null;
  setSelectedHexCell: (h3: string | null) => void;
  mapTimeRange: { start: Date; end: Date };
  setMapTimeRange: (range: { start: Date; end: Date }) => void;
  globeView: boolean;
  toggleGlobeView: () => void;
  mapHexCells: MapHexCell[];
  setMapHexCells: (cells: MapHexCell[]) => void;
  mapConnections: MapConnection[];
  setMapConnections: (connections: MapConnection[]) => void;

  // Graph
  selectedGraphNode: string | null;
  setSelectedGraphNode: (id: string | null) => void;
  graphExpansionHop: number;
  setGraphExpansionHop: (hop: number) => void;

  // Investigation
  investigationContext: {
    customerHash: string | null;
    sessionId: string | null;
  } | null;
  setInvestigationContext: (ctx: {
    customerHash: string | null;
    sessionId: string | null;
  } | null) => void;

  // Feed-Map correlation
  selectedFeedEvent: string | null;
  setSelectedFeedEvent: (eventId: string | null) => void;

  // ── Threat Feed ──────────────────────────────────────────────────────────
  feedEvents: ThreatEvent[];
  addFeedEvent: (event: ThreatEvent) => void;
  addFeedEvents: (events: ThreatEvent[]) => void;
  clearFeed: () => void;

  // Feed connection
  feedConnectionStatus: "connecting" | "connected" | "mock" | "disconnected";
  setFeedConnectionStatus: (
    status: "connecting" | "connected" | "mock" | "disconnected",
  ) => void;
  feedPaused: boolean;
  toggleFeedPaused: () => void;

  // Feed filters
  feedFilters: FeedFilters;
  setFeedFilters: (filters: Partial<FeedFilters>) => void;
  resetFeedFilters: () => void;

  // Recent threats (for map + overview)
  recentThreats: ThreatEvent[];
  setRecentThreats: (threats: ThreatEvent[]) => void;
  addRecentThreat: (threat: ThreatEvent) => void;

  // Legacy live events (ticker — derives from feedEvents)
  liveEvents: TickerMessage[];
  addLiveEvent: (event: TickerMessage) => void;

  // Role
  viewMode: "full" | "analyst";
  setViewMode: (mode: "full" | "analyst") => void;

  // Limits
  maxLiveEvents: number;

  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useBticStore = create<BticState>((set) => ({
  // Navigation
  activeNav: "home",
  setActiveNav: (nav) => set({ activeNav: nav }),

  // Map
  activeMapLayers: ["identity_confidence", "behavior_drift", "credential_theft", "sim_swap", "money_mule", "merchant_intelligence", "campaigns"],
  toggleMapLayer: (layer) =>
    set((state) => ({
      activeMapLayers: state.activeMapLayers.includes(layer)
        ? state.activeMapLayers.filter((l) => l !== layer)
        : [...state.activeMapLayers, layer],
    })),
  selectedHexCell: null,
  setSelectedHexCell: (h3) => set({ selectedHexCell: h3 }),
  mapTimeRange: {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000),
    end: new Date(),
  },
  setMapTimeRange: (range) => set({ mapTimeRange: range }),
  globeView: false,
  toggleGlobeView: () => set((s) => ({ globeView: !s.globeView })),
  mapHexCells: [],
  setMapHexCells: (cells) => set({ mapHexCells: cells }),
  mapConnections: [],
  setMapConnections: (connections) => set({ mapConnections: connections }),

  // Graph
  selectedGraphNode: null,
  setSelectedGraphNode: (id) => set({ selectedGraphNode: id }),
  graphExpansionHop: 1,
  setGraphExpansionHop: (hop) => set({ graphExpansionHop: hop }),

  // Investigation
  investigationContext: null,
  setInvestigationContext: (ctx) => set({ investigationContext: ctx }),

  // Feed-Map correlation
  selectedFeedEvent: null,
  setSelectedFeedEvent: (eventId) => set({ selectedFeedEvent: eventId }),

  // ── Threat Feed ──────────────────────────────────────────────────────────
  feedEvents: [],
  addFeedEvent: (event) =>
    set((state) => ({
      feedEvents: dedupAndPrune(
        [event, ...state.feedEvents],
        MAX_LIVE_EVENTS,
      ),
    })),
  addFeedEvents: (events) =>
    set((state) => ({
      feedEvents: dedupAndPrune(
        [...events, ...state.feedEvents],
        MAX_LIVE_EVENTS,
      ),
    })),
  clearFeed: () => set({ feedEvents: [] }),

  // Feed connection
  feedConnectionStatus: "disconnected",
  setFeedConnectionStatus: (status) => set({ feedConnectionStatus: status }),
  feedPaused: false,
  toggleFeedPaused: () => set((s) => ({ feedPaused: !s.feedPaused })),

  // Feed filters
  feedFilters: DEFAULT_FILTERS,
  setFeedFilters: (filters) =>
    set((s) => ({ feedFilters: { ...s.feedFilters, ...filters } })),
  resetFeedFilters: () => set({ feedFilters: DEFAULT_FILTERS }),

  // Recent threats (map + overview)
  recentThreats: [],
  setRecentThreats: (threats) =>
    set({ recentThreats: dedupAndPrune(threats, MAX_RECENT_THREATS) }),
  addRecentThreat: (threat) =>
    set((state) => ({
      recentThreats: dedupAndPrune(
        [threat, ...state.recentThreats],
        MAX_RECENT_THREATS,
      ),
    })),

  // Legacy live events (ticker)
  liveEvents: [],
  addLiveEvent: (event) =>
    set((state) => ({
      liveEvents: dedupAndPrune(
        [event, ...state.liveEvents],
        MAX_LIVE_EVENTS,
      ),
    })),

  // Role
  viewMode: "full",
  setViewMode: (mode) => set({ viewMode: mode }),

  // Limits
  maxLiveEvents: MAX_LIVE_EVENTS,

  // Command palette
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));

// ── Derived selector: filtered feed events ─────────────────────────────────
export function selectFilteredFeed(state: BticState): ThreatEvent[] {
  const { feedEvents, feedFilters } = state;
  const now = Date.now();
  const timeRangeMs: Record<string, number> = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
  };
  const cutoff = now - (timeRangeMs[feedFilters.timeRange] || 60 * 60 * 1000);

  return feedEvents.filter((e) => {
    // Time range
    if (new Date(e.timestamp).getTime() < cutoff) return false;
    // Severity
    if (
      feedFilters.severities.length > 0 &&
      !feedFilters.severities.includes(e.severity)
    )
      return false;
    // Type
    if (feedFilters.types.length > 0 && !feedFilters.types.includes(e.type))
      return false;
    // Search
    if (feedFilters.search) {
      const q = feedFilters.search.toLowerCase();
      return (
        e.customerHash.toLowerCase().includes(q) ||
        e.sessionId.toLowerCase().includes(q) ||
        e.location.city.toLowerCase().includes(q) ||
        e.location.state.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.details.toLowerCase().includes(q)
      );
    }
    return true;
  });
}
