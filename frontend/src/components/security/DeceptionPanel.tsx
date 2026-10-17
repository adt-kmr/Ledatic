// Citadel — Module 2: Active Deception & HoneyTrap (live demo panel)
// ======================================================================
// Lets an operator spring both traps on stage and watch the response:
//   • DOM honeypot  — an invisible field only a bot would fill
//   • Decoy APIs    — fake admin/debug endpoints no real client ever calls
// Either one → risk 1000 hard block + 24h IP blacklist + live FIU alert.
//
// IMPORTANT (demo failsafe): springing a trap blacklists THIS host, which then
// 403s every other API call — including the other three security modules. The
// Reset control is therefore always visible and is deliberately exempt from the
// blacklist server-side, so a self-lockout on stage is always recoverable.

import { useCallback, useEffect, useRef, useState } from "react";
import { C } from "../../lib/theme";
import {
  DECOY_PATHS,
  getDeceptionStatus,
  probeDecoy,
  reportHoneypot,
  resetDeception,
  securityEvaluate,
  threatStreamUrl,
  type SecurityVerdict,
} from "../../lib/securityApi";
import {
  BAD, MUTED, OK, WARN,
  ButtonRow, IntegrationStrip, LogConsole, ModuleShell, RunButton, StatRow, VerdictBadge,
  now, type LogLine,
} from "./SecurityKit";

interface TrapEvent {
  kind?: string;
  reason?: string;
  client_ip?: string;
  path?: string;
  severity?: string;
  risk_score?: number;
  timestamp?: number;
}

