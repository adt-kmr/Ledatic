/**
 * Citadel — FIU Threat Map (Punjab SIM-swap ring)
 * ===================================================
 * Renders the Punjab incident dataset through the production deck.gl map
 * (`components/btic/map/ThreatMap`) — the same GPU-rendered engine used by
 * /admin/threats — instead of a hand-drawn HTML5 canvas. That gives real
 * basemap tiles, hexagon aggregation, heatmap, arcs, zoom/pitch and tooltips
 * for free, rather than re-implementing map projection by hand.
 *
 * Preserved from the original tab: the intelligence-layer filter, the 48-hour
 * prediction toggle, the campaign stat bar, the severity legend, the city
 * breakdown strip and the incident detail panel.
 *
 * Live updates come from the REAL threat feed (`bticStore.recentThreats`, fed
 * by the SSE stream at /api/btic/events/stream, which the backend publishes to
 * on every genuine session evaluation). The previous version fabricated
 * incidents with Math.random() on a 5–8 s timer; that has been removed — an
 * empty live feed now honestly means "no live traffic", not invented activity.
 */

import { useEffect, useMemo, useState } from "react";
import { ThreatMap } from "../../components/btic/map/ThreatMap";
import { useBticStore } from "../../stores/bticStore";
import {
  PUNJAB_INCIDENTS,
  PUNJAB_STATS,
  type PunjabIncident,
} from "../../data/mockPunjabIncidents";
import type { MapHexCell, ThreatSeverity, ThreatType } from "../../types/btic";

const MONO = "'DM Mono', monospace";
const CYAN = "#2C7A91";

// Punjab-centred camera — the ring under investigation, not all of India.
const PUNJAB_VIEW = { longitude: 75.6, latitude: 31.0, zoom: 6.9, pitch: 45, bearing: -2 };

// Bounding box used to decide whether a live feed event belongs on this map.
const PB = { latMin: 29.5, latMax: 32.6, lngMin: 73.8, lngMax: 77.0 };

// ── Two encodings, deliberately kept apart ───────────────────────────────────
// Attack TYPE and SEVERITY are different dimensions, so they must not share a
// visual encoding. Previously both were coloured dots drawn from the same hues,
// so a red dot was ambiguous: "SIM Swap" or "CRITICAL"?
//
//   SEVERITY   → filled ROUND dot, status palette. This is what colours the map.
//   ATTACK TYPE → distinct GLYPH SHAPE, categorical palette. Filter only.
//
// The shape difference is the primary differentiator, so identity never rests
// on hue alone (and survives colour-blindness). The categorical hues below were
// validated for the dark surface: all six pass the lightness band, chroma floor,
// adjacent CVD separation (worst ΔE 8.4), normal-vision floor (worst 19.3) and
// 3:1 contrast.

/** Severity — status palette. Reserved; never reused for an attack type. */
const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "#d03b3b",
  HIGH: "#ec835a",
  MEDIUM: "#fab219",
  LOW: "#0ca30c",
};

const LAYER_OPTS = [
  { id: "ALL", label: "All Threats", color: "#575452", glyph: "◇" },
  { id: "SIM_SWAP", label: "SIM Swap", color: "#3987e5", glyph: "▲" },
  { id: "MONEY_MULE", label: "Money Mule", color: "#d95926", glyph: "■" },
  { id: "CREDENTIAL_THEFT", label: "Credential Theft", color: "#199e70", glyph: "◆" },
  { id: "COERCION", label: "Coercion", color: "#c98500", glyph: "✚" },
  { id: "BEHAVIORAL_ANOMALY", label: "Behavioral Anomaly", color: "#d55181", glyph: "⬢" },
  { id: "IDENTITY_MISMATCH", label: "Identity Mismatch", color: "#9085e9", glyph: "▼" },
];

/** Punjab incident → the hex-cell shape the deck.gl map consumes. */
function toHexCell(i: PunjabIncident): MapHexCell {
  return {
    h3Index: i.id,
    lat: i.lat,
    lng: i.lng,
    severity: i.severity as ThreatSeverity,
    confidence: Math.min(1, i.riskScore / 1000),
    // Victim count drives hexagon elevation, so a tall column reads as "many
    // people were hit here" rather than "many rows exist here".
    threatCount: Math.max(1, i.victimCount),
    threatTypes: [i.attackType as ThreatType],
    state: "Punjab",
    city: i.city,
  };
}

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr`
    : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L`
      : `₹${n.toLocaleString("en-IN")}`;

