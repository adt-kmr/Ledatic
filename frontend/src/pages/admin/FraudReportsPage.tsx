import { useEffect, useState, useCallback, useRef } from "react";
import { adminFetch } from "../../admin/adminAuth";
import { createLiveEventStream } from "../../lib/bticApi";
import { Pill } from "../../components/ui/Pill";
import { C, decisionColor } from "../../lib/theme";
import { FileWarning } from "lucide-react";
import { EmptyPanel } from "../../components/cc/EmptyPanel";

interface FraudReport {
  report_id: string;
  session_id: string;
  user_id: string;
  report_text: string;
  risk_score: number;
  threat_level?: string | null;
  evidence: string[];
  recommended_action?: string | null;
  confidence?: number | null;
  decision: string;
  pathway?: string | null;
  channel?: string | null;
  created_at?: string | null;
  keystroke_count: number;
  mouse_count: number;
  touch_count: number;
  /** Base64 data URL. May be the attempt capture or the enrolment photo. */
  face_image?: string | null;
  /** "attempt" = captured during this session, "enrolment" = account holder's
   *  registration photo and NOT the face behind this attempt. */
  face_image_source?: string | null;
  login_ip?: string | null;
  login_country?: string | null;
  login_city?: string | null;
  vpn_detected?: boolean | null;
  geo_distance_km?: number | null;
  ip_risk_score?: number | null;
}

