import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ArrowLeft, ArrowUpRight, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { CitadelMark } from "../components/cc/CitadelMark";
import { adminLogin, pingBackend, waitForBackend } from "./adminAuth";

const ORANGE = "#AA412A";
const TEAL = "#083241";

// Judges need a way in: this is the same account the repo's render.yaml and
// docs already publish. Flip to false to hide the shortcut.
const SHOW_DEMO_ACCESS = true;
const DEMO_ACCOUNT = { id: "ADMIN", password: "Citadel@Ops#2026", name: "FIU Administrator", note: "Full authority" };

const FACTS = [
  ["<80 ms", "Decision latency on the device-trust path"],
  ["SHAP", "Top-5 attribution behind every verdict"],
  ["100%", "Of operator actions logged and audited"],
];

type Server = "checking" | "waking" | "online" | "offline";

const SERVER_LABEL: Record<Server, string> = {
  checking: "Checking server",
  waking: "Waking the secure server",
  online: "Server online",
  offline: "Server unreachable",
};

/** Branded panel — desktop only, so the form is the whole screen on phones. */
function BrandPanel() {
  const reduce = useReducedMotion();
  return (
    <aside
      className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex xl:p-16"
      style={{ background: `radial-gradient(120% 90% at 0% 0%, #0E4558 0%, ${TEAL} 55%, #05222D 100%)` }}
    >
      <motion.svg
        aria-hidden
        className="pointer-events-none absolute -bottom-52 -right-52"
        width="720" height="720" viewBox="0 0 720 720" fill="none"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 240, repeat: Infinity, ease: "linear" }}
      >
        {[340, 280, 220, 160, 100].map((r, k) => (
          <circle key={r} cx="360" cy="360" r={r} stroke="#C5BACE" strokeOpacity={0.32 - k * 0.04} strokeDasharray={k % 2 ? "4 8" : undefined} />
        ))}
        <circle cx="360" cy="20" r="5" fill={ORANGE} />
      </motion.svg>

      <div className="relative flex items-center gap-2.5">
        <CitadelMark size={24} color="#fff" />
        <span className="cc-serif text-[26px] leading-none tracking-[-0.02em]">Citadel</span>
      </div>

      <div className="relative max-w-[520px]">
        <p className="cc-mono m-0 !text-[11px] text-white/60">FIU Fraud-Ops Console</p>
        <h1 className="cc-serif m-0 mt-5 text-[clamp(38px,3.6vw,56px)] leading-[1.04] tracking-[-0.02em]" style={{ textWrap: "balance" }}>
          Every block, explained and on the record.
        </h1>
        <p className="m-0 mt-6 max-w-[440px] text-[16px] leading-[1.55] text-white/70">
          Live sessions, mule networks and voice-MFA verdicts, with the evidence and an audit entry behind every decision.
        </p>
        <dl className="m-0 mt-12 grid gap-0 border-t border-white/15">
          {FACTS.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[110px_1fr] items-baseline gap-4 border-b border-white/15 py-4">
              <dt className="cc-serif text-[28px] leading-none">{k}</dt>
              <dd className="m-0 text-[14px] text-white/65">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="cc-mono relative m-0 !text-[11px] text-white/50">Derby Hackathon 2026 · Team Incognito</p>
    </aside>
  );
}

function ServerStatus({ state }: { state: Server }) {
  const colour = state === "online" ? "#3F8F5B" : state === "offline" ? "#B3382A" : "#C98A1B";
  const pulsing = state === "checking" || state === "waking";
  return (
    <span
      role="status"
      aria-live="polite"
      className="cc-mono inline-flex items-center gap-2 rounded-full border px-3 py-1.5 !text-[10.5px]"
      style={{ borderColor: "#EAE4E1", color: "#575452", background: "#FBF9F8" }}
    >
      <span className="relative flex h-2 w-2">
        {pulsing && <span className="cc-ping absolute inline-flex h-full w-full rounded-full opacity-70" style={{ background: colour }} />}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: colour }} />
      </span>
      {SERVER_LABEL[state]}
    </span>
  );
}

const fieldClass =
  "block h-12 w-full rounded-xl border bg-[#FBF9F8] px-4 text-[15px] text-[#100F0F] outline-none transition " +
  "placeholder:text-[#B3AEAC] hover:border-[#B3AEAC] focus:border-[#AA412A] focus:bg-white focus:ring-4 focus:ring-[#AA412A]/10";

