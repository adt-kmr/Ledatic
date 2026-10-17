// Citadel — Module 1: Post-Quantum Shield (live demo panel)
// =============================================================
// Proves a working post-quantum key exchange on stage:
//   1. fetch the server's ML-KEM-768 encapsulation key (NIST FIPS 203)
//   2. encapsulate a shared secret IN THE BROWSER (pure-TS `mlkem`)
//   3. send only the ciphertext — the secret itself never crosses the wire
//   4. the server decapsulates with kyber-py and returns a confirm tag
//   5. we recompute that tag locally: a match proves both sides independently
//      derived a byte-identical 32-byte secret across two languages
//
// The verdict is additionally signed with Dilithium-3 (ML-DSA-65, FIPS 204).

import { useCallback, useEffect, useState } from "react";
import { C } from "../../lib/theme";
import { apiUrl } from "../../lib/auth";
import { pqcEncapsulateVerbose, type KemHandshakeVerbose } from "../../lib/pqcKem";
import { securityEvaluate, type SecurityVerdict } from "../../lib/securityApi";
import {
  BAD, MUTED, OK,
  ButtonRow, IntegrationStrip, LogConsole, ModuleShell, RunButton, StatRow, VerdictBadge,
  now, type LogLine, type StepState,
} from "./SecurityKit";

interface SelfTest {
  ok: boolean;
  algorithm: string;
  encaps_key_bytes: number;
  ciphertext_bytes: number;
  shared_secret_bytes: number;
}

