import { Link } from "react-router-dom";
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Landmark,
  Smartphone,
  Building2,
  Wallet,
  Menu,
  X,
} from "lucide-react";

/* Citadel landing — Concurrence-style: warm editorial serif, burnt-orange
   primary, white sections with 24px rounded seams over orange / teal / moss
   bands, mono uppercase labels, and motion on almost every surface. */

const C = {
  black: "#100F0F",
  orange: "#AA412A",
  orangeDeep: "#933928",
  blue: "#083241",
  green: "#2C3827",
  lavender: "#C5BACE",
  w1: "#F1EAE7",
  w2: "#D7D2D0",
  w3: "#B3AEAC",
  w4: "#969290",
  w5: "#767270",
  w6: "#575452",
};

const EASE = [0.16, 1, 0.3, 1] as const;

/* Reveals on entering the viewport — and also when it's already been
   scrolled past (anchor jumps / fast scrolls), so nothing stays hidden. */
function Reveal({ children, delay = 0, className = "", y = 24 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      if (el.getBoundingClientRect().top < window.innerHeight - 40) {
        setShown(true);
        window.removeEventListener("scroll", check);
        window.removeEventListener("resize", check);
      }
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { window.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, []);
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y }}
      animate={shown ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.75, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

function CitadelMark({ size = 26, color = C.black }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="5.4 6.7 21.2 20.8" aria-hidden fill="none" className="block shrink-0">
      <path d="M7 27V12h3V7.5h3V12h2V7.5h2V12h2V7.5h3V12h3v15H7Z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13.5 27v-5.2a2.5 2.5 0 0 1 5 0V27" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function Arrow() {
  return <ArrowRight strokeWidth={1.75} />;
}

/* ── Count-up for the stat band ─────────────────────────────────────────── */
function CountUp({ to, decimals = 0, prefix = "", suffix = "" }: { to: number; decimals?: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const ctl = animate(0, to, { duration: 1.8, ease: EASE, onUpdate: setV });
    return () => ctl.stop();
  }, [inView, to]);
  return <span ref={ref}>{prefix}{v.toFixed(decimals)}{suffix}</span>;
}

/* ── Nav: white on light sections, transparent-on-colour over bands ─────── */
const NAV_LINKS = [
  { label: "Platform", href: "#platform" },
  { label: "Solutions", href: "#solutions", caret: true },
  { label: "Security", href: "#security", caret: true },
  { label: "Demos", href: "#explore", caret: true },
  { label: "Docs", to: "/doc" },
];

function Nav() {
  const [band, setBand] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const probe = 72;
      let hit: string | null = null;
      document.querySelectorAll<HTMLElement>("[data-nav-band]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top <= probe && r.bottom >= probe) hit = el.dataset.navBand ?? null;
      });
      setBand(hit);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);
  const dark = !!band;
  const fg = dark ? "#FFFFFF" : C.black;
  return (
    <header className="fixed inset-x-0 top-0 z-[60]" style={{ background: band ?? "#FFFFFF", transition: "background .45s ease" }}>
      <AnimatePresence initial={false}>
        {!dark && (
          <motion.a
            href="#coercion-story"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 36, opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="flex items-center justify-center gap-2 overflow-hidden px-4 text-[11px] no-underline"
            style={{ borderBottom: `1px solid ${C.w1}`, color: C.black }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="cc-ping absolute inline-flex h-full w-full rounded-full" style={{ background: "#4CAF50", opacity: 0.6 }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "#4CAF50" }} />
            </span>
            <span style={{ color: "rgba(16,15,15,.7)" }}>New</span>
            <span className="truncate">Coercion detection for AI-scripted UPI scams</span>
          </motion.a>
        )}
      </AnimatePresence>
      <nav className="cc-edge flex h-[72px] items-center justify-between">
        <Link to="/" className="flex items-baseline gap-2 no-underline" style={{ color: fg, transition: "color .3s" }}>
          <CitadelMark size={19} color={fg} />
          <span className="cc-serif text-[25px] leading-none tracking-[-0.02em]">Citadel</span>
        </Link>
        <div className="hidden items-center gap-9 lg:flex">
          {NAV_LINKS.map((l) => {
            const inner = (
              <span className="inline-flex items-center gap-1.5 text-[15px] tracking-[-0.01em]" style={{ color: fg, transition: "color .3s" }}>
                {l.label}{l.caret && <ChevronDown size={14} strokeWidth={1.75} />}
              </span>
            );
            return l.to
              ? <Link key={l.label} to={l.to} className="no-underline opacity-90 hover:opacity-100">{inner}</Link>
              : <a key={l.label} href={l.href} className="no-underline opacity-90 hover:opacity-100">{inner}</a>;
          })}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin" className="cc-btn hidden md:inline-flex" style={{ color: fg, border: `1px solid ${dark ? "rgba(255,255,255,.5)" : "transparent"}`, background: "transparent" }}>
            FIU Console
          </Link>
          <Link to="/demo/bank" className={`cc-btn ${dark ? "" : "cc-btn-orange"}`}
            style={dark ? { color: "#fff", border: "1px solid #fff", background: "transparent" } : undefined}>
            Launch Demo
          </Link>
          <button className="flex h-[39px] items-center px-2 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" style={{ color: fg }}>
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="cc-edge flex flex-col gap-1 pb-6 lg:hidden" style={{ background: band ?? "#fff" }}>
            {NAV_LINKS.map((l) => l.to
              ? <Link key={l.label} to={l.to} onClick={() => setOpen(false)} className="py-2 text-[17px] no-underline" style={{ color: fg }}>{l.label}</Link>
              : <a key={l.label} href={l.href} onClick={() => setOpen(false)} className="py-2 text-[17px] no-underline" style={{ color: fg }}>{l.label}</a>)}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

/* ── Hero media card: customer → Citadel AI → cycling threat list → bank ─ */
const THREATS = [
  "SIM-swap Defense", "Credential Replay", "Screen-share Coercion", "Deepfake Voice Calls",
  "Mule Account Payees", "Duress PIN Alerts", "Keystroke Drift", "Device Trust",
  "UPI Collect Scams", "Phishing Look-alikes", "OTP Interception", "Remote Access Apps",
  "Session Hijacking", "Bot Logins", "Account Takeover", "Social Engineering",
];

function HeroMedia() {
  const [i, setI] = useState(5);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % THREATS.length), 1700);
    return () => clearInterval(t);
  }, []);
  const ROW = 27;
  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded-[24px] md:min-h-[540px]" style={{ background: "#3B3634" }}>
      {/* drifting blurred "footage" */}
      <motion.div className="absolute -inset-20"
        animate={{ x: [0, 40, -20, 0], y: [0, -30, 20, 0], scale: [1, 1.08, 1.02, 1] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        style={{
          background: `radial-gradient(40% 55% at 30% 45%, #1E1A18 0%, transparent 70%),
            radial-gradient(30% 40% at 72% 30%, #6E6662 0%, transparent 70%),
            radial-gradient(35% 45% at 85% 85%, #2B2523 0%, transparent 70%),
            radial-gradient(50% 60% at 15% 90%, #5A4F4A 0%, transparent 70%),
            linear-gradient(120deg, #4A4441, #2E2927)`,
          filter: "blur(30px)",
        }} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(16,15,15,.35), rgba(16,15,15,.05) 60%, rgba(16,15,15,.3))" }} />

      <div className="relative flex h-full min-h-[inherit] items-center justify-center gap-3 px-5 md:gap-4 md:px-10">
        <Node label="Your customer" avatar />
        <FlowArrow />
        <Node label="Citadel AI" mark />
        <FlowArrow />
        <div className="relative h-[100%] min-h-[inherit] w-[180px] shrink-0 overflow-hidden md:w-[230px]"
          style={{ maskImage: "linear-gradient(to bottom, transparent, black 22%, black 78%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, transparent, black 22%, black 78%, transparent)" }}>
          <motion.div className="absolute left-0 top-1/2"
            animate={{ y: -i * ROW - ROW / 2 }} transition={{ duration: 0.9, ease: EASE }}>
            {THREATS.map((t, k) => (
              <div key={t} className="cc-serif whitespace-nowrap text-[16px] md:text-[20px]"
                style={{ height: ROW, lineHeight: `${ROW}px`, color: k === i ? "#FFFFFF" : "rgba(255,255,255,.42)", transition: "color .6s" }}>
                {t}
              </div>
            ))}
          </motion.div>
        </div>
        <FlowArrow className="hidden 2xl:block" />
        <Node label="Your bank" avatar className="hidden 2xl:flex" faded />
      </div>
    </div>
  );
}

