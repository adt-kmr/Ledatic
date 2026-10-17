import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check, Copy, Minus } from "lucide-react";
import { CountUp, EASE, NumberedTabs, Reveal } from "../components/cc/motion";

/* Cross-platform SDKs — Concurrence-style editorial page: serif display,
   mono labels, an orange stat band, a teal code band, warm neutrals. */

const INK = "#100F0F";
const W6 = "#575452";
const W5 = "#767270";
const HAIR = "#EAE4E1";

// ── Platform definitions ────────────────────────────────────────────────────
const PLATFORMS = [
  {
    id: "web", name: "Web SDK", tech: "TypeScript", n: 40, suffix: "+", statLabel: "DOM signals captured",
    description: "Keystroke dynamics, mouse movement, touch, screen-share, clipboard and device fingerprint — from the first keypress.",
    art: "radial-gradient(70% 60% at 70% 25%, #B9C9CF 0%, transparent 60%), radial-gradient(70% 70% at 20% 90%, #0B3A4B 0%, transparent 70%), linear-gradient(160deg, #5F7F8A, #083241)",
  },
  {
    id: "ios", name: "iOS SDK", tech: "Swift 5.9", n: 6, suffix: "", statLabel: "Native collectors",
    description: "UITextField delegate keystroke capture, UITouch force and size, identifierForVendor HMAC, lifecycle observers.",
    art: "radial-gradient(70% 60% at 30% 25%, #F4F0F6 0%, transparent 60%), radial-gradient(70% 70% at 80% 90%, #8E7C9C 0%, transparent 70%), linear-gradient(160deg, #D9CFE0, #9C8AAB)",
  },
  {
    id: "android", name: "Android SDK", tech: "Kotlin 1.9", n: 500, suffix: " ms", statLabel: "Signal flush cadence",
    description: "TextWatcher keystroke dynamics, MotionEvent pressure, IMEI HMAC-SHA256, DisplayManager screen-share detection.",
    art: "radial-gradient(60% 55% at 70% 25%, #CFD9C4 0%, transparent 60%), radial-gradient(70% 60% at 25% 85%, #2C3827 0%, transparent 65%), linear-gradient(160deg, #8A9A7C, #2C3827)",
  },
] as const;

function PlatformGlyph({ id, size = 64 }: { id: string; size?: number }) {
  if (id === "web")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" /><path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round">
      <rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M10.5 18.5h3" />
    </svg>
  );
}

// ── Signal coverage ─────────────────────────────────────────────────────────
const SIGNALS = [
  { signal: "Keystroke dynamics", web: "keydown/keyup events", ios: "UITextField delegate", android: "TextWatcher", webCap: true, iosCap: true, androidCap: true },
  { signal: "Touch / pressure", web: "pointer events", ios: "UITouch.force", android: "MotionEvent.pressure", webCap: true, iosCap: true, androidCap: true },
  { signal: "Flight time", web: "key-to-key ms", ios: "Notification diff", android: "System.currentTimeMillis", webCap: true, iosCap: true, androidCap: true },
  { signal: "Dwell time", web: "keydown→keyup", ios: "N/A (iOS 16+)", android: "backspace only", webCap: true, iosCap: false, androidCap: false },
  { signal: "Device fingerprint", web: "navigator API", ios: "identifierForVendor", android: "IMEI + HMAC", webCap: true, iosCap: true, androidCap: true },
  { signal: "Screen-share", web: "getDisplayMedia", ios: "capturedDidChange", android: "DisplayManager", webCap: true, iosCap: true, androidCap: true },
  { signal: "Clipboard", web: "paste event", ios: "UIPasteboard", android: "ClipboardManager", webCap: true, iosCap: true, androidCap: true },
  { signal: "Mouse movement", web: "mousemove coords", ios: "N/A", android: "N/A", webCap: true, iosCap: false, androidCap: false },
  { signal: "App lifecycle", web: "visibilitychange", ios: "UIApplication", android: "Activity lifecycle", webCap: true, iosCap: true, androidCap: true },
  { signal: "Screen resolution", web: "window.screen", ios: "UIScreen.main", android: "DisplayMetrics", webCap: true, iosCap: true, androidCap: true },
];

