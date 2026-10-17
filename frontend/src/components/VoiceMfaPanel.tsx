/**
 * Citadel — Voice MFA panel (Vapi Web SDK)
 * ============================================
 * Runs the ZipPay verification agent in the browser. The customer hears the
 * agent through their speakers and answers with their microphone — no phone
 * call, so it works from any country.
 *
 * The three questions and the greeting come from the server (`/web/start`);
 * this component only renders and streams audio. When the call ends it sends
 * the Vapi call id to `/web/complete` and the SERVER decides the verdict by
 * re-reading the conversation from Vapi. Answers are never posted from here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { C } from "../lib/theme";
import {
  completeWebVerification,
  getVoiceConfig,
  pollVerification,
  simulateVerification,
  startPhoneVerification,
  startWebVerification,
  type VoiceVerdict,
} from "../lib/voiceMfa";

type Phase = "idle" | "connecting" | "live" | "analysing" | "done" | "error";

const OK = "#3D8B5A";
const WARN = "#B7791F";
const BAD = "#B3261E";
const MUTED = "rgba(20, 19, 19,0.45)";

interface Line { role: "assistant" | "user"; text: string }

export interface VoiceMfaPanelProps {
  customerId?: string;
  name?: string;
  /** Prefills the phone-call field. */
  phoneNumber?: string;
  /** 'registration' (default) or 'login'. Login asks a device question whose
   *  answer is cross-checked against the fingerprint server-side. */
  purpose?: "registration" | "login";
  /** Called once a terminal verdict is reached, and with null when a new
   *  attempt starts — otherwise a stale "blocked" banner from a previous run
   *  stays on screen while the retry is still in flight. */
  onVerdict?: (v: VoiceVerdict | null) => void;
  /** Show the simulate controls (demo / failure-path walkthrough). */
  showDemoControls?: boolean;
}

