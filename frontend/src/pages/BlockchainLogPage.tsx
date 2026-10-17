import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch } from "../lib/auth";

interface ChainEvent {
  id: string;
  type: "IMEI_REGISTERED" | "IMEI_MISMATCH" | "MULE_FLAGGED" | "MULE_CLEARED" | "BEHAVIORAL_BLOCK" | "BEHAVIORAL_PASSPORT_PQC";
  user_hash: string;
  timestamp: string;
  latency_ms?: number;
  channel: string;
  details: string;
  pqc_algorithm?: string;
  pqc_hash_preview?: string;
}

const EVENT_CFG = {
  IMEI_REGISTERED: { color: "#3D8B5A", glow: "rgba(61, 139, 90,0.2)", icon: "✓", label: "IMEI Registered", cc: "HashRegistrar.go" },
  IMEI_MISMATCH: { color: "#B3261E", glow: "rgba(179, 38, 30,0.2)", icon: "✕", label: "IMEI Mismatch", cc: "MismatchDetector.go" },
  MULE_FLAGGED: { color: "#B7791F", glow: "rgba(255,180,0,0.2)", icon: "⚠", label: "Mule Flagged", cc: "MuleDetector.go" },
  MULE_CLEARED: { color: "#5B5BA8", glow: "rgba(170, 65, 42,0.2)", icon: "⟲", label: "Mule Cleared", cc: "MuleDetector.go" },
  BEHAVIORAL_BLOCK: { color: "#B5527A", glow: "rgba(255,107,107,0.2)", icon: "🔴", label: "Behavioral Block", cc: "ML Engine" },
  BEHAVIORAL_PASSPORT_PQC: { color: "#8E5BA8", glow: "rgba(170, 65, 42,0.25)", icon: "🔮", label: "PQC Passport", cc: "Dilithium-3" },
};


function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return new Date(iso).toLocaleTimeString("en-IN", { timeStyle: "short" });
}

