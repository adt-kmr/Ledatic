import { Pill } from "../../ui/Pill";

const ROLES = [
  {
    role: "FIU Admin",
    permissions: "Full access · Block/Unblock · Thresholds · Contact edit",
    count: 3,
  },
  {
    role: "Bank Analyst",
    permissions: "View only · Sessions · Customer 360 · Warn",
    count: 8,
  },
];

export function RoleManagement() {
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
        Role Management
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ROLES.map((role) => (
          <div
            key={role.role}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: 8,
              background: "#FFFFFF",
            }}
          >
            <div>
              <div style={{ fontSize: 14, color: "#100F0F", fontWeight: 500 }}>
                {role.role}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "#767270",
                  marginTop: 2,
                }}
              >
                {role.permissions}
              </div>
            </div>
            <Pill text={`${role.count} users`} color="#767270" />
          </div>
        ))}
      </div>
    </div>
  );
}
