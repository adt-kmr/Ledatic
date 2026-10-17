/**
 * PhishingSimPage.tsx — Fake ZipPay Bank Phishing Portal (labeled simulation)
 *
 * A deliberately CONVINCING clone of ZipPay Bank's verification page — that
 * realism is the point of the phishing demo. It stays unmistakably a labeled
 * simulation via the red banner and the look-alike domain (z1ppay-bank-verify.com).
 * Captures keystroke biometrics (dwell/flight) as the victim types, POSTs them to
 * /api/phishing/demo/log, then hands off to the C2 orchestrator.
 *
 * Styled to the ZipPay / Citadel design system: canvas ambient, glass card,
 * bank branding, focus states — professional, not "vibe-coded".
 */

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiUrl } from "../lib/auth";

const INK = "#141313";
const MUTED = "rgba(20, 19, 19,0.45)";
const FAINT = "rgba(20, 19, 19,0.4)";

export default function PhishingSimPage({ onSubmitted }: { onSubmitted?: () => void }) {
  const [username, setUsername] = useState("harshdeep");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  // Biometric telemetry capture
  const dwellTimes = useRef<number[]>([]);
  const flightTimes = useRef<number[]>([]);
  const lastKeyTime = useRef<number | null>(null);
  const keyPressStart = useRef<{ [key: string]: number }>({});
  const pasted = useRef(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const now = performance.now();
    keyPressStart.current[e.key] = now;
    if (lastKeyTime.current !== null) {
      const flight = now - lastKeyTime.current;
      if (flight > 0 && flight < 3000) flightTimes.current.push(flight);
    }
    lastKeyTime.current = now;
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    const start = keyPressStart.current[e.key];
    if (start) {
      const dwell = performance.now() - start;
      if (dwell > 0 && dwell < 2000) dwellTimes.current.push(dwell);
      delete keyPressStart.current[e.key];
    }
  };

  const handlePaste = () => { pasted.current = true; };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || submitting) return;
    setSubmitting(true);

    const avgDwell = dwellTimes.current.length ? dwellTimes.current.reduce((a, b) => a + b, 0) / dwellTimes.current.length : 180;
    const avgFlight = flightTimes.current.length ? flightTimes.current.reduce((a, b) => a + b, 0) / flightTimes.current.length : 320;
    const typingSpeed = password.length > 0 ? (password.length / (avgDwell + avgFlight)) * 1000 : 2.1;

    const payload = {
      username, password,
      user_agent: navigator.userAgent,
      dwell_times: dwellTimes.current,
      flight_times: flightTimes.current,
      avg_dwell_ms: avgDwell,
      avg_flight_ms: avgFlight,
      typing_speed_cps: typingSpeed,
      clipboard_paste_detected: pasted.current,
      session_id: `phish_session_${Date.now()}`,
    };

    try {
      await fetch(apiUrl("/api/phishing/demo/log"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn("Phishing log fetch failed:", err);
    }

    setSubmitting(false);
    setSubmitted(true);
    onSubmitted?.();
  };

  const inputStyle = (field: string): React.CSSProperties => ({
    width: "100%",
    padding: "13px 15px",
    borderRadius: 12,
    border: `1px solid ${focused === field ? "rgba(16, 15, 15,0.22)" : "rgba(16, 15, 15,0.1)"}`,
    background: focused === field ? "rgba(16, 15, 15,0.05)" : "rgba(16, 15, 15,0.03)",
    color: INK,
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    transition: "all 0.25s cubic-bezier(0.32,0.72,0,1)",
    fontFamily: "'Inter', sans-serif",
  });

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100%",
        background: "var(--color-canvas)",
        color: INK,
        fontFamily: "'Inter', system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        // Extra top padding reserves space for the absolutely-positioned
        // simulation ribbon so it never overlaps the login card.
        padding: "52px 20px 20px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ambient wash (matches the real ZipPay page) */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 80% at 50% -10%, rgba(148,163,184,0.10) 0%, transparent 60%)" }} />
      <div style={{ position: "absolute", bottom: "-12%", right: "-8%", width: 420, height: 420, borderRadius: "50%", pointerEvents: "none", background: "radial-gradient(circle, rgba(94,92,230,0.10) 0%, transparent 70%)", filter: "blur(60px)" }} />
      <div className="bg-grid-pattern" style={{ position: "absolute", inset: 0, opacity: 0.12, pointerEvents: "none" }} />

      {/* Simulation ribbon — the honest phishing tell.
          `absolute`, not `fixed`: this page is also embedded inside the
          PhishingDemoPage split view, and a fixed ribbon escaped that panel to
          paint a red band across the whole viewport. Anchoring to the parent
          (which is position:relative) keeps it inside its own surface in both
          the standalone and embedded cases.
          Styled dark to match the product design system rather than a solid
          red wash, while staying unmistakably a warning — this banner is the
          disclosure that marks the page as a simulation, so it must remain
          legible, not decorative. */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 30,
          background: "rgba(244, 244, 244,0.92)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,82,82,0.35)",
          color: "#FF5252", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em",
          padding: "7px 16px", textAlign: "center", textTransform: "uppercase",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap",
          fontFamily: "'DM Mono', monospace",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 6, height: 6, borderRadius: "50%", background: "#FF5252",
              boxShadow: "0 0 6px #FF5252", flexShrink: 0,
            }}
          />
          ⚠ Hackathon Phishing Simulation
        </span>
        <span
          style={{
            background: "rgba(16, 15, 15,0.05)",
            border: "1px solid rgba(16, 15, 15,0.08)",
            color: "rgba(20, 19, 19,0.55)",
            padding: "2px 9px", borderRadius: 6, letterSpacing: "0.04em",
          }}
        >
          z1ppay-bank-verify.com/secure-verify
        </span>
      </div>

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 420, padding: "0 4px" }}>
        {/* Bank branding */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 13, marginBottom: 24 }}>
          <div style={{ width: 46, height: 46, borderRadius: 13, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(170, 65, 42,0.28)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.2 9.2 12 4.3l8.8 4.9" />
              <path d="M4.6 9.2h14.8" />
              <path d="M7 11.4v6.2M12 11.4v6.2M17 11.4v6.2" />
              <path d="M4.2 19.7h15.6" />
            </svg>
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: INK, letterSpacing: "-0.03em", fontFamily: "'Inter', sans-serif" }}>ZipPay Bank</div>
            <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2, letterSpacing: "0.01em" }}>Secure Verification Portal · RBI Licensed</div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{
            background: "rgba(16, 15, 15,0.02)",
            backdropFilter: "blur(24px)",
            borderRadius: 22,
            border: "1px solid rgba(16, 15, 15,0.07)",
            padding: 30,
            boxShadow: "0 32px 64px -24px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.05)",
          }}
        >
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(199,137,43,0.1)", border: "1px solid rgba(199,137,43,0.28)", padding: "5px 13px", borderRadius: 9999, fontSize: 11, color: "#E0A64B", fontWeight: 600, marginBottom: 16, fontFamily: "'Inter', sans-serif" }}>
              🔒 Urgent Account Verification
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: INK, margin: "0 0 6px 0", letterSpacing: "-0.02em", fontFamily: "'Inter', sans-serif" }}>
              Account Identity Audit
            </h2>
            <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
              Verify your login credentials to restore full account access.
            </p>
          </div>

          <AnimatePresence mode="wait">
            {!submitted ? (
              <motion.form key="form" initial={{ opacity: 1 }} exit={{ opacity: 0 }} onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: FAINT, marginBottom: 8, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "'Inter', sans-serif" }}>
                    Customer ID / User ID
                  </label>
                  <input
                    type="text" value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} onPaste={handlePaste}
                    onFocus={() => setFocused("user")} onBlur={() => setFocused(null)}
                    placeholder="Enter Customer ID" required style={inputStyle("user")}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: FAINT, marginBottom: 8, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "'Inter', sans-serif" }}>
                    Password / Internet Banking PIN
                  </label>
                  <input
                    type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} onPaste={handlePaste}
                    onFocus={() => setFocused("pass")} onBlur={() => setFocused(null)}
                    placeholder="••••••••" required style={inputStyle("pass")}
                  />
                </div>

                <div style={{ background: "rgba(199,137,43,0.08)", border: "1px solid rgba(199,137,43,0.2)", padding: "10px 12px", borderRadius: 12, fontSize: 11, color: "#E0A64B", lineHeight: 1.5, display: "flex", gap: 8 }}>
                  <span>⚠</span>
                  <span>Failure to verify within 24 hours will result in temporary suspension under RBI KYC mandates.</span>
                </div>

                <motion.button
                  type="submit" disabled={submitting}
                  whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 9999, border: "none",
                    background: submitting ? "rgba(170, 65, 42,0.4)" : "var(--color-primary)",
                    color: "var(--color-on-primary)", fontSize: 14, fontWeight: 700,
                    cursor: submitting ? "not-allowed" : "pointer",
                    boxShadow: "0 8px 22px rgba(170, 65, 42,0.28), inset 0 1px 1px rgba(255,255,255,0.3)",
                    marginTop: 4, fontFamily: "'Inter', sans-serif", letterSpacing: "0.01em",
                  }}
                >
                  {submitting ? "Verifying Credentials…" : "Verify Account & Continue →"}
                </motion.button>

                <div style={{ textAlign: "center", fontSize: 10, color: "rgba(20, 19, 19,0.3)", marginTop: 2, fontFamily: "'Inter', sans-serif" }}>
                  🔒 256-bit encrypted · Powered by ZipPay SecureAuth
                </div>
              </motion.form>
            ) : (
              <motion.div key="submitted" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(52,199,89,0.12)", border: "1px solid rgba(52,199,89,0.35)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px auto", fontSize: 24, color: "#34C759" }}>✓</div>
                <h3 style={{ fontSize: 18, color: INK, margin: "0 0 8px 0", fontWeight: 700, fontFamily: "'Inter', sans-serif" }}>Credentials Submitted</h3>
                <p style={{ fontSize: 13, color: MUTED, margin: "0 0 20px 0", lineHeight: 1.5 }}>
                  Credentials &amp; typing telemetry harvested by the C2 terminal.
                </p>
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: 12, fontSize: 12, color: "#fca5a5", lineHeight: 1.5 }}>
                  Switch to the <strong>C2 Terminal</strong> panel to watch real-time exfiltration &amp; Citadel's defense.
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
