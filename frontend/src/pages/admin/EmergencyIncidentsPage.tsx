import { useEffect, useState, useCallback } from "react";
import { adminFetch } from "../../admin/adminAuth";
import { Pill } from "../../components/ui/Pill";
import { C } from "../../lib/theme";
import { Siren } from "lucide-react";
import { EmptyPanel } from "../../components/cc/EmptyPanel";

interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp: string;
}

interface Incident {
  incident_id: string;
  user_id: string;
  user_name?: string | null;
  customer_id?: string | null;
  status: string;
  latitude?: number | null;
  longitude?: number | null;
  timestamp: string;
  resolved_at?: string | null;
  device_info?: Record<string, unknown> | null;
  contact_1_name?: string | null;
  contact_2_name?: string | null;
  location_timeline: LocationPoint[];
  maps_url?: string | null;
  risk_priority: string;
  payment_amount?: number | null;
  payment_recipient?: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: C.red,
  RESOLVED: C.green,
  FALSE_ALARM: C.textMuted,
};

export default function EmergencyIncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = filter ? `?status=${filter}` : "";
    adminFetch(`/api/duress/incidents${q}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setIncidents(data);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load incidents"));
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const resolve = async (incidentId: string, status: "RESOLVED" | "FALSE_ALARM") => {
    setBusyId(incidentId);
    try {
      const r = await adminFetch(`/api/duress/resolve/${incidentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (r.ok) load();
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = incidents?.filter((i) => i.status === "ACTIVE").length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 10, background: "#F7F3F1" }}>
          {["", "ACTIVE", "RESOLVED", "FALSE_ALARM"].map((s) => {
            const on = filter === s;
            return (
              <button
                key={s || "all"}
                onClick={() => setFilter(s)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: on ? "#FFFFFF" : "transparent",
                  boxShadow: on ? "0 1px 2px rgba(16,15,15,0.08)" : "none",
                  color: on ? "#100F0F" : "#767270",
                  fontSize: 13,
                  fontWeight: on ? 500 : 400,
                  cursor: "pointer",
                  transition: "all .15s",
                }}
              >
                {s ? s.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "All"}
              </button>
            );
          })}
        </div>
        {activeCount > 0 && <Pill text={`${activeCount} active`} color={C.red} />}
      </div>

      {error && (
        <div className="glass-card" style={{ padding: "14px 18px", fontSize: 14, color: C.red }}>
          {error}
        </div>
      )}

      {incidents === null && !error && (
        <div style={{ fontSize: 13.5, color: "#767270" }}>Loading...</div>
      )}

      {incidents !== null && incidents.length === 0 && (
        <EmptyPanel
          icon={Siren}
          title={filter ? `No ${filter.replace("_", " ").toLowerCase()} incidents` : "No emergencies right now"}
          body="When a customer enters their silent duress PIN, the incident lands here with live location and their trusted contacts already alerted."
          cta={filter ? undefined : { label: "Try duress mode in the bank demo", to: "/demo/bank" }}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {incidents?.map((inc) => (
          <div
            key={inc.incident_id}
            className="glass-card"
            style={{
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              borderLeft: `3px solid ${STATUS_COLOR[inc.status] ?? C.textMuted}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 400, fontSize: 20, color: "#100F0F" }}>
                  {inc.user_name || inc.customer_id || inc.user_id}
                </span>
                <Pill text={inc.status} color={STATUS_COLOR[inc.status] ?? C.textMuted} />
                <Pill text={inc.risk_priority} color={C.red} />
              </div>
              <span style={{ fontFamily: C.mono, fontSize: 12.5, color: "#767270" }}>
                {new Date(inc.timestamp).toLocaleString()}
              </span>
            </div>

            {inc.payment_amount != null && (
              <div style={{ fontSize: 14, color: "#575452" }}>
                Forced payment: <strong>₹{inc.payment_amount.toLocaleString()}</strong>
                {inc.payment_recipient ? ` to ${inc.payment_recipient}` : ""}
              </div>
            )}

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "#767270", fontFamily: C.mono }}>
              {inc.contact_1_name && <span>Contact: {inc.contact_1_name}</span>}
              {inc.contact_2_name && <span>Contact 2: {inc.contact_2_name}</span>}
              <span>{inc.location_timeline.length} location update{inc.location_timeline.length === 1 ? "" : "s"}</span>
              {inc.maps_url && (
                <a href={inc.maps_url} target="_blank" rel="noreferrer" style={{ color: C.blue }}>
                  View on map ↗
                </a>
              )}
            </div>

            {inc.status === "ACTIVE" && (
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => resolve(inc.incident_id, "RESOLVED")}
                  disabled={busyId === inc.incident_id}
                  style={{
                    padding: "7px 14px", borderRadius: 8, border: "none",
                    background: C.green, color: "#F2F1F1", fontSize: 13.5, fontWeight: 700,
                    cursor: busyId === inc.incident_id ? "default" : "pointer",
                    opacity: busyId === inc.incident_id ? 0.5 : 1,
                  }}
                >
                  Mark Resolved
                </button>
                <button
                  onClick={() => resolve(inc.incident_id, "FALSE_ALARM")}
                  disabled={busyId === inc.incident_id}
                  style={{
                    padding: "7px 14px", borderRadius: 8, border: "1px solid #D7D2D0",
                    background: "transparent", color: "#575452", fontSize: 13.5, fontWeight: 600,
                    cursor: busyId === inc.incident_id ? "default" : "pointer",
                    opacity: busyId === inc.incident_id ? 0.5 : 1,
                  }}
                >
                  False Alarm
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
