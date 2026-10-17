import { useState, useMemo, useCallback } from "react";
import {
  Search,
  Filter,
  Pause,
  Play,
  X,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Shield,
  Radio,
  MapPin,
  Clock,
  User,
  ExternalLink,
} from "lucide-react";
import { useBticStore } from "../../../stores/bticStore";
import { useThreatFeed } from "../../../hooks/useThreatFeed";
import { useNavigate } from "react-router-dom";
import type {
  ThreatEvent,
  ThreatSeverity,
  ThreatType,
} from "../../../types/btic";

// ── Constants ──────────────────────────────────────────────────────────────
const SEVERITY_CONFIG: Record<
  ThreatSeverity,
  { color: string; bg: string; icon: React.ReactNode }
> = {
  CRITICAL: {
    color: "#B3261E",
    bg: "rgba(179, 38, 30,0.12)",
    icon: <AlertTriangle size={12} />,
  },
  HIGH: {
    color: "#B7791F",
    bg: "rgba(183, 121, 31,0.12)",
    icon: <AlertTriangle size={12} />,
  },
  MEDIUM: {
    color: "#B8920F",
    bg: "rgba(184, 146, 15,0.10)",
    icon: <Shield size={12} />,
  },
  LOW: {
    color: "#3D8B5A",
    bg: "rgba(61, 139, 90,0.10)",
    icon: <Shield size={12} />,
  },
  INFO: {
    color: "#2C7A91",
    bg: "rgba(44, 122, 145,0.10)",
    icon: <Radio size={12} />,
  },
};

const TYPE_LABELS: Record<ThreatType, string> = {
  SIM_SWAP: "SIM Swap",
  CREDENTIAL_THEFT: "Credential Theft",
  COERCION: "Coercion",
  MONEY_MULE: "Money Mule",
  BEHAVIORAL_ANOMALY: "Behavior Drift",
  MERCHANT_ABUSE: "Merchant Abuse",
  IDENTITY_MISMATCH: "Identity Mismatch",
};

const ALL_SEVERITIES: ThreatSeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
];
const ALL_TYPES: ThreatType[] = [
  "SIM_SWAP",
  "CREDENTIAL_THEFT",
  "COERCION",
  "MONEY_MULE",
  "BEHAVIORAL_ANOMALY",
  "MERCHANT_ABUSE",
  "IDENTITY_MISMATCH",
];
const TIME_RANGES = ["5m", "15m", "1h", "6h", "24h"] as const;