export default function VoiceMfaPanel({
  customerId, name, phoneNumber, purpose = "registration", onVerdict, showDemoControls = true,
}: VoiceMfaPanelProps) {
  // Two ways to run the same verification. Browser is the default because it
  // needs no phone number and is not subject to international-calling limits;
  // phone is the one a bank would actually ship.
  const [mode, setMode] = useState<"web" | "phone">("web");
  const [phone, setPhone] = useState(phoneNumber || "+91");
  const [phoneReady, setPhoneReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const [verdict, setVerdict] = useState<VoiceVerdict | null>(null);
  const [webReady, setWebReady] = useState<boolean | null>(null);

  const vapiRef = useRef<any>(null);
  const verificationIdRef = useRef<string | null>(null);
  const callIdRef = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getVoiceConfig().then((c) => {
      setWebReady(!!c?.web_ready);
      setPhoneReady(c?.phone_mode === "live");
    });
  }, []);

  // Always keep the newest line in view.
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [lines]);

  // Leaving mid-call must not leave a live mic open.
  useEffect(() => () => { try { vapiRef.current?.stop(); } catch { /* already stopped */ } }, []);

  const finish = useCallback(async () => {
    setPhase("analysing");
    const vid = verificationIdRef.current;
    if (!vid) { setPhase("error"); setError("No verification in progress."); return; }
    const v = await completeWebVerification(vid, callIdRef.current);
    if (!v) { setPhase("error"); setError("Could not read the verification result."); return; }
    setVerdict(v);
    setPhase("done");
    onVerdict?.(v);
  }, [onVerdict]);

  const start = async () => {
    setError(null); setLines([]); setVerdict(null);
    onVerdict?.(null);          // drop any banner from a previous attempt
    setPhase("connecting");

    const s = await startWebVerification({ customerId, name, purpose });
    if (!s) { setPhase("error"); setError("Could not start verification."); return; }
    verificationIdRef.current = s.verification_id;

    try {
      // Loaded on demand — the SDK pulls in a WebRTC stack we should not ship
      // to every page that imports this module.
      //
      // @vapi-ai/web ships CommonJS (`exports.default = Vapi`) with no ESM
      // build, so a dynamic import gets double-wrapped: `mod.default` is the
      // module object and the class sits at `mod.default.default`. Destructuring
      // `{ default: Vapi }` therefore yields an object, and `new Vapi(...)`
      // fails with "is not a constructor". Unwrap defensively so this keeps
      // working if the package ever ships a proper ESM build.
      const mod: any = await import("@vapi-ai/web");
      const Vapi = typeof mod?.default?.default === "function" ? mod.default.default
        : typeof mod?.default === "function" ? mod.default
          : typeof mod === "function" ? mod
            : null;
      if (!Vapi) throw new Error("Voice SDK failed to load (unexpected module shape).");

      const vapi = new Vapi(s.public_key);
      vapiRef.current = vapi;

      vapi.on("call-start", () => setPhase("live"));
      vapi.on("speech-start", () => setAssistantSpeaking(true));
      vapi.on("speech-end", () => setAssistantSpeaking(false));
      vapi.on("volume-level", (v: number) => setVolume(v));

      vapi.on("message", (msg: any) => {
        // Only final transcripts are rendered; partials would thrash the list.
        if (msg?.type === "transcript" && msg?.transcriptType === "final") {
          setLines((prev) => [...prev, {
            role: msg.role === "assistant" ? "assistant" : "user",
            text: String(msg.transcript || ""),
          }]);
        }
        if (msg?.type === "status-update" && msg?.call?.id) callIdRef.current = msg.call.id;
      });

      vapi.on("error", (e: any) => {
        setPhase("error");
        setError(typeof e?.message === "string" ? e.message : "Voice connection failed.");
      });

      vapi.on("call-end", () => { setAssistantSpeaking(false); void finish(); });

      const call: any = await vapi.start(s.assistant as any);
      if (call?.id) callIdRef.current = call.id;
    } catch (e: unknown) {
      setPhase("error");
      setError(
        e instanceof Error && /permission|denied|NotAllowed/i.test(e.message)
          ? "Microphone permission denied — allow mic access and try again."
          : e instanceof Error ? e.message : "Could not start the voice agent.",
      );
    }
  };

  const stop = () => { try { vapiRef.current?.stop(); } catch { /* ignore */ } };

  /**
   * Phone mode: place a real outbound call, then poll until a verdict lands.
   *
   * Polling rather than waiting on the webhook, because Vapi cannot reach
   * localhost — without a public VAPI_SERVER_URL the webhook never arrives.
   * The status endpoint re-reads the call from Vapi, so the answers are just
   * as authoritative.
   */
  const startPhone = async () => {
    setError(null); setLines([]); setVerdict(null);
    onVerdict?.(null);
    setPhase("connecting");

    const res = await startPhoneVerification({ customerId, name, phoneNumber: phone.trim() });
    if (!res.ok) { setPhase("error"); setError(res.error); return; }

    verificationIdRef.current = res.data.verification_id;
    callIdRef.current = res.data.call_id;
    if (res.data.status === "ERROR") {
      setPhase("error"); setError(res.data.message); return;
    }

    setPhase("live");
    setLines([{ role: "assistant", text: `Calling ${phone.trim()} — answer the call and reply to each question.` }]);

    setPhase("analysing");
    const v = await pollVerification(res.data.verification_id, { intervalMs: 4000, timeoutMs: 180000 });
    if (!v) {
      setPhase("error");
      setError("Timed out waiting for the call to finish. It may still be in progress.");
      return;
    }
    setVerdict(v); setPhase("done"); onVerdict?.(v);
  };

  const runSimulate = async (q1: boolean, q2: boolean, q3: boolean) => {
    setPhase("analysing"); setError(null); setVerdict(null);
    onVerdict?.(null);
    let vid = verificationIdRef.current;
    if (!vid) {
      const s = await startWebVerification({ customerId, name, purpose });
      if (!s) { setPhase("error"); setError("Could not start verification."); return; }
      vid = s.verification_id; verificationIdRef.current = vid;
    }
    const v = await simulateVerification(vid, { q1, q2, q3 });
    if (!v) { setPhase("error"); setError("Simulation failed."); return; }
    setVerdict(v); setPhase("done"); onVerdict?.(v);
    verificationIdRef.current = null;   // next run opens a fresh verification
  };

  const dColor = verdict?.decision === "APPROVE" ? OK
    : verdict?.decision === "STEP_UP" ? WARN
      : verdict?.decision === "HARD_BLOCK" ? BAD : MUTED;

  return (
    <div
      style={{
        borderRadius: 16, border: "1px solid #EAE4E1",
        background: "#FFFFFF", padding: "18px 20px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700, color: "#100F0F" }}>
          🎙️ Voice Verification
        </span>
        <span style={{ fontSize: 9.5, fontFamily: C.mono, color: MUTED, letterSpacing: "0.06em" }}>
          {webReady === null ? "…" : webReady ? "VAPI · IN-BROWSER" : "SIMULATED"}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5, marginBottom: 14 }}>
        {purpose === "login"
          ? "Our security agent will confirm this sign-in with a few quick yes/no questions."
          : "Our security agent will ask you three quick yes/no questions to confirm this registration."}
      </div>

      {/* Mode selector — same verification, two delivery channels. */}
      {(phase === "idle" || phase === "done" || phase === "error") && (
        <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>
          {([
            ["web", "🌐 Browser call", webReady],
            ["phone", "📞 Phone call", phoneReady],
          ] as const).map(([m, label, ready]) => (
            <button
              key={m}
              onClick={() => setMode(m as "web" | "phone")}
              title={ready ? "" : "Not configured on the server"}
              style={{
                flex: 1, padding: "8px 10px", borderRadius: 9, cursor: "pointer",
                border: `1px solid ${mode === m ? "rgba(16, 15, 15,0.22)" : "rgba(16, 15, 15,0.08)"}`,
                background: mode === m ? "rgba(16, 15, 15,0.07)" : "transparent",
                color: mode === m ? "#100F0F" : MUTED,
                fontSize: 11, fontFamily: C.mono, fontWeight: 600,
                opacity: ready ? 1 : 0.5,
              }}
            >
              {label}
              {!ready && <span style={{ fontSize: 8.5, display: "block", marginTop: 2 }}>not configured</span>}
            </button>
          ))}
        </div>
      )}

      {/* Phone number, only in phone mode */}
      {mode === "phone" && (phase === "idle" || phase === "done" || phase === "error") && (
        <div style={{ marginBottom: 12 }}>
          <input
            value={phone}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d+]/g, "");
              setPhone(v.startsWith("+") ? v : "+" + v.replace(/\+/g, ""));
            }}
            placeholder="+919876543210"
            maxLength={16}
            style={{
              width: "100%", padding: "9px 12px", borderRadius: 9,
              border: "1px solid #D7D2D0", background: "rgba(255, 255, 255,0.3)",
              color: "#100F0F", fontSize: 12.5, fontFamily: C.mono, outline: "none",
            }}
          />
          <div style={{ fontSize: 10, color: MUTED, marginTop: 5, lineHeight: 1.4 }}>
            The call arrives from an unknown international number — expect it, and answer within a few rings.
          </div>
        </div>
      )}

      {/* Live state */}
      {(phase === "connecting" || phase === "live") && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
            padding: "12px 14px", borderRadius: 12,
            background: "rgba(61, 139, 90,0.06)", border: "1px solid rgba(61, 139, 90,0.25)",
          }}
        >
          <span
            style={{
              width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
              background: assistantSpeaking ? OK : "rgba(16, 15, 15,0.25)",
              boxShadow: assistantSpeaking ? `0 0 10px ${OK}` : "none",
              transition: "all 0.15s",
            }}
          />
          <span style={{ fontSize: 12, fontFamily: C.mono, color: "#100F0F", flex: 1 }}>
            {phase === "connecting" ? "Connecting…" : assistantSpeaking ? "Agent speaking…" : "Listening — answer yes or no"}
          </span>
          {/* Mic level, so the customer can see they are being heard. */}
          <span style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 16 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                style={{
                  width: 3, borderRadius: 2, background: volume * 5 > i ? OK : "rgba(16, 15, 15,0.15)",
                  height: 4 + i * 3, transition: "background 0.1s",
                }}
              />
            ))}
          </span>
        </div>
      )}

      {/* Transcript */}
      {lines.length > 0 && (
        <div
          ref={transcriptRef}
          style={{
            maxHeight: 190, overflowY: "auto", marginBottom: 12,
            padding: "10px 12px", borderRadius: 10,
            background: "rgba(255, 255, 255,0.32)", border: "1px solid #EAE4E1",
          }}
        >
          {lines.map((l, i) => (
            <div key={i} style={{ marginBottom: 7, display: "flex", gap: 8 }}>
              <span style={{ fontSize: 9, fontFamily: C.mono, color: l.role === "assistant" ? OK : "#2C7A91", flexShrink: 0, width: 42, paddingTop: 2 }}>
                {l.role === "assistant" ? "AGENT" : "YOU"}
              </span>
              <span style={{ fontSize: 12, color: "#575452", lineHeight: 1.45 }}>{l.text}</span>
            </div>
          ))}
        </div>
      )}

      {phase === "analysing" && (
        <div style={{ fontSize: 12, color: WARN, fontFamily: C.mono, marginBottom: 12 }}>
          Verifying answers…
        </div>
      )}

      {/* Verdict */}
      {verdict && (
        <div
          style={{
            marginBottom: 12, padding: "13px 15px", borderRadius: 12,
            background: `color-mix(in oklch, ${dColor} 8%, transparent)`,
            border: `1px solid color-mix(in oklch, ${dColor} 32%, transparent)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 9, flexWrap: "wrap" }}>
            <span style={{ fontFamily: C.mono, fontSize: 12.5, fontWeight: 800, color: dColor }}>
              {verdict.decision ?? verdict.status}
            </span>
            <span style={{ fontFamily: C.mono, fontSize: 11, color: MUTED }}>risk {verdict.risk_score}</span>
          </div>
          {([
            ["Registered this account", verdict.q1_registered],
            ["Acting on their own", verdict.q2_not_coerced],
            ["Location matches", verdict.q3_location_match],
          ] as const).map(([label, val]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #EAE4E1" }}>
              <span style={{ fontSize: 11, color: MUTED }}>{label}</span>
              <span style={{ fontSize: 11, fontFamily: C.mono, fontWeight: 700, color: val === true ? OK : val === false ? BAD : MUTED }}>
                {val === true ? "YES" : val === false ? "NO" : "—"}
              </span>
            </div>
          ))}
          {verdict.failure_reason && (
            <div style={{ marginTop: 9, fontSize: 11.5, color: dColor, lineHeight: 1.45 }}>
              {verdict.failure_reason}
            </div>
          )}

          {/* Proof the verdict was acted on, not just displayed. */}
          {(verdict.account_blocked || verdict.persisted_session_id || verdict.blockchain_anchor?.on_chain) && (
            <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid #EAE4E1", display: "flex", flexDirection: "column", gap: 4 }}>
              {verdict.account_blocked && (
                <span style={{ fontSize: 10.5, fontFamily: C.mono, color: BAD }}>
                  ✓ account blocked — login refused
                </span>
              )}
              {verdict.persisted_session_id && (
                <span style={{ fontSize: 10.5, fontFamily: C.mono, color: MUTED }}>
                  ✓ filed to FIU fraud worklist
                </span>
              )}
              {verdict.blockchain_anchor?.on_chain && (
                <span style={{ fontSize: 10.5, fontFamily: C.mono, color: OK }}>
                  ✓ anchored on Hyperledger ({verdict.blockchain_anchor.latency_ms}ms)
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 12, fontSize: 12, color: BAD, lineHeight: 1.45 }}>{error}</div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
        {(phase === "idle" || phase === "done" || phase === "error") && (
          <button
            onClick={() => (mode === "phone" ? startPhone() : start())}
            disabled={mode === "phone" && !/^\+\d{8,15}$/.test(phone.trim())}
            style={{
              padding: "10px 18px", borderRadius: 10, border: "none",
              background: mode === "phone" && !/^\+\d{8,15}$/.test(phone.trim())
                ? "rgba(16, 15, 15,0.08)" : "var(--color-primary)",
              color: mode === "phone" && !/^\+\d{8,15}$/.test(phone.trim())
                ? "rgba(20, 19, 19,0.35)" : "var(--color-on-primary)",
              fontSize: 12.5, fontWeight: 700, fontFamily: "'Inter', sans-serif",
              cursor: mode === "phone" && !/^\+\d{8,15}$/.test(phone.trim()) ? "not-allowed" : "pointer",
            }}
          >
            {phase === "idle"
              ? (mode === "phone" ? "📞 Call My Phone" : "🎙️ Start Browser Call")
              : "↻ Retry"}
          </button>
        )}
        {(phase === "connecting" || phase === "live") && (
          <button
            onClick={stop}
            style={{
              padding: "10px 18px", borderRadius: 10,
              border: "1px solid rgba(179, 38, 30,0.4)", background: "rgba(179, 38, 30,0.12)",
              color: BAD, fontSize: 12.5, fontWeight: 700, fontFamily: "'Inter', sans-serif", cursor: "pointer",
            }}
          >
            ■ End Call
          </button>
        )}
      </div>

      {/* Demo controls — the failure paths cannot be produced on a live call
          (nobody will say "yes, I am being coerced" on cue), so they are driven
          directly. Server-side verdict logic is identical either way. */}
      {showDemoControls && phase !== "live" && phase !== "connecting" && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #EAE4E1" }}>
          <div style={{ fontSize: 8.5, fontFamily: C.mono, color: "#969290", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
            Demo · simulate outcome
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {([
              ["All yes → approve", true, true, true, OK],
              ["Denies registering", false, true, true, BAD],
              ["Under coercion", true, false, true, BAD],
              ["Wrong city", true, true, false, WARN],
            ] as const).map(([label, a, b, c, col]) => (
              <button
                key={label}
                onClick={() => runSimulate(a, b, c)}
                style={{
                  padding: "6px 11px", borderRadius: 8,
                  border: `1px solid color-mix(in oklch, ${col} 30%, transparent)`,
                  background: "transparent", color: col,
                  fontSize: 10.5, fontFamily: C.mono, fontWeight: 600, cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