export default function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const reduce = useReducedMotion();
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [caps, setCaps] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [server, setServer] = useState<Server>("checking");
  const gone = useRef(false);
  const pwRef = useRef<HTMLInputElement>(null);

  // Wake a sleeping backend while the operator is still typing.
  useEffect(() => {
    gone.current = false;
    (async () => {
      if (await pingBackend(6000)) { if (!gone.current) setServer("online"); return; }
      if (gone.current) return;
      setServer("waking");
      const ok = await waitForBackend(() => gone.current);
      if (!gone.current) setServer(ok ? "online" : "offline");
    })();
    return () => { gone.current = true; };
  }, []);

  // After a few seconds of waiting, say why instead of leaving a dead spinner.
  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [busy]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !id.trim() || !pw) return;
    setErr(null);
    setBusy(true);
    try {
      if (server !== "online") {
        setServer("waking");
        const ok = await waitForBackend(() => gone.current);
        if (gone.current) return;
        if (!ok) {
          setServer("offline");
          throw new Error("The server didn't wake up in time — wait a moment and try again");
        }
        setServer("online");
      }
      await adminLogin(id.trim(), pw);
      onLogin();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      if (!gone.current) setBusy(false);
    }
  };

  const useDemo = () => {
    setId(DEMO_ACCOUNT.id);
    setPw(DEMO_ACCOUNT.password);
    setErr(null);
    setTimeout(() => pwRef.current?.form?.querySelector<HTMLButtonElement>("button[type=submit]")?.focus(), 0);
  };

  const rise = reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } };

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]" style={{ color: "#100F0F", fontFamily: "'Inter', sans-serif" }}>
      <BrandPanel />

      <main className="flex min-h-screen flex-col px-6 py-6 sm:px-12 lg:px-16">
        <div className="flex items-center justify-between">
          <Link to="/" className="group inline-flex items-center gap-2 text-[14px] text-[#575452] no-underline transition-colors hover:text-[#100F0F]">
            <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-0.5" />
            <span className="lg:hidden inline-flex items-center gap-2"><CitadelMark size={18} /><span className="cc-serif text-[20px] leading-none text-[#100F0F]">Citadel</span></span>
            <span className="hidden lg:inline">Back to Citadel</span>
          </Link>
          <ServerStatus state={server} />
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <motion.form onSubmit={submit} noValidate className="w-full max-w-[400px]" {...rise}>
            <h2 className="cc-serif m-0 text-[40px] leading-[1.05] tracking-[-0.02em]">Sign in</h2>
            <p className="m-0 mt-3 text-[15px] leading-[1.5] text-[#575452]">
              Restricted to authorised FIU and partner-bank operators.
            </p>

            <label htmlFor="op-id" className="cc-mono mb-2 mt-9 block !text-[11px] text-[#575452]">Operator ID</label>
            <input
              id="op-id" name="username" autoFocus autoComplete="username" autoCapitalize="characters" spellCheck={false}
              value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. ADMIN"
              aria-invalid={!!err} className={fieldClass} style={{ borderColor: err ? "#E0A89F" : "#D7D2D0" }}
            />

            <label htmlFor="op-pw" className="cc-mono mb-2 mt-5 block !text-[11px] text-[#575452]">Password</label>
            <div className="relative">
              <input
                id="op-pw" name="password" ref={pwRef} type={showPw ? "text" : "password"} autoComplete="current-password"
                value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Enter your password"
                onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))} onBlur={() => setCaps(false)}
                aria-invalid={!!err} className={`${fieldClass} pr-12`} style={{ borderColor: err ? "#E0A89F" : "#D7D2D0" }}
              />
              <button
                type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={showPw}
                className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent text-[#767270] transition-colors hover:bg-[#F1EAE7] hover:text-[#100F0F]"
              >
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <AnimatePresence>
              {caps && (
                <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="m-0 mt-2 overflow-hidden text-[13px] text-[#9A5B12]">
                  Caps Lock is on.
                </motion.p>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {err && (
                <motion.div
                  key={err} role="alert"
                  initial={{ opacity: 0, x: reduce ? 0 : -6 }} animate={{ opacity: 1, x: reduce ? 0 : [0, -6, 6, -3, 0] }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                  className="mt-5 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[14px] leading-[1.45]"
                  style={{ background: "#FBEFEC", borderColor: "#F0CFC8", color: "#8E2F1F" }}
                >
                  <AlertCircle size={18} className="mt-px shrink-0" />
                  <span>{err}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <button type="submit" disabled={busy || !id.trim() || !pw}
              className="cc-btn cc-btn-orange mt-6 !h-12 w-full !text-[15px] disabled:cursor-not-allowed disabled:opacity-45">
              {busy ? <><Loader2 size={18} className="animate-spin" /> {slow ? "Still working…" : "Verifying…"}</> : "Sign in"}
            </button>

            <AnimatePresence>
              {busy && slow && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="m-0 mt-3 text-center text-[13px] leading-[1.5] text-[#767270]">
                  Waking the secure server — the first sign-in after a quiet spell can take up to a minute.
                </motion.p>
              )}
            </AnimatePresence>

            {SHOW_DEMO_ACCESS && (
              <div className="mt-8 rounded-xl border border-[#EAE4E1] bg-[#FBF9F8]">
                <button type="button" onClick={() => setDemoOpen((o) => !o)} aria-expanded={demoOpen}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border-0 bg-transparent px-4 py-3 text-left text-[14px] text-[#575452] transition-colors hover:text-[#100F0F]">
                  <span className="inline-flex items-center gap-2"><KeyRound size={16} /> Demo access for judges</span>
                  <span className="cc-mono !text-[11px] text-[#767270]">{demoOpen ? "Hide" : "Show"}</span>
                </button>
                <AnimatePresence initial={false}>
                  {demoOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }} className="overflow-hidden">
                      <div className="flex items-center justify-between gap-3 border-t border-[#EAE4E1] px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium">{DEMO_ACCOUNT.name}</div>
                          <div className="cc-mono !text-[11px] text-[#767270]">{DEMO_ACCOUNT.id} · {DEMO_ACCOUNT.note}</div>
                        </div>
                        <button type="button" onClick={useDemo}
                          className="shrink-0 cursor-pointer rounded-lg border border-[#D7D2D0] bg-white px-3 py-1.5 text-[13px] text-[#100F0F] transition-colors hover:border-[#AA412A] hover:text-[#AA412A]">
                          Fill credentials
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-[14px]">
              <Link to="/demo/bank" className="group inline-flex items-center gap-1 text-[#575452] underline underline-offset-4 transition-colors hover:text-[#100F0F]">
                Try the customer demo <ArrowUpRight size={15} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <span className="cc-mono !text-[10px] text-[#767270]">All access is logged and audited</span>
            </div>
          </motion.form>
        </div>
      </main>
    </div>
  );
}