// ── Main Panel ─────────────────────────────────────────────────────────────
export function ThreatFeedPanel() {
  // Start the real-time engine (decoupled from map)
  useThreatFeed({ mockIntervalMs: 2000, enabled: true });

  const navigate = useNavigate();
  const feedEvents = useBticStore((s) => s.feedEvents);
  const feedFilters = useBticStore((s) => s.feedFilters);
  const setFeedFilters = useBticStore((s) => s.setFeedFilters);
  const resetFeedFilters = useBticStore((s) => s.resetFeedFilters);
  const feedPaused = useBticStore((s) => s.feedPaused);
  const toggleFeedPaused = useBticStore((s) => s.toggleFeedPaused);
  const connectionStatus = useBticStore((s) => s.feedConnectionStatus);
  const clearFeed = useBticStore((s) => s.clearFeed);
  const selectedFeedEvent = useBticStore((s) => s.selectedFeedEvent);
  const setSelectedFeedEvent = useBticStore((s) => s.setSelectedFeedEvent);

  const filtered = useMemo(() => {
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
      if (new Date(e.timestamp).getTime() < cutoff) return false;
      if (feedFilters.severities.length > 0 && !feedFilters.severities.includes(e.severity)) return false;
      if (feedFilters.types.length > 0 && !feedFilters.types.includes(e.type)) return false;
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
  }, [feedEvents, feedFilters]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [searchInput, setSearchInput] = useState("");

  // Debounced search
  const handleSearch = useCallback(
    (value: string) => {
      setSearchInput(value);
      setFeedFilters({ search: value });
    },
    [setFeedFilters],
  );

  const hasActiveFilters =
    feedFilters.severities.length > 0 ||
    feedFilters.types.length > 0 ||
    feedFilters.search.length > 0;

  // Stats
  const stats = useMemo(() => {
    const now = Date.now();
    const last5m = feedEvents.filter(
      (e) => now - new Date(e.timestamp).getTime() < 5 * 60 * 1000,
    );
    return {
      total: last5m.length,
      critical: last5m.filter((e) => e.severity === "CRITICAL").length,
      high: last5m.filter((e) => e.severity === "HIGH").length,
      blocked: last5m.filter((e) => e.decision === "HARD_BLOCK").length,
    };
  }, [feedEvents]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid #EAE4E1",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3
              style={{
                fontFamily: "'Newsreader', Georgia, serif",
                fontSize: 22,
                fontWeight: 400,
                color: "#100F0F",
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              Threat feed
            </h3>
            <ConnectionBadge status={connectionStatus} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <FeedButton
              onClick={toggleFeedPaused}
              title={feedPaused ? "Resume" : "Pause"}
            >
              {feedPaused ? <Play size={12} /> : <Pause size={12} />}
            </FeedButton>
            <FeedButton
              onClick={() => setShowFilters(!showFilters)}
              active={showFilters || hasActiveFilters}
              title="Filters"
            >
              <Filter size={12} />
              {hasActiveFilters && (
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "#B7791F",
                    position: "absolute",
                    top: -2,
                    right: -2,
                  }}
                />
              )}
            </FeedButton>
            <FeedButton onClick={clearFeed} title="Clear">
              <X size={12} />
            </FeedButton>
          </div>
        </div>

        {/* ── Search ──────────────────────────────────────────────────────── */}
        <div style={{ position: "relative" }}>
          <Search
            size={13}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#969290",
            }}
          />
          <input
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search hash, session, city, type..."
            style={{
              width: "100%",
              padding: "7px 10px 7px 30px",
              borderRadius: 8,
              border: "1px solid #EAE4E1",
              background: "#FFFFFF",
              color: "#100F0F",
              fontSize: 12.5,
              fontFamily: "'DM Mono', monospace",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* ── Filter Bar ─────────────────────────────────────────────────── */}
        {showFilters && (
          <FilterBar
            filters={feedFilters}
            onFilterChange={setFeedFilters}
            onReset={resetFeedFilters}
          />
        )}
      </div>

      {/* ── Stats Strip ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 12,
          padding: "8px 18px",
          borderBottom: "1px solid #EAE4E1",
          flexShrink: 0,
        }}
      >
        <MiniStat label="5m" value={String(stats.total)} />
        <MiniStat label="CRIT" value={String(stats.critical)} color="#B3261E" />
        <MiniStat label="HIGH" value={String(stats.high)} color="#B7791F" />
        <MiniStat
          label="BLOCK"
          value={String(stats.blocked)}
          color="#B3261E"
        />
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 11,
            color: "#969290",
            fontFamily: "'DM Mono', monospace",
            alignSelf: "center",
          }}
        >
          {filtered.length} shown
        </span>
      </div>

      {/* ── Event List ───────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 0",
        }}
      >
        {filtered.length === 0 && (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: "#969290",
              fontSize: 13.5,
            }}
          >
            {feedPaused ? (
              <div>
                <Pause
                  size={20}
                  style={{ margin: "0 auto 8px", opacity: 0.4 }}
                />
                <div>Feed paused</div>
              </div>
            ) : feedEvents.length === 0 ? (
              "Waiting for events..."
            ) : (
              "No events match filters"
            )}
          </div>
        )}
        {filtered.map((event) => (
          <FeedEventItem
            key={event.id}
            event={event}
            isExpanded={expandedId === event.id}
            isSelected={selectedFeedEvent === event.id}
            onToggle={() =>
              setExpandedId(expandedId === event.id ? null : event.id)
            }
            onSelect={() =>
              setSelectedFeedEvent(selectedFeedEvent === event.id ? null : event.id)
            }
            onInvestigate={() =>
              navigate("/admin/investigate", {
                state: { customerHash: event.customerHash },
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

// ── FeedEventItem ──────────────────────────────────────────────────────────
function FeedEventItem({
  event,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onInvestigate,
}: {
  event: ThreatEvent;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onInvestigate: () => void;
}) {
  const sev = SEVERITY_CONFIG[event.severity];
  const time = formatTimeAgo(event.timestamp);

  return (
    <div
      onClick={(e) => {
        onToggle();
        onSelect();
      }}
      style={{
        padding: "10px 18px",
        borderBottom: "1px solid #EAE4E1",
        cursor: "pointer",
        transition: "background 0.15s",
        background: isSelected
          ? "rgba(44, 122, 145,0.08)"
          : isExpanded
            ? "rgba(16, 15, 15,0.03)"
            : "transparent",
        borderLeft: isSelected ? "2px solid #2C7A91" : "2px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (!isExpanded) e.currentTarget.style.background = "rgba(16, 15, 15,0.02)";
      }}
      onMouseLeave={(e) => {
        if (!isExpanded && !isSelected) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Severity indicator */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: sev.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: sev.color,
            flexShrink: 0,
          }}
        >
          {sev.icon}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 2,
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "#100F0F",
                fontFamily: "'Inter', sans-serif",
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {TYPE_LABELS[event.type]}
            </span>
            <span
              style={{
                fontSize: 11.5,
                padding: "2px 6px",
                borderRadius: 5,
                background: sev.bg,
                color: sev.color,
                fontWeight: 500,
                fontFamily: "'DM Mono', monospace",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {event.severity}
            </span>
            <span
              style={{
                fontSize: 11.5,
                padding: "2px 6px",
                borderRadius: 5,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                background:
                  event.decision === "HARD_BLOCK"
                    ? "rgba(179, 38, 30,0.15)"
                    : event.decision === "STEP_UP"
                      ? "rgba(183, 121, 31,0.12)"
                      : "rgba(61, 139, 90,0.10)",
                color:
                  event.decision === "HARD_BLOCK"
                    ? "#B3261E"
                    : event.decision === "STEP_UP"
                      ? "#B7791F"
                      : "#3D8B5A",
                fontFamily: "'DM Mono', monospace",
                fontWeight: 500,
              }}
            >
              {event.decision.replace(/_/g, " ")}
            </span>
          </div>
          <div
            style={{
              fontSize: 13.5,
              color: "#767270",
              fontFamily: "'Inter', sans-serif",
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 3,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <MapPin size={11} />
              {event.location.city}
            </span>
            <span style={{ color: "#D7D2D0" }}>·</span>
            <span>{time}</span>
            <span style={{ color: "#D7D2D0" }}>·</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12.5, color: event.riskScore >= 600 ? "#B3261E" : event.riskScore >= 300 ? "#B7791F" : "#3D8B5A" }}>
              {event.riskScore.toFixed(0)}
              <span style={{ color: "#969290" }}> risk</span>
            </span>
          </div>
        </div>

        {/* Expand arrow */}
        <div style={{ color: "#969290", flexShrink: 0 }}>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(255, 255, 255,0.3)",
            border: "1px solid #EAE4E1",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <DetailRow label="Customer" value={event.customerHash.slice(0, 16) + "..."} />
            <DetailRow label="Session" value={event.sessionId.slice(0, 12) + "..."} />
            <DetailRow label="Channel" value={event.channel} />
            <DetailRow label="Pathway" value={event.pathway} />
            <DetailRow
              label="Confidence"
              value={`${(event.confidence * 100).toFixed(0)}%`}
            />
            <DetailRow label="Time" value={new Date(event.timestamp).toLocaleTimeString()} />
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "#767270",
              lineHeight: 1.5,
              marginBottom: 8,
            }}
          >
            {event.details}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInvestigate();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid #D7D2D0",
              background: "rgba(16, 15, 15,0.04)",
              color: "var(--color-primary)",
              fontSize: 11.5,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            <ExternalLink size={10} />
            Investigate
          </button>
        </div>
      )}
    </div>
  );
}