function SignalMatrix() {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto rounded-[20px]" style={{ border: `1px solid ${HAIR}` }}>
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr]" style={{ background: "#F7F3F1", borderBottom: `1px solid ${HAIR}` }}>
          {["Signal", "Web", "iOS", "Android"].map((h) => (
            <div key={h} className="cc-mono px-6 py-4" style={{ color: W6 }}>{h}</div>
          ))}
        </div>
        {SIGNALS.map((row, i) => (
          <Reveal key={row.signal} delay={i * 0.03} y={10}>
            <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr] transition-colors"
              onMouseEnter={() => setHover(row.signal)} onMouseLeave={() => setHover(null)}
              style={{ borderBottom: i < SIGNALS.length - 1 ? `1px solid ${HAIR}` : "none", background: hover === row.signal ? "#FBF9F8" : "#fff" }}>
              <div className="cc-serif px-6 py-4 text-[19px]" style={{ color: INK }}>{row.signal}</div>
              {(["web", "ios", "android"] as const).map((p) => {
                const cap = row[`${p}Cap`];
                return (
                  <div key={p} className="flex items-center gap-2.5 px-6 py-4 font-mono text-[12.5px]" style={{ color: cap ? W6 : "#B3AEAC" }}>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                      style={{ background: cap ? "rgba(61,107,58,.12)" : "#F1EAE7", color: cap ? "#3D6B3A" : "#B3AEAC" }}>
                      {cap ? <Check size={12} strokeWidth={2.5} /> : <Minus size={12} strokeWidth={2.5} />}
                    </span>
                    {row[p]}
                  </div>
                );
              })}
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

// ── Code (real SDK entry points) ────────────────────────────────────────────
const CODE_TABS = [
  {
    id: "web", label: "Web", lang: "TypeScript", filename: "BehaviorSDK.ts",
    code: `export class BehaviorSDK {
  private config: Required<SDKConfig>;
  private sessionId: string;
  private keystrokeBuffer: KeystrokeEvent[] = [];
  private mouseBuffer: MouseEvent[] = [];
  private touchBuffer: TouchEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SDKConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionId = crypto.randomUUID();
  }

  start() {
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("paste", this.onPaste);
    this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
  }

  private async flush() {
    const bundle: SignalBundle = {
      sessionId: this.sessionId,
      userId: this.config.userId,
      channel: this.config.channel,
      keystrokeEvents: this.keystrokeBuffer.splice(0),
      mouseEvents: this.mouseBuffer.splice(0),
      touchEvents: this.touchBuffer.splice(0),
      environment: this.captureEnvironment(),
      timestampMs: Date.now(),
    };
    await fetch(\`\${this.config.apiUrl}/api/signals/ingest\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle),
    });
  }
}`,
  },
  {
    id: "ios", label: "iOS", lang: "Swift", filename: "BehaviorSDK.swift",
    code: `class BehaviorSDK {
    let sessionId: String
    private let config: SDKConfig
    private let uploader: SignalUploader
    private var bundle: SignalBundle?
    private var flushTimer: Timer?

    init(config: SDKConfig) {
        self.config = config
        self.sessionId = UUID().uuidString
        self.uploader = SignalUploader(apiUrl: config.apiUrl)
    }

    @MainActor
    func start(view: UIView, inputFields: [UIView]) {
        let env = EnvironmentCollector().buildEnvironment()
        bundle = SignalBundle(
            sessionId: sessionId,
            userId: config.userId,
            channel: config.channel,
            imeiHash: config.imeiHash,
            environment: env,
            timestampMs: Int64(Date().timeIntervalSince1970 * 1000)
        )
        keystrokeCollector = KeystrokeCollector(bundle: bundle!)
        touchCollector = TouchCollector(bundle: bundle!)
        inputFields.forEach { keystrokeCollector?.attach(to: $0) }
        touchCollector?.attach(to: view)
        flushTimer = Timer.scheduledTimer(withTimeInterval: config.flushIntervalMs / 1000, repeats: true) { [weak self] _ in
            self?.flush()
        }
    }

    private func flush() {
        guard let bundle = bundle, !bundle.keystrokeEvents.isEmpty else { return }
        uploader.send(bundle) { [weak self] in self?.bundle?.reset() }
    }
}`,
  },
  {
    id: "android", label: "Android", lang: "Kotlin", filename: "BehaviorSDK.kt",
    code: `class BehaviorSDK(private val config: SDKConfig) {
    val sessionId: String = UUID.randomUUID().toString()
    private var bundle: SignalBundle? = null
    private var handler: Handler? = null

    fun start(activity: Activity, inputFields: List<EditText>) {
        val env = EnvironmentSignals(
            screenShareActive = false, clipboardSource = "none",
            tabVisible = true, deviceType = "mobile",
            userAgent = "", screenResolution = ""
        )
        bundle = SignalBundle(
            sessionId = sessionId, userId = config.userId,
            channel = config.channel, imeiHash = config.imeiHash,
            keystrokeEvents = mutableListOf(),
            touchEvents = mutableListOf(),
            environment = env, timestampMs = System.currentTimeMillis()
        )
        val keystrokeCollector = KeystrokeCollector(bundle!!)
        val touchCollector = TouchCollector(bundle!!)
        inputFields.forEach { keystrokeCollector.attach(it) }
        val root = activity.findViewById<View>(android.R.id.content)
        touchCollector.attach(root)

        handler = Handler(Looper.getMainLooper())
        handler?.postDelayed(object : Runnable {
            override fun run() { flush(); handler?.postDelayed(this, config.flushIntervalMs) }
        }, config.flushIntervalMs)
    }

    private fun flush() {
        bundle?.let { SignalUploader(config.apiUrl).send(it) { bundle?.reset() } }
    }
}`,
  },
] as const;

function CodeBand() {
  const [tab, setTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const active = CODE_TABS[tab];
  const copy = () => navigator.clipboard?.writeText(active.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {});
  return (
    <div className="grid gap-10 lg:grid-cols-[260px_1fr] lg:gap-16">
      <div>
        <NumberedTabs id="sdk-code" light active={tab} onChange={setTab}
          items={CODE_TABS.map((t, i) => ({ n: `0${i + 1}`, t: t.label.toUpperCase() }))} />
        <AnimatePresence mode="wait">
          <motion.p key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35 }}
            className="m-0 mt-10 max-w-[240px] pl-[17px] text-[15px] leading-[1.5]" style={{ color: "#D7D2D0" }}>
            {active.lang} implementation of the same signal bundle, posting to <span className="font-mono text-white">/api/signals/ingest</span>.
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="overflow-hidden rounded-[18px]" style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.14)" }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,.1)" }}>
          <div className="flex items-center gap-2">
            {[0, 1, 2].map((d) => <span key={d} className="h-2.5 w-2.5 rounded-full" style={{ background: "rgba(255,255,255,.22)" }} />)}
            <span className="cc-mono ml-3 text-white/70">{active.filename}</span>
          </div>
          <button onClick={copy} className="cc-mono flex items-center gap-1.5 text-white/70 transition-colors hover:text-white" aria-label="Copy code">
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <AnimatePresence mode="wait">
          <motion.pre key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
            className="m-0 max-h-[460px] overflow-auto px-5 py-5 font-mono text-[12.5px] leading-[1.75]" style={{ color: "#F1EAE7" }}>
            {active.code.split("\n").map((l, i) => (
              <div key={i} className="flex">
                <span className="mr-5 inline-block w-6 shrink-0 select-none text-right" style={{ color: "rgba(255,255,255,.25)" }}>{i + 1}</span>
                <span className="whitespace-pre">{l}</span>
              </div>
            ))}
          </motion.pre>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Simulated multi-platform signal stream ──────────────────────────────────