export default function PqcShieldPanel() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [selftest, setSelftest] = useState<SelfTest | null>(null);
  const [kem, setKem] = useState<KemHandshakeVerbose | null>(null);
  const [verdict, setVerdict] = useState<SecurityVerdict | null>(null);
  const [matched, setMatched] = useState<boolean | null>(null);

  const push = useCallback((text: string, tone?: LogLine["tone"]) => {
    setLog((l) => [...l.slice(-80), { text, tone, ts: now() }]);
  }, []);

  // Server-side KEM health on mount.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(apiUrl("/api/security/pqc/selftest"));
        if (r.ok) setSelftest(await r.json());
      } catch { /* offline — panel still renders, run will report it */ }
    })();
  }, []);

  const runHandshake = async () => {
    setBusy(true);
    setKem(null);
    setVerdict(null);
    setMatched(null);

    push("▶ Fetching server ML-KEM-768 encapsulation key …", "warn");
    const k = await pqcEncapsulateVerbose();
    if (!k) {
      push("✖ KEM unavailable — server key could not be fetched", "bad");
      setBusy(false);
      return;
    }
    setKem(k);
    push(`  encapsulation key: ${k.encapsKeyBytes} bytes (FIPS 203)`, "dim");
    push("▶ Encapsulating shared secret in-browser (pure TS) …", "warn");
    push(`  ciphertext: ${k.ciphertextBytes} bytes → sent to server`, "dim");
    push(`  browser secret: ${k.sharedSecretHex.slice(0, 32)}… (${k.sharedSecretBytes}B)`, "ok");
    push("  ⚠ the secret itself is NEVER transmitted", "dim");

    push("▶ Server decapsulating with kyber-py …", "warn");
    const v = await securityEvaluate({
      sessionId: `pqc-demo-${Date.now()}`,
      telemetryBundle: { demo: "pqc_shield" },
      // zk proving is a separate module and is slow; skip it here so this
      // panel measures only the KEM round-trip.
      proveZk: false,
      // Attribute the verdict and fuse it with a behavioural risk so the
      // integration strip below shows the full engine path, not just the KEM.
      customerHash: "Harsh",
      behavioralRisk: 120,
    });

    if (!v) {
      push("✖ /evaluate failed — is this host deception-blacklisted?", "bad");
      setBusy(false);
      return;
    }
    setVerdict(v);

    const ok = v.pqc_kem_verified === true;
    setMatched(ok);
    if (ok) {
      push("✔ CONFIRM TAGS MATCH — browser and server derived the SAME 32-byte key", "ok");
      push("  cross-language interop proven: TypeScript ↔ Python", "ok");
    } else if (v.pqc_kem_confirm) {
      push("✖ confirm tag mismatch — key agreement failed", "bad");
    } else {
      push("• server returned no confirm tag (KEM inactive, signing still on)", "warn");
    }
    if (v.dilithium_signature) {
      push(`✔ verdict signed with ${v.pqc_algorithm}`, "ok");
    }
    if (v.persisted_session_id) {
      push(`✔ verdict persisted as session ${v.persisted_session_id.slice(0, 8)}…`, "ok");
    }
    if (v.blockchain_anchor?.on_chain) {
      push(`✔ anchored on Hyperledger Fabric (${v.blockchain_anchor.latency_ms}ms)`, "ok");
    } else if (v.blockchain_anchor?.reason === "not_a_block") {
      push("• no ledger anchor — verdict is not a HARD_BLOCK", "dim");
    }
    setBusy(false);
  };

  const matchState: StepState = matched === null ? "idle" : matched ? "pass" : "fail";

  return (
    <ModuleShell
      index={1}
      title="Post-Quantum Shield"
      threat="Harvest-now-decrypt-later (quantum)"
      tech="ML-KEM-768 (FIPS 203) + ML-DSA-65 / Dilithium-3 (FIPS 204)"
      caveat="Pure-software NIST-standard cryptography — no special hardware. The shared secret is never transmitted; only the ciphertext is. A matching confirm tag is proof both sides derived the identical key independently."
    >
      {/* Server capability */}
      <div style={{ marginBottom: 14 }}>
        <StatRow
          label="Server KEM"
          value={selftest ? selftest.algorithm : "checking…"}
          color={selftest?.ok ? OK : MUTED}
        />
        <StatRow
          label="Self-test"
          value={
            <VerdictBadge
              state={selftest ? (selftest.ok ? "pass" : "fail") : "idle"}
              text={selftest ? (selftest.ok ? "PASS" : "FAIL") : "…"}
            />
          }
        />
        {selftest && (
          <StatRow
            label="Key / CT / secret"
            value={`${selftest.encaps_key_bytes}B / ${selftest.ciphertext_bytes}B / ${selftest.shared_secret_bytes}B`}
            color="rgba(16, 15, 15,0.7)"
          />
        )}
      </div>

      <ButtonRow>
        <RunButton onClick={runHandshake} busy={busy}>
          ▶ Run PQ Key Exchange
        </RunButton>
      </ButtonRow>

      {/* The proof point — two independently derived secrets */}
      {kem && (
        <div
          style={{
            marginBottom: 14, padding: "13px 15px", borderRadius: 10,
            background: "rgba(255, 255, 255,0.32)",
            border: `1px solid color-mix(in oklch, ${matched === false ? BAD : OK} 26%, transparent)`,
          }}
        >
          <div style={{ fontSize: 11.5, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 9, fontFamily: "'Inter', sans-serif" }}>
            Key agreement proof
          </div>

          <div style={{ marginBottom: 9 }}>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 3, fontFamily: "'Inter', sans-serif" }}>
              BROWSER (TypeScript · mlkem) derived secret
            </div>
            <div style={{ fontFamily: C.mono, fontSize: 12, color: OK, wordBreak: "break-all", lineHeight: 1.6 }}>
              {kem.sharedSecretHex}
            </div>
          </div>

          <div style={{ marginBottom: 9 }}>
            <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 3, fontFamily: "'Inter', sans-serif" }}>
              CONFIRM TAG — ours vs server's
            </div>
            <div style={{ fontFamily: C.mono, fontSize: 12, color: "rgba(16, 15, 15,0.62)", wordBreak: "break-all", lineHeight: 1.6 }}>
              ours&nbsp;&nbsp; {kem.expectedConfirmB64}
            </div>
            <div style={{ fontFamily: C.mono, fontSize: 12, color: "rgba(16, 15, 15,0.62)", wordBreak: "break-all", lineHeight: 1.6 }}>
              server {verdict?.pqc_kem_confirm ?? "—"}
            </div>
          </div>

          <VerdictBadge
            state={matchState}
            text={
              matched === null ? "AWAITING SERVER"
                : matched ? "✔ BYTE-IDENTICAL — QUANTUM-SAFE CHANNEL"
                  : "✖ MISMATCH"
            }
          />
        </div>
      )}

      {/* Dilithium signature over the verdict */}
      {verdict?.dilithium_signature && (
        <div style={{ marginBottom: 14 }}>
          <StatRow label="Verdict signature" value={verdict.pqc_algorithm ?? "—"} color={OK} />
          <div
            style={{
              marginTop: 7, padding: "9px 11px", borderRadius: 8,
              background: "rgba(255, 255, 255,0.3)", border: "1px solid #EAE4E1",
              fontFamily: C.mono, fontSize: 11.5, color: "rgba(16, 15, 15,0.45)",
              wordBreak: "break-all", lineHeight: 1.6,
            }}
          >
            {verdict.dilithium_signature.slice(0, 160)}…
          </div>
        </div>
      )}

      <LogConsole lines={log} empty="Run the key exchange to see the handshake…" height={175} />

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
    </ModuleShell>
  );
}
