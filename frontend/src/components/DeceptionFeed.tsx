// Citadel — Live Deception Feed (FIU Fraud-Ops)
// =================================================
// Subscribes to the /api/security/threat-stream SSE and renders live honeypot /
// decoy-endpoint intrusion events. Mounted in the FIU Security Operations
// Center so a trap sprung on the login demo appears here in real time.

import React from "react";
import { threatStreamUrl, getDeceptionStatus } from "../lib/securityApi";

interface TrapEvent {
  kind: string;
  client_ip: string;
  reason: string;
  path?: string | null;
  timestamp: number;
}

const KIND_LABEL: Record<string, string> = {
  DOM_HONEYPOT: "DOM Honeypot",
  DECOY_API: "Decoy API Probe",
  BLACKLIST_HIT: "Blacklist Hit",
};

export const DeceptionFeed: React.FC = () => {
  const [events, setEvents] = React.useState<TrapEvent[]>([]);

  React.useEffect(() => {
    // Seed with any recent traps captured before this panel mounted.
    void getDeceptionStatus().then((s) => {
      if (s?.recent_traps?.length) {
        setEvents((prev) => [...(s.recent_traps as unknown as TrapEvent[]).slice(-8).reverse(), ...prev].slice(0, 20));
      }
    });

    const es = new EventSource(threatStreamUrl());
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as TrapEvent;
        if (!ev.kind) return;
        setEvents((prev) => [ev, ...prev].slice(0, 20));
      } catch {
        /* ignore keep-alive / malformed */
      }
    };
    es.onerror = () => { /* browser auto-reconnects */ };
    return () => es.close();
  }, []);

  return (
    <div style={{
      borderRadius: 16, padding: "16px 18px", marginBottom: 24,
      background: "#FFFFFF", border: "1px solid #EAE4E1",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#B8352C", boxShadow: "0 0 8px #B8352C" }} className="animate-pulse" />
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: "#100F0F", textTransform: "uppercase" }}>
          Active Deception · Live Trap Feed
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#767270", fontFamily: "monospace" }}>
          {events.length} event{events.length === 1 ? "" : "s"}
        </span>
      </div>
      {events.length === 0 ? (
        <div style={{ fontSize: 12, color: "#969290", padding: "8px 0" }}>
          No intrusion attempts. Honeypots armed, decoy endpoints live.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
          {events.map((ev, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
              borderRadius: 10, background: "rgba(184,53,44,0.06)", border: "1px solid rgba(184,53,44,0.18)",
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#B8352C", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                {KIND_LABEL[ev.kind] ?? ev.kind}
              </span>
              <span style={{ fontSize: 11, color: "#575452", overflow: "hidden", textOverflow: "ellipsis" }}>
                {ev.reason}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: "#767270", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                {ev.client_ip}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DeceptionFeed;
