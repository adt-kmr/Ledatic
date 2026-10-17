// Citadel — Module 4: zk-SNARK Biometric Passport (live demo panel)
// =====================================================================
// Demonstrates Groth16 soundness on stage, three ways:
//
//   1. HONEST PROVER  — risk within policy → proof generates and VERIFIES
//   2. TAMPERED PROOF — mutate one field of a valid proof → REJECTED
//   3. CHEATING PROVER — risk above threshold → CANNOT EVEN GENERATE a proof
//                        (the witness is unsatisfiable; proving throws)
//
// The client proves it knows the secret behind an enrolled Poseidon baseline
// AND that its risk is within threshold — without revealing the features, the
// secret, or the exact score. Verification is pure-Python pairing check.
//
// Proving runs in the browser and is genuinely CPU-heavy (seconds) — that
// latency is real work, not a fake spinner.

import { useCallback, useEffect, useState } from "react";
import { C } from "../../lib/theme";
import {
  generatePassportProof, resolvePassportInputs, isDeviceEnrolled,
  type ZkProof, type PassportInputs,
} from "../../lib/zkPassport";
import { getZkParams, verifyZkProof, type ZkParams } from "../../lib/securityApi";
import {
  BAD, MUTED, OK,
  ButtonRow, LogConsole, ModuleShell, RunButton, StatRow, VerdictBadge,
  now, type LogLine, type StepState,
} from "./SecurityKit";

interface Outcome { state: StepState; text: string; }

// The telemetry the feature commitment binds to. Kept stable within the panel
// so repeated proofs are comparable; in the login flow this is the real signal
// bundle captured by the SDK.
const TELEMETRY = { module: "zk_passport_demo", channel: "internet_banking" };