export default function FraudReportsPage() {
  const [reports, setReports] = useState<FraudReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const load = useCallback(() => {
    adminFetch("/api/fraud/reports")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setReports(data);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load fraud reports"));
  }, []);

  // Live, not "eventually".
  //
  // A 20 s poll meant a hard block raised in one tab took up to 20 s to appear
  // in the FIU tab, which does not read as a live fraud console. The backend
  // already publishes every session verdict to Redis `btic:events` and exposes
  // it over SSE, so subscribe to that and refetch the moment something lands.
  // The poll stays as a backstop at 5 s for when SSE is unavailable (no admin
  // token yet, proxy that buffers, browser without EventSource) — the list is
  // never worse off than before, only faster when the stream works.
  useEffect(() => {
    load();

    const es = createLiveEventStream(
      (evt) => {
        // Only verdicts create fraud reports; ignore the rest of the firehose.
        // Names must match what the backend actually publishes:
        // auth.py -> "session_evaluated", voice_mfa.py -> "voice_mfa",
        // security_integration.py -> "security_verdict".
        const t = evt?.type;
        if (t === "session_evaluated" || t === "voice_mfa" || t === "security_verdict") {
          setLive(true);
          load();
        }
      },
      () => setLive(false),
    );
    esRef.current = es;
    if (es) setLive(true);

    const timer = setInterval(load, 5000);
    return () => {
      clearInterval(timer);
      es?.close();
      esRef.current = null;
    };
  }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 22, color: "#100F0F" }}>
            {reports?.length ?? 0} report{reports?.length === 1 ? "" : "s"}
          </span>
          <span
            title={live ? "Streaming verdicts over SSE" : "Stream unavailable — polling every 5s"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800,
              letterSpacing: 0.5, fontFamily: C.mono, padding: "3px 8px", borderRadius: 999,
              background: live ? "rgba(61, 139, 90,0.12)" : "rgba(16, 15, 15,0.05)",
              color: live ? "#3D8B5A" : "#767270",
              border: `1px solid ${live ? "rgba(61, 139, 90,0.35)" : "rgba(16, 15, 15,0.1)"}`,
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: 999,
              background: live ? "#3D8B5A" : "rgba(20, 19, 19,0.4)",
              boxShadow: live ? "0 0 6px #3D8B5A" : "none",
            }} />
            {live ? "LIVE" : "POLLING"}
          </span>
        </div>
        <p style={{ fontSize: 13.5, color: "#767270", margin: 0, maxWidth: 520 }}>
          Face, IP, location and behavioural signals per session, streamed as verdicts land.
        </p>
      </div>

      {error && (
        <div className="glass-card" style={{ padding: "14px 18px", fontSize: 14, color: C.red }}>
          {error}
        </div>
      )}

      {reports === null && !error && (
        <div style={{ fontSize: 13.5, color: "#767270" }}>Loading...</div>
      )}

      {reports !== null && reports.length === 0 && (
        <EmptyPanel
          icon={FileWarning}
          title="No fraud reports yet"
          body="A report is written automatically the moment a session is stepped up or hard-blocked. Run one of the attack scenarios in the bank demo to generate the first one."
          cta={{ label: "Open the bank demo", to: "/demo/bank" }}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {reports?.map((r) => {
          const isOpen = expanded === r.report_id;
          return (
            <div
              key={r.report_id}
              className="glass-card"
              style={{
                padding: "16px 20px",
                cursor: "pointer",
                borderLeft: `3px solid ${decisionColor[r.decision] ?? C.textMuted}`,
              }}
              onClick={() => setExpanded(isOpen ? null : r.report_id)}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Face behind the attempt. Labelled, because an enrolment
                      photo is the account holder — not whoever tried to log
                      in — and showing it unlabelled tells the analyst the
                      opposite of what happened. */}
                  {r.face_image && (
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <img
                        src={r.face_image}
                        alt={r.face_image_source === "attempt" ? "Face captured during this attempt" : "Account holder's registration photo"}
                        style={{
                          width: 44, height: 44, borderRadius: 10, objectFit: "cover",
                          border: `2px solid ${r.face_image_source === "attempt" ? C.red : "rgba(16, 15, 15,0.15)"}`,
                          filter: r.face_image_source === "enrolment" ? "grayscale(0.7)" : "none",
                        }}
                      />
                      <span
                        style={{
                          position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)",
                          fontSize: 10, fontWeight: 800, letterSpacing: 0.3, whiteSpace: "nowrap",
                          padding: "1px 4px", borderRadius: 4, fontFamily: C.mono,
                          background: r.face_image_source === "attempt" ? C.red : "rgba(199, 195, 192,0.95)",
                          color: r.face_image_source === "attempt" ? "#fff" : "#575452",
                        }}
                      >
                        {r.face_image_source === "attempt" ? "LIVE" : "ENROL"}
                      </span>
                    </div>
                  )}
                  <span style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 400, fontSize: 20, color: "#100F0F" }}>
                    {r.user_id}
                  </span>
                  <Pill text={r.decision} color={decisionColor[r.decision] ?? C.textMuted} />
                  {r.threat_level && <Pill text={r.threat_level} color={C.amber} />}
                  {r.vpn_detected && <Pill text="VPN" color={C.violet} />}
                </div>
                <span style={{ fontFamily: C.mono, fontSize: 12.5, color: "#767270" }}>
                  {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                </span>
              </div>

              <div style={{ marginTop: 8, fontSize: 14, color: "#575452", lineHeight: 1.5 }}>
                {r.report_text}
              </div>

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 12.5, color: "#767270", fontFamily: C.mono }}>
                <span>risk {r.risk_score}</span>
                {r.channel && <span>{r.channel}</span>}
                {r.pathway && <span>{r.pathway}</span>}
                {(r.login_city || r.login_country) && (
                  <span style={{ color: C.amber }}>
                    📍 {[r.login_city, r.login_country].filter(Boolean).join(", ")}
                  </span>
                )}
                {r.login_ip && <span>🌐 {r.login_ip}</span>}
                {r.geo_distance_km != null && <span>{Math.round(r.geo_distance_km)}km from usual</span>}
                <span>{r.keystroke_count} keystrokes · {r.mouse_count} mouse · {r.touch_count} touch</span>
              </div>

              {isOpen && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #EAE4E1", display: "flex", flexDirection: "column", gap: 8 }}>
                  {r.recommended_action && (
                    <div style={{ fontSize: 13.5, color: "#575452" }}>
                      <strong style={{ color: "#100F0F" }}>Recommended action:</strong> {r.recommended_action}
                    </div>
                  )}
                  {r.evidence?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: "#767270", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                        Evidence
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: "#575452" }}>
                        {r.evidence.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {r.login_ip && (
                    <div style={{ fontSize: 13, color: "#767270", fontFamily: C.mono }}>
                      IP {r.login_ip} · risk {r.ip_risk_score ?? "n/a"} · session {r.session_id.slice(0, 8)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