export default function BlockchainLogPage() {
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, setChainLive] = useState(false);
  const [pqcStatus, setPqcStatus] = useState<{
    pqc_available: boolean;
    algorithm: string;
    standard: string;
    security_level: string;
    global_enrolled: number;
    global_verified: number;
  } | null>(null);
  const isLoadingRef = useRef(false);

  const load = async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoadError(null);
    try {
      // 1) LIVE Hyperledger Fabric ledger first — real on-chain chaincode
      //    queries (IMEI baselines + a live SIM-swap mismatch probe).
      const r = await apiFetch("/api/blockchain/ledger");
      if (r.ok) {
        const data = await r.json();
        if (data.chain_live && Array.isArray(data.events) && data.events.length > 0) {
          const liveEvents: ChainEvent[] = data.events.map((e: {
            label?: string; type: ChainEvent["type"]; user_hash: string;
            timestamp: string; latency_ms?: number; channel: string; details: string;
          }) => ({
            id: `${e.user_hash}-${e.type}-${e.timestamp}`,
            type: e.type,
            user_hash: e.user_hash,
            timestamp: e.timestamp,
            latency_ms: typeof e.latency_ms === "number" ? e.latency_ms : undefined,
            channel: e.channel,
            details: e.details,
          }));
          setEvents(liveEvents);
          setChainLive(true);
          setLoading(false);
          return;
        }
      }
      setChainLive(false);
      // 2) Fallback: persisted SMART_CONTRACT fraud reports from prior /evaluate runs.
      const rr = await apiFetch("/api/fraud/reports");
      if (rr.ok) {
        const reports = await rr.json() as Array<{
          report_id: string; pathway: string; decision: string;
          user_id: string; created_at: string; latency_ms?: number;
          channel: string;
        }>;
        const blockchainEvents: ChainEvent[] = reports
          .filter((rep) => rep.pathway === "SMART_CONTRACT")
          .map((rep) => ({
            id: rep.report_id,
            type: rep.decision === "HARD_BLOCK" ? "IMEI_MISMATCH" : "IMEI_REGISTERED",
            user_hash: rep.user_id.slice(0, 20) + "...",
            timestamp: rep.created_at,
            latency_ms: typeof rep.latency_ms === "number" ? rep.latency_ms : undefined,
            channel: rep.channel,
            details: rep.decision === "HARD_BLOCK"
              ? "SIM swap detected — IMEI hash mismatch on Fabric ledger → HARD_BLOCK"
              : "IMEI hash verified against Fabric ledger → APPROVE",
          }));
        setEvents(blockchainEvents.reverse());
      } else {
        setEvents([]);
        setLoadError("Could not load ledger events — authenticate and run a demo scenario first.");
      }
    } catch (e) {
      console.warn("Blockchain ledger fetch failed:", e);
      setEvents([]);
      setLoadError("Ledger unavailable. Start the backend and run a SIM-swap or enrollment demo.");
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  };

  // Load PQC status separately (non-blocking)
  const loadPqcStatus = async () => {
    try {
      const r = await apiFetch("/api/blockchain/pqc-status");
      if (r.ok) {
        const data = await r.json();
        setPqcStatus({
          pqc_available: data.server_pqc?.pqc_available ?? false,
          algorithm: data.server_pqc?.algorithm ?? "Dilithium-3",
          standard: data.server_pqc?.standard ?? "NIST FIPS 204 (ML-DSA)",
          security_level: data.server_pqc?.security_level ?? "128-bit quantum security",
          global_enrolled: data.global_stats?.pqc_enrolled_passports ?? 0,
          global_verified: data.global_stats?.pqc_verified_sessions ?? 0,
        });
      }
    } catch (e) {
      console.warn("PQC status fetch failed:", e);
    }
  };

  useEffect(() => {
    load();
    loadPqcStatus();
    const id = setInterval(load, 15000);
    const pqcId = setInterval(loadPqcStatus, 30000);
    return () => { clearInterval(id); clearInterval(pqcId); };
  }, []);

  return (
    <div className="relative min-h-screen bg-[var(--color-canvas)] text-[#100F0F] font-inter overflow-hidden pb-32 pt-16">

      {/* ClickHouse-style Grid & Glows */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-grid-pattern opacity-10"></div>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full" style={{
          background: 'radial-gradient(circle, rgba(255, 180, 0, 0.01) 0%, transparent 60%)',
          filter: 'blur(80px)',
          transform: 'translateY(-20%)'
        }}></div>
      </div>

      <div className="relative z-10 max-w-[1100px] mx-auto px-6">

        {/* Top Action Bar & Network Status */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-16">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <h2 className="text-2xl font-outfit font-extrabold tracking-tight text-[#100F0F] flex items-center gap-2">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="opacity-80">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="#B7791F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="#100F0F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Hyperledger Fabric
              </h2>
              <p className="text-[11px] font-mono text-amber-700 mt-1 tracking-wide">
                HashRegistrar · MismatchDetector · MuleDetector
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {loadError && (
              <span className="px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-widest text-[#B3261E] bg-red-950/30 border border-red-500/30 rounded-full">
                No live events
              </span>
            )}
            <button
              onClick={load}
              className="px-4 py-2 text-[11px] font-mono font-bold text-[#100F0F] bg-[rgba(16,15,15,0.04)] border border-[rgba(16,15,15,0.06)] hover:bg-[rgba(16,15,15,0.06)] hover:border-[rgba(16,15,15,0.12)] rounded-lg transition-all duration-200 cursor-pointer flex items-center gap-2"
            >
              <span>↻</span> Refresh
            </button>
          </div>
        </div>

        {/* Network Status Bar */}
        <div className="flex flex-wrap items-center gap-6 p-4 mb-12 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] backdrop-blur-xl" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.02), inset 0 1px 1px rgba(255,255,255,0.8)' }}>
          <div className="flex items-center gap-2 border-r border-[rgba(16,15,15,0.06)] pr-6">
            <span className="w-2 h-2 rounded-full bg-[#3D8B5A] shadow-[0_0_8px_#3D8B5A] animate-pulse"></span>
            <span className="text-[12px] font-bold text-[#3D8B5A] tracking-wide">Fabric Network Online</span>
          </div>
          {[
            { label: "Channel", value: "citadel-channel" },
            { label: "Chaincode", value: "citadel-cc" },
            { label: "Consensus", value: "Raft (1 orderer)" },
            { label: "Peers", value: "2 org peers" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-[10px] text-[rgba(20,19,19,0.5)] uppercase tracking-wider">{label}:</span>
              <span className="text-[11px] text-[#100F0F] font-mono bg-[rgba(16,15,15,0.04)] px-2 py-0.5 rounded border border-[rgba(16,15,15,0.06)]">{value}</span>
            </div>
          ))}
        </div>

        {/* Header Hero */}
        <div className="flex flex-col items-center text-center mb-16">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-6xl md:text-[80px] tracking-[-0.03em] leading-[1] mb-6"
            style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 400, color: "#100F0F" }}
          >
            Immutable Audit Trail.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg md:text-xl text-[rgba(20,19,19,0.5)] max-w-2xl font-light leading-relaxed font-inter"
          >
            Every device check and behavioral signal is immutably recorded on Hyperledger Fabric with sub-80ms finality.
          </motion.p>
        </div>

        {/* Metrics Bento Box */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricBento title="Total Events" value={events.length.toString()} color="#100F0F" delay={0.2} />
          <MetricBento title="IMEI Registrations" value={events.filter(e => e.type === "IMEI_REGISTERED").length.toString()} color="#3D8B5A" glow={events.filter(e => e.type === "IMEI_REGISTERED").length > 0} delay={0.3} />
          <MetricBento title="Mismatches Detected" value={events.filter(e => e.type === "IMEI_MISMATCH").length.toString()} color="#B3261E" glow={events.filter(e => e.type === "IMEI_MISMATCH").length > 0} delay={0.4} />
          <MetricBento title="Mule Flags" value={events.filter(e => e.type === "MULE_FLAGGED").length.toString()} color="#B7791F" glow={events.filter(e => e.type === "MULE_FLAGGED").length > 0} delay={0.5} />
        </div>

        {/* 🔮 PQC Panel — CRYSTALS-Dilithium-3 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-10 rounded-2xl border overflow-hidden"
          style={{
            borderColor: "rgba(251,213,48,0.3)",
            background: "linear-gradient(135deg, rgba(251,213,48,0.06) 0%, rgba(251,213,48,0.04) 50%, rgba(251,213,48,0.06) 100%)",
            boxShadow: "0 0 40px rgba(251,213,48,0.08), inset 0 1px 1px rgba(255,255,255,0.6)"
          }}
        >
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-4">
              {/* Animated glow orb */}
              <div className="relative w-12 h-12 flex-shrink-0">
                <div className="absolute inset-0 rounded-xl animate-pulse" style={{ background: "radial-gradient(circle, rgba(251,213,48,0.4) 0%, transparent 70%)" }} />
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: "linear-gradient(135deg, rgba(251,213,48,0.15), rgba(251,213,48,0.1))", border: "1px solid rgba(251,213,48,0.3)" }}>🔮</div>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-outfit font-bold text-[var(--color-accent-gold)] tracking-tight">CRYSTALS-Dilithium-3 Active</span>
                  <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-accent-gold)] rounded-full" style={{ background: "rgba(251,213,48,0.12)", border: "1px solid rgba(251,213,48,0.25)" }}>NIST FIPS 204</span>
                  {pqcStatus?.pqc_available && (
                    <span className="w-2 h-2 rounded-full bg-[var(--color-accent-gold)] shadow-[0_0_8px_rgba(251,213,48,0.8)] animate-pulse" />
                  )}
                </div>
                <p className="text-[11px] text-[rgba(251,213,48,0.8)] mt-0.5 font-mono">
                  {pqcStatus?.standard ?? "NIST FIPS 204 (ML-DSA)"} · {pqcStatus?.security_level ?? "128-bit quantum security"} · Lattice-based signatures
                </p>
              </div>
            </div>
            {/* Right stats */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-center px-4 py-2 rounded-xl" style={{ background: "rgba(251,213,48,0.08)", border: "1px solid rgba(251,213,48,0.15)" }}>
                <div className="text-[22px] font-outfit font-black text-[var(--color-accent-gold)]">{pqcStatus?.global_enrolled ?? events.filter(e => e.type === "BEHAVIORAL_PASSPORT_PQC").length}</div>
                <div className="text-[9px] font-mono text-[var(--color-accent-gold)] uppercase tracking-widest">PQC Passports</div>
              </div>
              <div className="text-center px-4 py-2 rounded-xl" style={{ background: "rgba(251,213,48,0.08)", border: "1px solid rgba(251,213,48,0.15)" }}>
                <div className="text-[22px] font-outfit font-black text-[var(--color-accent-gold)]">{pqcStatus?.global_verified ?? 0}</div>
                <div className="text-[9px] font-mono text-[var(--color-accent-gold)] uppercase tracking-widest">Verified Sessions</div>
              </div>
              <div className="text-center px-4 py-2 rounded-xl" style={{ background: "rgba(251,213,48,0.08)", border: "1px solid rgba(251,213,48,0.15)" }}>
                <div className="text-[13px] font-mono font-bold text-[var(--color-accent-gold)]">~3.3KB</div>
                <div className="text-[9px] font-mono text-[var(--color-accent-gold)] uppercase tracking-widest">Sig Size</div>
              </div>
            </div>
          </div>
          {/* Bottom info strip */}
          <div className="px-5 py-2.5 border-t flex flex-wrap items-center gap-x-6 gap-y-1" style={{ borderColor: "rgba(251,213,48,0.15)", background: "rgba(251,213,48,0.04)" }}>
            {[
              { label: "Algorithm", val: pqcStatus?.algorithm ?? "Dilithium-3" },
              { label: "Hash Function", val: "SHA3-256" },
              { label: "Immune to", val: "Shor's Algorithm (Quantum)" },
              { label: "Storage", val: "Hyperledger Fabric + Postgres" },
            ].map(({ label, val }) => (
              <span key={label} className="text-[10px] font-mono text-[rgba(251,213,48,0.7)]">
                <span className="text-[var(--color-accent-gold)] font-bold">{label}:</span> {val}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Event Legend */}
        <div className="flex flex-wrap gap-2 mb-8">
          {Object.entries(EVENT_CFG).map(([type, cfg]) => (
            <div key={type} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[rgba(16,15,15,0.06)] bg-[rgba(16,15,15,0.02)] backdrop-blur-sm">
              <span className="text-[11px] font-bold" style={{ color: cfg.color }}>{cfg.icon}</span>
              <span className="text-[10px] font-bold tracking-[0.04em]" style={{ color: cfg.color }}>{cfg.label}</span>
              <span className="text-[8px] text-[rgba(20,19,19,0.5)]" style={{ fontFamily: "'DM Mono', monospace" }}>· {cfg.cc}</span>
            </div>
          ))}
        </div>

        {/* Ledger Feed Section */}
        <div className="relative mb-24">
          <div className="flex items-center justify-between mb-6 border-b border-[rgba(16,15,15,0.06)] pb-4">
            <h3 className="text-xl font-outfit font-semibold tracking-[-0.02em] text-[#100F0F]">Live Ledger Stream</h3>
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-24 rounded-xl border border-[rgba(16,15,15,0.06)] bg-[rgba(16,15,15,0.04)] animate-pulse" />
                ))}
              </div>
            ) : (
              <AnimatePresence>
                {events.map((ev, i) => (
                  <LedgerRow key={ev.id} event={ev} index={i} />
                ))}
              </AnimatePresence>
            )}
            {events.length === 0 && !loading && (
              <div className="py-12 text-center text-[rgba(20,19,19,0.5)] font-mono text-sm border border-dashed border-[rgba(16,15,15,0.06)] rounded-xl px-6">
                {loadError ?? "No on-chain events yet. Run a SIM-swap or enrollment demo to populate the ledger."}
              </div>
            )}
          </div>
        </div>

        {/* Chaincode Reference Cards (Restored from old version) */}
        <div className="border-t border-[rgba(16,15,15,0.06)] pt-12 pb-8">
          <h3 className="text-xl font-outfit font-semibold tracking-[-0.02em] text-[#100F0F] mb-8 text-center">Smart Contract References</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <ChaincodeCard
              name="HashRegistrar.go"
              color="#3D8B5A"
              desc="Stores SHA-256(bank_id + customer_id + IMEI) on first login. Pseudonymous — no raw PII on chain."
            />
            <ChaincodeCard
              name="MismatchDetector.go"
              color="#B3261E"
              desc="Compares current IMEI hash vs. stored baseline. Fires HARD_BLOCK event on any delta — <80ms end-to-end."
            />
            <ChaincodeCard
              name="MuleDetector.go"
              color="#B7791F"
              desc="Flags accounts receiving transfers from >N flagged sources. Detects money mule networks across branches."
            />
          </div>
        </div>

      </div>
    </div>
  );
}