// ── FilterBar ──────────────────────────────────────────────────────────────
function FilterBar({
  filters,
  onFilterChange,
  onReset,
}: {
  filters: { severities: ThreatSeverity[]; types: ThreatType[]; timeRange: "5m" | "15m" | "1h" | "6h" | "24h" };
  onFilterChange: (f: Partial<typeof filters>) => void;
  onReset: () => void;
}) {
  const toggleSeverity = (s: ThreatSeverity) => {
    const next = filters.severities.includes(s)
      ? filters.severities.filter((x) => x !== s)
      : [...filters.severities, s];
    onFilterChange({ severities: next });
  };

  const toggleType = (t: ThreatType) => {
    const next = filters.types.includes(t)
      ? filters.types.filter((x) => x !== t)
      : [...filters.types, t];
    onFilterChange({ types: next });
  };

  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(255, 255, 255,0.25)",
        border: "1px solid #EAE4E1",
      }}
    >
      {/* Time range */}
      <div style={{ marginBottom: 10 }}>
        <FilterLabel>Time Range</FilterLabel>
        <div style={{ display: "flex", gap: 4 }}>
          {TIME_RANGES.map((tr) => (
            <button
              key={tr}
              onClick={() => onFilterChange({ timeRange: tr })}
              style={{
                padding: "3px 8px",
                borderRadius: 4,
                border: "none",
                background:
                  filters.timeRange === tr
                    ? "rgba(16, 15, 15,0.12)"
                    : "transparent",
                color:
                  filters.timeRange === tr
                    ? "#100F0F"
                    : "rgba(20, 19, 19,0.35)",
                fontSize: 11.5,
                fontFamily: "'DM Mono', monospace",
                cursor: "pointer",
              }}
            >
              {tr}
            </button>
          ))}
        </div>
      </div>

      {/* Severity */}
      <div style={{ marginBottom: 10 }}>
        <FilterLabel>Severity</FilterLabel>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {ALL_SEVERITIES.map((s) => {
            const active = filters.severities.includes(s);
            const cfg = SEVERITY_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => toggleSeverity(s)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  border: active ? `1px solid ${cfg.color}40` : "1px solid rgba(16, 15, 15,0.06)",
                  background: active ? cfg.bg : "transparent",
                  color: active ? cfg.color : "#969290",
                  fontSize: 11.5,
                  fontFamily: "'DM Mono', monospace",
                  cursor: "pointer",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Type */}
      <div style={{ marginBottom: 8 }}>
        <FilterLabel>Threat Type</FilterLabel>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {ALL_TYPES.map((t) => {
            const active = filters.types.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  border: active
                    ? "1px solid rgba(16, 15, 15,0.2)"
                    : "1px solid rgba(16, 15, 15,0.06)",
                  background: active ? "rgba(16, 15, 15,0.08)" : "transparent",
                  color: active
                    ? "#100F0F"
                    : "rgba(20, 19, 19,0.35)",
                  fontSize: 11,
                  fontFamily: "'DM Mono', monospace",
                  cursor: "pointer",
                }}
              >
                {TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Reset */}
      {(filters.severities.length > 0 || filters.types.length > 0) && (
        <button
          onClick={onReset}
          style={{
            padding: "4px 10px",
            borderRadius: 4,
            border: "1px solid rgba(179, 38, 30,0.2)",
            background: "rgba(179, 38, 30,0.08)",
            color: "#B3261E",
            fontSize: 11.5,
            cursor: "pointer",
            fontFamily: "'DM Mono', monospace",
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────
function ConnectionBadge({
  status,
}: {
  status: "connecting" | "connected" | "mock" | "disconnected";
}) {
  const config = {
    connecting: { color: "#B8920F", label: "CONNECTING", pulse: true },
    connected: { color: "#3D8B5A", label: "LIVE SSE", pulse: true },
    mock: { color: "#706C69", label: "MOCK", pulse: false },
    disconnected: { color: "#B3261E", label: "OFFLINE", pulse: false },
  }[status];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 7px",
        borderRadius: 4,
        background: `${config.color}12`,
        border: `1px solid ${config.color}25`,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: config.color,
          boxShadow: config.pulse ? `0 0 4px ${config.color}80` : "none",
        }}
      />
      <span
        style={{
          fontSize: 10,
          color: config.color,
          fontFamily: "'DM Mono', monospace",
          fontWeight: 600,
          letterSpacing: "0.05em",
        }}
      >
        {config.label}
      </span>
    </div>
  );
}

function FeedButton({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 26,
        height: 26,
        borderRadius: 6,
        border: `1px solid ${active ? "rgba(16, 15, 15,0.15)" : "rgba(16, 15, 15,0.06)"}`,
        background: active ? "rgba(16, 15, 15,0.08)" : "transparent",
        color: active ? "#100F0F" : "#767270",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 13.5,
          fontWeight: 700,
          color: color || "#100F0F",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 10,
          color: "#969290",
          fontFamily: "'DM Mono', monospace",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: "#969290",
        fontFamily: "'DM Mono', monospace",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        marginBottom: 5,
      }}
    >
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: "#969290",
          fontFamily: "'DM Mono', monospace",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 1,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "#575452",
          fontFamily: "'DM Mono', monospace",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
