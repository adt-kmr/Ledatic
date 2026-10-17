import { memo, useCallback } from "react";
import { useBticStore } from "../../../stores/bticStore";
import type { MapLayer } from "../../../types/btic";

const LAYERS: { id: MapLayer; label: string; color: string }[] = [
  { id: "identity_confidence", label: "Identity Confidence", color: "#2C7A91" },
  { id: "behavior_drift", label: "Behavior Drift", color: "#3D8B5A" },
  { id: "credential_theft", label: "Credential Theft", color: "#B7791F" },
  { id: "sim_swap", label: "SIM Swap", color: "#B3261E" },
  { id: "money_mule", label: "Money Mule", color: "#8E5BA8" },
  { id: "merchant_intelligence", label: "Merchant Intelligence", color: "#B8920F" },
  { id: "campaigns", label: "Campaigns", color: "#5B5BA8" },
];

// Memoized layer toggle button
const LayerToggle = memo(function LayerToggle({
  layer,
  active,
  onToggle,
}: {
  layer: (typeof LAYERS)[number];
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 8px",
        borderRadius: 6,
        border: "none",
        background: active ? "rgba(16, 15, 15,0.08)" : "transparent",
        cursor: "pointer",
        transition: "all 0.15s",
        width: "100%",
        textAlign: "left",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: active ? layer.color : "rgba(16, 15, 15,0.15)",
          boxShadow: "none",
          transition: "all 0.15s",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 12,
          color: active
            ? "rgba(20, 19, 19,0.85)"
            : "rgba(20, 19, 19,0.35)",
          fontFamily: "'Inter', sans-serif",
          fontWeight: active ? 600 : 400,
          transition: "color 0.15s",
        }}
      >
        {layer.label}
      </span>
    </button>
  );
});

export const MapControls = memo(function MapControls() {
  const activeMapLayers = useBticStore((s) => s.activeMapLayers);
  const toggleMapLayer = useBticStore((s) => s.toggleMapLayer);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        background: "rgba(255, 255, 255,0.95)",
        backdropFilter: "blur(14px)",
        borderRadius: 10,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        zIndex: 50,
        minWidth: 150,
        maxWidth: "calc(100vw - 32px)",
        border: "1px solid #EAE4E1",
      }}
    >
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#767270", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
          Intelligence Layers
        </div>

      {LAYERS.map((layer) => (
        <LayerToggle
          key={layer.id}
          layer={layer}
          active={activeMapLayers.includes(layer.id)}
          onToggle={() => toggleMapLayer(layer.id)}
        />
      ))}
    </div>
  );
});
