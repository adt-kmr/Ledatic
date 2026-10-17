import { ErrorBoundary } from "../../components/ui/ErrorBoundary";
import { ThreatMap } from "../../components/btic/map/ThreatMap";
import { MapControls } from "../../components/btic/map/MapControls";
import { MapLegend } from "../../components/btic/map/MapLegend";
import { TimeSlider } from "../../components/btic/map/TimeSlider";
import { ThreatFeedPanel } from "../../components/btic/feed";

function MapFallback() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(ellipse at center, #F1F1F1 0%, #F9F8F8 100%)",
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
          Loading Spatial Intelligence Engine...
        </div>
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11.5,
            color: "#969290",
            letterSpacing: "0.1em",
          }}
        >
          Initializing MapLibre GL + Deck.gl + H3
        </div>
      </div>
    </div>
  );
}

export default function ThreatIntelPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: "max(560px, calc(100vh - 300px))",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {["H3 hexagonal overlay", "deck.gl GPU rendering", "Heatmap density", "Real-time events"].map((t) => (
          <span key={t} className="cc-mono" style={{ padding: "4px 9px", borderRadius: 6, background: "#F7F3F1", color: "#575452", fontSize: 11.5 }}>{t}</span>
        ))}
      </div>

      {/* Map + Feed sidebar — stacks on mobile */}
      <div
        className="flex flex-col md:flex-row"
        style={{ gap: 12, flex: 1, minHeight: 0 }}
      >
        {/* Map */}
        <ErrorBoundary
          name="Threat Map"
          fallback={
            <div
              className="glass-card"
              style={{ flex: 1, borderRadius: 12, overflow: "hidden" }}
            >
              <MapFallback />
            </div>
          }
        >
          <div
            className="glass-card"
            style={{
              flex: 1,
              borderRadius: 12,
              overflow: "hidden",
              position: "relative",
              minHeight: 300,
            }}
          >
            <ThreatMap />
            <MapControls />
            <MapLegend />
            <TimeSlider />
          </div>
        </ErrorBoundary>

        {/* Threat Feed Sidebar — full width on mobile */}
        <div
          className="glass-card md:w-[380px] w-full md:flex-shrink-0 max-h-[300px] md:max-h-none"
          style={{
            borderRadius: 12,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ThreatFeedPanel />
        </div>
      </div>
    </div>
  );
}