export default function ZkPassportPanel() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [params, setParams] = useState<ZkParams | null>(null);
  const [riskScore, setRiskScore] = useState(120);
  const [proof, setProof] = useState<ZkProof | null>(null);
  const [proveMs, setProveMs] = useState<number | null>(null);

  const [honest, setHonest] = useState<Outcome | null>(null);
  const [tamper, setTamper] = useState<Outcome | null>(null);
  const [cheat, setCheat] = useState<Outcome | null>(null);

  const push = useCallback((text: string, tone?: LogLine["tone"]) => {
    setLog((l) => [...l.slice(-90), { text, tone, ts: now() }]);
  }, []);

  const [inputs, setInputs] = useState<PassportInputs | null>(null);

  useEffect(() => { void getZkParams().then(setParams); }, []);

  // Resolve the REAL device enrolment inputs so the operator can see the
  // secret is device-generated (and persisted), not a source constant.
  useEffect(() => {
    void resolvePassportInputs(TELEMETRY).then(setInputs).catch(() => setInputs(null));
  }, []);

  const threshold = params?.max_risk_threshold ?? 300;
  const withinPolicy = riskScore < threshold;

  // ── 1 + 2: honest prover, then tamper with the resulting proof ─────────────
  const runHonestAndTamper = async () => {
    setBusy("honest");
    setHonest(null); setTamper(null); setProof(null); setProveMs(null);

    push(`▶ Proving: riskScore=${riskScore} < threshold=${threshold} …`, "warn");
    push("  (Groth16 witness + proof generation in-browser — this is real work)", "dim");

    const t0 = performance.now();
    const p = await generatePassportProof(riskScore, threshold, TELEMETRY);
    const dt = Math.round(performance.now() - t0);
    setProveMs(dt);

    if (!p) {
      push(`✖ proof generation failed after ${dt}ms`, "bad");
      setHonest({ state: "fail", text: "COULD NOT PROVE" });
      setBusy(null);
      return;
    }
    setProof(p);
    push(`✔ proof generated in ${dt}ms`, "ok");
    push(`  public signals: [${p.publicSignals.join(", ")}]`, "dim");
    push("  ⚠ raw features, secret and exact score were NOT revealed", "dim");

    push("▶ Verifying proof server-side (pure-Python pairing check) …", "warn");
    const v = await verifyZkProof(p.proof, p.publicSignals);
    if (v?.verified) {
      push("✔ PROOF VERIFIED — statement is true, privacy preserved", "ok");
      setHonest({ state: "pass", text: "VERIFIED" });
    } else {
      push(`✖ verification returned ${String(v?.verified)}`, "bad");
      setHonest({ state: "fail", text: "REJECTED" });
      setBusy(null);
      return;
    }

    // 2 — tamper with the valid proof and re-verify
    push("▶ Attacker TAMPERS with one field of the valid proof …", "warn");
    const bad = JSON.parse(JSON.stringify(p.proof)) as Record<string, any>;
    if (Array.isArray(bad.pi_a) && bad.pi_a.length > 0) {
      // Flip the first coordinate — still well-formed, cryptographically wrong.
      bad.pi_a[0] = bad.pi_a[0] === "1" ? "2" : "1";
    }
    const v2 = await verifyZkProof(bad, p.publicSignals);
    if (v2 && v2.verified === false) {
      push("✖ TAMPERED PROOF REJECTED — soundness holds", "bad");
      setTamper({ state: "fail", text: "REJECTED ✓ (expected)" });
    } else {
      push(`⚠ unexpected verify result: ${String(v2?.verified)}`, "warn");
      setTamper({ state: "neutral", text: `GOT ${String(v2?.verified)}` });
    }

    setBusy(null);
  };

  // ── 3: cheating prover — risk above the policy threshold ───────────────────
  const runCheatDemo = async () => {
    setBusy("cheat");
    setCheat(null);
    const cheatScore = threshold + 250;
    push(`▶ Cheating prover attempts riskScore=${cheatScore} (over threshold ${threshold}) …`, "warn");

    const t0 = performance.now();
    const p = await generatePassportProof(cheatScore, threshold, TELEMETRY);
    const dt = Math.round(performance.now() - t0);

    if (p === null) {
      push(`✖ PROOF GENERATION IMPOSSIBLE (${dt}ms) — witness unsatisfiable`, "bad");
      push("  the circuit refuses to prove a false statement", "ok");
      push("  a liar cannot even produce a proof, let alone pass verification", "ok");
      setCheat({ state: "fail", text: "CANNOT PROVE ✓ (expected)" });
    } else {
      // Should be unreachable with a correctly compiled circuit; verify anyway
      // rather than claiming success we have not actually checked.
      const v = await verifyZkProof(p.proof, p.publicSignals);
      if (v?.verified) {
        push("⚠ a proof was produced AND verified above threshold — investigate circuit", "bad");
        setCheat({ state: "neutral", text: "UNEXPECTED: VERIFIED" });
      } else {
        push("✖ proof produced but REJECTED at verification", "bad");
        setCheat({ state: "fail", text: "REJECTED ✓" });
      }
    }
    setBusy(null);
  };

  return (
    <ModuleShell
      index={4}
      title="zk-SNARK Biometric Passport"
      threat="Biometric privacy leakage · central biometric honeypots"
      tech="Groth16 (Circom/snarkjs) · BN128 · Poseidon commitment"
      caveat="Real compiled circuit and trusted setup — proving runs in-browser and verification is a pure-Python pairing check, no trusted third party. The enrolment secret is generated on THIS device with crypto.getRandomValues() and persisted locally; it is never transmitted, and the feature commitment is derived from the session's real telemetry. Clearing site data re-enrols the device with a new secret and a different baseline."
    >
      {/* Circuit params */}
      <div style={{ marginBottom: 14 }}>
        <StatRow
          label="Circuit"
          value={params ? `${params.protocol} · ${params.curve}` : "loading…"}
          color={params?.available ? OK : MUTED}
        />
        <StatRow
          label="Verifier"
          value={
            <VerdictBadge
              state={params ? (params.available ? "pass" : "fail") : "idle"}
              text={params ? (params.available ? "AVAILABLE" : "UNAVAILABLE") : "…"}
            />
          }
        />
        <StatRow label="Policy threshold" value={`risk < ${threshold}`} color="rgba(16, 15, 15,0.7)" />
        <StatRow
          label="Device enrolment"
          value={
            <VerdictBadge
              state={isDeviceEnrolled() ? "pass" : "neutral"}
              text={isDeviceEnrolled() ? "ENROLLED (device-local secret)" : "NOT YET ENROLLED"}
            />
          }
        />
      </div>

      {/* Real enrolment material — proves the secret is device-generated */}
      {inputs && (
        <div
          style={{
            marginBottom: 14, padding: "11px 13px", borderRadius: 9,
            background: "rgba(255, 255, 255,0.3)", border: "1px solid #EAE4E1",
          }}
        >
          <div style={{ fontSize: 11.5, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7, fontFamily: "'Inter', sans-serif" }}>
            This device's enrolment (private — never transmitted)
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 11.5, color: "rgba(16, 15, 15,0.5)", lineHeight: 1.75, wordBreak: "break-all" }}>
            <div>featureCommit <span style={{ color: "rgba(16, 15, 15,0.72)" }}>{inputs.featureCommit.toString().slice(0, 40)}…</span></div>
            <div>imeiSecret&nbsp;&nbsp;&nbsp; <span style={{ color: BAD }}>{inputs.imeiSecret.toString().slice(0, 12)}…… (device-local, CSPRNG)</span></div>
            <div>baselineHash&nbsp; <span style={{ color: OK }}>{inputs.baselineHash.slice(0, 40)}…</span></div>
          </div>
        </div>
      )}

      {/* Risk slider — lets the jury see the policy boundary directly */}
      <div
        style={{
          marginBottom: 14, padding: "13px 15px", borderRadius: 10,
          background: "rgba(255, 255, 255,0.3)", border: "1px solid #EAE4E1",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 11.5, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'Inter', sans-serif" }}>
            Private input · behavioural risk score
          </span>
          <VerdictBadge
            state={withinPolicy ? "pass" : "fail"}
            text={withinPolicy ? `${riskScore} · WITHIN POLICY` : `${riskScore} · OVER THRESHOLD`}
          />
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(600, threshold + 300)}
          value={riskScore}
          onChange={(e) => setRiskScore(Number(e.target.value))}
          style={{ width: "100%", accentColor: withinPolicy ? OK : BAD, cursor: "pointer" }}
        />
        <div style={{ fontSize: 12, color: MUTED, fontFamily: C.mono, marginTop: 6 }}>
          {withinPolicy
            ? "a proof CAN be generated for this score"
            : "witness is unsatisfiable — proving will correctly fail"}
        </div>
      </div>

      <ButtonRow>
        <RunButton onClick={runHonestAndTamper} busy={busy === "honest"} disabled={!!busy}>
          ▶ Prove &amp; Verify
        </RunButton>
        <RunButton onClick={runCheatDemo} busy={busy === "cheat"} disabled={!!busy} variant="danger">
          ▶ Try To Cheat
        </RunButton>
      </ButtonRow>

      {/* Soundness results */}
      {(honest || tamper || cheat) && (
        <div style={{ marginBottom: 14 }}>
          {honest && <StatRow label="1 · Honest prover" value={<VerdictBadge state={honest.state} text={honest.text} />} />}
          {tamper && <StatRow label="2 · Tampered proof" value={<VerdictBadge state={tamper.state} text={tamper.text} />} />}
          {cheat && <StatRow label="3 · Cheating prover" value={<VerdictBadge state={cheat.state} text={cheat.text} />} />}
          {proveMs !== null && <StatRow label="Proving time" value={`${proveMs} ms (in-browser)`} color="rgba(16, 15, 15,0.7)" />}
        </div>
      )}

      {/* The proof itself */}
      {proof && (
        <div
          style={{
            marginBottom: 14, padding: "11px 13px", borderRadius: 9,
            background: "rgba(255, 255, 255,0.32)", border: "1px solid #EAE4E1",
          }}
        >
          <div style={{ fontSize: 11.5, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7, fontFamily: "'Inter', sans-serif" }}>
            Public signals (all the verifier ever sees)
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 12, color: OK, wordBreak: "break-all", lineHeight: 1.7 }}>
            [{proof.publicSignals.join(", ")}]
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 11.5, color: MUTED, marginTop: 7, lineHeight: 1.6 }}>
            no raw features · no device secret · no exact risk score
          </div>
        </div>
      )}

      <LogConsole lines={log} empty="Generate a proof to see soundness demonstrated…" height={190} />
    </ModuleShell>
  );
}
