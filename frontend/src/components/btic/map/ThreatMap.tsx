import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import DeckGL from "@deck.gl/react";
import { ArcLayer, ScatterplotLayer, IconLayer } from "@deck.gl/layers";
import { HexagonLayer, HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { MapViewState } from "@deck.gl/core";
import { useBticStore } from "../../../stores/bticStore";
import { useMapRealTime } from "../../../hooks/useMapRealTime";
import { useMapData } from "../../../hooks/useMapData";
import { MapTooltip } from "./MapTooltip";
import { FeedTooltip } from "./FeedTooltip";
import { MapOverlay } from "./MapOverlay";
import { RegionSidebar } from "./RegionSidebar";
import type { MapHexCell, MapLayer, ThreatEvent } from "../../../types/btic";

// ── Severity → RGBA color ─────────────────────────────────────────────────
const SEVERITY_COLOR: Record<string, [number, number, number, number]> = {
  CRITICAL: [255, 69, 58, 230],
  HIGH: [255, 159, 10, 210],
  MEDIUM: [255, 214, 10, 190],
  LOW: [48, 209, 88, 170],
  INFO: [100, 210, 255, 150],
};

function severityColor(s: string): [number, number, number, number] {
  return SEVERITY_COLOR[s] || [142, 142, 147, 130];
}

// ── Layer filter ───────────────────────────────────────────────────────────
function matchesLayer(cell: MapHexCell, layers: MapLayer[]): boolean {
  if (layers.length === 0) return true;
  for (const layer of layers) {
    switch (layer) {
      case "identity_confidence":
        return true;
      case "behavior_drift":
        if (cell.threatTypes.includes("BEHAVIORAL_ANOMALY")) return true;
        break;
      case "credential_theft":
        if (cell.threatTypes.includes("CREDENTIAL_THEFT")) return true;
        break;
      case "sim_swap":
        if (cell.threatTypes.includes("SIM_SWAP")) return true;
        break;
      case "money_mule":
        if (cell.threatTypes.includes("MONEY_MULE")) return true;
        break;
      case "merchant_intelligence":
        if (cell.threatTypes.includes("MERCHANT_ABUSE")) return true;
        break;
      case "campaigns":
        if (cell.severity === "CRITICAL" || cell.severity === "HIGH")
          return true;
        break;
    }
  }
  return layers.includes("identity_confidence");
}

// ── Initial viewport ───────────────────────────────────────────────────────
const INITIAL_VIEW: MapViewState = {
  longitude: 78.9,
  latitude: 22.5,
  zoom: 4.4,
  pitch: 48,
  bearing: -2,
};

const MAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

interface TooltipInfo {
  x: number;
  y: number;
  cell: MapHexCell;
}

interface FeedTooltipInfo {
  x: number;
  y: number;
  event: ThreatEvent;
}

export interface ThreatMapProps {
  /**
   * Render these cells instead of the store's live BTIC feed.
   * Used by the FIU Threat Map tab to plot Punjab incident data through the
   * same deck.gl renderer. Omit for the default all-India live behaviour —
   * /admin/threats passes nothing and is unaffected.
   */
  cells?: MapHexCell[];
  /** Camera override, e.g. to centre on a single state. */
  initialView?: Partial<MapViewState>;
  /** Skip the backend hex fetch when cells are supplied externally. */
  disableFetch?: boolean;
}

export function ThreatMap({ cells, initialView, disableFetch }: ThreatMapProps = {}) {
  const activeMapLayers = useBticStore((s) => s.activeMapLayers);
  const selectedHexCell = useBticStore((s) => s.selectedHexCell);
  const setSelectedHexCell = useBticStore((s) => s.setSelectedHexCell);
  const recentThreats = useBticStore((s) => s.recentThreats);
  const globeView = useBticStore((s) => s.globeView);
  const storeHexCells = useBticStore((s) => s.mapHexCells);
  // Externally-supplied cells win over the store so a caller can scope the map
  // to its own dataset without mutating shared BTIC state.
  const mapHexCells = cells ?? storeHexCells;
  const mapConnections = useBticStore((s) => s.mapConnections);
  const selectedFeedEvent = useBticStore((s) => s.selectedFeedEvent);
  const setSelectedFeedEvent = useBticStore((s) => s.setSelectedFeedEvent);

  const [viewState, setViewState] = useState<MapViewState>({ ...INITIAL_VIEW, ...initialView });
  const [hoverInfo, setHoverInfo] = useState<TooltipInfo | null>(null);
  const [feedHoverInfo, setFeedHoverInfo] = useState<FeedTooltipInfo | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  // Animation clock (0..1 saw-tooth) that drives the pulsing rings around
  // live threat points so each incoming feed event visibly "lands" on the map.
  const [pulsePhase, setPulsePhase] = useState(0);
  const deckRef = useRef<any>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      // ~1.6s period saw-tooth
      setPulsePhase((Date.now() % 1600) / 1600);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Fetch real map data from backend (falls back to mock). Skipped when the
  // caller supplies its own cells, so the fetch cannot overwrite them.
  useMapData({ hours: 24, enabled: !disableFetch });

  const { isLive, toggleLive, eventCount, connectionType } = useMapRealTime({
    intervalMs: 1500,
    enabled: true,
  });

  // Cinematic camera descent on load
  useEffect(() => {
    const timer = setTimeout(() => {
      setViewState({
        longitude: 78.9,
        latitude: 22.5,
        zoom: 4.6,
        pitch: 42,
        bearing: -5,
        transitionDuration: 2800,
      });
      setIsLoaded(true);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  // Filter cells by active layers
  const visibleCells = useMemo(
    () => mapHexCells.filter((c) => matchesLayer(c, activeMapLayers)),
    [mapHexCells, activeMapLayers],
  );

  // Hex data for DeckGL HexagonLayer (aggregated from feed events)
  const hexData = useMemo(
    () =>
      recentThreats.map((t) => ({
        position: [t.location.lng, t.location.lat] as [number, number],
        color: severityColor(t.severity),
        elevation: t.riskScore * 0.1,
        weight: t.riskScore,
      })),
    [recentThreats],
  );

  // Arc data for DeckGL ArcLayer (connections between cells)
  const arcData = useMemo(
    () =>
      mapConnections.map((conn) => ({
        source: [conn.source.lng, conn.source.lat] as [number, number],
        target: [conn.target.lng, conn.target.lat] as [number, number],
        sourceColor: severityColor(
          conn.type === "SIM_SWAP"
            ? "CRITICAL"
            : conn.type === "CREDENTIAL_THEFT"
              ? "HIGH"
              : "MEDIUM",
        ),
        targetColor: severityColor("INFO"),
        width: 1 + conn.confidence * 2,
      })),
    [mapConnections],
  );

  // Scatter data for pulse effects — stable reference (no Math.random in render)
  const pulseData = useMemo(() => {
    // More static pulses from critical cells
    const staticPulses = visibleCells
      .filter((c) => c.severity === "CRITICAL" || c.severity === "HIGH")
      .slice(0, 50)
      .map((c) => ({
        position: [c.lng, c.lat] as [number, number],
        color: severityColor(c.severity),
        radius: 25000 + c.threatCount * 6000,
      }));

    // More dynamic pulses from recent threats
    const dynamicPulses = recentThreats.slice(0, 25).map((t, i) => ({
      position: [t.location.lng, t.location.lat] as [number, number],
      color: severityColor(t.severity),
      radius: 12000 + (i % 8) * 3500,
    }));

    return [...staticPulses, ...dynamicPulses];
  }, [visibleCells, recentThreats]);

  // Heatmap data for the heatmap layer (from feed events)
  const heatmapData = useMemo(
    () =>
      recentThreats.map((t) => ({
        position: [t.location.lng, t.location.lat] as [number, number],
        weight: t.riskScore,
      })),
    [recentThreats],
  );

  // Feed event dots data
  const feedDotsData = useMemo(
    () =>
      recentThreats.map((t) => ({
        position: [t.location.lng, t.location.lat] as [number, number],
        color: severityColor(t.severity),
        radius: 800 + t.riskScore * 0.05,
        id: t.id,
      })),
    [recentThreats],
  );

  // Selected feed event highlight
  const selectedDotData = useMemo(() => {
    if (!selectedFeedEvent) return [];
    const event = recentThreats.find((t) => t.id === selectedFeedEvent);
    if (!event) return [];
    return [{
      position: [event.location.lng, event.location.lat] as [number, number],
      color: [255, 255, 255, 255] as [number, number, number, number],
      radius: 1500,
    }];
  }, [selectedFeedEvent, recentThreats]);

  // DeckGL layers
  const layers = useMemo(() => {
    const result: any[] = [];

    // ── Hexagon Layer (3D Threat Towers) ────────────────────────────────
    result.push(
      new HexagonLayer({
        id: "hex-layer",
        data: hexData,
        getPosition: (d: any) => d.position,
        getElevationWeight: (d: any) => d.weight,
        getColorWeight: (d: any) => d.weight,
        elevationScale: 1.2,
        extruded: true,
        radius: 22000,
        upperPercentile: 95,
        coverage: 0.88,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 40],
        material: {
          ambient: 0.64,
          diffuse: 0.6,
          shininess: 32,
          specularColor: [51, 51, 51],
        },
        colorRange: [
          [30, 144, 255, 180],
          [48, 209, 88, 190],
          [255, 214, 10, 200],
          [255, 159, 10, 220],
          [255, 69, 58, 240],
        ],
        onHover: (info: any) => {
          if (info.object) {
            const hex = info.object;
            const cell = visibleCells.find(
              (c) =>
                Math.abs(c.lat - (hex.position?.[1] || 0)) < 0.5 &&
                Math.abs(c.lng - (hex.position?.[0] || 0)) < 0.5,
            );
            if (cell) setHoverInfo({ x: info.x, y: info.y, cell });
          } else {
            setHoverInfo(null);
          }
          return false;
        },
        onClick: (info: any) => {
          if (info.object) {
            const hex = info.object;
            const cell = visibleCells.find(
              (c) =>
                Math.abs(c.lat - (hex.position?.[1] || 0)) < 0.5 &&
                Math.abs(c.lng - (hex.position?.[0] || 0)) < 0.5,
            );
            if (cell) {
              setSelectedHexCell(
                selectedHexCell === cell.h3Index ? null : cell.h3Index,
              );
            }
          }
          return false;
        },
      }),
    );

    // ── Arc Layer (Connection Lines) ────────────────────────────────────
    if (arcData.length > 0) {
      result.push(
        new ArcLayer({
          id: "arc-layer",
          data: arcData,
          getSourcePosition: (d: any) => d.source,
          getTargetPosition: (d: any) => d.target,
          getSourceColor: (d: any) => d.sourceColor,
          getTargetColor: (d: any) => d.targetColor,
          getWidth: (d: any) => d.width,
          greatCircle: true,
          pickable: false,
          opacity: 0.45,
        }),
      );
    }

    // ── Scatterplot Layer (Pulse Rings) ─────────────────────────────────
    if (pulseData.length > 0) {
      result.push(
        new ScatterplotLayer({
          id: "pulse-layer",
          data: pulseData,
          getPosition: (d: any) => d.position,
          getFillColor: (d: any) => d.color,
          getRadius: (d: any) => d.radius,
          radiusMinPixels: 2,
          radiusMaxPixels: 35,
          opacity: 0.25,
          filled: true,
          stroked: true,
          getLineColor: (d: any) => d.color,
          lineWidthMinPixels: 1,
          pickable: false,
        }),
      );
    }

    // ── Heatmap Layer (threat density overlay) ──────────────────────────
    if (heatmapData.length > 0) {
      result.push(
        new HeatmapLayer({
          id: "heatmap-layer",
          data: heatmapData,
          getPosition: (d: any) => d.position,
          getWeight: (d: any) => d.weight,
          radiusPixels: 40,
          intensity: 1.2,
          threshold: 0.15,
          colorRange: [
            [30, 144, 255, 60],
            [0, 200, 83, 100],
            [255, 214, 10, 150],
            [255, 159, 10, 180],
            [255, 69, 58, 220],
          ],
          pickable: false,
        }),
      );
    }

    // ── Feed Events Dots (individual threat points) ─────────────────────
    if (feedDotsData.length > 0) {
      result.push(
        new ScatterplotLayer({
          id: "feed-dots-layer",
          data: feedDotsData,
          getPosition: (d: any) => d.position,
          getFillColor: (d: any) => d.color,
          getRadius: (d: any) => d.radius,
          radiusMinPixels: 4,
          radiusMaxPixels: 12,
          opacity: 0.8,
          filled: true,
          stroked: true,
          getLineColor: (d: any) => [d.color[0], d.color[1], d.color[2], 255],
          lineWidthMinPixels: 1,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 60],
          onHover: (info: any) => {
            if (info.object) {
              const event = recentThreats.find((t) => t.id === info.object.id);
              if (event) {
                setFeedHoverInfo({ x: info.x, y: info.y, event });
              }
            } else {
              setFeedHoverInfo(null);
            }
            return false;
          },
          onClick: (info: any) => {
            if (info.object) {
              setSelectedFeedEvent(info.object.id);
            }
            return false;
          },
        }),
      );
    }

    // ── Selected Feed Event Highlight ───────────────────────────────────
    if (selectedDotData.length > 0) {
      result.push(
        new ScatterplotLayer({
          id: "selected-feed-dot",
          data: selectedDotData,
          getPosition: (d: any) => d.position,
          getFillColor: (d: any) => d.color,
          getRadius: (d: any) => d.radius,
          radiusMinPixels: 15,
          radiusMaxPixels: 30,
          opacity: 0.9,
          filled: true,
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2,
          pickable: false,
        }),
      );
    }

    return result;
  }, [hexData, arcData, pulseData, heatmapData, feedDotsData, selectedDotData, visibleCells, selectedHexCell, selectedFeedEvent]);

  const onViewStateChange = useCallback(({ viewState: vs }: any) => {
    setViewState(vs);
  }, []);

  // Fly to selected cell
  useEffect(() => {
    if (!selectedHexCell) return;
    const cell = mapHexCells.find((c) => c.h3Index === selectedHexCell);
    if (!cell) return;
    setViewState({
      longitude: cell.lng,
      latitude: cell.lat,
      zoom: 7,
      pitch: 35,
      bearing: 0,
      transitionDuration: 1000,
    });
  }, [selectedHexCell, mapHexCells]);

  // Fly to selected feed event
  useEffect(() => {
    if (!selectedFeedEvent) return;
    const event = recentThreats.find((t) => t.id === selectedFeedEvent);
    if (!event) return;
    setViewState({
      longitude: event.location.lng,
      latitude: event.location.lat,
      zoom: 8,
      pitch: 30,
      bearing: 0,
      transitionDuration: 1000,
    });
  }, [selectedFeedEvent, recentThreats]);

  // Zoom to fit all visible cells
  const handleFitBounds = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || recentThreats.length === 0) return;

    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const threat of recentThreats) {
      if (threat.location.lng < minLng) minLng = threat.location.lng;
      if (threat.location.lng > maxLng) maxLng = threat.location.lng;
      if (threat.location.lat < minLat) minLat = threat.location.lat;
      if (threat.location.lat > maxLat) maxLat = threat.location.lat;
    }

    // Pad bounds by 10%
    const padLng = (maxLng - minLng) * 0.1 || 1;
    const padLat = (maxLat - minLat) * 0.1 || 1;

    map.fitBounds(
      [
        [minLng - padLng, minLat - padLat],
        [maxLng + padLng, maxLat + padLat],
      ],
      { padding: 60, duration: 1200, maxZoom: 8 },
    );
  }, [recentThreats]);

  // Listen for fitBounds custom event (from command palette / keyboard shortcut)
  useEffect(() => {
    const handler = () => handleFitBounds();
    window.addEventListener("btic:fitBounds", handler);
    return () => window.removeEventListener("btic:fitBounds", handler);
  }, [handleFitBounds]);

  // Reset view to default center/zoom
  const handleResetView = useCallback(() => {
    setViewState({
      ...INITIAL_VIEW,
      transitionDuration: 1200,
    });
    setSelectedHexCell(null);
  }, [setSelectedHexCell]);

  useEffect(() => {
    const handler = () => handleResetView();
    window.addEventListener("btic:resetView", handler);
    return () => window.removeEventListener("btic:resetView", handler);
  }, [handleResetView]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* MapLibre base map sits UNDERNEATH (z-index 0); DeckGL threat layers
          overlay on top (z-index 1). Previously MapLibre was a child of DeckGL,
          so once the base tiles loaded they painted OVER the deck canvas and
          hid every hex tower / threat marker. */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <MapLibreComponent viewState={viewState} globeView={globeView} mapRef={mapInstanceRef} />
      </div>
      <DeckGL
        ref={deckRef}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        layers={layers}
        controller={true}
        style={{ position: "absolute", top: "0", left: "0", width: "100%", height: "100%", zIndex: "1" }}
        getTooltip={() => null}
      />

      {/* Stats + Live toggle overlays */}
      <MapOverlay
        isLive={isLive}
        onToggleLive={toggleLive}
        onFitBounds={handleFitBounds}
        connectionType={connectionType}
        eventCount={eventCount}
        visibleCells={recentThreats.length}
        connectionCount={mapConnections.length}
        recentThreats={recentThreats}
      />

      {/* Region detail sidebar */}
      <RegionSidebar />

      {/* Hover tooltip */}
      {hoverInfo && !selectedHexCell && (
        <MapTooltip x={hoverInfo.x} y={hoverInfo.y} cell={hoverInfo.cell} />
      )}

      {/* Feed event tooltip */}
      {feedHoverInfo && (
        <FeedTooltip x={feedHoverInfo.x} y={feedHoverInfo.y} event={feedHoverInfo.event} />
      )}

      {/* Loading overlay */}
      {!isLoaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(249, 248, 248,0.92)",
            zIndex: 200,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "'Newsreader', Georgia, serif",
                fontSize: 21,
                fontWeight: 400,
                color: "#767270",
                marginBottom: 8,
              }}
            >
              Initializing Spatial Engine
            </div>
            <div
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11.5,
                color: "#969290",
                letterSpacing: "0.1em",
              }}
            >
              MapLibre GL + Deck.gl + H3
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MapLibre GL JS component ──────────────────────────────────────────────
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

function MapLibreComponent({
  viewState,
  globeView,
  mapRef: externalRef,
}: {
  viewState: MapViewState;
  globeView: boolean;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom: INITIAL_VIEW.zoom,
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
      attributionControl: false,
      projection: globeView ? "globe" : "mercator",
    } as any);

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );

    mapRef.current = map;
    externalRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      externalRef.current = null;
    };
  }, []);

  // Sync viewState
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.jumpTo({
      center: [viewState.longitude, viewState.latitude],
      zoom: viewState.zoom,
      pitch: viewState.pitch,
      bearing: viewState.bearing,
    });
  }, [viewState]);

  // Toggle projection on globeView change (wait for style to load first)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      try { map.setProjection(globeView ? "globe" : "mercator" as any); } catch { /* style not ready */ }
    };
    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once("style.load", apply);
    }
  }, [globeView]);

  return (
    <div
      ref={mapContainer}
      style={{ position: "absolute", width: "100%", height: "100%" }}
    />
  );
}