function Node({ label, avatar, mark, className = "", faded }: { label: string; avatar?: boolean; mark?: boolean; className?: string; faded?: boolean }) {
  return (
    <div className={`flex shrink-0 items-center gap-2 ${className}`} style={{ opacity: faded ? 0.55 : 1, filter: faded ? "blur(0.6px)" : undefined }}>
      {avatar && <span className="h-6 w-6 rounded-full" style={{ background: "radial-gradient(circle at 40% 35%, #E4D5CC, #8C7A70 60%, #4A3F3A)", boxShadow: "0 0 0 1px rgba(255,255,255,.25)" }} />}
      {mark && <CitadelMark size={20} color="#fff" />}
      <span className="cc-mono hidden text-[10px] text-white/85 md:inline">{label}</span>
    </div>
  );
}

function FlowArrow({ className = "" }: { className?: string }) {
  return (
    <svg className={`shrink-0 ${className}`} width="40" height="10" viewBox="0 0 40 10" aria-hidden>
      <line x1="0" y1="5" x2="34" y2="5" stroke="rgba(255,255,255,.55)" strokeWidth="1" className="cc-flow" />
      <path d="M33 1.5 L37.5 5 L33 8.5" stroke="rgba(255,255,255,.55)" fill="none" strokeWidth="1" />
    </svg>
  );
}

/* ── Wordmark marquee (tech we build on — not customer logos) ───────────── */
const STACK = [
  { t: "Hyperledger Fabric", f: "cc-serif text-[22px]" },
  { t: "PyTorch", f: "font-semibold text-[20px] tracking-[-0.03em]" },
  { t: "XGBoost", f: "font-bold text-[19px] italic" },
  { t: "FastAPI", f: "font-medium text-[20px]" },
  { t: "PostgreSQL", f: "cc-serif text-[22px] italic" },
  { t: "redis", f: "font-extrabold text-[21px] tracking-[-0.04em]" },
  { t: "Ethereum Sepolia", f: "font-light text-[20px] tracking-[0.02em]" },
  { t: "GSMA CAMARA", f: "cc-mono !text-[14px] !tracking-[0.2em]" },
  { t: "SHAP", f: "font-black text-[20px] tracking-[0.12em]" },
  { t: "LangChain", f: "font-medium text-[20px]" },
  { t: "Docker", f: "font-bold text-[20px] tracking-[-0.02em]" },
  { t: "scikit-learn", f: "cc-serif text-[21px]" },
];

