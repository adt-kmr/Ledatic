/**
 * PhishingDemoPage.tsx — Phishing & Credential-Theft Defense Orchestrator
 *
 * Split-screen:
 *   Left  — Embedded Victim View (PhishingSimPage, the fake portal)
 *   Right — C2 Hacker Terminal + Citadel defense stream (WebSocket)
 *   Bottom — 4-step attack-chain timeline
 *
 * Concurrence-style light layout: serif display, mono labels, animated
 * attack-chain stepper, browser-framed victim view and a light terminal.
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check, RotateCcw, ShieldX, TriangleAlert } from "lucide-react";
import { apiUrl, wsUrl } from "../lib/auth";
import { EASE, Reveal } from "../components/cc/motion";
import PhishingSimPage from "./PhishingSimPage";

interface TerminalEvent {
  type: string;
  ts: string;
  msg?: string;
  field?: string;
  value?: string;
  raw?: string;
}

const INK = "#100F0F";

export default function PhishingDemoPage() {
  const [events, setEvents] = useState<TerminalEvent[]>([]);
  const [phase, setPhase] = useState<"waiting" | "credentials_captured" | "blocked">("waiting");
  const [simulatingAttacker, setSimulatingAttacker] = useState(false);
  const [connected, setConnected] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Connect the Hacker Terminal to /api/phishing/demo/ws.
  //
  // Reconnects on drop: a demo left open on a projector for an hour must not
  // sit silently dead because one socket closed. Also pings, because the proxy
  // in front of the backend closes idle connections.
  useEffect(() => {
    let closedByUs = false;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      let ws: WebSocket;
      try {
        // wsUrl() builds an ABSOLUTE url — a relative path makes the
        // WebSocket constructor throw, which previously killed this effect
        // before any handler was attached.
        ws = new WebSocket(wsUrl("/api/phishing/demo/ws"));
      } catch (err) {
        console.warn("Hacker Terminal: could not open socket", err);
        reconnectTimer = setTimeout(connect, 3000);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retry = 0;
        // Backend answers "ping" with PONG; keeps proxies from timing us out.
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 25000);
      };

      ws.onclose = () => {
        setConnected(false);
        if (pingTimer) clearInterval(pingTimer);
        if (closedByUs) return;
        // Back off to a ceiling so a backend restart doesn't spin the browser.
        retry = Math.min(retry + 1, 5);
        reconnectTimer = setTimeout(connect, 1000 * retry);
      };

      ws.onmessage = (event) => {
        try {
          const data: TerminalEvent = JSON.parse(event.data);
          if (data.type === "RESET") {
            setEvents([]);
            setPhase("waiting");
          } else if (data.type !== "PONG") {
            setEvents((prev) => [...prev, data]);
            if (data.type === "SUCCESS") setPhase("credentials_captured");
            else if (data.type === "BLOCK") setPhase("blocked");
          }
        } catch (err) {
          console.error("WS message parse error:", err);
        }
      };

      ws.onerror = () => { /* onclose handles the retry */ };
    };

    connect();
    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const handleTriggerAttackerLogin = async () => {
    setSimulatingAttacker(true);
    try {
      await fetch(apiUrl("/api/phishing/demo/attack-detected"), { method: "POST" });
    } catch (err) {
      console.warn("Attack notification error:", err);
    }
    setSimulatingAttacker(false);
  };

  const handleResetDemo = async () => {
    try {
      await fetch(apiUrl("/api/phishing/demo/reset"), { method: "POST" });
    } catch (err) {
      console.warn("Reset error:", err);
    }
    setEvents([]);
    setPhase("waiting");
  };

  const steps = [
    { n: "01", title: "Phishing link sent", label: "Email delivered", status: "complete" },
    { n: "02", title: "Victim enters credentials", label: phase !== "waiting" ? "Credentials entered" : "Awaiting input", status: phase !== "waiting" ? "complete" : "active" },
    { n: "03", title: "Exfiltrated to attacker", label: phase !== "waiting" ? "Captured by C2" : "Pending", status: phase !== "waiting" ? "complete" : "pending" },
    { n: "04", title: "Citadel defense", label: phase === "blocked" ? "HARD_BLOCK fired" : "Monitoring", status: phase === "blocked" ? "blocked" : "pending" },
  ] as const;
  const progress = phase === "blocked" ? 1 : phase === "credentials_captured" ? 0.67 : 0.33;

  return (
    <div className="bg-white" style={{ color: INK, fontFamily: "'Inter', system-ui, sans-serif", minHeight: "calc(100dvh - 56px)" }}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="cc-edge pb-12 pt-14 md:pt-20">
        <div className="border-l pl-0 lg:pl-9" style={{ borderColor: "#D7D2D0" }}>
          <Reveal>
            <span className="cc-mono inline-flex items-center gap-2 rounded-[6px] px-3 py-1.5" style={{ color: "#B3261E", background: "rgba(179,38,30,.07)" }}>
              <span className="relative flex h-1.5 w-1.5">
                <span className="cc-ping absolute inline-flex h-full w-full rounded-full" style={{ background: "#B3261E", opacity: 0.6 }} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "#B3261E" }} />
              </span>
              Attack vector 02 · Bank of Baroda case study
            </span>
          </Reveal>
          <Reveal delay={0.06}>
            <h1 className="cc-serif m-0 mt-6 text-[clamp(40px,5.6vw,80px)] leading-[1.02] tracking-[-0.025em]">Anatomy of a phished session.</h1>
            <p className="cc-serif m-0 mt-1 text-[clamp(40px,5.6vw,80px)] leading-[1.02] tracking-[-0.025em]" style={{ color: "#969290" }}>From stolen password to HARD_BLOCK.</p>
          </Reveal>
          <Reveal delay={0.12} className="mt-10 flex flex-wrap items-end justify-between gap-6">
            <p className="m-0 max-w-[540px] border-l-[3px] pl-6 text-[17px] leading-[1.5]" style={{ borderColor: "#D7D2D0", color: "#575452" }}>
              Type credentials into the look-alike portal. Watch them land in the attacker's terminal — then watch Citadel refuse the attacker anyway.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <AnimatePresence>
                {phase === "credentials_captured" && (
                  <motion.button initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }}
                    onClick={handleTriggerAttackerLogin} disabled={simulatingAttacker}
                    className="cc-btn !h-[46px] !px-6 !text-[15px]" style={{ background: "#B3261E", color: "#fff" }}>
                    {simulatingAttacker ? "Logging in as attacker…" : "Simulate attacker login"} <ArrowRight />
                  </motion.button>
                )}
              </AnimatePresence>
              <button onClick={handleResetDemo} className="cc-btn !h-[46px] !px-6 !text-[15px]" style={{ color: INK, border: "1px solid #D7D2D0", background: "#fff" }}>
                <RotateCcw /> Reset demo
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Attack chain ─────────────────────────────────────────────────── */}
      <section className="cc-edge pb-10">
        <Reveal>
          <div className="relative grid gap-6 rounded-[24px] px-6 py-8 sm:grid-cols-2 lg:grid-cols-4 lg:px-10" style={{ background: "#F7F3F1" }}>
            <div className="absolute left-10 right-10 top-[52px] hidden h-[2px] lg:block" style={{ background: "#E2DCD9" }}>
              <motion.div className="h-full" style={{ background: phase === "blocked" ? "#B3261E" : "#AA412A" }}
                animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.9, ease: EASE }} />
            </div>
            {steps.map((s) => {
              const pulsing = s.status === "active" || s.status === "blocked";
              const col = s.status === "blocked" ? "#B3261E" : s.status === "complete" ? "#AA412A" : s.status === "active" ? "#100F0F" : "#B3AEAC";
              return (
                <div key={s.n} className="relative">
                  <motion.div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full font-mono text-[12px]"
                    animate={{ scale: pulsing ? [1, 1.08, 1] : 1 }}
                    transition={{ duration: 1.6, repeat: pulsing ? Infinity : 0 }}
                    style={{ background: s.status === "pending" ? "#fff" : col, color: s.status === "pending" ? "#969290" : "#fff", border: s.status === "pending" ? "1px solid #D7D2D0" : "none" }}>
                    {s.status === "complete" ? <Check size={16} strokeWidth={2.5} /> : s.status === "blocked" ? <ShieldX size={16} strokeWidth={2} /> : s.n}
                  </motion.div>
                  <div className="cc-serif mt-5 text-[22px] leading-[1.1]">{s.title}</div>
                  <div className="cc-mono mt-2" style={{ color: col }}>{s.label}</div>
                </div>
              );
            })}
          </div>
        </Reveal>
      </section>

      {/* ── Split view ───────────────────────────────────────────────────── */}
      <section className="cc-edge pb-12">
        <div className="grid gap-5 lg:grid-cols-2">
          <Reveal>
            <div className="flex h-full min-h-[580px] flex-col overflow-hidden rounded-[20px]" style={{ border: "1px solid #EAE4E1", boxShadow: "0 30px 60px -30px rgba(16,15,15,.25)" }}>
              <div className="flex items-center gap-3 px-4 py-3" style={{ background: "#F7F3F1", borderBottom: "1px solid #EAE4E1" }}>
                <div className="flex gap-1.5">{[0, 1, 2].map((d) => <span key={d} className="h-2.5 w-2.5 rounded-full" style={{ background: "#D7D2D0" }} />)}</div>
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] px-3 py-1.5" style={{ background: "#fff", border: "1px solid #EAE4E1" }}>
                  <TriangleAlert size={13} color="#B3261E" className="shrink-0" />
                  <span className="truncate font-mono text-[12px]" style={{ color: "#575452" }}>
                    https://<span style={{ color: "#B3261E", fontWeight: 600 }}>z1ppay</span>-bank-verify.com/login
                  </span>
                </div>
                <span className="cc-mono hidden sm:inline" style={{ color: "#B3261E" }}>Victim view</span>
              </div>
              <div className="relative flex-1 overflow-y-auto">
                <PhishingSimPage />
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="flex h-full min-h-[580px] flex-col overflow-hidden rounded-[20px]" style={{ border: "1px solid #EAE4E1", background: "#FBF9F8" }}>
              <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid #EAE4E1" }}>
                <span className="cc-mono flex items-center gap-2" style={{ color: "#575452" }}>
                  <span className="relative flex h-2 w-2">
                    {connected && <span className="cc-ping absolute inline-flex h-full w-full rounded-full" style={{ background: "#3D8B5A", opacity: 0.6 }} />}
                    <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: connected ? "#3D8B5A" : "#B3AEAC" }} />
                  </span>
                  Attacker C2 · Citadel stream
                </span>
                <span className="cc-mono" style={{ color: connected ? "#3D6B3A" : "#969290" }}>{connected ? "ws connected" : "ws offline"}</span>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 font-mono text-[12.5px] leading-[1.7]" style={{ maxHeight: 640 }}>
                {events.length === 0 ? (
                  <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center">
                    <motion.div animate={{ opacity: [0.35, 1, 0.35] }} transition={{ duration: 2.2, repeat: Infinity }}
                      className="cc-serif text-[26px]" style={{ color: "#575452" }}>Listening for a submission…</motion.div>
                    <p className="m-0 mt-3 max-w-[320px] font-sans text-[14px]" style={{ color: "#969290" }}>Enter credentials in the victim view to start the capture stream.</p>
                  </div>
                ) : (
                  events.map((ev, idx) => (
                    <motion.div key={idx} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }} className="mb-1">
                      {ev.type === "HEADER" && <div className="mt-2 font-semibold" style={{ color: "#B3261E" }}>[{ev.ts}] {ev.msg}</div>}
                      {ev.type === "CRED" && (
                        <div className="pl-4">
                          <span style={{ color: "#969290" }}>[{ev.ts}] {ev.field}: </span>
                          <span className="font-semibold" style={{ color: "#8A6A1E" }}>{ev.value}</span>
                          {ev.raw && <span className="ml-2" style={{ color: "#B3261E" }}>(RAW: "{ev.raw}")</span>}
                        </div>
                      )}
                      {ev.type === "BIO" && (
                        <div className="pl-4" style={{ color: "#0B5A73" }}>
                          <span style={{ color: "#969290" }}>[{ev.ts}] telemetry.{ev.field}: </span>
                          <span className="font-semibold">{ev.value}</span>
                        </div>
                      )}
                      {ev.type === "STATUS" && <div className="mt-1 pl-4" style={{ color: "#8A6A1E" }}>[{ev.ts}] {ev.msg}</div>}
                      {ev.type === "SUCCESS" && <div className="mb-2 pl-4 font-semibold" style={{ color: "#3D6B3A" }}>[{ev.ts}] {ev.msg}</div>}
                      {ev.type === "SEPARATOR" && <div className="my-3" style={{ color: "#D7D2D0" }}>{ev.msg}</div>}
                      {ev.type === "ATTACK" && <div className="font-semibold" style={{ color: "#B3261E" }}>[{ev.ts}] {ev.msg}</div>}
                      {ev.type === "DETECTION" && (
                        <div className="pl-4">
                          <span style={{ color: "#969290" }}>[{ev.ts}] Citadel.{ev.field}: </span>
                          <span className="font-semibold" style={{ color: "#AA412A" }}>{ev.value}</span>
                        </div>
                      )}
                      {ev.type === "BLOCK" && (
                        <div className="mt-2 rounded-[8px] px-3 py-2 text-[13px] font-bold"
                          style={{ color: "#B3261E", background: "rgba(179,38,30,.08)", border: "1px solid rgba(179,38,30,.3)" }}>
                          [{ev.ts}] {ev.msg}
                        </div>
                      )}
                      {ev.type === "ALERT" && <div className="mt-1 pl-4" style={{ color: "#3D6B3A" }}>[{ev.ts}] {ev.msg}</div>}
                    </motion.div>
                  ))
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Outcome banner ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {phase === "blocked" && (
          <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.6, ease: EASE }} className="cc-edge pb-12">
            <div className="flex flex-wrap items-center justify-between gap-6 rounded-[24px] px-8 py-10 text-white md:px-12" style={{ background: "#AA412A" }}>
              <div>
                <div className="cc-mono text-white/80">Verdict</div>
                <div className="cc-serif mt-2 text-[clamp(32px,4vw,56px)] leading-none">HARD_BLOCK. The stolen password was useless.</div>
              </div>
              <ShieldX size={72} strokeWidth={1} className="text-white/80" />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ── How Citadel caught it ────────────────────────────────────────── */}
      <section className="cc-edge cc-section-y !pt-12">
        <Reveal><h2 className="cc-serif m-0 mb-10 text-[clamp(32px,4vw,56px)] leading-[1.04] tracking-[-0.015em]">How Citadel caught it.</h2></Reveal>
        <div className="grid md:grid-cols-3" style={{ borderTop: "1px solid #EAE4E1" }}>
          {[
            { n: "01", t: "Wrong rhythm", d: "The attacker typed the right password with someone else's dwell and flight times. Behavioral similarity fell below the customer's passport." },
            { n: "02", t: "Wrong device", d: "The login came from a device whose HMAC hash had never been enrolled on-chain for this customer." },
            { n: "03", t: "Replay signature", d: "Credentials submitted to a look-alike domain, then replayed against the real bank within minutes — a classic phishing kill-chain." },
          ].map((c, k) => (
            <Reveal key={c.n} delay={k * 0.08}>
              <div className="h-full py-8 md:px-8" style={{ borderLeft: k ? "1px solid #EAE4E1" : undefined }}>
                <span className="cc-mono" style={{ color: "#AA412A" }}>{c.n}</span>
                <h3 className="cc-serif m-0 mt-4 text-[28px] font-normal">{c.t}</h3>
                <p className="m-0 mt-3 text-[15px] leading-[1.5]" style={{ color: "#575452" }}>{c.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}
