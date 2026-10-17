/**
 * Citadel — live voice-MFA toast for the FIU console
 * ======================================================
 * Pops the moment a customer finishes a voice verification, so an analyst sees
 * a sign-in as it happens rather than on the next 12s list poll.
 *
 * Subscribes to /api/btic/events/stream — the SSE feed the console already
 * uses for session evaluations — and filters for `type: "voice_mfa"`. No second
 * stream, no polling.
 */

import { useEffect, useState, useCallback } from "react";
import { C } from "../lib/theme";
import { apiUrl } from "../lib/auth";
import { getAdminToken } from "../admin/adminAuth";

const OK = "#3D8B5A";
const WARN = "#B7791F";
const BAD = "#B3261E";
const MUTED = "rgba(20, 19, 19,0.45)";

interface VoiceEvent {
  id: string;
  purpose: string;
  customer_hash: string;
  decision: string | null;
  risk_score: number;
  q1: boolean | null;
  q2: boolean | null;
  q3: boolean | null;
  failure_reason: string | null;
  at: number;
}

const TOAST_MS = 12000;

export default function VoiceMfaToast() {
  const [toasts, setToasts] = useState<VoiceEvent[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  useEffect(() => {
    // The stream is admin-authenticated; without a token there is nothing to
    // show, so stay silent rather than opening a doomed connection.
    const token = getAdminToken();
    if (!token) return;

    let es: EventSource | null = null;
    try {
      es = new EventSource(apiUrl(`/api/btic/events/stream?token=${encodeURIComponent(token)}`));
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d?.type !== "voice_mfa") return;
          const item: VoiceEvent = {
            id: d.verification_id || String(Date.now()),
            purpose: d.purpose || "registration",
            customer_hash: d.customer_hash || "unknown",
            decision: d.decision ?? null,
            risk_score: d.risk_score ?? 0,
            q1: d.q1 ?? null, q2: d.q2 ?? null, q3: d.q3 ?? null,
            failure_reason: d.failure_reason ?? null,
            at: Date.now(),
          };
          // Newest first, capped — a burst of sign-ins must not bury the screen.
          setToasts((t) => [item, ...t.filter((x) => x.id !== item.id)].slice(0, 4));
          setTimeout(() => dismiss(item.id), TOAST_MS);
        } catch { /* non-JSON heartbeat */ }
      };
      es.onerror = () => { /* EventSource retries on its own */ };
    } catch { /* SSE unavailable — the list view still works */ }

    return () => { es?.close(); };
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed", right: 18, bottom: 18, zIndex: 9999,
        display: "flex", flexDirection: "column", gap: 10, maxWidth: 340,
      }}
    >
      {toasts.map((t) => {
        const col = t.decision === "APPROVE" ? OK
          : t.decision === "STEP_UP" ? WARN
            : t.decision === "HARD_BLOCK" ? BAD : MUTED;
        const answered = t.q1 === true;
        return (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            style={{
              background: "rgba(243, 243, 243,0.96)",
              backdropFilter: "blur(14px)",
              border: `1px solid color-mix(in oklch, ${col} 40%, transparent)`,
              borderLeft: `3px solid ${col}`,
              borderRadius: 12, padding: "12px 14px", cursor: "pointer",
              boxShadow: "0 18px 40px -24px rgba(16,15,15,0.22)",
              animation: "bdnaToastIn 0.25s cubic-bezier(0.16,1,0.3,1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, fontFamily: C.mono, fontWeight: 700, color: col, letterSpacing: "0.05em" }}>
                🎙️ {t.purpose === "login" ? "NEW LOGIN" : "NEW REGISTRATION"}
              </span>
              <span style={{ fontSize: 9.5, fontFamily: C.mono, color: MUTED }}>risk {t.risk_score}</span>
            </div>

            <div style={{ fontSize: 12, color: "#100F0F", fontWeight: 600, marginBottom: 5, wordBreak: "break-all" }}>
              {t.customer_hash.length > 20 ? t.customer_hash.slice(0, 16) + "…" : t.customer_hash}
            </div>

            <div style={{ fontSize: 11, color: "#575452", lineHeight: 1.45 }}>
              {t.purpose === "login" ? "“Did you just sign in?”" : "“Did you just register?”"}{" "}
              <span style={{ color: answered ? OK : BAD, fontWeight: 700, fontFamily: C.mono }}>
                {t.q1 === true ? "YES" : t.q1 === false ? "NO" : "—"}
              </span>
            </div>

            {t.failure_reason && (
              <div style={{ marginTop: 6, fontSize: 10.5, color: col, lineHeight: 1.4 }}>
                {t.failure_reason}
              </div>
            )}

            <div style={{ marginTop: 7, fontSize: 10, fontFamily: C.mono, fontWeight: 700, color: col }}>
              {t.decision ?? "—"}
            </div>
          </div>
        );
      })}
      <style>{`@keyframes bdnaToastIn{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}`}</style>
    </div>
  );
}