function StackMarquee({ invert = false }: { invert?: boolean }) {
  const row = [...STACK, ...STACK];
  return (
    <div className="cc-marquee-wrap relative overflow-hidden"
      style={{ maskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)" }}>
      <div className="cc-marquee flex items-center gap-16 py-2">
        {row.map((s, k) => (
          <span key={k} className={`whitespace-nowrap ${s.f}`} style={{ color: invert ? "rgba(255,255,255,.75)" : C.w5 }}>{s.t}</span>
        ))}
      </div>
    </div>
  );
}

/* ── Scenario carousel (orange band) with vertical dot progress ─────────── */
const SCENARIOS = [
  {
    tag: "Pathway 1 · Device trust",
    quote: "A new handset logs in with the right password and the right OTP. The device hash doesn't match the on-chain baseline — the SIM was ported 47 minutes ago.",
    who: "SIM-swap account takeover",
    how: "HARD_BLOCK in 63 ms, before the OTP matters",
  },
  {
    tag: "Pathway 2 · Coercion",
    quote: "The customer is real, but someone is on the call telling them what to type. Screen-share is on, the payee was pasted, and they hesitate before every field.",
    who: "AI-scripted UPI scam",
    how: "Funds held, voice MFA triggered, analyst paged",
  },
  {
    tag: "Pathway 3 · Behavioral ML",
    quote: "Phished credentials, replayed from a look-alike page. The password is perfect. The typing rhythm belongs to someone else entirely.",
    who: "Credential replay",
    how: "STEP_UP with SHAP top-5 attached",
  },
];

function ScenarioCarousel() {
  const [i, setI] = useState(0);
  const DUR = 7;
  useEffect(() => {
    const t = setTimeout(() => setI((n) => (n + 1) % SCENARIOS.length), DUR * 1000);
    return () => clearTimeout(t);
  }, [i]);
  const s = SCENARIOS[i];
  return (
    <div id="coercion-story" className="relative overflow-hidden rounded-[24px] px-6 py-14 md:px-16 md:py-24"
      style={{ background: "linear-gradient(135deg, rgba(16,15,15,.22) 0%, rgba(16,15,15,.08) 55%, rgba(255,255,255,.08) 100%)" }}>
      <div className="grid gap-10 md:grid-cols-[1fr_2fr]">
        <div>
          <div className="cc-mono text-white/80">{s.tag}</div>
          <div className="mt-6 flex items-baseline gap-2 text-white">
            <CitadelMark size={21} color="#fff" />
            <span className="cc-serif text-[26px]">Citadel</span>
          </div>
        </div>
        <div className="relative pr-10">
          <AnimatePresence mode="wait">
            <motion.div key={i}
              initial={{ opacity: 0, y: 16, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -12, filter: "blur(8px)" }} transition={{ duration: 0.6, ease: EASE }}>
              <p className="cc-serif m-0 text-[clamp(22px,2.6vw,36px)] leading-[1.12] tracking-[-0.01em] text-white">“{s.quote}”</p>
              <p className="m-0 mt-10 text-[15px] font-medium text-white">{s.who}</p>
              <p className="m-0 mt-1 text-[15px]" style={{ color: C.w2 }}>{s.how}</p>
            </motion.div>
          </AnimatePresence>
          <div className="absolute right-0 top-0 flex flex-col items-center gap-3 rounded-full px-2 py-3" style={{ background: "rgba(255,255,255,.12)" }}>
            {SCENARIOS.map((_, k) => (
              <button key={k} onClick={() => setI(k)} aria-label={`Scenario ${k + 1}`}
                className="relative overflow-hidden rounded-full" style={{ width: 3, height: k === i ? 26 : 4, background: "rgba(255,255,255,.35)", transition: "height .4s" }}>
                {k === i && <span key={i} className="absolute inset-0 origin-top" style={{ background: "#fff", animation: `ccDotFillV ${DUR}s linear forwards` }} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Compliance badge (drawn, not a third-party logo) ───────────────────── */
function Badge({ top, bottom }: { top: string; bottom?: string }) {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden className="shrink-0">
      <circle cx="28" cy="28" r="27" fill="none" stroke="rgba(255,255,255,.55)" />
      <circle cx="28" cy="28" r="23" fill="none" stroke="rgba(255,255,255,.2)" />
      <text x="28" y={bottom ? 25 : 31} textAnchor="middle" fill="#fff" fontSize="8" fontFamily="DM Mono, monospace" letterSpacing=".6">{top}</text>
      {bottom && <text x="28" y="36" textAnchor="middle" fill="rgba(255,255,255,.85)" fontSize="7" fontFamily="DM Mono, monospace" letterSpacing=".6">{bottom}</text>}
    </svg>
  );
}

/* ── Solution tiles: generated "photographic" art + glass label ─────────── */
const TILES = [
  { label: "Banks", icon: Landmark, bg: "radial-gradient(70% 60% at 30% 25%, #E9DDD4 0%, transparent 60%), radial-gradient(60% 70% at 80% 85%, #6B4A3E 0%, transparent 65%), linear-gradient(160deg, #CDB8AB, #7E6457)" },
  { label: "UPI Apps", icon: Smartphone, bg: "radial-gradient(60% 60% at 70% 30%, #B9C9CF 0%, transparent 60%), radial-gradient(70% 60% at 20% 90%, #1E3B47 0%, transparent 70%), linear-gradient(160deg, #6F8C96, #22404B)" },
  { label: "NBFCs & Lenders", icon: Building2, bg: "radial-gradient(60% 60% at 35% 30%, #DCD3C2 0%, transparent 60%), radial-gradient(60% 60% at 80% 80%, #2F4A57 0%, transparent 65%), linear-gradient(160deg, #A79C88, #3C5560)" },
  { label: "Wallets & Fintech", icon: Wallet, bg: "radial-gradient(60% 55% at 70% 25%, #CFD9C4 0%, transparent 60%), radial-gradient(70% 60% at 25% 85%, #3A4A32 0%, transparent 65%), linear-gradient(160deg, #94A487, #36452F)" },
];

/* ── Decision engine tabs (blue band) ───────────────────────────────────── */
const PATHWAYS = [
  {
    n: "01", t: "Device Trust",
    d: "Every device's HMAC-hashed identity is anchored on Hyperledger Fabric at enrollment. A mismatch — the signature of a SIM-swap — is blocked through a Redis fast path in under 80 ms.",
    rows: [["HMAC(IMEI)", "computed on device"], ["Baseline", "on-chain · Fabric"], ["CAMARA", "SIM ported 47 min ago"], ["Verdict", "HARD_BLOCK · 63 ms"]],
  },
  {
    n: "02", t: "Coercion Context",
    d: "Scammers coach real customers through real transfers. Citadel reads the coaching — screen-share, pasted payees, hesitation — and a silent duress PIN opens a decoy session.",
    rows: [["Screen-share", "active during PIN"], ["Payee", "pasted · 6.8 s hesitation"], ["Voice MFA", "challenge call placed"], ["Verdict", "HARD_BLOCK · funds held"]],
  },
  {
    n: "03", t: "Behavioral ML",
    d: "BehaveFormer embeddings, a Siamese similarity head and CNN-LSTM session drift, fused by a risk scorer that ships its SHAP top-5 with every decision.",
    rows: [["Similarity", "0.41 vs 3-shot passport"], ["Session drift", "rising since 'amount'"], ["Fusion", "score 512 / 1000"], ["Verdict", "STEP_UP · SHAP top-5"]],
  },
];

function NumberedTabs({ items, active, onChange, light }: { items: { n: string; t: string }[]; active: number; onChange: (i: number) => void; light?: boolean }) {
  return (
    <div className="flex flex-col">
      {items.map((it, k) => (
        <button key={it.n} onClick={() => onChange(k)}
          className="cc-mono relative flex items-center gap-6 py-2 pl-[17px] text-left !text-[13px]"
          style={{ color: light ? (k === active ? "#fff" : "rgba(255,255,255,.6)") : (k === active ? C.black : "rgba(0,0,0,.5)"), transition: "color .25s" }}>
          {k === active && (
            <motion.span layoutId={light ? "tab-bar-light" : "tab-bar-dark"} className="absolute left-0 top-0 h-full w-[4px]"
              style={{ background: light ? "#fff" : C.black }} transition={{ duration: 0.4, ease: EASE }} />
          )}
          <span>{it.n}</span><span>{it.t}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Step card deck (lavender, active step springs to the front) ────────── */
const INK = "#3C3540";

function StepArt({ kind, live }: { kind: number; live: boolean }) {
  const loop = live ? { repeat: Infinity, ease: "easeInOut" as const } : { duration: 0 };
  if (kind === 0)
    return (
      <div className="flex h-full items-end justify-between gap-[5px] px-1">
        {[0.45, 0.8, 0.3, 0.95, 0.6, 0.75, 0.4, 0.9, 0.55, 0.7].map((h, k) => (
          <motion.span key={k} className="block w-full rounded-full" style={{ background: k % 3 === 0 ? C.orange : "rgba(60,53,64,.28)", originY: 1 }}
            initial={{ scaleY: h }} animate={live ? { scaleY: [h, 1 - h * 0.6, h] } : { scaleY: h }}
            transition={{ ...loop, duration: 1.6 + (k % 4) * 0.3, delay: k * 0.08 }}>
            <span className="block h-[86px]" />
          </motion.span>
        ))}
      </div>
    );
  if (kind === 1)
    return (
      <svg viewBox="0 0 120 90" className="h-full w-full">
        {[34, 26, 18, 10].map((r, k) => (
          <motion.ellipse key={r} cx="60" cy="48" rx={r * 1.15} ry={r} fill="none" stroke={k === 0 ? C.orange : INK} strokeOpacity={k === 0 ? 1 : 0.3}
            strokeWidth="1.6" strokeDasharray={k % 2 ? "3 4" : "none"}
            initial={{ pathLength: live ? 0 : 1 }} animate={{ pathLength: 1 }} transition={{ duration: live ? 1.1 : 0, delay: k * 0.15, ease: EASE }} />
        ))}
        <circle cx="60" cy="48" r="3" fill={INK} />
      </svg>
    );
  if (kind === 2)
    return (
      <div className="flex h-full flex-col justify-end gap-2.5">
        {[["Device", 0.32], ["Coercion", 0.58], ["Behavior", 0.81]].map(([t, v], k) => (
          <div key={t as string} className="flex items-center gap-2">
            <span className="cc-mono w-[64px] !text-[9px]" style={{ color: "rgba(60,53,64,.6)" }}>{t}</span>
            <div className="h-[6px] flex-1 overflow-hidden rounded-full" style={{ background: "rgba(60,53,64,.12)" }}>
              <motion.div className="h-full rounded-full" style={{ background: k === 2 ? C.orange : INK, originX: 0 }}
                initial={{ scaleX: live ? 0 : (v as number) }} animate={{ scaleX: v as number }} transition={{ duration: live ? 0.9 : 0, delay: 0.2 + k * 0.15, ease: EASE }} />
            </div>
          </div>
        ))}
        <span className="cc-mono mt-1 self-start rounded-[4px] px-2 py-[3px] !text-[9px] text-white" style={{ background: C.orange }}>STEP_UP · 0.71</span>
      </div>
    );
  const nodes = [[20, 64], [52, 30], [88, 20], [96, 62], [58, 72]];
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full">
      {[[0, 1], [1, 2], [1, 3], [3, 4], [4, 0], [1, 4]].map(([a, b], k) => (
        <motion.line key={k} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke={INK} strokeOpacity=".3" strokeWidth="1.4"
          initial={{ pathLength: live ? 0 : 1 }} animate={{ pathLength: 1 }} transition={{ duration: live ? 0.6 : 0, delay: k * 0.1 }} />
      ))}
      {nodes.map(([x, y], k) => (
        <motion.circle key={k} cx={x} cy={y} r={k === 1 ? 6 : 4} fill={k === 1 ? C.orange : "#fff"} stroke={INK} strokeOpacity=".5" strokeWidth="1.4"
          initial={{ scale: live ? 0 : 1 }} animate={{ scale: 1 }} transition={{ duration: live ? 0.4 : 0, delay: 0.3 + k * 0.08 }} style={{ originX: `${x}px`, originY: `${y}px` }} />
      ))}
    </svg>
  );
}

function CardDeck({ active }: { active: number }) {
  const reduce = useReducedMotion();
  const N = STEPS.length;
  return (
    <div className="relative mx-auto flex h-[400px] w-full max-w-[560px] items-center justify-center">
      <div className="pointer-events-none absolute inset-x-[12%] bottom-[6%] h-[60px] rounded-[50%] blur-2xl" style={{ background: "rgba(90,70,110,.18)" }} />
      <motion.div className="relative h-[300px] w-[240px]"
        animate={reduce ? undefined : { y: [0, -8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
        {STEPS.map((s, k) => {
          const d = (k - active + N) % N;
          const leaving = d === N - 1;
          return (
            <motion.div key={s.n} className="absolute inset-0 flex flex-col rounded-[18px] p-5"
              initial={false}
              animate={leaving
                ? { x: -70, y: 30, rotate: -10, scale: 0.92, opacity: 0 }
                : { x: d * 34, y: -d * 22, rotate: d * 5, scale: 1 - d * 0.07, opacity: 1 }}
              transition={{ type: "spring", stiffness: 170, damping: 24, mass: 0.9 }}
              style={{
                zIndex: N - d,
                transformOrigin: "50% 100%",
                background: d === 0 ? "linear-gradient(150deg, #FCFAFD, #E9E1EE)" : "linear-gradient(150deg, #F1ECF4, #D9CFE0)",
                boxShadow: d === 0 ? "0 30px 60px rgba(80,60,100,.24), inset 0 0 0 1px #fff" : "0 14px 30px rgba(80,60,100,.14), inset 0 0 0 1px rgba(255,255,255,.7)",
              }}>
              <div className="flex items-center justify-between">
                <span className="cc-mono !text-[10px]" style={{ color: "rgba(60,53,64,.55)" }}>{s.n} / 0{N}</span>
                <span className="h-2 w-2 rounded-full" style={{ background: d === 0 ? C.orange : "rgba(60,53,64,.2)" }} />
              </div>
              <motion.div className="mt-4 flex items-start gap-2" initial={false} animate={{ opacity: d === 0 ? 1 : 0 }} transition={{ duration: 0.25 }}>
                <span className="mt-1.5 h-4 w-[2px] shrink-0" style={{ background: C.black }} />
                <span className="cc-serif text-[24px] leading-[1.05]" style={{ color: INK }}>{s.card}</span>
              </motion.div>
              <div className="mt-auto h-[96px]">
                {d === 0 && <StepArt key={active} kind={k} live={!reduce} />}
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}

const STEPS = [
  { n: "01", t: "Integrate", card: "Signal SDK", d: "Drop the Web, Android or iOS SDK into your login and payment screens. 40+ signals stream every 500 ms; the raw IMEI never leaves the device." },
  { n: "02", t: "Enroll", card: "Behavior Passport", d: "Three sessions build each customer's behavioral passport and anchor their device baseline on-chain." },
  { n: "03", t: "Decide", card: "Risk Fusion", d: "Three pathways run in parallel and fuse into one score — APPROVE, STEP_UP or HARD_BLOCK — before money moves." },
  { n: "04", t: "Investigate", card: "Evidence Graph", d: "Every HARD_BLOCK gets an AI-written evidence report, streamed live to the FIU command center with a full audit trail." },
];

const EXPLORE = [
  { to: "/demo/bank", t: "ZipPay: a retail bank protected by Citadel", d: "Register, log in and transfer — then watch the engine score every keystroke.", art: "blue" },
  { to: "/admin", t: "Inside the FIU fraud-ops command center", d: "Live sessions, threat map, mule networks, voice-MFA verdicts and the device ledger.", art: "orange" },
  { to: "/phishing-demo", t: "Anatomy of a phished session", d: "A staged credential-theft attack, and what the stolen session looks like to the engine.", art: "lavender" },
];

function ExploreArt({ kind }: { kind: string }) {
  if (kind === "blue")
    return (
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, #C5BACE 0%, #8D8FA0 38%, #2B4654 70%, #1B3340 100%)" }}>
        {[18, 38, 58].map((x) => <div key={x} className="absolute top-[25%] h-[60%] w-[18%]" style={{ left: `${x}%`, background: "linear-gradient(180deg, rgba(255,255,255,.0), rgba(255,255,255,.12), rgba(255,255,255,0))" }} />)}
        <div className="absolute inset-x-[8%] top-[48%] flex items-baseline justify-center gap-4 py-4" style={{ borderTop: "1px solid rgba(255,255,255,.3)", borderBottom: "1px solid rgba(255,255,255,.3)" }}>
          <CitadelMark size={20} color="#fff" /><span className="cc-serif text-[26px] text-white">Citadel</span>
          <span className="h-8 w-px bg-white/40" /><span className="text-[20px] font-semibold text-white">ZipPay</span>
        </div>
      </div>
    );
  if (kind === "orange")
    return (
      <div className="absolute inset-0" style={{ background: C.orange }}>
        {[[0, 18, 0.22], [12, 10, 0.12], [30, 22, 0.18], [62, 14, 0.25], [80, 20, 0.15]].map(([x, w, o], k) => (
          <div key={k} className="absolute inset-y-0" style={{ left: `${x}%`, width: `${w}%`, background: `rgba(255,255,255,${o})`, filter: "blur(2px)" }} />
        ))}
        <div className="absolute inset-0 flex items-baseline justify-center gap-3 pt-[46%]">
          <CitadelMark size={30} color="#fff" /><span className="cc-serif text-[40px] text-white">Citadel</span>
        </div>
      </div>
    );
  return (
    <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 30% 30%, #F1EAE7, transparent 60%), radial-gradient(70% 70% at 80% 90%, #C5BACE, transparent 60%), linear-gradient(160deg, #E4DCE6, #B7A9C0)" }}>
      <div className="absolute left-1/2 top-1/2 w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[10px] p-4" style={{ background: "rgba(255,255,255,.75)", boxShadow: "0 20px 40px rgba(60,40,80,.18)" }}>
        <div className="cc-mono mb-3 !text-[9px]" style={{ color: C.w5 }}>zippay-secure-login.co</div>
        {[1, 2].map((k) => <div key={k} className="mb-2 h-6 rounded-[4px]" style={{ background: "#fff", border: `1px solid ${C.w2}` }} />)}
        <div className="h-6 rounded-[4px]" style={{ background: C.orange }} />
        <div className="cc-mono mt-3 !text-[9px]" style={{ color: C.orange }}>⚠ credential replay detected</div>
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const [tab, setTab] = useState(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), 6000);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <div className="min-h-screen bg-white" style={{ color: C.black, fontFamily: "'Inter', sans-serif" }}>
      <Nav />

      {/* Hero */}
      <section className="cc-edge relative z-10 -mb-[24px] rounded-b-[24px] bg-white pb-[80px] pt-[150px] md:pt-[180px]">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)] lg:gap-14">
          <div className="flex flex-col justify-between pl-0 lg:border-l lg:pl-9" style={{ borderColor: C.w2 }}>
            <div>
              <Reveal>
                <a href="#platform" className="text-[15px] underline underline-offset-4" style={{ color: C.w6 }}>Citadel, built for Indian digital banking</a>
              </Reveal>
              <Reveal delay={0.08}>
                <h1 className="cc-serif m-0 mt-5 text-[clamp(40px,5.4vw,76px)] leading-[1.02] tracking-[-0.025em]" style={{ textWrap: "balance" }}>
                  Every payment verified by who is really behind it.
                </h1>
              </Reveal>
            </div>
            <Reveal delay={0.18} className="mt-14 lg:mt-24">
              <div className="border-l-[3px] pl-8" style={{ borderColor: C.w2 }}>
                <p className="cc-serif m-0 max-w-[480px] text-[clamp(18px,1.6vw,24px)] leading-[1.25] tracking-[-0.01em]">
                  Deploy AI that learns how each customer types, taps and pays — and stops the scammer who doesn't.
                </p>
                <div className="mt-10 flex flex-wrap gap-2">
                  <Link to="/demo/bank" className="cc-btn cc-btn-orange !h-[46px] !px-6 !text-[15px]">Launch Demo <Arrow /></Link>
                  <Link to="/doc" className="cc-btn !h-[46px] !px-6 !text-[15px]" style={{ color: C.black, border: `1px solid ${C.w2}` }}>Read the docs</Link>
                </div>
              </div>
            </Reveal>
          </div>
          <motion.div initial={{ opacity: 0, scale: 0.97, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 1.1, ease: EASE, delay: 0.15 }}>
            <HeroMedia />
          </motion.div>
        </div>

        <div className="mt-20">
          <p className="cc-mono m-0 mb-6 text-center" style={{ color: C.black }}>Built on proven open infrastructure</p>
          <StackMarquee />
        </div>
      </section>

      {/* Orange stat band + scenarios */}
      <section data-nav-band={C.orange} className="cc-edge relative pb-[80px] pt-[112px] lg:pt-[180px]" style={{ background: C.orange }}>
        <div className="grid grid-cols-1 md:grid-cols-3" style={{ borderBottom: "1px solid rgba(255,255,255,.35)" }}>
          {[
            { el: <CountUp to={0.944} decimals={3} />, l: "Open-set ROC-AUC on unseen users" },
            { el: <CountUp to={80} prefix="<" suffix="ms" />, l: "To block a SIM-swap" },
            { el: <CountUp to={100} suffix="%" />, l: "Of decisions explained with SHAP" },
          ].map((s, k) => (
            <Reveal key={k} delay={k * 0.1}>
              <div className="flex h-full flex-col items-center px-4 pb-16 pt-4 md:pb-24" style={{ borderLeft: "1px solid rgba(255,255,255,.35)" }}>
                <span className="cc-serif text-center text-[clamp(72px,8.4vw,128px)] font-light leading-[1.08] tracking-[-0.03em] text-white">{s.el}</span>
                <span className="mt-12 text-center text-[15px] text-white">{s.l}</span>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="pt-[80px]">
          <Reveal><ScenarioCarousel /></Reveal>
        </div>
      </section>

      {/* Security (white, rounded seams) */}
      <section id="security" className="relative z-10 -mt-6 overflow-clip rounded-[24px] bg-white">
        <div className="cc-edge py-12 lg:py-16">
          <Reveal><h2 className="cc-serif m-0 mb-8 text-[clamp(38px,4.4vw,64px)] leading-[1.02] tracking-[-0.015em]">Security for critical money movement.</h2></Reveal>
          <Reveal delay={0.1}>
            <div className="grid gap-0 rounded-[24px] px-6 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:px-12" style={{ background: C.green }}>
              {[
                { b: [["FIPS", "203/204"]], t: "Post-Quantum", s: "ML-KEM-768 · ML-DSA-65" },
                { b: [["RBI", "AUTH 2025"]], t: "RBI Auth Directions", s: "Design aligned" },
                { b: [["DPDP", "2023"], ["PII", "NONE"]], t: "DPDP & No PII On-chain", s: "Privacy by design" },
                { b: [["RBI", "FREE-AI"]], t: "Explainable AI", s: "SHAP top-5 per decision" },
              ].map((c, k) => (
                <div key={c.t} className="px-0 py-6 sm:px-8 lg:py-2" style={{ borderLeft: k ? "1px solid rgba(255,255,255,.18)" : undefined }}>
                  <div className="mb-6 flex gap-3">{c.b.map(([a, b]) => <Badge key={a} top={a} bottom={b} />)}</div>
                  <h3 className="cc-serif m-0 text-[22px] font-normal text-white lg:text-[28px]">{c.t}</h3>
                  <p className="m-0 mt-3 text-[14px] font-medium text-white/90">{c.s}</p>
                </div>
              ))}
            </div>
          </Reveal>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-6">
            <div className="flex flex-wrap items-center gap-8">
              <span className="cc-mono" style={{ color: C.w5 }}>On the roadmap</span>
              {["ISO/IEC 27001", "PCI DSS", "SOC 2 Type II"].map((x) => <span key={x} className="text-[17px]">{x}</span>)}
            </div>
            <Link to="/doc" className="group inline-flex items-center gap-2 text-[17px] underline underline-offset-4" style={{ color: C.black }}>
              Explore security <ArrowUpRight size={18} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>

        {/* Solutions */}
        <div id="solutions" className="cc-section-y overflow-hidden">
          <Reveal><h2 className="cc-serif m-0 mb-12 px-6 text-center text-[clamp(32px,4.4vw,64px)] leading-[1.02] tracking-[-0.015em] lg:mb-16">Solutions designed for your institution.</h2></Reveal>
          <div className="cc-edge grid grid-cols-2 gap-3 md:gap-6 lg:grid-cols-4">
            {TILES.map((t, k) => (
              <Reveal key={t.label} delay={k * 0.08}>
                <Link to="/demo/platforms" className="group relative block aspect-[3/4.2] overflow-hidden rounded-[18px] no-underline md:rounded-[24px]">
                  <div className="absolute inset-0 scale-110 transition-transform duration-[1.6s] ease-out group-hover:scale-125" style={{ background: t.bg }} />
                  <t.icon strokeWidth={0.6} className="absolute left-1/2 top-[40%] h-[46%] w-[46%] -translate-x-1/2 -translate-y-1/2 text-white/25 transition-transform duration-700 group-hover:scale-110" />
                  <div className="absolute inset-0" style={{ background: "radial-gradient(transparent 50%, rgba(0,0,0,.25))" }} />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[8px] px-5 py-3 text-[15px] text-white md:text-[20px]"
                    style={{ background: "rgba(150,140,135,.42)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
                    {t.label}
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
          <p className="cc-edge m-0 mt-8 text-center text-[17px]" style={{ color: C.w6 }}>
            Don't see your institution type? Citadel's SDK fits any login or payment flow. <Link to="/doc" className="underline" style={{ color: C.w6 }}>Read the docs.</Link>
          </p>
        </div>
      </section>

      {/* Blue platform band */}
      <section id="platform" data-nav-band={C.blue} className="cc-edge relative -mt-6 pb-12 pt-[110px] lg:pt-[170px]" style={{ background: C.blue }}>
        <div className="border-l pl-0 lg:pl-9" style={{ borderColor: "rgba(255,255,255,.25)" }}>
          <Reveal>
            <h2 className="cc-serif m-0 text-[clamp(38px,5.2vw,76px)] leading-[1.04] tracking-[-0.025em] text-white" style={{ textWrap: "balance" }}>The Citadel Decision Engine</h2>
            <p className="cc-serif m-0 max-w-[1100px] text-[clamp(38px,5.2vw,76px)] leading-[1.04] tracking-[-0.025em]" style={{ color: C.w3, textWrap: "balance" }}>
              Three parallel pathways, one verdict, in under 80 milliseconds.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mt-16">
            <Link to="/doc" className="cc-btn cc-btn-glass !h-[46px] !px-6 !text-[15px]">Explore Platform <Arrow /></Link>
          </Reveal>

          <div className="mt-24 grid gap-10 lg:grid-cols-[260px_1fr_1.2fr] lg:gap-16">
            <NumberedTabs items={PATHWAYS} active={tab} onChange={setTab} light />
            <AnimatePresence mode="wait">
              <motion.div key={tab} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.45, ease: EASE }}>
                <h3 className="cc-serif m-0 mb-6 text-[clamp(30px,3.3vw,48px)] font-normal leading-[1.02] text-white">{PATHWAYS[tab].t}</h3>
                <p className="m-0 max-w-[380px] text-[15px] leading-[1.5]" style={{ color: C.w2 }}>{PATHWAYS[tab].d}</p>
              </motion.div>
            </AnimatePresence>
            <AnimatePresence mode="wait">
              <motion.div key={tab} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.5, ease: EASE }}
                className="overflow-hidden rounded-[18px]" style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.14)" }}>
                <div className="cc-mono flex items-center justify-between px-5 py-3 text-white/60" style={{ borderBottom: "1px solid rgba(255,255,255,.1)" }}>
                  <span>Pathway {PATHWAYS[tab].n}</span>
                  <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7FD49A]" />live</span>
                </div>
                {PATHWAYS[tab].rows.map(([k, v], r) => (
                  <motion.div key={k} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + r * 0.18, duration: 0.4 }}
                    className="flex items-center justify-between px-5 py-4" style={{ borderTop: r ? "1px solid rgba(255,255,255,.08)" : undefined }}>
                    <span className="cc-mono text-white/55">{k}</span>
                    <span className={`text-[15px] ${r === 3 ? "font-medium" : ""}`} style={{ color: r === 3 ? (v.startsWith("STEP") ? "#F5C77A" : "#F29A84") : "#fff" }}>{v}</span>
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-32 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <Reveal><h3 className="cc-serif m-0 max-w-[606px] text-[clamp(28px,3.3vw,48px)] font-normal leading-[1.04] text-white">Bank-grade security meets one-line integration.</h3></Reveal>
            <Reveal delay={0.1}><p className="m-0 max-w-[396px] text-[15px] leading-[1.5]" style={{ color: C.w2 }}>
              Web, Android and iOS SDKs share one signal bundle and one REST API. Device baselines live on a permissioned ledger; behavioral profiles sit behind row-level security.
            </p></Reveal>
          </div>
          <div className="mt-14 pb-6"><StackMarquee invert /></div>
        </div>
      </section>

      {/* Stepper */}
      <section className="relative z-10 -mt-6 rounded-[24px] bg-white">
        <div className="cc-edge cc-section-y">
          <Reveal className="text-center">
            <h2 className="cc-serif m-0 text-[clamp(38px,5vw,76px)] leading-[1.04] tracking-[-0.025em]">AI built for your fraud model</h2>
            <p className="cc-serif m-0 mx-auto max-w-[1100px] text-[clamp(38px,5vw,76px)] leading-[1.04] tracking-[-0.025em]" style={{ color: C.w4, textWrap: "balance" }}>
              Behavioral baselines for your unique customers and channels.
            </p>
          </Reveal>
          <div className="mt-20 grid items-center gap-10 border-l lg:grid-cols-[360px_1fr]" style={{ borderColor: C.w2 }}>
            <div>
              <NumberedTabs items={STEPS.map((s) => ({ n: s.n, t: s.t.toUpperCase() }))} active={step} onChange={setStep} />
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4 }} className="pl-[17px] pt-20">
                  <h3 className="cc-serif m-0 text-[28px] font-normal">{STEPS[step].t}</h3>
                  <p className="m-0 mt-8 max-w-[300px] text-[17px] leading-[1.45]" style={{ color: C.w6 }}>{STEPS[step].d}</p>
                  <div className="mt-4 h-[2px] w-[180px] overflow-hidden rounded" style={{ background: C.w1 }}>
                    <span key={step} className="cc-dot-fill block h-full" style={{ background: C.black, animationDuration: "6s" }} />
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
            <CardDeck active={step} />
          </div>
          <p className="cc-mono m-0 mb-10 mt-20 hidden px-6 lg:block">Rigorously validated. Honestly measured.</p>
          <div className="grid gap-8 md:grid-cols-3">
            {[
              { v: <CountUp to={80} prefix="<" suffix=" ms" />, l: "Decision latency on the device-trust fast path" },
              { v: <CountUp to={0.868} decimals={3} />, l: "Transaction-fraud ROC-AUC on a temporal split, leakage removed" },
              { v: <CountUp to={40} suffix="+" />, l: "Behavioral signals captured per session" },
            ].map((m, k) => (
              <Reveal key={k} delay={k * 0.08}>
                <div className="flex items-baseline gap-6 border-t pt-6 md:block" style={{ borderColor: C.w2 }}>
                  <span className="cc-serif block text-[48px] leading-none">{m.v}</span>
                  <span className="mt-3 block max-w-[260px] text-[15px]" style={{ color: C.w6 }}>{m.l}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* Explore */}
        <div id="explore" className="cc-edge cc-section-y">
          <div className="mb-14 flex flex-wrap items-end justify-between gap-6">
            <Reveal><h2 className="cc-serif m-0 text-[clamp(38px,4.4vw,64px)] leading-[1.02] tracking-[-0.015em]">See it hold the line, live.</h2></Reveal>
            <Link to="/demo/bank" className="cc-btn cc-btn-dark">Launch Demo <Arrow /></Link>
          </div>
          <div className="grid border-x md:grid-cols-3" style={{ borderColor: C.w1 }}>
            {EXPLORE.map((x, k) => (
              <Reveal key={x.to} delay={k * 0.1}>
                <Link to={x.to} className="group block h-full px-6 pb-10 no-underline md:px-10" style={{ borderLeft: k ? `1px solid ${C.w1}` : undefined, color: C.black }}>
                  <div className="relative aspect-[3/4] overflow-hidden rounded-[22px]">
                    <div className="absolute inset-0 transition-transform duration-[1.2s] ease-out group-hover:scale-105"><ExploreArt kind={x.art} /></div>
                  </div>
                  <h3 className="cc-serif m-0 mt-10 text-[clamp(24px,2.2vw,34px)] font-normal leading-[1.1] transition-colors group-hover:text-[#083241]">{x.t}</h3>
                  <p className="m-0 mt-4 text-[15px] leading-[1.45]" style={{ color: C.w6 }}>{x.d}</p>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="cc-edge cc-section-y relative z-10 pb-[140px]">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <Reveal><h2 className="cc-serif m-0 max-w-[808px] text-[clamp(34px,4vw,60px)] font-normal leading-[1.04] tracking-[-0.015em]" style={{ textWrap: "balance" }}>
              Reliable fraud infrastructure for digital banking.
            </h2></Reveal>
            <Link to="/demo/bank" className="cc-btn cc-btn-orange !h-[46px] !px-6 !text-[15px] self-start lg:self-end">Launch Demo <Arrow /></Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer data-nav-band={C.orange} className="relative -mt-[50px] w-full pt-[50px]" style={{ background: C.orange }}>
        <div className="cc-edge grid gap-12 py-20 lg:grid-cols-[1fr_2fr]">
          <div>
            <CitadelMark size={30} color="#fff" />
            <p className="cc-serif m-0 mb-10 mt-8 max-w-[300px] text-[26px] leading-[1.15] text-white">Trusted behavioral security for digital banking.</p>
            <span className="cc-mono flex items-center gap-2 text-white/90">
              <span className="relative flex h-2 w-2">
                <span className="cc-ping absolute inline-flex h-full w-full rounded-full bg-[#7FD49A] opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7FD49A]" />
              </span>
              IBM Z Datathon 2026
            </span>
            <p className="m-0 mt-4 max-w-[340px] text-[13px] leading-[1.5] text-white/70">
              Theme: Secure &amp; privacy-aware AI · Built by Apoorv, Keha, Aditya, Vanshika, Harshdeep and Parth
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 md:grid-cols-3" style={{ borderLeft: "1px solid rgba(255,255,255,.2)" }}>
            {[
              { h: "Platform", l: [["Bank demo", "/demo/bank"], ["FIU console", "/admin"], ["Phishing demo", "/phishing-demo"], ["Platforms", "/demo/platforms"]] },
              { h: "Pathways", l: [["Device trust", "#platform"], ["Coercion", "#platform"], ["Behavioral ML", "#platform"], ["Investigator", "#explore"]] },
              { h: "Developers", l: [["Docs", "/doc"], ["API reference", "/doc"], ["Security", "#security"], ["GitHub", "https://github.com/adt-kmr/Ledatic"]] },
            ].map((col) => (
              <div key={col.h} className="pl-8 md:pl-10">
                <h3 className="m-0 mb-6 text-[17px] font-normal text-white">{col.h}</h3>
                <ul className="m-0 flex list-none flex-col gap-4 p-0">
                  {col.l.map(([t, href]) => (
                    <li key={t}>
                      {href.startsWith("/")
                        ? <Link to={href} className="cc-mono !text-[12px] text-white/60 no-underline transition-colors hover:text-white">{t}</Link>
                        : <a href={href} {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})} className="cc-mono !text-[12px] text-white/60 no-underline transition-colors hover:text-white">{t}</a>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="cc-edge flex flex-wrap justify-between gap-4 pb-10 text-[13px] text-white/60">
          <span>Team Incognito — Harshdeep Athawale · Prabinder Singh · Danish Dhanjal · Kyna Sood · Anish Grover</span>
          <span className="cc-mono !text-[11px]">Synthetic & public data only</span>
        </div>
        <div className="pointer-events-none select-none overflow-hidden">
          <motion.div initial={{ y: "30%", opacity: 0 }} whileInView={{ y: "0%", opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, ease: EASE }}
            className="cc-serif -mb-[0.22em] text-center text-[22vw] leading-none tracking-[-0.05em] text-white/10">
            Citadel
          </motion.div>
        </div>
      </footer>
    </div>
  );
}