interface StreamSignal { id: number; platform: "web" | "ios" | "android"; type: "KEYSTROKE" | "TOUCH" | "ENVIRONMENT" | "NAVIGATION"; detail: string; timestamp: string; }
const SIGNAL_TYPES: StreamSignal["type"][] = ["KEYSTROKE", "TOUCH", "ENVIRONMENT", "NAVIGATION"];
const PLATFORM_IDS: StreamSignal["platform"][] = ["web", "ios", "android"];
const DETAILS: Record<StreamSignal["type"], string[]> = {
  KEYSTROKE: ["key='a' dwell=89ms flight=142ms", "key='Enter' dwell=62ms flight=210ms", "key='Shift' dwell=45ms flight=38ms", "key='h' dwell=71ms flight=95ms", "key='Backspace' dwell=54ms flight=120ms", "key='e' dwell=83ms flight=108ms"],
  TOUCH: ["x=187.3 y=412.8 pressure=0.62 size=12.4", "x=302.1 y=289.5 pressure=0.78 size=14.1", "x=94.6 y=531.2 pressure=0.45 size=10.8", "swipe dx=120 dy=-45 velocity=890px/s"],
  ENVIRONMENT: ["screen_share=false clipboard=paste tab_visible=true", "lifecycle=active resolution=1170x2532", "lifecycle=background device_type=mobile"],
  NAVIGATION: ["field_enter=login_email dwell=2340ms", "field_exit=login_password dwell=1890ms", "field_enter=otp_input dwell=450ms"],
};
const PLATFORM_TONE: Record<StreamSignal["platform"], string> = { web: "#083241", ios: "#7A5E8E", android: "#3D6B3A" };
const TYPE_TONE: Record<StreamSignal["type"], [string, string]> = {
  KEYSTROKE: ["#AA412A", "rgba(170,65,42,.09)"],
  TOUCH: ["#7A5E8E", "rgba(122,94,142,.1)"],
  ENVIRONMENT: ["#8A6A1E", "rgba(196,150,40,.12)"],
  NAVIGATION: ["#083241", "rgba(8,50,65,.08)"],
};