export default function DeceptionPanel() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [blacklisted, setBlacklisted] = useState<boolean | null>(null);
  const [traps, setTraps] = useState<TrapEvent[]>([]);
  const [honeypotValue, setHoneypotValue] = useState("");
  const [verdict, setVerdict] = useState<SecurityVerdict | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const push = useCallback((text: string, tone?: LogLine["tone"]) => {
    setLog((l) => [...l.slice(-80), { text, tone, ts: now() }]);
  }, []);

  // ── Status poll ────────────────────────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    const s = await getDeceptionStatus();
    if (s && typeof s.your_ip_blacklisted === "boolean") {
      setBlacklisted(s.your_ip_blacklisted);
      if (Array.isArray(s.recent_traps)) setTraps(s.recent_traps as TrapEvent[]);
    } else {
      // Non-status body means this host is being blocked by the middleware.
      setBlacklisted(true);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const t = setInterval(refreshStatus, 8000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  // ── Live SSE trap feed ─────────────────────────────────────────────────────
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(threatStreamUrl());
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as TrapEvent;
          setTraps((prev) => [data, ...prev].slice(0, 25));
          push(
            `⚡ TRAP · ${data.kind ?? "EVENT"} · ${data.reason ?? data.path ?? ""}`,
            "bad",
          );
        } catch {
          /* non-JSON heartbeat — ignore */
        }
      };
      es.onerror = () => { /* stream retries on its own; status poll is the backstop */ };
    } catch {
      /* EventSource unavailable — the status poll still drives the panel */
    }
    return () => { es?.close(); esRef.current = null; };
  }, [push]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const runDecoyProbe = async () => {
    const path = DECOY_PATHS[0];
    setBusy("decoy");
    push(`▶ Attacker scanner probing ${path} …`, "warn");
    const r = await probeDecoy(path);
    if (r.trapped) {
      push(`✖ DECOY TRIPPED — HTTP 403, risk=1000, IP blacklisted 24h`, "bad");
      push(`  This host is now blocked. Use RESET TRAPS to recover.`, "warn");
      setBlacklisted(true);
    } else if (r.httpStatus === 0) {
      push(`network error probing ${path}`, "warn");
    } else {
      push(`decoy returned HTTP ${r.httpStatus}`, "warn");
    }
    setBusy(null);
    void refreshStatus();
  };

  const runHoneypotFill = async () => {
    setBusy("honeypot");
    setVerdict(null);
    // Exactly what a form-filling bot does: populate every field it can see in
    // the DOM, including the one that is invisible to a human.
    setHoneypotValue("bot@stuffing-script.io");
    push(`▶ Bot auto-fills hidden field "company_website" …`, "warn");
    const res = await reportHoneypot(null, "company_website", 21);
    if (res) {
      push(
        `✖ HONEYPOT TRIPPED — decision=${res.decision} risk=${res.risk_score} blacklisted=${res.blacklisted}`,
        "bad",
      );
      setBlacklisted(!!res.blacklisted);
    } else {
      push(`honeypot report failed (host may already be blacklisted)`, "warn");
      setBlacklisted(true);
    }

    // Run the trap through the unified gate so the block is attributed,
    // persisted, and anchored — this is what makes it a system event rather
    // than a local UI state change.
    push("▶ Routing trap through unified security gate …", "warn");
    const v = await securityEvaluate({
      sessionId: `deception-demo-${Date.now()}`,
      telemetryBundle: { demo: "active_deception" },
      honeypotInteracted: true,
      proveZk: false,
      customerHash: "Harsh",
      behavioralRisk: 120,
    });
    if (v) {
      setVerdict(v);
      push(`✔ fused decision ${v.fused_decision} (risk ${v.fused_risk_score})`, "bad");
      if (v.persisted_session_id) {
        push(`✔ persisted → visible in FIU Fraud Reports`, "ok");
      }
      if (v.blockchain_anchor?.on_chain) {
        push(`✔ anchored on Hyperledger Fabric (${v.blockchain_anchor.latency_ms}ms)`, "ok");
      } else {
        push(`• ledger anchor unavailable (${v.blockchain_anchor?.reason ?? "offline"})`, "warn");
      }
    } else {
      push("gate evaluation unavailable (host blacklisted — reset to retry)", "warn");
    }

    setBusy(null);
    void refreshStatus();
  };

  const runReset = async () => {
    setBusy("reset");
    push(`▶ Clearing deception blacklist …`, "warn");
    const ok = await resetDeception(false);
    push(
      ok ? `✔ Blacklist cleared — demo ready to re-run` : `reset failed`,
      ok ? "ok" : "bad",
    );
    setHoneypotValue("");
    setVerdict(null);
    setBusy(null);
    void refreshStatus();
  };

  const blState: "pass" | "fail" | "neutral" =
    blacklisted === null ? "neutral" : blacklisted ? "fail" : "pass";

  return (
    <ModuleShell
      index={2}
      title="Active Deception & HoneyTrap"
      threat="Bots · credential stuffing · endpoint scanning"
      tech="DOM honeypots + decoy APIs + 24h IP blacklist"
      caveat="Traps fire on behaviour no genuine client ever exhibits (filling an invisible field, requesting a non-existent admin route), so there is no legitimate-user false-positive path. Springing a trap blacklists this host — Reset Traps restores it."
    >
      {/* Live state */}
      <div style={{ marginBottom: 14 }}>
        <StatRow
          label="Decoy endpoints"
          value={`${DECOY_PATHS.length} ARMED`}
          color={OK}
        />
        <StatRow
          label="This host"
          value={
            <VerdictBadge
              state={blState}
              text={blacklisted === null ? "CHECKING…" : blacklisted ? "BLACKLISTED" : "CLEAN"}
            />
          }
        />
        <StatRow label="Traps recorded" value={String(traps.length)} color={traps.length ? WARN : MUTED} />
      </div>

      {/* Armed decoy list — shows the jury what an attacker would find */}
      <div
        style={{
          marginBottom: 14, padding: "10px 12px", borderRadius: 9,
          background: "rgba(255, 255, 255,0.3)", border: "1px solid #EAE4E1",
        }}
      >
        <div style={{ fontSize: 11.5, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7, fontFamily: "'Inter', sans-serif" }}>
          Armed decoy routes
        </div>
        {DECOY_PATHS.map((p) => (
          <div key={p} style={{ fontFamily: C.mono, fontSize: 12.5, color: "rgba(16, 15, 15,0.5)", lineHeight: 1.8 }}>
            <span style={{ color: BAD }}>▸</span> {p}
          </div>
        ))}
      </div>

      {/* The actual DOM honeypot, revealed for the demo.
          In the real login form this carries the same name but is visually
          hidden — here it is shown so the jury can see what the bot filled. */}
      <div
        style={{
          marginBottom: 14, padding: "12px 14px", borderRadius: 9,
          background: "rgba(179, 38, 30,0.045)", border: "1px dashed rgba(179, 38, 30,0.3)",
        }}
      >
        <div style={{ fontSize: 11.5, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontFamily: "'Inter', sans-serif" }}>
          DOM honeypot field · <span style={{ color: BAD }}>invisible to humans, shown here for the demo</span>
        </div>
        <input
          readOnly
          value={honeypotValue}
          placeholder="(empty — a human never fills this)"
          style={{
            width: "100%", padding: "9px 11px", borderRadius: 7,
            border: "1px solid #D7D2D0",
            background: "rgba(255, 255, 255,0.35)",
            color: honeypotValue ? BAD : "rgba(16, 15, 15,0.35)",
            fontSize: 13.5, fontFamily: C.mono, outline: "none",
          }}
        />
      </div>

      <ButtonRow>
        <RunButton onClick={runDecoyProbe} busy={busy === "decoy"} disabled={!!busy} variant="danger">
          ▶ Probe Decoy API
        </RunButton>
        <RunButton onClick={runHoneypotFill} busy={busy === "honeypot"} disabled={!!busy} variant="danger">
          ▶ Simulate Bot Fill
        </RunButton>
        <RunButton onClick={runReset} busy={busy === "reset"} disabled={!!busy} variant="primary">
          ↺ Reset Traps
        </RunButton>
      </ButtonRow>

      <LogConsole lines={log} empty="Spring a trap to see the response…" height={165} />

      {verdict && (
        <IntegrationStrip
          behavioralRisk={verdict.behavioral_risk}
          securityRisk={verdict.security_risk_score}
          fusedRisk={verdict.fused_risk_score}
          fusedDecision={verdict.fused_decision}
          persistedSessionId={verdict.persisted_session_id}
          anchor={verdict.blockchain_anchor}
        />
      )}

      {/* Recent traps (persists across reset — evidence trail) */}
      {traps.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11.5, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontFamily: "'Inter', sans-serif" }}>
            Trap evidence trail
          </div>
          {traps.slice(0, 6).map((t, i) => (
            <div
              key={i}
              style={{
                display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
                padding: "7px 10px", marginBottom: 5, borderRadius: 7,
                background: "rgba(179, 38, 30,0.05)",
                borderLeft: `2px solid ${BAD}`,
                fontFamily: C.mono, fontSize: 12,
              }}
            >
              <span style={{ color: BAD, fontWeight: 700 }}>{t.kind ?? "TRAP"}</span>
              <span style={{ color: "rgba(16, 15, 15,0.55)", flex: 1, minWidth: 0 }}>
                {t.reason ?? t.path ?? ""}
              </span>
              {t.risk_score != null && <span style={{ color: BAD }}>risk {t.risk_score}</span>}
              {t.client_ip && <span style={{ color: MUTED }}>{t.client_ip}</span>}
            </div>
          ))}
        </div>
      )}
    </ModuleShell>
  );
}
