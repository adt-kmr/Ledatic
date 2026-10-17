import { useState, useCallback, useMemo, useEffect, useRef, memo } from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, TextLayer, ArcLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { MapViewState } from "@deck.gl/core";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { GEO_DATA, SEVERITY_COLORS, INDIAN_CITIES, SEVERITY_RGBA } from "./data";
import type { ThreatEvent } from "../../../types/btic";

// ── Severity → RGBA color ──────────────────────────────────────────────────
function severityColor(s: string): [number, number, number, number] {
  return SEVERITY_RGBA[s] || [142, 142, 147, 130];
}

// ── Initial viewport centered on India ──────────────────────────────────────
const INITIAL_VIEW: MapViewState = {
  longitude: 78.9,
  latitude: 22.5,
  zoom: 4.5,
  pitch: 35,
  bearing: -5,
};

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// ── City Dot Component ──────────────────────────────────────────────────────
const CityDot = memo(function CityDot({ city, onClick, isHighlighted }: {
  city: typeof INDIAN_CITIES[0];
  onClick: () => void;
  isHighlighted: boolean;
}) {
  const size = Math.max(8, Math.min(24, 6 + (city.threatCount / 5)));
  const color = SEVERITY_COLORS[city.severity];

  return (
    <div
      onClick={onClick}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        cursor: "pointer",
        zIndex: isHighlighted ? 100 : 10,
      }}
    >
      {/* Pulse ring for critical/high */}
      {(city.severity === "CRITICAL" || city.severity === "HIGH") && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: size * 2.5,
            height: size * 2.5,
            borderRadius: "50%",
            border: `2px solid ${color}`,
            opacity: 0.4,
            animation: "pulse 2s ease-out infinite",
          }}
        />
      )}
      {/* Main dot */}
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: `radial-gradient(circle at 30% 30%, ${color}, ${color}cc)`,
          boxShadow: `0 0 ${size}px ${color}60, 0 0 ${size * 2}px ${color}30`,
          transition: "all 0.3s ease",
          transform: isHighlighted ? "scale(1.3)" : "scale(1)",
        }}
      />
      {/* City label */}
      {isHighlighted && (
        <div
          style={{
            position: "absolute",
            top: size + 8,
            left: "50%",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            fontSize: 11.5,
            fontFamily: "'DM Mono', monospace",
            fontWeight: 600,
            color: "#100F0F",
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
            background: "rgba(255, 255, 255,0.7)",
            padding: "3px 8px",
            borderRadius: 4,
            border: `1px solid ${color}40`,
          }}
        >
          {city.name}
          <span style={{ marginLeft: 6, color, fontSize: 11 }}>
            {city.threatCount}
          </span>
        </div>
      )}
    </div>
  );
});

// ── MapLibre Component ──────────────────────────────────────────────────────
function MapLibreComponent({ viewState }: { viewState: MapViewState }) {
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
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync viewState from deck.gl controller
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

  return (
    <div
      ref={mapContainer}
      style={{ position: "absolute", width: "100%", height: "100%" }}
    />
  );
}

// ── Main GeographicHeatmap Component ────────────────────────────────────────
interface GeographicHeatmapProps {
  recentThreats?: ThreatEvent[];
  onCityClick?: (city: typeof INDIAN_CITIES[0]) => void;
}

