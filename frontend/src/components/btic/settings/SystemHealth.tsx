const SERVICES = [
  { name: "ML Service", status: "healthy", detail: "XGBoost + SHAP ready" },
  { name: "Redis", status: "healthy", detail: "Connected · 128MB used" },
  {
    name: "PostgreSQL",
    status: "healthy",
    detail: "42 connections · 2.1GB",
  },
  {
    name: "Hyperledger Fabric",
    status: "healthy",
    detail: "2 peers · channel active",
  },
  {
    name: "Ethereum Bridge",
    status: "healthy",
    detail: "Sepolia · last proof 2m ago",
  },
];

export function SystemHealth() {
  return (
    <div className="glass-card" style={{ padding: "22px 24px" }}>
      <div
        style={{
          fontFamily: "'Newsreader', Georgia, serif",
          fontSize: 21,
          fontWeight: 400,
          color: "#100F0F",
          marginBottom: 14,
        }}
      >
        System Health
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {SERVICES.map((service) => (
          <div
            key={service.name}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: 8,
              background: "#FFFFFF",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#3D8B5A",
                  boxShadow: "0 0 6px #34C75980",
                }}
              />
              <span style={{ fontSize: 14, color: "#100F0F", fontWeight: 500 }}>
                {service.name}
              </span>
            </div>
            <span
              style={{
                fontSize: 12.5,
                color: "#767270",
                fontFamily: "'DM Mono', monospace",
              }}
            >
              {service.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
