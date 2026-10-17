import { useState, useEffect } from "react";
import { C } from "../../lib/theme";

interface ServiceStatus {
  name: string;
  status: "healthy" | "degraded" | "down";
  latency: number;
}

const INITIAL_SERVICES: ServiceStatus[] = [
  { name: "ML Engine", status: "healthy", latency: 42 },
  { name: "Redis", status: "healthy", latency: 3 },
  { name: "PostgreSQL", status: "healthy", latency: 12 },
  { name: "Hyperledger", status: "healthy", latency: 85 },
];

const STATUS_COLORS: Record<ServiceStatus["status"], string> = {
  healthy: "#3D8B5A",
  degraded: "#B7791F",
  down: "#B3261E",
};

export function StatusIndicator() {
  const [services, setServices] = useState(INITIAL_SERVICES);

  useEffect(() => {
    const interval = setInterval(() => {
      setServices((prev) =>
        prev.map((s) => ({
          ...s,
          latency: Math.max(
            1,
            s.latency + Math.round((Math.random() - 0.5) * 6)
          ),
        }))
      );
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const allHealthy = services.every((s) => s.status === "healthy");

  return (
    <div className="glass-card" style={{ padding: "14px 18px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.01em", lineHeight: 1.15, marginBottom: 14 }}>
          System health
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11.5,
            fontFamily: "'DM Mono', monospace",
            color: allHealthy ? "#3D8B5A" : "#B7791F",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: allHealthy ? "#3D8B5A" : "#B7791F",
              boxShadow: `0 0 6px ${allHealthy ? "#34C75980" : "#FF9F0A80"}`,
            }}
          />
          {allHealthy ? "ALL OPERATIONAL" : "DEGRADED"}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {services.map((service) => (
          <div
            key={service.name}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "5px 8px",
              borderRadius: 6,
              background: "#FFFFFF",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className="status-pulse"
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: STATUS_COLORS[service.status],
                  boxShadow: `0 0 4px ${STATUS_COLORS[service.status]}60`,
                }}
              />
              <span
                style={{
                  fontSize: 12.5,
                  color: "#575452",
                }}
              >
                {service.name}
              </span>
            </div>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11.5,
                color: "#969290",
              }}
            >
              {service.latency}ms
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