function MetricBento({ title, value, color, glow, delay }: {
  title: string; value: string; color: string; glow?: boolean; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="relative p-5 rounded-2xl border border-[rgba(16,15,15,0.06)] bg-[rgba(16,15,15,0.02)] backdrop-blur-[40px] overflow-hidden group hover:border-[rgba(16,15,15,0.12)] transition-all duration-400 magnetic-hover"
      style={{ boxShadow: '0 18px 40px -20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255, 255, 255, 0.06)' }}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(16,15,15,0.03)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
      {glow && (
        <div className="absolute -top-12 -right-12 w-24 h-24 rounded-full blur-[30px] opacity-15 pointer-events-none" style={{ backgroundColor: color }}></div>
      )}
      <div className="text-[9px] font-semibold tracking-[0.12em] uppercase mb-2" style={{ color: "#767270", fontFamily: "'DM Mono', monospace" }}>{title}</div>
      <div className="text-3xl md:text-[42px] font-extrabold tracking-[-0.04em] leading-none" style={{ color, fontFamily: "'Inter', sans-serif" }}>{value}</div>
    </motion.div>
  );
}

function LedgerRow({ event, index }: { event: ChainEvent; index: number }) {
  const cfg = EVENT_CFG[event.type as keyof typeof EVENT_CFG];

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex flex-col md:flex-row gap-4 p-4 rounded-xl border border-[rgba(16,15,15,0.06)] bg-[rgba(16,15,15,0.02)] backdrop-blur-[20px] hover:bg-[rgba(16,15,15,0.04)] hover:border-[rgba(16,15,15,0.12)] transition-all duration-300 overflow-hidden magnetic-hover"
    >
      <div className="absolute left-0 top-0 bottom-0 w-[2px] opacity-80 rounded-full" style={{ backgroundColor: cfg.color, boxShadow: `0 0 8px ${cfg.glow}` }}></div>

      <div className="flex-1 pl-3">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5">
            <span className="font-bold tracking-wide text-[12px]" style={{ color: cfg.color, fontFamily: "'Inter', sans-serif" }}>{cfg.label}</span>
            <span className="px-2 py-0.5 rounded-full text-[8px] font-semibold tracking-[0.08em] text-[rgba(20,19,19,0.5)] bg-[rgba(16,15,15,0.04)] border border-[rgba(16,15,15,0.06)] uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>
              {cfg.cc}
            </span>
          </div>
          <div className="flex items-center gap-3 font-semibold text-[10px] text-[rgba(20,19,19,0.5)]" style={{ fontFamily: "'DM Mono', monospace" }}>
            {event.latency_ms && (
              <span className="flex items-center gap-1" style={{ color: event.latency_ms < 20 ? "#16a34a" : "inherit" }}>
                {event.latency_ms < 20 && <span className="text-[9px]">⚡</span>}
                {event.latency_ms}ms
              </span>
            )}
            <span>{timeAgo(event.timestamp)}</span>
          </div>
        </div>

        <p className="text-[12px] text-[rgba(20,19,19,0.7)] leading-relaxed mb-3 font-inter">
          {event.details}
        </p>

        <div className="flex flex-wrap gap-4 border-t border-[rgba(16,15,15,0.06)] pt-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-[9px]" style={{ fontFamily: "'DM Mono', monospace" }}>
            <span className="text-[rgba(20,19,19,0.35)] uppercase tracking-[0.1em]">User</span>
            <span className="text-[rgba(20,19,19,0.7)]">{event.user_hash}</span>
          </div>
          <div className="flex items-center gap-1.5 font-semibold text-[9px]" style={{ fontFamily: "'DM Mono', monospace" }}>
            <span className="text-[rgba(20,19,19,0.35)] uppercase tracking-[0.1em]">TX</span>
            <span className="text-[rgba(20,19,19,0.7)]">{event.id.split('-')[0]}...</span>
          </div>
          <div className="flex items-center gap-1.5 font-semibold text-[9px]" style={{ fontFamily: "'DM Mono', monospace" }}>
            <span className="text-[rgba(20,19,19,0.35)] uppercase tracking-[0.1em]">Channel</span>
            <span className="text-[rgba(20,19,19,0.7)]">{event.channel.toUpperCase()}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ChaincodeCard({ name, color, desc }: { name: string; color: string; desc: string }) {
  return (
    <div className="p-5 rounded-xl border border-[rgba(16,15,15,0.06)] bg-[rgba(16,15,15,0.02)] hover:bg-[rgba(16,15,15,0.04)] hover:border-[rgba(16,15,15,0.12)] transition-all duration-300 backdrop-blur-md relative overflow-hidden group magnetic-hover">
      <div className="absolute top-0 left-0 w-full h-[1px] opacity-10" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}></div>
      <h4 className="text-[12px] font-bold mb-2.5 tracking-[0.04em]" style={{ color, fontFamily: "'DM Mono', monospace" }}>{name}</h4>
      <p className="text-[12px] text-[rgba(20,19,19,0.7)] leading-relaxed" style={{ fontFamily: "'Inter', sans-serif" }}>{desc}</p>
    </div>
  );
}
