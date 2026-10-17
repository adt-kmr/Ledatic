// Citadel — Module 3: Anti-Spoofing & Replay Resistance (live demo panel)
// ===========================================================================
// Two independent defences, demonstrated separately because they have very
// different strength claims:
//
//   A. REPLAY RESISTANCE (hard cryptography, provable)
//      Server issues a single-use nonce; client signs (nonce || sha256(bundle))
//      with an ephemeral session key. Replaying a spent nonce is rejected;
//      tampering with the bundle breaks the signature.
//
//   B. MICRO-TREMOR FFT (calibrated behavioural heuristic, NOT crypto)
//      Human hands carry involuntary 8–12 Hz jitter; synthetic input is
//      unnaturally smooth. This CONTRIBUTES to the score and returns NEUTRAL
//      when the signal is insufficient — it never decides alone. That framing
//      is deliberate and is what the PPT commits to.

import { useCallback, useRef, useState } from "react";
import { C } from "../../lib/theme";
import { useMotionSignal } from "../../lib/useMotionSignal";
import {
  getNonce, hmacHex, securityEvaluateRaw, sha256Hex,
  type NonceResponse, type SecurityVerdict,
} from "../../lib/securityApi";
import {
  BAD, MUTED, OK,
  ButtonRow, LogConsole, ModuleShell, RunButton, SplitCompare, StatRow, VerdictBadge,
  now, type LogLine, type StepState,
} from "./SecurityKit";

const DEMO_BUNDLE = { keystroke_events: [1, 2, 3], channel: "internet_banking" };

const SAMPLES = 256;
const RATE_HZ = 60;

interface ReplayOutcome { label: string; status: string; state: StepState; }

/** Shape of cyber_verdicts.micro_tremor_fft returned by /api/security/evaluate. */
interface TremorVerdict {
  is_human: boolean | null;
  tremor_ratio?: number;
  reason?: string;
  confidence?: number;
  sampling_rate_hz?: number;
}

// The reference signals below are pointer-DELTA (dx) signals, which is what the
// server's FFT expects — not absolute position.
//
// They are placed ON an exact FFT bin (an integer number of cycles across the
// window). That matters: an off-bin component leaks energy across the whole
// spectrum, and that leakage alone lands ~0.08 of total energy inside the
// 8–12 Hz band — enough to read as "human" no matter how smooth the input is.
// On-bin signals isolate the phenomenon the heuristic is actually measuring.
const bin = (hz: number, n: number) => Math.round((hz * n) / RATE_HZ);

/** Scripted trajectory: one smooth low-frequency component, zero tremor. */
function botMotion(n = SAMPLES): number[] {
  const k = bin(2, n);
  return Array.from({ length: n }, (_, i) => 40 * Math.sin((2 * Math.PI * k * i) / n));
}

/** Human hand: the same intent motion plus involuntary ~10 Hz tremor + noise. */
function humanMotion(n = SAMPLES): number[] {
  const k = bin(2, n);
  const kt = bin(10, n);
  return Array.from({ length: n }, (_, i) =>
    40 * Math.sin((2 * Math.PI * k * i) / n) +
    22 * Math.sin((2 * Math.PI * kt * i) / n) +
    (Math.random() - 0.5) * 2,
  );
}

/** 60 Hz sample timestamps in ms, matching the motion arrays above. */
function timestamps(n = SAMPLES): number[] {
  const t0 = Date.now();
  return Array.from({ length: n }, (_, i) => t0 + Math.round((i * 1000) / RATE_HZ));
}