function SignalStream() {
  const [signals, setSignals] = useState<StreamSignal[]>([]);
  const [counts, setCounts] = useState({ web: 0, ios: 0, android: 0 });
  const idRef = useRef(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const platform = PLATFORM_IDS[Math.floor(Math.random() * PLATFORM_IDS.length)];
      const type = SIGNAL_TYPES[Math.floor(Math.random() * SIGNAL_TYPES.length)];
      const list = DETAILS[type];
      const now = new Date();
      const timestamp = `${now.toTimeString().slice(0, 8)}.${now.getMilliseconds().toString().padStart(3, "0")}`;
      setSignals((prev) => [{ id: idRef.current++, platform, type, detail: list[Math.floor(Math.random() * list.length)], timestamp }, ...prev].slice(0, 14));
      setCounts((c) => ({ ...c, [platform]: c[platform] + 1 }));
      timer = setTimeout(tick, 450 + Math.random() * 500);
    };
    timer = setTimeout(tick, 400);
    return () => clearTimeout(timer);
  }, []);
  const total = counts.web + counts.ios + counts.android;

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
      <div className="flex flex-col gap-6">
        {PLATFORM_IDS.map((p) => (
          <div key={p} className="border-t pt-5" style={{ borderColor: HAIR }}>
            <div className="flex items-baseline justify-between">
              <span className="cc-mono" style={{ color: W6 }}>{p}</span>
              <span className="cc-serif text-[36px] leading-none" style={{ color: INK }}>{counts[p]}</span>
            </div>
            <div className="mt-3 h-[3px] overflow-hidden rounded-full" style={{ background: "#F1EAE7" }}>
              <motion.div className="h-full rounded-full" style={{ background: PLATFORM_TONE[p] }}
                animate={{ width: total ? `${(counts[p] / total) * 100}%` : "0%" }} transition={{ duration: 0.5 }} />
            </div>
          </div>
        ))}
        <p className="m-0 text-[13px] leading-[1.5]" style={{ color: W5 }}>Simulated stream for illustration — the live bank demo sends real signals to the engine.</p>
      </div>
      <div className="overflow-hidden rounded-[20px]" style={{ border: `1px solid ${HAIR}` }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ background: "#F7F3F1", borderBottom: `1px solid ${HAIR}` }}>
          <span className="cc-mono flex items-center gap-2" style={{ color: W6 }}>
            <span className="relative flex h-2 w-2">
              <span className="cc-ping absolute inline-flex h-full w-full rounded-full" style={{ background: "#3D8B5A", opacity: 0.6 }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#3D8B5A" }} />
            </span>
            {total} signals captured
          </span>
          <span className="cc-mono" style={{ color: W5 }}>500 ms flush</span>
        </div>
        <div className="h-[460px] overflow-hidden">
          <AnimatePresence initial={false}>
            {signals.map((s) => (
              <motion.div key={s.id} layout
                initial={{ opacity: 0, y: -16, backgroundColor: "rgba(170,65,42,.06)" }}
                animate={{ opacity: 1, y: 0, backgroundColor: "rgba(255,255,255,0)" }}
                exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: EASE }}
                className="grid grid-cols-[96px_76px_118px_1fr] items-center gap-3 px-6 py-[9px]"
                style={{ borderBottom: `1px solid ${HAIR}` }}>
                <span className="font-mono text-[11px]" style={{ color: "#969290" }}>{s.timestamp}</span>
                <span className="cc-mono flex items-center gap-1.5" style={{ color: PLATFORM_TONE[s.platform] }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: PLATFORM_TONE[s.platform] }} />{s.platform}
                </span>
                <span className="cc-mono w-fit rounded-[5px] px-2 py-0.5 !text-[10px]" style={{ color: TYPE_TONE[s.type][0], background: TYPE_TONE[s.type][1] }}>{s.type}</span>
                <span className="truncate font-mono text-[12px]" style={{ color: W6 }}>{s.detail}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function PlatformsPage() {
  return (
    <div className="bg-white" style={{ color: INK, fontFamily: "'Inter', sans-serif" }}>
      {/* Hero */}
      <section className="cc-edge pb-16 pt-16 md:pt-24">
        <div className="border-l pl-0 lg:pl-9" style={{ borderColor: "#D7D2D0" }}>
          <Reveal><span className="cc-mono" style={{ color: W5 }}>Cross-platform SDKs</span></Reveal>
          <Reveal delay={0.06}>
            <h1 className="cc-serif m-0 mt-5 max-w-[1000px] text-[clamp(40px,5.6vw,80px)] leading-[1.02] tracking-[-0.025em]">One SDK, every surface your customers bank on.</h1>
            <p className="cc-serif m-0 mt-2 max-w-[1000px] text-[clamp(40px,5.6vw,80px)] leading-[1.02] tracking-[-0.025em]" style={{ color: "#969290" }}>Same schema, same engine.</p>
          </Reveal>
          <Reveal delay={0.14} className="mt-12 flex flex-wrap items-end justify-between gap-8">
            <p className="m-0 max-w-[520px] border-l-[3px] pl-6 text-[17px] leading-[1.5]" style={{ borderColor: "#D7D2D0", color: W6 }}>
              Behavioral biometrics captured natively across web, iOS and Android — streamed to one backend and one fraud-detection pipeline.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to="/demo/bank" className="cc-btn cc-btn-orange !h-[46px] !px-6 !text-[15px]">Try it in the bank demo <ArrowRight /></Link>
              <Link to="/doc" className="cc-btn !h-[46px] !px-6 !text-[15px]" style={{ color: INK, border: "1px solid #D7D2D0" }}>SDK docs</Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Platform tiles */}
      <section className="cc-edge pb-24">
        <div className="grid gap-4 md:grid-cols-3 md:gap-6">
          {PLATFORMS.map((p, i) => (
            <Reveal key={p.id} delay={i * 0.1}>
              <motion.div whileHover={{ y: -6 }} transition={{ duration: 0.4, ease: EASE }}
                className="group relative flex h-full min-h-[520px] flex-col justify-between overflow-hidden rounded-[24px] p-8 text-white">
                <div className="absolute inset-0 scale-110 transition-transform duration-[1.6s] ease-out group-hover:scale-125" style={{ background: p.art }} />
                <div className="absolute right-[-30px] top-[30px] text-white/20 transition-transform duration-700 group-hover:rotate-6 group-hover:scale-110">
                  <PlatformGlyph id={p.id} size={220} />
                </div>
                <div className="relative">
                  <span className="cc-mono rounded-[6px] px-3 py-1.5 text-white" style={{ background: "rgba(255,255,255,.18)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}>{p.tech}</span>
                </div>
                <div className="relative">
                  <div className="cc-serif text-[clamp(64px,6vw,96px)] font-light leading-none tracking-[-0.03em]"><CountUp to={p.n} suffix={p.suffix} /></div>
                  <div className="cc-mono mt-3 text-white/80">{p.statLabel}</div>
                  <h3 className="cc-serif m-0 mt-8 text-[32px] font-normal">{p.name}</h3>
                  <p className="m-0 mt-3 text-[15px] leading-[1.5] text-white/85">{p.description}</p>
                </div>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Orange stat band */}
      <section className="cc-edge rounded-[24px] pb-16 pt-24" style={{ background: "#AA412A" }}>
        <Reveal><p className="cc-mono m-0 mb-12 text-center text-white/80">One signal bundle · three native runtimes</p></Reveal>
        <div className="grid md:grid-cols-3" style={{ borderBottom: "1px solid rgba(255,255,255,.35)" }}>
          {[
            { el: <CountUp to={10} />, l: "Signal families with cross-platform parity" },
            { el: <CountUp to={500} suffix=" ms" />, l: "Bundle flush interval on every platform" },
            { el: <CountUp to={0} />, l: "Raw IMEIs that ever leave the device" },
          ].map((s, k) => (
            <Reveal key={k} delay={k * 0.1}>
              <div className="flex h-full flex-col items-center px-4 pb-16" style={{ borderLeft: "1px solid rgba(255,255,255,.35)" }}>
                <span className="cc-serif text-[clamp(64px,7.5vw,116px)] font-light leading-[1.08] tracking-[-0.03em] text-white">{s.el}</span>
                <span className="mt-8 max-w-[240px] text-center text-[15px] text-white">{s.l}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Coverage matrix */}
      <section className="cc-edge cc-section-y">
        <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
          <Reveal>
            <span className="cc-mono" style={{ color: W5 }}>Feature parity</span>
            <h2 className="cc-serif m-0 mt-4 text-[clamp(36px,4.4vw,64px)] leading-[1.02] tracking-[-0.015em]">Signal coverage across platforms.</h2>
          </Reveal>
          <div className="flex gap-6">
            {[["#3D6B3A", "Captured natively"], ["#B3AEAC", "Not available"]].map(([c, l]) => (
              <span key={l} className="cc-mono flex items-center gap-2" style={{ color: W6 }}><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>
            ))}
          </div>
        </div>
        <SignalMatrix />
      </section>

      {/* Teal code band */}
      <section className="cc-edge rounded-[24px] pb-20 pt-24" style={{ background: "#083241" }}>
        <div className="border-l pl-0 lg:pl-9" style={{ borderColor: "rgba(255,255,255,.25)" }}>
          <Reveal>
            <h2 className="cc-serif m-0 text-[clamp(36px,5vw,72px)] leading-[1.04] tracking-[-0.025em] text-white">Same pattern,</h2>
            <p className="cc-serif m-0 text-[clamp(36px,5vw,72px)] leading-[1.04] tracking-[-0.025em]" style={{ color: "#B3AEAC" }}>native implementation.</p>
          </Reveal>
          <div className="mt-16"><CodeBand /></div>
        </div>
      </section>

      {/* Live stream */}
      <section className="cc-edge cc-section-y">
        <Reveal className="mb-12">
          <span className="cc-mono" style={{ color: W5 }}>Live signal feed</span>
          <h2 className="cc-serif m-0 mt-4 text-[clamp(36px,4.4vw,64px)] leading-[1.02] tracking-[-0.015em]">Every tap, streamed in half a second.</h2>
        </Reveal>
        <SignalStream />
      </section>
    </div>
  );
}
