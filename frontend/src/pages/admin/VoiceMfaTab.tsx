/**
 * Citadel — Voice MFA verifications (FIU console tab)
 * =======================================================
 * Every registration-time voice verification, with the three answers, the
 * verdict, and what the verdict actually did (blocked / filed / anchored).
 *
 * Reads GET /api/voice-mfa/verifications, which is fiu_admin-only — hence the
 * admin-token-aware fetch passed in from the parent rather than the customer
 * token DashboardPage normally carries.
 */

import { useCallback, useEffect, useState } from "react";
import { C } from "../../lib/theme";

const OK = "#3D8B5A";
const WARN = "#B7791F";
const BAD = "#B3261E";
const MUTED = "rgba(20, 19, 19,0.42)";

export interface VoiceVerification {
  verification_id: string;
  customer_hash: string;
  phone_last4: string;
  status: string;
  decision: string | null;
  risk_score: number;
  q1_registered: boolean | null;
  q2_not_coerced: boolean | null;
  q3_location_match: boolean | null;
  expected_city: string | null;
  failure_reason: string | null;
  simulated: boolean;
  created_at: string | null;
  completed_at: string | null;
}

const decisionColor = (d: string | null) =>
  d === "APPROVE" ? OK : d === "STEP_UP" ? WARN : d === "HARD_BLOCK" ? BAD : MUTED;

/** Per-question cell. Deliberately renders NULL distinctly from NO — an
 *  unanswered question is "no evidence", not a failure. */
function Answer({ label, value }: { label: string; value: boolean | null }) {
  const col = value === true ? OK : value === false ? BAD : MUTED;
  const text = value === true ? "YES" : value === false ? "NO" : "—";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 74 }}>
      <span style={{ fontSize: 10.5, color: MUTED, fontFamily: C.mono, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: C.mono, color: col }}>{text}</span>
    </div>
  );
}

export default function VoiceMfaTab({
  fetcher,
}: {
  /** Admin-token-aware fetch supplied by the parent console. */
  fetcher: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  const [rows, setRows] = useState<VoiceVerification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "HARD_BLOCK" | "STEP_UP" | "APPROVE">("ALL");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setError(null);
      try {
        const r = await fetcher("/api/voice-mfa/verifications?limit=100");
        if (!r.ok) throw new Error(r.status === 403 ? "Sign in to /admin as FIU ADMIN to view voice verifications." : `HTTP ${r.status}`);
        setRows(await r.json());
        setError(null);
      } catch (e) {
        if (!silent) setError(e instanceof Error ? e.message : "Failed to load verifications");
      }
    },
    [fetcher],
  );

  useEffect(() => {
    load();
    // Silent poll so the list stays live without flashing a skeleton.
    const t = setInterval(() => load(true), 12000);
    return () => clearInterval(t);
  }, [load]);

  const shown = (rows ?? []).filter((r) => filter === "ALL" || r.decision === filter);
  const count = (d: string) => (rows ?? []).filter((r) => r.decision === d).length;

  return (
    <div>
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 12, marginBottom: 18 }}>
        {([
          ["Total", (rows ?? []).length, "var(--color-primary)"],
          ["Verified", count("APPROVE"), OK],
          ["Step-up", count("STEP_UP"), WARN],
          ["Blocked", count("HARD_BLOCK"), BAD],
        ] as const).map(([label, val, col]) => (
          <div
            key={label}
            style={{
              padding: "13px 16px", borderRadius: 12,
              background: "#FFFFFF", border: "1px solid #EAE4E1",
            }}
          >
            <div style={{ fontSize: 21, fontWeight: 800, color: col, fontFamily: C.mono }}>{val}</div>
            <div style={{ fontSize: 10.5, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 3 }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap" }}>
        {(["ALL", "HARD_BLOCK", "STEP_UP", "APPROVE"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "6px 12px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${filter === f ? "rgba(16, 15, 15,0.18)" : "transparent"}`,
              background: filter === f ? "rgba(16, 15, 15,0.07)" : "transparent",
              color: filter === f ? "#100F0F" : MUTED,
              fontSize: 12, fontFamily: C.mono, fontWeight: 600, letterSpacing: "0.04em",
            }}
          >
            {f.replace("_", " ")}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: "13px 16px", borderRadius: 12, background: "rgba(179, 38, 30,0.07)", border: "1px solid rgba(179, 38, 30,0.25)", fontSize: 13.5, color: BAD, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {rows === null && !error && (
        <div style={{ fontSize: 13.5, color: MUTED, fontFamily: C.mono }}>Loading…</div>
      )}

      {rows !== null && shown.length === 0 && !error && (
        <div style={{ padding: "22px", borderRadius: 12, background: "#FFFFFF", border: "1px solid #EAE4E1", fontSize: 14, color: MUTED, lineHeight: 1.6 }}>
          No voice verifications{filter !== "ALL" ? ` with decision ${filter.replace("_", " ")}` : ""} yet.
          They are created when a customer completes registration on the ZipPay demo.
        </div>
      )}

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {shown.map((v) => (
          <div
            key={v.verification_id}
            style={{
              padding: "13px 16px", borderRadius: 12,
              background: "#FFFFFF",
              border: "1px solid #EAE4E1",
              borderLeft: `3px solid ${decisionColor(v.decision)}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 800, color: decisionColor(v.decision) }}>
                  {v.decision ?? v.status}
                </span>
                <span style={{ fontSize: 13, color: "#100F0F", fontWeight: 600 }}>
                  {v.customer_hash.length > 18 ? v.customer_hash.slice(0, 14) + "…" : v.customer_hash}
                </span>
                {v.phone_last4 && (
                  <span style={{ fontSize: 11.5, fontFamily: C.mono, color: MUTED }}>••••{v.phone_last4}</span>
                )}
                {v.simulated && (
                  <span style={{ fontSize: 10.5, fontFamily: C.mono, color: WARN, border: `1px solid ${WARN}55`, borderRadius: 20, padding: "2px 7px" }}>
                    SIMULATED
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11.5, fontFamily: C.mono, color: MUTED }}>
                risk {v.risk_score} · {v.created_at ? new Date(v.created_at).toLocaleString() : ""}
              </span>
            </div>

            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: v.failure_reason ? 9 : 0 }}>
              <Answer label="Registered" value={v.q1_registered} />
              <Answer label="Not coerced" value={v.q2_not_coerced} />
              <Answer label={`In ${v.expected_city || "city"}`} value={v.q3_location_match} />
            </div>

            {v.failure_reason && (
              <div style={{ fontSize: 13, color: decisionColor(v.decision), lineHeight: 1.45 }}>
                {v.failure_reason}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