export default function AntiSpoofPanel() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // Replay demo state
  const [fresh, setFresh] = useState<ReplayOutcome | null>(null);
  const [replayed, setReplayed] = useState<ReplayOutcome | null>(null);
  const [tampered, setTampered] = useState<ReplayOutcome | null>(null);
  const spentRef = useRef<NonceResponse | null>(null);

  // Tremor demo state
  const [humanV, setHumanV] = useState<SecurityVerdict | null>(null);
  const [botV, setBotV] = useState<SecurityVerdict | null>(null);
  const [realV, setRealV] = useState<SecurityVerdict | null>(null);
  const [realN, setRealN] = useState(0);
  const { snapshot } = useMotionSignal();

  const push = useCallback((text: string, tone?: LogLine["tone"]) => {
    setLog((l) => [...l.slice(-90), { text, tone, ts: now() }]);
  }, []);

  const readReplay = (v: SecurityVerdict | null): string =>
    String((v?.cyber_verdicts ?? {})["replay_status"] ?? "NO_RESPONSE");

  // ── A. Replay resistance ───────────────────────────────────────────────────
  const runReplayDemo = async () => {
    setBusy("replay");
    setFresh(null); setReplayed(null); setTampered(null);

    // 1 — legitimate, freshly signed packet
    push("▶ [1/3] Requesting single-use nonce …", "warn");
    const n = await getNonce();
    if (!n) {
      push("✖ nonce request failed — host may be deception-blacklisted", "bad");
      setBusy(null);
      return;
    }
    spentRef.current = n;
    push(`  nonce ${n.nonce.slice(0, 24)}… (ttl ${n.ttl}s)`, "dim");

    const digest = await sha256Hex(DEMO_BUNDLE);
    const sig = await hmacHex(n.session_key, n.nonce, digest);
    push("▶ Signing (nonce ‖ sha256(bundle)) and submitting …", "warn");
    const v1 = await securityEvaluateRaw({
      sessionId: `replay-fresh-${Date.now()}`,
      nonce: n.nonce, bundleDigest: digest, signature: sig,
      telemetryBundle: DEMO_BUNDLE,
    });
    const s1 = readReplay(v1);
    const ok1 = s1.includes("FRESH") || s1.includes("SIGNED");
    setFresh({ label: "Legitimate packet", status: s1, state: ok1 ? "pass" : "fail" });
    push(ok1 ? `✔ ACCEPTED — ${s1}` : `unexpected: ${s1}`, ok1 ? "ok" : "warn");

    // 2 — attacker replays the exact same captured packet
    push("▶ [2/3] Attacker REPLAYS the identical captured packet …", "warn");
    const v2 = await securityEvaluateRaw({
      sessionId: `replay-attack-${Date.now()}`,
      nonce: n.nonce, bundleDigest: digest, signature: sig,
      telemetryBundle: DEMO_BUNDLE,
    });
    const s2 = readReplay(v2);
    const caught2 = s2.includes("REPLAY") || s2.includes("SPENT") || s2.includes("UNKNOWN");
    setReplayed({ label: "Replayed packet", status: s2, state: caught2 ? "fail" : "neutral" });
    push(
      caught2 ? `✖ REJECTED — ${s2} (nonce already spent)` : `⚠ got ${s2}`,
      caught2 ? "bad" : "warn",
    );

    // 3 — attacker tampers with the telemetry, keeping the old signature
    push("▶ [3/3] Attacker TAMPERS with telemetry, reuses signature …", "warn");
    const n3 = await getNonce();
    const tamperedDigest = await sha256Hex({ ...DEMO_BUNDLE, keystroke_events: [9, 9, 9] });
    const v3 = await securityEvaluateRaw({
      sessionId: `replay-tamper-${Date.now()}`,
      nonce: n3?.nonce ?? n.nonce,
      bundleDigest: tamperedDigest,
      signature: sig, // stale signature over the ORIGINAL digest
      telemetryBundle: { ...DEMO_BUNDLE, keystroke_events: [9, 9, 9] },
    });
    const s3 = readReplay(v3);
    const caught3 = s3.includes("BAD") || s3.includes("INVALID") || s3.includes("SIGNATURE") || s3.includes("UNKNOWN");
    setTampered({ label: "Tampered packet", status: s3, state: caught3 ? "fail" : "neutral" });
    push(
      caught3 ? `✖ REJECTED — ${s3} (signature does not cover new digest)` : `⚠ got ${s3}`,
      caught3 ? "bad" : "warn",
    );

    push("— replay defence is provable cryptography, not a heuristic", "dim");
    setBusy(null);
  };

  // ── B. Micro-tremor FFT ────────────────────────────────────────────────────
  const runTremorDemo = async () => {
    setBusy("tremor");
    setHumanV(null); setBotV(null);
    const ts = timestamps();

    push("▶ Submitting HUMAN-like motion (intent + 10 Hz tremor) …", "warn");
    const hv = await securityEvaluateRaw({
      sessionId: `tremor-human-${Date.now()}`,
      telemetryBundle: DEMO_BUNDLE,
      motionValues: humanMotion(), motionTimestamps: ts,
    });
    setHumanV(hv);
    const hf = (hv?.cyber_verdicts ?? {})["micro_tremor_fft"] as TremorVerdict | undefined;
    push(
      `  → is_human=${String(hf?.is_human)} ratio=${hf?.tremor_ratio ?? "—"}`,
      hf?.is_human ? "ok" : "warn",
    );

    push("▶ Submitting SYNTHETIC motion (perfectly smooth ramp) …", "warn");
    const bv = await securityEvaluateRaw({
      sessionId: `tremor-bot-${Date.now()}`,
      telemetryBundle: DEMO_BUNDLE,
      motionValues: botMotion(), motionTimestamps: ts,
    });
    setBotV(bv);
    const bf = (bv?.cyber_verdicts ?? {})["micro_tremor_fft"] as TremorVerdict | undefined;
    push(
      `  → is_human=${String(bf?.is_human)} ratio=${bf?.tremor_ratio ?? "—"}`,
      bf?.is_human === false ? "bad" : "warn",
    );
    push("— NEUTRAL is a valid outcome: the check never decides alone", "dim");
    setBusy(null);
  };

  // Real captured pointer motion — the honest counterpart to the two reference
  // signals above. Whatever it returns (including NEUTRAL) is shown as-is.
  const runRealMotion = async () => {
    setBusy("real");
    setRealV(null);
    const snap = snapshot();
    setRealN(snap.values.length);
    if (snap.values.length < 32) {
      push(`✖ only ${snap.values.length} samples — move the mouse around first (need 32+)`, "warn");
      setBusy(null);
      return;
    }
    push(`▶ Submitting ${snap.values.length} REAL captured pointer deltas …`, "warn");
    const rv = await securityEvaluateRaw({
      sessionId: `tremor-real-${Date.now()}`,
      telemetryBundle: DEMO_BUNDLE,
      motionValues: snap.values,
      motionTimestamps: snap.timestamps,
    });
    setRealV(rv);
    const rf = (rv?.cyber_verdicts ?? {})["micro_tremor_fft"] as TremorVerdict | undefined;
    push(
      `  → is_human=${String(rf?.is_human)} ratio=${rf?.tremor_ratio ?? "—"} reason=${rf?.reason ?? "—"} rate=${rf?.sampling_rate_hz ?? "—"}Hz`,
      rf?.is_human ? "ok" : rf?.is_human === false ? "bad" : "warn",
    );
    push("— real browser sampling is irregular; NEUTRAL here is expected and honest", "dim");
    setBusy(null);
  };

  const fftOf = (v: SecurityVerdict | null) =>
    (v?.cyber_verdicts ?? {})["micro_tremor_fft"] as TremorVerdict | undefined;

  const fftState = (v: SecurityVerdict | null, expectHuman: boolean): StepState => {
    const f = fftOf(v);
    if (!v || !f || f.is_human === null || f.is_human === undefined) return "neutral";
    return f.is_human === expectHuman ? (expectHuman ? "pass" : "fail") : "neutral";
  };

  const fftText = (v: SecurityVerdict | null): string => {
    const f = fftOf(v);
    if (!v) return "—";
    if (!f || f.is_human === null || f.is_human === undefined) return "NEUTRAL";
    return f.is_human ? "HUMAN BAND" : "SYNTHETIC";
  };

  return (
    <ModuleShell
      index={3}
      title="Anti-Spoofing & Replay Resistance"
      threat="Session replay · tampered telemetry · GAN-synthetic input"
      tech="Single-use nonce + HMAC signature · 8–12 Hz FFT tremor analysis"
      caveat="The replay defence is standard, provable cryptography — deterministic and independently checkable. The micro-tremor check is a calibrated behavioural heuristic: it contributes to the composite score, returns NEUTRAL on insufficient signal, and never blocks on its own. The human/scripted pair below are clean synthetic reference signals that isolate the effect; real browser pointer sampling is irregular (~60 Hz, jittery) and legitimately often reads NEUTRAL — use the real-motion button to see that unfiltered."
    >
      {/* ── A. Replay ───────────────────────────────────────────────────── */}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#100F0F", fontFamily: C.mono, letterSpacing: "0.06em", marginBottom: 10 }}>
        A · REPLAY RESISTANCE <span style={{ color: OK }}>— hard cryptography</span>
      </div>

      <ButtonRow>
        <RunButton onClick={runReplayDemo} busy={busy === "replay"} disabled={!!busy}>
          ▶ Run Replay Attack
        </RunButton>
      </ButtonRow>

      {(fresh || replayed || tampered) && (
        <div style={{ marginBottom: 16 }}>
          {[fresh, replayed, tampered].filter(Boolean).map((o, i) => (
            <StatRow
              key={i}
              label={o!.label}
              value={<VerdictBadge state={o!.state} text={o!.status} />}
            />
          ))}
        </div>
      )}

      {/* ── B. Micro-tremor ─────────────────────────────────────────────── */}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#100F0F", fontFamily: C.mono, letterSpacing: "0.06em", margin: "18px 0 10px" }}>
        B · MICRO-TREMOR FFT <span style={{ color: "#E0A64B" }}>— behavioural heuristic</span>
      </div>

      <ButtonRow>
        <RunButton onClick={runTremorDemo} busy={busy === "tremor"} disabled={!!busy}>
          ▶ Compare Reference Signals
        </RunButton>
        <RunButton onClick={runRealMotion} busy={busy === "real"} disabled={!!busy} variant="ghost">
          ▶ Use My Real Mouse Motion
        </RunButton>
      </ButtonRow>

      {(humanV || botV) && (
        <SplitCompare
          left={{
            title: "Human reference",
            state: fftState(humanV, true),
            children: (
              <>
                <StatRow label="Verdict" value={fftText(humanV)} color={fftOf(humanV)?.is_human ? OK : MUTED} />
                <StatRow label="Tremor ratio" value={String(fftOf(humanV)?.tremor_ratio ?? "—")} />
                <StatRow label="Signal" value="2 Hz intent + 10 Hz tremor" color="rgba(16, 15, 15,0.6)" />
              </>
            ),
          }}
          right={{
            title: "Scripted reference",
            state: fftState(botV, false),
            children: (
              <>
                <StatRow label="Verdict" value={fftText(botV)} color={fftOf(botV)?.is_human === false ? BAD : MUTED} />
                <StatRow label="Tremor ratio" value={String(fftOf(botV)?.tremor_ratio ?? "—")} />
                <StatRow label="Signal" value="2 Hz intent, no tremor" color="rgba(16, 15, 15,0.6)" />
              </>
            ),
          }}
        />
      )}

      {/* Real captured motion — shown separately so it is never confused with
          the clean reference signals above. */}
      {realV && (
        <div
          style={{
            marginBottom: 14, padding: "13px 15px", borderRadius: 10,
            background: "#FFFFFF",
            border: "1px solid #EAE4E1",
          }}
        >
          <div style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: "rgba(16, 15, 15,0.75)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 9 }}>
            Your real captured motion · {realN} samples
          </div>
          <StatRow label="Verdict" value={fftText(realV)} color={fftOf(realV)?.is_human ? OK : fftOf(realV)?.is_human === false ? BAD : MUTED} />
          <StatRow label="Tremor ratio" value={String(fftOf(realV)?.tremor_ratio ?? "—")} />
          <StatRow label="Reason" value={String(fftOf(realV)?.reason ?? "—")} color="rgba(16, 15, 15,0.6)" />
          <StatRow label="Sampling rate" value={`${fftOf(realV)?.sampling_rate_hz ?? "—"} Hz`} color="rgba(16, 15, 15,0.6)" />
        </div>
      )}

      <LogConsole lines={log} empty="Run either demo to see the defence in action…" height={185} />
    </ModuleShell>
  );
}