export function GeographicHeatmap({ recentThreats = [], onCityClick }: GeographicHeatmapProps) {
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW);
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  // Merge city data with live threat data
  const cityData = useMemo(() => {
    const threatCounts: Record<string, number> = {};
    recentThreats.forEach((t) => {
      const city = t.location.city;
      threatCounts[city] = (threatCounts[city] || 0) + 1;
    });

    return INDIAN_CITIES.map((city) => ({
      ...city,
      liveThreats: threatCounts[city.name] || 0,
      displayCount: city.threatCount + (threatCounts[city.name] || 0),
    }));
  }, [recentThreats]);

  // Scatter data for DeckGL
  const scatterData = useMemo(
    () =>
      cityData.map((city) => ({
        position: [city.lng, city.lat] as [number, number],
        color: severityColor(city.severity),
        radius: 4000 + city.displayCount * 800,
        name: city.name,
        threats: city.displayCount,
        severity: city.severity,
      })),
    [cityData],
  );

  // Heatmap data
  const heatmapData = useMemo(
    () =>
      cityData.map((city) => ({
        position: [city.lng, city.lat] as [number, number],
        weight: city.displayCount,
      })),
    [cityData],
  );

  // Text labels for major cities
  const textData = useMemo(
    () =>
      cityData
        .filter((c) => c.displayCount > 15)
        .map((city) => ({
          position: [city.lng, city.lat + 0.4] as [number, number],
          text: city.name,
          size: 10,
          color: [245, 245, 247, 180] as [number, number, number, number],
        })),
    [cityData],
  );

  // Arc connections between high-severity cities
  const arcData = useMemo(() => {
    const highCities = cityData.filter((c) => c.severity === "CRITICAL" || c.severity === "HIGH");
    const arcs: { source: [number, number]; target: [number, number]; sourceColor: [number, number, number, number]; targetColor: [number, number, number, number] }[] = [];
    for (let i = 0; i < highCities.length; i++) {
      for (let j = i + 1; j < highCities.length; j++) {
        const a = highCities[i];
        const b = highCities[j];
        if (a.displayCount + b.displayCount > 40) {
          arcs.push({
            source: [a.lng, a.lat] as [number, number],
            target: [b.lng, b.lat] as [number, number],
            sourceColor: severityColor(a.severity),
            targetColor: severityColor(b.severity),
          });
        }
      }
    }
    return arcs;
  }, [cityData]);

  // Feed event dots plotted directly on the map
  const feedDotsData = useMemo(
    () =>
      recentThreats.slice(0, 60).map((t) => ({
        position: [t.location.lng, t.location.lat] as [number, number],
        color: severityColor(t.severity),
        radius: 600 + t.riskScore * 0.04,
        id: t.id,
        type: t.type,
        severity: t.severity,
      })),
    [recentThreats],
  );

  // DeckGL layers
  const layers = useMemo(() => {
    const result: any[] = [];

    // Heatmap layer for density visualization (stronger alpha for visibility)
    result.push(
      new HeatmapLayer({
        id: "analytics-heatmap",
        data: heatmapData,
        getPosition: (d: any) => d.position,
        getWeight: (d: any) => d.weight,
        radiusPixels: 60,
        intensity: 1.8,
        threshold: 0.08,
        colorRange: [
          [30, 144, 255, 80],
          [0, 200, 83, 120],
          [255, 214, 10, 160],
          [255, 159, 10, 200],
          [255, 69, 58, 240],
        ],
        pickable: false,
      }),
    );

    // Arc connections between high-severity cities
    if (arcData.length > 0) {
      result.push(
        new ArcLayer({
          id: "analytics-arcs",
          data: arcData,
          getSourcePosition: (d: any) => d.source,
          getTargetPosition: (d: any) => d.target,
          getSourceColor: (d: any) => d.sourceColor,
          getTargetColor: (d: any) => d.targetColor,
          getWidth: 1.5,
          greatCircle: true,
          pickable: false,
          opacity: 0.35,
        }),
      );
    }

    // Scatter layer for city dots
    result.push(
      new ScatterplotLayer({
        id: "analytics-dots",
        data: scatterData,
        getPosition: (d: any) => d.position,
        getFillColor: (d: any) => d.color,
        getRadius: (d: any) => d.radius,
        radiusMinPixels: 6,
        radiusMaxPixels: 30,
        opacity: 0.85,
        filled: true,
        stroked: true,
        getLineColor: (d: any) => [d.color[0], d.color[1], d.color[2], 255] as [number, number, number, number],
        lineWidthMinPixels: 1.5,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
        onHover: (info: any) => {
          if (info.object) {
            setHoveredCity(info.object.name);
          } else {
            setHoveredCity(null);
          }
          return false;
        },
        onClick: (info: any) => {
          if (info.object) {
            const city = cityData.find((c) => c.name === info.object.name);
            if (city) {
              setSelectedCity(selectedCity === city.name ? null : city.name);
              onCityClick?.(city);
            }
          }
          return false;
        },
      }),
    );

    // Threat feed event dots (individual events plotted on the map)
    if (feedDotsData.length > 0) {
      result.push(
        new ScatterplotLayer({
          id: "analytics-feed-dots",
          data: feedDotsData,
          getPosition: (d: any) => d.position,
          getFillColor: (d: any) => d.color,
          getRadius: (d: any) => d.radius,
          radiusMinPixels: 2,
          radiusMaxPixels: 6,
          opacity: 0.7,
          filled: true,
          stroked: false,
          pickable: false,
        }),
      );
    }

    // Text layer for major city labels
    if (textData.length > 0) {
      result.push(
        new TextLayer({
          id: "analytics-labels",
          data: textData,
          getPosition: (d: any) => d.position,
          getText: (d: any) => d.text,
          getSize: (d: any) => d.size,
          getColor: (d: any) => d.color,
          fontFamily: "'DM Mono', monospace",
          fontWeight: 600,
          getTextAnchor: "middle",
          getAlignmentBaseline: "bottom",
          pickable: false,
        }),
      );
    }

    return result;
  }, [scatterData, heatmapData, textData, arcData, feedDotsData, cityData, selectedCity, onCityClick]);

  // Fly to selected city
  useEffect(() => {
    if (!selectedCity) return;
    const city = cityData.find((c) => c.name === selectedCity);
    if (!city) return;
    setViewState({
      longitude: city.lng,
      latitude: city.lat,
      zoom: 8,
      pitch: 25,
      bearing: 0,
      transitionDuration: 800,
    });
  }, [selectedCity, cityData]);

  const onViewStateChange = useCallback(({ viewState: vs }: any) => {
    setViewState(vs);
  }, []);

  return (
    <div className="glass-card" style={{ padding: 0, overflow: "hidden", position: "relative" }}>
      {/* Header */}
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid #EAE4E1",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          position: "relative",
          zIndex: 20,
          background: "rgba(249, 248, 248,0.9)",
        }}
      >
        <div>
          <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 14 }}>
          Geographic hotspots
        </div>
          <div
            style={{
              fontFamily: "'Newsreader', Georgia, serif",
              fontSize: 20,
              fontWeight: 400,
              color: "#100F0F",
              marginTop: 2,
            }}
          >
            Top States by Threat Volume
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {Object.entries(SEVERITY_COLORS).map(([level, color]) => (
            <div
              key={level}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10,
                color: "#767270",
                fontFamily: "'DM Mono', monospace",
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: color,
                }}
              />
              {level}
            </div>
          ))}
        </div>
      </div>

      {/* State list */}
      <div style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {GEO_DATA.slice(0, 6).map((item) => (
            <div
              key={item.state}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 2,
                  background: SEVERITY_COLORS[item.severity],
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, fontSize: 12.5, color: "#575452" }}>
                {item.state}
              </span>
              <span
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "#100F0F",
                }}
              >
                {item.threats}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* CSS animation for pulse */}
      <style>{`
        @keyframes pulse {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.4; }
          100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