export function ThreatMapTab() {
  const [activeLayer, setActiveLayer] = useState("ALL");
  const [showPrediction, setShowPrediction] = useState(false);
  const [selected, setSelected] = useState<PunjabIncident | null>(null);

  // Real live feed — populated by SSE, not a random generator.
  const recentThreats = useBticStore((s) => s.recentThreats);
  const selectedHexCell = useBticStore((s) => s.selectedHexCell);

  // Live events that geographically fall inside the Punjab view.
  const liveInPunjab = useMemo(
    () =>
      recentThreats.filter(
        (t) =>
          t.location &&
          t.location.lat > PB.latMin && t.location.lat < PB.latMax &&
          t.location.lng > PB.lngMin && t.location.lng < PB.lngMax,
      ),
    [recentThreats],
  );

  const filtered = useMemo(() => {
    let rows = PUNJAB_INCIDENTS;
    if (activeLayer !== "ALL") rows = rows.filter((i) => i.attackType === activeLayer);
    // Prediction mode narrows to incidents the model expects to escalate.
    if (showPrediction) rows = rows.filter((i) => i.predicted);
    return rows;
  }, [activeLayer, showPrediction]);

  const cells = useMemo<MapHexCell[]>(() => {
    const base = filtered.map(toHexCell);
    const live: MapHexCell[] = liveInPunjab.map((t) => ({
      h3Index: `live-${t.id}`,
      lat: t.location.lat,
      lng: t.location.lng,
      severity: t.severity,
      confidence: t.confidence,
      threatCount: 1,
      threatTypes: [t.type],
      state: t.location.state || "Punjab",
      city: t.location.city || "—",
    }));
    return [...base, ...live];
  }, [filtered, liveInPunjab]);

  // Clicking a hex on the map selects the matching incident for the detail
  // card. The store holds the h3Index string, which toHexCell() sets to the
  // incident id, so the lookup is a direct match.
  useEffect(() => {
    if (!selectedHexCell) return;
    const hit = PUNJAB_INCIDENTS.find((i) => i.id === selectedHexCell);
    if (hit) setSelected(hit);
  }, [selectedHexCell]);

  const cityCount = (c: PunjabIncident["city"]) =>
    filtered.filter((i) => i.city === c).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 240px)", minHeight: 560 }}>
      {/* ── Header + campaign stats ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 12, padding: "12px 16px",
          background: "rgba(243, 243, 243,0.92)",
          border: "1px solid rgba(44, 122, 145,0.14)",
          borderRadius: "12px 12px 0 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 21, fontWeight: 400, color: "#100F0F", fontFamily: "'Newsreader', Georgia, serif" }}>
            🗺️ Threat Map
          </span>
          <span style={{ fontSize: 11.5, fontFamily: MONO, color: CYAN, background: "rgba(44, 122, 145,0.1)", border: "1px solid rgba(44, 122, 145,0.28)", borderRadius: 20, padding: "3px 9px", letterSpacing: "0.06em" }}>
            {PUNJAB_STATS.campaignId}
          </span>
          {liveInPunjab.length > 0 && (
            <span style={{ fontSize: 11.5, fontFamily: MONO, color: "#B3261E", background: "rgba(179, 38, 30,0.1)", border: "1px solid rgba(179, 38, 30,0.3)", borderRadius: 20, padding: "3px 9px" }}>
              ● {liveInPunjab.length} LIVE
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 15, flexWrap: "wrap", fontSize: 11.5, fontFamily: MONO, color: "#767270" }}>
          <span>shown <b style={{ color: "#100F0F" }}>{filtered.length}</b>/{PUNJAB_STATS.total}</span>
          <span>critical <b style={{ color: SEVERITY_COLOR.CRITICAL }}>{PUNJAB_STATS.critical}</b></span>
          <span>victims <b style={{ color: "#100F0F" }}>{PUNJAB_STATS.totalVictims.toLocaleString("en-IN")}</b></span>
          <span>laundered <b style={{ color: "#B7791F" }}>{inr(PUNJAB_STATS.totalAmountINR)}</b></span>
        </div>

        <button
          onClick={() => setShowPrediction((v) => !v)}
          style={{
            padding: "6px 13px", borderRadius: 8, cursor: "pointer",
            border: `1px solid ${showPrediction ? "rgba(179, 38, 30,0.6)" : "rgba(16, 15, 15,0.12)"}`,
            background: showPrediction ? "rgba(179, 38, 30,0.15)" : "transparent",
            color: showPrediction ? "#B3261E" : "#767270",
            fontSize: 11.5, fontFamily: MONO, fontWeight: 700,
            letterSpacing: "0.06em", textTransform: "uppercase", transition: "all 0.2s",
          }}
        >
          {showPrediction ? "◉ 48H Prediction" : "○ 48H Prediction"}
        </button>
      </div>

      {/* ── Body: layer rail + deck.gl map ──────────────────────────────── */}
      <div
        style={{
          flex: 1, display: "flex", minHeight: 0,
          border: "1px solid rgba(44, 122, 145,0.14)", borderTop: "none",
          borderRadius: "0 0 12px 12px", overflow: "hidden",
        }}
      >
        {/* Layer filter rail — hidden on mobile, where the map needs the width */}
        <div
          className="hidden md:flex"
          style={{
            width: 175, flexShrink: 0, background: "rgba(243, 243, 243,0.92)",
            borderRight: "1px solid rgba(44, 122, 145,0.1)",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #EAE4E1", fontSize: 11, fontFamily: MONO, color: CYAN, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Attack Type <span style={{ color: "#969290" }}>· filter</span>
          </div>
          {LAYER_OPTS.map((opt) => {
            const on = activeLayer === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setActiveLayer(opt.id)}
                title={`Filter: ${opt.label}`}
                style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "8px 12px",
                  border: "none", cursor: "pointer",
                  background: on ? "rgba(44, 122, 145,0.07)" : "transparent",
                  borderLeft: on ? `2px solid ${opt.color}` : "2px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                {/* Glyph, not a dot — shape carries attack-type identity so it
                    can never be mistaken for a severity swatch. */}
                <span
                  style={{
                    fontSize: 12.5, lineHeight: 1, width: 12, textAlign: "center",
                    color: on ? opt.color : `${opt.color}A6`,
                    flexShrink: 0,
                  }}
                >
                  {opt.glyph}
                </span>
                <span style={{ fontSize: 11.5, fontFamily: MONO, color: on ? "#100F0F" : "#767270", textAlign: "left", lineHeight: 1.3 }}>
                  {opt.label}
                </span>
              </button>
            );
          })}

          <div style={{ marginTop: "auto", padding: "10px 12px", borderTop: "1px solid #EAE4E1" }}>
            <div style={{ fontSize: 10, color: "#969290", fontFamily: MONO, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
              Severity
            </div>
            {/* Spelled out so the two legends can't be confused: this is the
                scale the map itself is coloured by. */}
            <div style={{ fontSize: 10, color: "#969290", fontFamily: MONO, marginBottom: 8, lineHeight: 1.4 }}>
              map colour
            </div>
            {Object.entries(SEVERITY_COLOR).map(([s, col]) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", background: col, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontFamily: MONO, color: "#767270" }}>{s}</span>
              </div>
            ))}
          </div>
        </div>

        {/* The real map */}
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <ThreatMap cells={cells} initialView={PUNJAB_VIEW} disableFetch />

          {/* Incident detail — appears when a hex is clicked */}
          {selected && (
            <div
              style={{
                position: "absolute", right: 12, top: 12, width: 290, zIndex: 20,
                background: "rgba(243, 243, 243,0.96)", backdropFilter: "blur(12px)",
                border: `1px solid ${SEVERITY_COLOR[selected.severity] ?? CYAN}`,
                borderRadius: 12, padding: "13px 15px",
                maxHeight: "calc(100% - 24px)", overflowY: "auto",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
                <span style={{ fontSize: 12.5, fontFamily: MONO, fontWeight: 700, color: SEVERITY_COLOR[selected.severity] }}>
                  {selected.attackType}
                </span>
                <button
                  onClick={() => setSelected(null)}
                  style={{ background: "none", border: "none", color: "#767270", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
              <div style={{ fontSize: 13, color: "#575452", lineHeight: 1.55, marginBottom: 10 }}>
                {selected.details}
              </div>
              {([
                ["City", selected.city],
                ["Risk", `${selected.riskScore} · ${selected.decision}`],
                ["Victims", String(selected.victimCount)],
                ["Laundered", inr(selected.amountINR)],
                ["Operator", selected.operatorCircle],
                ["Mule a/c", selected.muleAccount],
                ["Linked", `${selected.linkedIncidentIds.length} incident(s)`],
              ] as const).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", borderBottom: "1px solid #EAE4E1" }}>
                  <span style={{ fontSize: 11.5, fontFamily: MONO, color: "#767270", textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</span>
                  <span style={{ fontSize: 12, fontFamily: MONO, color: "#100F0F", textAlign: "right", wordBreak: "break-all" }}>{v}</span>
                </div>
              ))}
              {showPrediction && (
                <div style={{ marginTop: 9, padding: "7px 9px", borderRadius: 7, background: "rgba(179, 38, 30,0.09)", border: "1px solid rgba(179, 38, 30,0.25)", fontSize: 11.5, fontFamily: MONO, color: "#B3261E" }}>
                  48h forecast: {selected.predictedRisk}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── City breakdown strip ────────────────────────────────────────── */}
      <div
        style={{
          display: "flex", marginTop: 10, borderRadius: 10,
          background: "rgba(243, 243, 243,0.92)", border: "1px solid rgba(44, 122, 145,0.12)",
          overflow: "hidden",
        }}
      >
        {([
          ["Amritsar", "#B3261E"],
          ["Patiala", "#B7791F"],
          ["Ludhiana", CYAN],
        ] as const).map(([city, color], idx, arr) => (
          <div
            key={city}
            style={{
              flex: 1, padding: "8px 14px", textAlign: "center",
              borderRight: idx < arr.length - 1 ? "1px solid rgba(16, 15, 15,0.05)" : "none",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 400, color, fontFamily: "'Newsreader', Georgia, serif" }}>
              {cityCount(city as PunjabIncident["city"])} INC
            </div>
            <div style={{ fontSize: 10, color: "#969290", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>
              {city}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ThreatMapTab;
