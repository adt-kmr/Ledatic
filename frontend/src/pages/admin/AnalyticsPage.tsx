import { useState, useEffect, useCallback, useRef } from "react";
import {
  ThreatTrendChart,
  DecisionDistribution,
  GeographicHeatmap,
  ModelPerformance,
  THREAT_DATA,
  DECISION_DATA,
  INDIAN_CITIES,
  generateThreatForCity,
} from "../../components/btic/analytics";
import type { ThreatEvent } from "../../types/btic";

export default function AnalyticsPage() {
  const [period, setPeriod] = useState("7d");
  const [recentThreats, setRecentThreats] = useState<ThreatEvent[]>([]);
  const threatsRef = useRef<ThreatEvent[]>([]);

  const maxThreats = Math.max(
    ...THREAT_DATA.map((d) => d.critical + d.high + d.medium + d.low)
  );
  const totalDecisions = DECISION_DATA.reduce((s, d) => s + d.count, 0);

  const addThreat = useCallback(() => {
    const totalWeight = INDIAN_CITIES.reduce((sum, c) => sum + c.threatCount, 0);
    let rand = Math.random() * totalWeight;
    let selectedCity = INDIAN_CITIES[0];
    for (const city of INDIAN_CITIES) {
      rand -= city.threatCount;
      if (rand <= 0) {
        selectedCity = city;
        break;
      }
    }

    const threat = generateThreatForCity(selectedCity);
    threatsRef.current = [threat, ...threatsRef.current].slice(0, 100);
    setRecentThreats([...threatsRef.current]);
  }, []);

  useEffect(() => {
    for (let i = 0; i < 15; i++) {
      addThreat();
    }

    const interval = setInterval(addThreat, 2000 + Math.random() * 3000);
    return () => clearInterval(interval);
  }, [addThreat]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header — stacks on mobile */}
      <div
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between"
        style={{ gap: 12 }}
      >
        <div style={{ display: "flex", gap: 6, alignSelf: "flex-start" }}>
          {["1d", "7d", "30d"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: "5px 12px",
                borderRadius: 8,
                fontSize: 12.5,
                cursor: "pointer",
                border: "1px solid #D7D2D0",
                background:
                  period === p ? "rgba(16, 15, 15,0.12)" : "transparent",
                color: period === p ? "#100F0F" : "rgba(16, 15, 15,0.4)",
                fontFamily: "'DM Mono', monospace",
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <GeographicHeatmap recentThreats={recentThreats} />

      <ThreatTrendChart maxThreats={maxThreats} />

      {/* Bottom grid — stacks on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 16 }}>
        <DecisionDistribution totalDecisions={totalDecisions} />
        <ModelPerformance />
      </div>
    </div>
  );
}
