import { useState, useEffect, useCallback } from "react";
import { FileWarning, Siren, Mic, QrCode, Orbit, Building2, Map as MapIcon, Network, Link2, ShieldCheck, Crosshair, ScanFace, Fingerprint, type LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { C } from "../lib/theme";
import { apiFetch, ensureDemoToken, apiUrl } from "../lib/auth";
import { getAdminToken } from "../admin/adminAuth";

// Some fraud-ops endpoints (duress incidents, voice-MFA verifications, fraud
// reports) are fiu_admin-only. When this page is mounted inside the FIU portal
// (/cbi, /admin), an admin token is available in localStorage and must be used
// instead of the customer/demo token apiFetch() normally attaches — otherwise
// these calls 401/403 even though the analyst is signed in. Falls back to
// apiFetch() so standalone /demo/dashboard behaves exactly as before.
function adminAwareFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const adminToken = getAdminToken();
  if (adminToken) {
    const headers = new Headers(init.headers ?? undefined);
    headers.set("Authorization", `Bearer ${adminToken}`);
    return fetch(apiUrl(path), { ...init, headers });
  }
  return apiFetch(path, init);
}
import { LoadingRows, useAnimatedCounter } from "../components/Shared";
import DeceptionFeed from "../components/DeceptionFeed";
import FinancialGravityPage from "./FinancialGravityPage";
import BlockchainLogPage from "./BlockchainLogPage";
import {
  PqcShieldPanel,
  DeceptionPanel,
  AntiSpoofPanel,
  ZkPassportPanel,
} from "../components/security";
import { ThreatMapTab } from "./admin/ThreatMapTab";
import { MuleNetworkTab } from "./admin/MuleNetworkTab";
import VoiceMfaTab from "./admin/VoiceMfaTab";
import VoiceMfaToast from "../components/VoiceMfaToast";

interface FraudReport {
  report_id: string; session_id: string; user_id: string;
  report_text: string; risk_score: number; threat_level?: string;
  evidence: string[]; recommended_action?: string; confidence?: number;
  decision: string; pathway: string; channel: string; created_at: string;
  face_image?: string;
  pqc_verified?: boolean;
  pqc_algorithm?: string;
  keystroke_count?: number;
  mouse_count?: number;
  touch_count?: number;
  mouse_events?: any[];
  touch_events?: any[];
  login_ip?: string;
  login_country?: string;
  login_city?: string;
  vpn_detected?: boolean;
}

interface ShapFeature {
  feature: string; shap_value: number; description: string; direction: string;
}

interface ShapExplanation {
  session_id: string; features: ShapFeature[]; available?: boolean;
}

interface TxnScoreResult {
  decision: string;
  fraud_probability: number;
  anomaly_score: number;
  operating_threshold?: number;
  top_features?: Array<{ feature: string; shap_value?: number; feature_value?: number; importance?: number }>;
}

const THREAT_COLORS: Record<string, { text: string; bg: string; bar: string }> = {
  CRITICAL: { text: "var(--color-accent-rose)", bg: "color-mix(in oklch, var(--color-accent-rose) 15%, transparent)", bar: "var(--color-accent-rose)" },
  HIGH: { text: "oklch(0.75 0.15 70)", bg: "color-mix(in oklch, oklch(0.75 0.15 70) 15%, transparent)", bar: "oklch(0.75 0.15 70)" },
  MEDIUM: { text: "var(--color-accent-blue)", bg: "color-mix(in oklch, var(--color-accent-blue) 15%, transparent)", bar: "var(--color-accent-blue)" },
};

const DECISION_COLOR: Record<string, string> = {
  APPROVE: C.green,
  STEP_UP: C.amber,
  HARD_BLOCK: C.red,
};

// ── Console tabs ─────────────────────────────────────────────────────────────
// Grouped by role rather than one flat row: eleven tabs overflow the viewport
// on a laptop, and the grouping also tells a reviewer what each section is for.
// Colours are per-tab so the active state keeps each area visually distinct.
type TabId =
  | "fraud" | "emergency" | "qr" | "gravity" | "consortium" | "voice_mfa"
  | "threat_map" | "mule_network" | "blockchain"
  | "pqc" | "deception" | "antispoof" | "zkp";

const TAB_GROUPS: { name: string; tabs: { id: TabId; label: string; color: string; icon: LucideIcon }[] }[] = [
  {
    name: "Fraud ops",
    tabs: [
      { id: "fraud",      label: "Fraud reports",   color: "#100F0F", icon: FileWarning },
      { id: "emergency",  label: "Emergency",        color: "#B3261E", icon: Siren },
      { id: "voice_mfa",  label: "Voice MFA",        color: "#2C7A91", icon: Mic },
      { id: "qr",         label: "QR scans",         color: "var(--color-primary)", icon: QrCode },
      { id: "gravity",    label: "Financial gravity", color: "var(--color-primary)", icon: Orbit },
      { id: "consortium", label: "Consortium",       color: "var(--color-primary)", icon: Building2 },
    ],
  },
  {
    name: "Intelligence",
    tabs: [
      { id: "threat_map",   label: "Threat map",       color: "#2C7A91", icon: MapIcon },
      { id: "mule_network", label: "Mule network",     color: "#8E5BA8", icon: Network },
      { id: "blockchain",   label: "Blockchain ledger", color: "#3D8B5A", icon: Link2 },
    ],
  },
  {
    name: "Advanced security",
    tabs: [
      { id: "pqc",       label: "PQC shield",   color: "#3D8B5A", icon: ShieldCheck },
      { id: "deception", label: "Deception",    color: "#B7791F", icon: Crosshair },
      { id: "antispoof", label: "Anti-spoof",   color: "#2C7A91", icon: ScanFace },
      { id: "zkp",       label: "zk-SNARK",     color: "#8E5BA8", icon: Fingerprint },
    ],
  },
];

// ── SHAP Horizontal Bar Chart ─────────────────────────────────────────────
function ShapBarChart({ features, loading }: { features: ShapFeature[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="mb-4">
        <div className="text-[9px] uppercase tracking-[0.1em] font-semibold mb-3" style={{ color: "#969290", fontFamily: C.mono }}>
          SHAP Feature Importance
        </div>
        {[80, 60, 70, 50, 65, 45].map((w, i) => (
          <div key={i} className="mb-2">
            <div className="skeleton mb-1" style={{ height: 5, width: `${w}%`, borderRadius: 2 }} />
            <div className="skeleton" style={{ height: 5, width: `${w - 10}%`, borderRadius: 2 }} />
          </div>
        ))}
      </div>
    );
  }

  if (!features || features.length === 0) {
    return (
      <div className="mb-4">
        <div className="text-[9px] uppercase tracking-[0.1em] font-semibold mb-2" style={{ color: "#969290", fontFamily: C.mono }}>
          SHAP Feature Importance
        </div>
        <div className="text-[11px] italic py-2" style={{ color: "#969290" }}>
          No explanation available for this session.
        </div>
      </div>
    );
  }

  const maxAbs = Math.max(...features.map(f => Math.abs(f.shap_value)), 0.01);
  const chartData = features.map(f => ({
    name: f.description.length > 20 ? f.description.slice(0, 18) + "…" : f.description,
    fullName: f.description,
    value: parseFloat(f.shap_value.toFixed(3)),
    isNeg: f.shap_value < 0,
  }));

  const chartHeight = features.length * 32 + 10;

  return (
    <div className="mb-4">
      <div className="flex justify-between items-baseline mb-3">
        <div className="text-[9px] uppercase tracking-[0.1em] font-semibold" style={{ color: "#969290", fontFamily: C.mono }}>
          SHAP Feature Importance
        </div>
        <div className="text-[8px]" style={{ color: "#969290", fontFamily: C.mono }}>RBI FREE-AI</div>
      </div>
      {/* Legend */}
      <div className="flex gap-4 mb-3 text-[9px]" style={{ color: "#767270", fontFamily: C.mono }}>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 inline-block rounded-sm" style={{ background: C.red }} />
          Risk-increasing
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 inline-block rounded-sm" style={{ background: C.green }} />
          Risk-reducing
        </div>
      </div>
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 36, top: 0, bottom: 0 }}>
            <XAxis type="number" hide domain={[-maxAbs * 1.15, maxAbs * 1.15]} />
            <YAxis
              type="category" dataKey="name" width={120}
              tick={{ fontSize: 11.5, fill: "var(--color-muted)", fontFamily: "Inter, sans-serif" }}
              axisLine={false} tickLine={false}
            />
            <ReferenceLine x={0} stroke="var(--color-hairline)" strokeDasharray="2 2" />
            <Tooltip
              contentStyle={{
                background: "var(--color-canvas)", border: "1px solid var(--color-hairline)",
                borderRadius: 0, fontSize: 12.5, color: "var(--color-body-strong)", fontFamily: C.mono,
                boxShadow: "0 8px 32px var(--color-canvas)", padding: "8px 12px"
              }}
              formatter={(val: unknown, _name: unknown, props: unknown) => {
                const n = typeof val === "number" ? val : 0;
                const payload = (props as { payload?: { fullName?: string } })?.payload;
                return [`${n >= 0 ? "+" : ""}${n.toFixed(3)}  ${n >= 0 ? "↑ risk" : "↓ risk"}`, payload?.fullName || ""];
              }}
              cursor={{ fill: "var(--color-surface-soft)" }}
            />
            <Bar dataKey="value" radius={[0, 0, 0, 0]} barSize={12}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.isNeg ? C.green : C.red} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── SOC Metric Card ────────────────────────────────────────────────────────
interface SOCMetricCardProps {
  label: string;
  value: number;
  accent?: string;
  glow?: boolean;
  description?: string;
  percentage?: string;
  icon?: string;
}

function SOCMetricCard({
  label,
  value,
  accent = "var(--color-primary)",
  glow = false,
  description,
  percentage,
  icon,
}: SOCMetricCardProps) {
  const animated = useAnimatedCounter(value);
  return (
    <motion.div
      whileHover={{ y: -2, borderColor: accent }}
      style={{
        padding: "22px 24px",
        borderRadius: 16,
        background: glow ? `linear-gradient(160deg, ${accent}0F 0%, #FFFFFF 55%)` : "#FFFFFF",
        border: `1px solid ${glow ? `${accent}38` : "#EAE4E1"}`,
        boxShadow: "0 1px 2px rgba(16,15,15,0.04)",
        position: "relative",
        overflow: "hidden",
        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        cursor: "default"
      }}
    >
      {/* Top glowing edge */}
      {glow && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        }} />
      )}
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#767270", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500, fontFamily: C.mono }}>
          {label}
        </div>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, opacity: 0.85, marginTop: 4 }} aria-hidden data-icon={icon} />
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: 42, fontWeight: 300, color: "#100F0F", fontFamily: "'Newsreader', Georgia, serif", letterSpacing: "-0.015em", lineHeight: 1 }}>
          {animated}
        </div>
        {percentage && (
          <span style={{ fontSize: 11.5, color: percentage.startsWith("-") ? "#3D8B5A" : "#B3261E", fontFamily: C.mono, fontWeight: 700 }}>
            {percentage}
          </span>
        )}
      </div>

      {description && (
        <div style={{ fontSize: 12, color: "#767270", marginTop: 10, fontFamily: C.mono, letterSpacing: "0.02em" }}>
          {description}
        </div>
      )}
    </motion.div>
  );
}


// ── Transaction Fraud Scorer Panel ─────────────────────────────────────────
const TXN_PRESETS = [
  { label: "Normal UPI (₹500)", txn: { amount: 500, hour: 14, is_transfer: 1 } },
  { label: "Large transfer (₹50K)", txn: { amount: 50000, hour: 15, is_transfer: 1 } },
  { label: "Late-night cash-out", txn: { amount: 10000, hour: 3, is_transfer: 0 } },
  { label: "Round-amount (₹2L)", txn: { amount: 200000, hour: 1, is_transfer: 1 } },
];

function TransactionScorer() {
  const [amount, setAmount] = useState("5000");
  const [hour, setHour] = useState("14");
  const [isTransfer, setIsTransfer] = useState(true);
  const [result, setResult] = useState<TxnScoreResult | null>(null);
  const [loading, setLoading] = useState(false);

  const score = useCallback(async (overrideTxn?: Record<string, number>) => {
    setLoading(true);
    setResult(null);
    try {
      const txn = overrideTxn || {
        amount: parseFloat(amount) || 0,
        hour: parseInt(hour) || 12,
        is_transfer: isTransfer ? 1 : 0,
      };
      const r = await apiFetch("/api/fraud/score-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: txn }),
      });
      if (r.ok) setResult(await r.json());
    } catch (e) { console.warn("Transaction scoring failed:", e); }
    finally { setLoading(false); }
  }, [amount, hour, isTransfer]);

  return (
    <div className="glass-card" style={{ marginBottom: 26, padding: "22px 26px", borderRadius: 16, border: "1px solid #EAE4E1", background: "#FFFFFF" }}>
      <div className="flex justify-between items-center mb-5">
        <div>
          <span className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: "#100F0F", marginRight: 8, fontFamily: C.mono }}>
            Transaction Scorer
          </span>
          <span className="text-[9px]" style={{ color: "#969290", fontFamily: C.mono }}>
            XGBoost 0.868 + COPOD 0.815
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TXN_PRESETS.map(p => (
            <button key={p.label} onClick={() => { score(p.txn); }} className="glass-button" style={{
              padding: "5px 12px", fontSize: 11.5, fontFamily: C.mono, fontWeight: 500,
            }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <div className="text-[9px] uppercase tracking-[0.1em] mb-2" style={{ color: "#969290", fontFamily: C.mono }}>Amount (₹)</div>
          <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="5000"
            className="premium-input"
            style={{
              width: 100, padding: "8px 12px",
              background: "#FFFFFF", border: "1px solid #EAE4E1",
              color: "#100F0F", fontSize: 14, fontFamily: C.mono, outline: "none", borderRadius: 8,
            }}
          />
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-[0.1em] mb-2" style={{ color: "#969290", fontFamily: C.mono }}>Hour (0-23)</div>
          <input value={hour} onChange={e => setHour(e.target.value)} placeholder="14"
            className="premium-input"
            style={{
              width: 60, padding: "8px 12px",
              background: "#FFFFFF", border: "1px solid #EAE4E1",
              color: "#100F0F", fontSize: 14, fontFamily: C.mono, outline: "none", borderRadius: 8,
            }}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer mb-2" style={{ fontSize: 12.5, color: "#767270", fontFamily: C.mono, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <input type="checkbox" checked={isTransfer} onChange={e => setIsTransfer(e.target.checked)}
            style={{ accentColor: "#fff", width: 14, height: 14 }} />
          P2P Transfer
        </label>
        <button onClick={() => score()} disabled={loading} className="btn-primary" style={{
          padding: "9px 20px", marginLeft: 4,
          fontSize: 12.5, fontFamily: C.mono, textTransform: "uppercase" as const, letterSpacing: "0.06em",
        }}>
          {loading ? "Scoring…" : "Run Model"}
        </button>
      </div>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              marginTop: 20, padding: "16px 20px",
              background: "var(--color-canvas)", border: `1px solid var(--color-hairline)`,
              overflow: "hidden",
            }}>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <span style={{ fontSize: 11.5, color: "var(--color-muted-soft)", fontFamily: C.mono, textTransform: "uppercase", letterSpacing: "0.08em" }}>Decision</span>
                <div style={{
                  fontSize: 20, fontWeight: 800, fontFamily: C.mono, marginTop: 4,
                  color: result.decision === "BLOCK" ? C.red : C.green,
                }}>
                  {result.decision}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 11.5, color: "var(--color-muted-soft)", fontFamily: C.mono, textTransform: "uppercase", letterSpacing: "0.08em" }}>Fraud Prob</span>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: C.mono, color: C.textPrimary, marginTop: 4 }}>
                  {(result.fraud_probability * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <span style={{ fontSize: 11.5, color: "var(--color-muted-soft)", fontFamily: C.mono, textTransform: "uppercase", letterSpacing: "0.08em" }}>Anomaly Score</span>
                {/* COPOD decision_function is a raw anomaly score (higher = more
                    anomalous), NOT a probability — do not ×100 or suffix %. */}
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: C.mono, color: C.textPrimary, marginTop: 4 }}>
                  {typeof result.anomaly_score === "number" ? result.anomaly_score.toFixed(1) : "—"}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 11.5, color: "var(--color-muted-soft)", fontFamily: C.mono, textTransform: "uppercase", letterSpacing: "0.08em" }}>Threshold</span>
                <div style={{ fontSize: 18, fontWeight: 500, fontFamily: C.mono, color: "var(--color-muted-soft)", marginTop: 4 }}>
                  {result.operating_threshold !== undefined ? (result.operating_threshold * 100).toFixed(0) + "%" : "—"}
                </div>
              </div>
            </div>
            {!!result.top_features && result.top_features.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
                style={{ marginTop: 16, borderTop: "1px dashed var(--color-hairline)", paddingTop: 12 }}>
                <span style={{ fontSize: 11.5, color: "var(--color-muted-soft)", fontFamily: C.mono, textTransform: "uppercase", letterSpacing: "0.08em" }}>Top Features</span>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {result.top_features.map(f => (
                    <span key={f.feature} style={{
                      fontSize: 11.5, fontFamily: C.mono, padding: "2px 8px",
                      background: "var(--color-surface-soft)", border: "1px solid var(--color-hairline)",
                      color: "var(--color-body)",
                    }}>
                      {f.feature}: {f.shap_value !== undefined ? (f.shap_value > 0 ? "+" : "") + f.shap_value.toFixed(2) : (f.importance !== undefined ? f.importance.toFixed(2) : (f.feature_value !== undefined ? f.feature_value.toFixed(2) : "0.00"))}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}



// Helper for Consortium event times
function timeAgo(iso: string): string {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    return new Date(iso).toLocaleTimeString("en-IN", { timeStyle: "short" });
  } catch (e) {
    return "just now";
  }
}

// ── ConsortiumMapPage ────────────────────────────────────────────────────────
function ConsortiumMapPage() {
  const [reportingBank, setReportingBank] = useState("SBI");
  const [targetUser, setTargetUser] = useState("Harsh");
  const [broadcasting, setBroadcasting] = useState(false);
  const [consortiumEvents, setConsortiumEvents] = useState<any[]>([]);
  const [pulseProgress, setPulseProgress] = useState(0);
  const [consensusMsg, setConsensusMsg] = useState("");

  const loadConsortiumLogs = async () => {
    try {
      const res = await apiFetch("/api/blockchain/ledger");
      if (res.ok) {
        const data = await res.json();
        const filtered = (data.events || []).filter((e: any) => e.channel === "consortium");
        setConsortiumEvents(filtered);
      }
    } catch (e) {
      console.warn("Failed to load consortium ledger:", e);
    }
  };

  useEffect(() => {
    loadConsortiumLogs();
    const interval = setInterval(loadConsortiumLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleBroadcast = async () => {
    if (broadcasting) return;
    setBroadcasting(true);
    setPulseProgress(0);
    setConsensusMsg("");

    let progress = 0;
    const pulseInterval = setInterval(() => {
      progress += 0.05;
      if (progress >= 1) {
        clearInterval(pulseInterval);
        setPulseProgress(1);
        triggerBackendReport();
      } else {
        setPulseProgress(progress);
      }
    }, 50);
  };

  const triggerBackendReport = async () => {
    try {
      const imeiHash = "a1ddbe55b87c50dc41901a28388bb0a4f6e62e8970fb5542500d99cfc16449ed";
      const res = await apiFetch("/api/blockchain/consortium/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: targetUser,
          imei_hash: imeiHash,
          reporting_bank: reportingBank
        })
      });

      if (res.ok) {
        setConsensusMsg(`✓ Committed. ${reportingBank} threat report verified by FIU Peer node.`);
        await loadConsortiumLogs();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => {
        setBroadcasting(false);
        setPulseProgress(0);
      }, 1000);
    }
  };

  const coords: Record<string, { x: number; y: number }> = {
    FIU: { x: 80, y: 200 },
    SBI: { x: 200, y: 80 },
    PNB: { x: 320, y: 200 },
    HDFC: { x: 200, y: 320 }
  };

  const startPt = coords[reportingBank] || coords.SBI;
  const endPt = coords.FIU;
  const pulseX = startPt.x + (endPt.x - startPt.x) * pulseProgress;
  const pulseY = startPt.y + (endPt.y - startPt.y) * pulseProgress;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20, marginTop: 10 }}>
      <div style={{
        background: "#FFFFFF", border: "1px solid #EAE4E1",
        borderRadius: 20, padding: "24px 20px"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-primary)", fontFamily: C.mono, marginBottom: 4 }}>
              🌐 Cross-Bank Consortium Ledger
            </div>
            <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, color: "#100F0F", fontWeight: 400 }}>
              Consensus Threat Exchange Network
            </div>
          </div>
          <span style={{ fontSize: 10, background: "rgba(61, 139, 90,0.15)", border: "1px solid rgba(61, 139, 90,0.3)", borderRadius: 20, padding: "2px 10px", color: "#3D8B5A", fontFamily: C.mono, fontWeight: "bold" }}>
            CONSENSUS SYNCED
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "center", background: "rgba(255, 255, 255,0.2)", borderRadius: 16, padding: "20px 0", position: "relative", overflow: "hidden" }}>
          <AnimatePresence>
            {consensusMsg && (
              <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
                style={{
                  position: "absolute", top: 12, left: 12, right: 12,
                  background: "rgba(170, 65, 42,0.15)", border: "1px solid rgba(170, 65, 42,0.3)",
                  borderRadius: 10, padding: "8px 12px", color: "var(--color-primary)",
                  fontSize: 11.5, fontFamily: C.mono, textAlign: "center", zIndex: 10
                }}>
                {consensusMsg}
              </motion.div>
            )}
          </AnimatePresence>

          <svg width="400" height="400" viewBox="0 0 400 400" style={{ maxWidth: "100%", height: "auto" }}>
            <line x1="200" y1="80" x2="80" y2="200" stroke="rgba(170, 65, 42,0.15)" strokeWidth="2" strokeDasharray="5,5" />
            <line x1="320" y1="200" x2="80" y2="200" stroke="rgba(170, 65, 42,0.15)" strokeWidth="2" strokeDasharray="5,5" />
            <line x1="200" y1="320" x2="80" y2="200" stroke="rgba(170, 65, 42,0.15)" strokeWidth="2" strokeDasharray="5,5" />

            <circle cx="200" cy="200" r="120" fill="none" stroke="rgba(170, 65, 42,0.02)" strokeWidth="1" />

            {broadcasting && pulseProgress > 0 && pulseProgress < 1 && (
              <>
                <circle cx={pulseX} cy={pulseY} r="8" fill="var(--color-primary)" opacity="0.6">
                  <animate attributeName="r" values="6;12;6" dur="0.8s" repeatCount="indefinite" />
                </circle>
                <circle cx={pulseX} cy={pulseY} r="3" fill="var(--color-primary)" />
              </>
            )}

            <g transform="translate(200, 80)">
              <circle r="22" fill="rgba(16, 15, 15,0.02)" stroke={reportingBank === "SBI" && broadcasting ? "var(--color-primary)" : "rgba(16, 15, 15,0.1)"} strokeWidth="1.5" />
              {reportingBank === "SBI" && broadcasting && (
                <circle r="22" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" opacity="0.5">
                  <animate attributeName="r" values="22;32;22" dur="1s" repeatCount="indefinite" />
                </circle>
              )}
              <text y="4" textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="bold" fontFamily={C.mono}>SBI</text>
              <circle cx="16" cy="-16" r="4" fill="#3D8B5A" />
            </g>

            <g transform="translate(320, 200)">
              <circle r="22" fill="rgba(16, 15, 15,0.02)" stroke={reportingBank === "PNB" && broadcasting ? "var(--color-primary)" : "rgba(16, 15, 15,0.1)"} strokeWidth="1.5" />
              {reportingBank === "PNB" && broadcasting && (
                <circle r="22" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" opacity="0.5">
                  <animate attributeName="r" values="22;32;22" dur="1s" repeatCount="indefinite" />
                </circle>
              )}
              <text y="4" textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="bold" fontFamily={C.mono}>PNB</text>
              <circle cx="16" cy="-16" r="4" fill="#3D8B5A" />
            </g>

            <g transform="translate(200, 320)">
              <circle r="22" fill="rgba(16, 15, 15,0.02)" stroke={reportingBank === "HDFC" && broadcasting ? "var(--color-primary)" : "rgba(16, 15, 15,0.1)"} strokeWidth="1.5" />
              {reportingBank === "HDFC" && broadcasting && (
                <circle r="22" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" opacity="0.5">
                  <animate attributeName="r" values="22;32;22" dur="1s" repeatCount="indefinite" />
                </circle>
              )}
              <text y="4" textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="bold" fontFamily={C.mono}>HDFC</text>
              <circle cx="16" cy="-16" r="4" fill="#3D8B5A" />
            </g>

            <g transform="translate(80, 200)">
              <circle r="28" fill="rgba(170, 65, 42,0.08)" stroke="var(--color-primary)" strokeWidth="2.5" />
              <text y="4" textAnchor="middle" fill="var(--color-primary)" fontSize="10" fontWeight="bold" fontFamily={C.mono}>FIU</text>
              <text y="38" textAnchor="middle" fill="rgba(16, 15, 15,0.4)" fontSize="8" fontFamily={C.mono}>Primary Peer</text>
              <circle cx="20" cy="-20" r="5" fill="#3D8B5A" />
            </g>

            <circle cx="200" cy="200" r="160" fill="none" stroke="rgba(16, 15, 15,0.02)" strokeWidth="1" strokeDasharray="3,6" />
          </svg>
        </div>

        <div style={{
          marginTop: 18, padding: "16px 14px", background: "#FFFFFF",
          border: "1px solid #EAE4E1", borderRadius: 12
        }}>
          <div style={{ fontSize: 11.5, color: "#767270", fontFamily: C.mono, marginBottom: 10, textTransform: "uppercase" }}>
            Consortium Threat Simulator
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: "rgba(16, 15, 15,0.3)", display: "block", marginBottom: 4, fontFamily: C.mono }}>REPORTING PEER</label>
              <select value={reportingBank} onChange={(e) => setReportingBank(e.target.value)}
                style={{ width: "100%", background: "rgba(255, 255, 255,0.2)", border: "1px solid #EAE4E1", color: "#100F0F", borderRadius: 8, padding: "6px 10px", fontSize: 11.5, fontFamily: C.mono, outline: "none", colorScheme: "light" }}>
                <option value="SBI">State Bank of India (SBI)</option>
                <option value="PNB">Punjab National Bank (PNB)</option>
                <option value="HDFC">HDFC Bank</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: "rgba(16, 15, 15,0.3)", display: "block", marginBottom: 4, fontFamily: C.mono }}>TARGET CUSTOMER</label>
              <select value={targetUser} onChange={(e) => setTargetUser(e.target.value)}
                style={{ width: "100%", background: "rgba(255, 255, 255,0.2)", border: "1px solid #EAE4E1", color: "#100F0F", borderRadius: 8, padding: "6px 10px", fontSize: 11.5, fontFamily: C.mono, outline: "none", colorScheme: "light" }}>
                <option value="Harsh">Harsh (Demo)</option>
                <option value="Rajesh">Rajesh (Demo)</option>
              </select>
            </div>
          </div>
          <button onClick={handleBroadcast} disabled={broadcasting}
            style={{
              width: "100%", padding: "10px", borderRadius: 8,
              background: broadcasting ? "rgba(170, 65, 42,0.15)" : "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-active) 100%)",
              border: broadcasting ? "1px solid rgba(170, 65, 42,0.3)" : "none",
              color: broadcasting ? "var(--color-primary)" : "var(--color-on-primary)", fontSize: 11.5, fontFamily: C.mono, fontWeight: 700,
              cursor: broadcasting ? "default" : "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, transition: "all 0.2s"
            }}>
            {broadcasting ? <>⚡ BROADCASTING FRAUD EVENT TO LEDGER...</> : <>🚨 BROADCAST COMPROMISED DEVICE HASH</>}
          </button>
        </div>
      </div>

      <div style={{
        background: "#FFFFFF", border: "1px solid #EAE4E1",
        borderRadius: 20, padding: "24px 20px", display: "flex", flexDirection: "column"
      }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#969290", fontFamily: C.mono, marginBottom: 14 }}>
          📋 Consortium verified ledger feed
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, overflowY: "auto", maxHeight: 420 }} className="scrollbar-hide">
          {consortiumEvents.length === 0 ? (
            <div style={{ margin: "auto", textAlign: "center", padding: "40px 10px", color: "#969290", fontFamily: C.mono, fontSize: 11.5 }}>
              No consortium threats reported yet.<br />Use the simulator on the left to broadcast a peer-bank threat.
            </div>
          ) : (
            consortiumEvents.map((ev, idx) => (
              <div key={idx} style={{ padding: "12px 14px", borderRadius: 12, background: "#FFFFFF", border: "1px solid #EAE4E1" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(170, 65, 42,0.15)", border: "1px solid rgba(170, 65, 42,0.3)", color: "var(--color-primary)", fontFamily: C.mono, fontWeight: 700 }}>
                    {ev.label}
                  </span>
                  <span style={{ fontSize: 10, color: "#969290", fontFamily: C.mono }}>
                    {timeAgo(ev.timestamp)}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "#100F0F", fontFamily: C.mono, marginBottom: 4, wordBreak: "break-all" }}>
                  User Hash: {ev.user_hash}
                </div>
                <div style={{ fontSize: 11, color: "#767270", fontFamily: C.mono }}>
                  {ev.details}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}


// ── DashboardPage ─────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [reports, setReports] = useState<FraudReport[]>([]);
  const [loading, setLoading] = useState(true);
  // Set when a poll fails, so the list on screen is never silently stale.
  const [stale, setStale] = useState<string | null>(null);
  const [selected, setSelected] = useState<FraudReport | null>(null);
  const [shap, setShap] = useState<ShapFeature[]>([]);
  const [shapLoading, setShapLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("fraud");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDecision, setFilterDecision] = useState<"ALL" | "HARD_BLOCK" | "STEP_UP" | "APPROVE">("ALL");
  const [incidents, setIncidents] = useState<any[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<any | null>(null);

  const [qrScans, setQrScans] = useState<any[]>([]);
  const [qrScansLoading, setQrScansLoading] = useState(false);
  const [selectedQrScan, setSelectedQrScan] = useState<any | null>(null);

  const loadQrScans = async (silent = false) => {
    if (!silent) setQrScansLoading(true);
    try {
      const r = await apiFetch("/api/payments/qr-scans");
      if (r.ok) {
        const data = await r.json();
        setQrScans(data.scans || []);
        setSelectedQrScan((prev: any) => {
          if (!prev) return null;
          const fresh = (data.scans || []).find((x: any) => x.id === prev.id);
          return fresh || prev;
        });
      }
    } catch (e) {
      console.warn("Failed to load QR scans:", e);
    } finally {
      if (!silent) setQrScansLoading(false);
    }
  };

  /** `silent` skips the spinner so the 5 s background poll doesn't flash. */
  const loadIncidents = async (silent = false) => {
    if (!silent) setIncidentsLoading(true);
    try {
      const r = await adminAwareFetch("/api/duress/incidents");
      if (r.ok) {
        const data = await r.json();
        setIncidents(data);
        // Sync selected incident with the latest polled data (for real-time maps / coordinates)
        setSelectedIncident((prev: any) => {
          if (!prev) return null;
          const fresh = data.find((x: any) => x.incident_id === prev.incident_id);
          return fresh || prev;
        });
      }
    } catch (e) {
      console.warn("Failed to load incidents:", e);
    } finally {
      if (!silent) setIncidentsLoading(false);
    }
  };

  const handleResolveIncident = async (incidentId: string, status: "RESOLVED" | "FALSE_ALARM") => {
    try {
      const r = await adminAwareFetch(`/api/duress/resolve/${incidentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (r.ok) {
        loadIncidents();
        if (selectedIncident?.incident_id === incidentId) {
          setSelectedIncident((prev: any) => prev ? { ...prev, status } : null);
        }
      }
    } catch (e) {
      console.error("Failed to resolve incident:", e);
    }
  };

  useEffect(() => {
    if (activeTab === "emergency") {
      loadIncidents();                                       // first paint
      const interval = setInterval(() => loadIncidents(true), 5000);  // silent
      return () => clearInterval(interval);
    } else if (activeTab === "qr") {
      loadQrScans();
      const interval = setInterval(() => loadQrScans(true), 5000);
      return () => clearInterval(interval);
    }
    // NOTE: fraud reports are NOT polled here — the always-on poller below
    // already covers them. Having both meant /api/fraud/reports was fetched
    // twice on this tab (6 s and 10 s), out of phase.
  }, [activeTab]);

  /**
   * Load the current tab's data.
   *
   * `silent` skips the loading flag. Background polls MUST pass silent=true:
   * flipping `loading` swaps the whole list for a skeleton, which read as the
   * screen spontaneously reloading itself every few seconds. Only the very
   * first load (and an explicit Refresh click) should show the skeleton.
   */
  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (activeTab === "qr") {
        await loadQrScans(silent);
      } else if (activeTab === "emergency") {
        await loadIncidents();
      } else {
        const r = await adminAwareFetch("/api/fraud/reports");
        if (r.ok) {
          const fresh: FraudReport[] = await r.json();
          setReports(fresh);
          setStale(null);
          // Keep the open investigation panel pointed at the refreshed row
          // rather than a detached copy from the previous fetch.
          setSelected((prev) =>
            prev ? fresh.find((x) => x.report_id === prev.report_id) ?? prev : null,
          );
        } else {
          // A failed poll used to be swallowed here, leaving the last good
          // list on screen with nothing to say it had stopped updating. While
          // /api/fraud/reports was 500ing in production that looked exactly
          // like "old hard blocks show up, new ones never do" — the data was
          // simply frozen at the last successful fetch. Say so instead.
          setStale(`Live updates paused — /api/fraud/reports returned ${r.status}. Showing the last successful load.`);
        }
      }
    } catch (e) {
      console.warn("Loading failed:", e);
      setStale("Live updates paused — could not reach the server. Showing the last successful load.");
    }
    finally { if (!silent) setLoading(false); }
  };

  // Live-refresh: poll so new blocks/reports surface without a manual refresh.
  // The interval is silent so the list updates in place — no skeleton flash.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const init = async () => {
      await ensureDemoToken();
      await load(); // first paint may show the skeleton
      adminAwareFetch("/api/duress/incidents").then((r: Response) => r.ok ? r.json() : null).then((d: any) => { if (d) setIncidents(d); }).catch(() => {});
    };
    init();
    // Background poll for incidents every 5s so new live incidents show up
    const incidentPoll = setInterval(() => {
      adminAwareFetch("/api/duress/incidents").then((r: Response) => r.ok ? r.json() : null).then((d: any) => { if (d) setIncidents(d); }).catch(() => {});
    }, 5000);
    const t = setInterval(() => load(true), 6000); // background: silent
    return () => { clearInterval(t); clearInterval(incidentPoll); };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected) { setShap([]); return; }
    let cancelled = false;
    setShapLoading(true);
    apiFetch(`/api/auth/explain/${selected.session_id}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: ShapExplanation | null) => {
        if (cancelled) return;
        if (data?.features) {
          const sorted = [...data.features]
            .sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
            .slice(0, 6);
          setShap(sorted);
        } else { setShap([]); }
      })
      .catch(() => { if (!cancelled) setShap([]); })
      .finally(() => { if (!cancelled) setShapLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.session_id]);

  const critical = reports.filter(r => r.threat_level === "CRITICAL").length;
  const high = reports.filter(r => r.threat_level === "HIGH").length;
  const blocked = reports.filter(r => r.decision === "HARD_BLOCK").length;

  const filteredReports = reports.filter(r => {
    const matchesSearch = searchQuery.trim() === "" ||
      r.user_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.session_id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDecision = filterDecision === "ALL" || r.decision === filterDecision;
    return matchesSearch && matchesDecision;
  });

  return (
    <div style={{ minHeight: "100vh", position: "relative", background: "var(--color-canvas)", color: "#100F0F", paddingBottom: 64 }}>
      <div className="bg-grid-pattern" style={{ position: "fixed", inset: 0, opacity: 0.1, pointerEvents: "none", zIndex: 0 }} />
      {/* Live sign-in toasts — fixed-position, so it sits outside the tab
          switch and pops on whichever tab the analyst happens to be on. */}
      <VoiceMfaToast />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex justify-between items-end mb-6 pb-4" style={{ borderBottom: "1px solid #EAE4E1" }}>
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }}>
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 mb-4 rounded-full bg-[rgba(170,65,42,0.10)] border border-[rgba(170,65,42,0.28)] text-[9px] font-semibold tracking-widest text-[var(--color-primary)] uppercase" style={{ fontFamily: C.mono }}>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] shadow-[0_0_6px_rgba(170,65,42,0.8)] animate-pulse" />
              ZIPBANK SECURITY OPERATIONS CENTER
            </div>
            <h2 className="text-3xl md:text-4xl tracking-[-0.02em] mb-1" style={{
              color: "#100F0F",
              fontWeight: 400,
              fontFamily: "'Newsreader', Georgia, serif",
            }}>
              Fraud Intelligence Console
            </h2>
            <p className="text-[10px] font-medium tracking-[0.08em] uppercase" style={{ color: "#969290", fontFamily: C.mono }}>
              Biometric threat matrices & ledger validation
            </p>
          </motion.div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              /* Wrapped: passing `load` directly hands React's click event in
                 as `silent` (truthy), which would suppress the skeleton on an
                 explicit refresh. */
              onClick={() => load()} className="btn-secondary" style={{
                padding: "9px 18px",
                fontSize: 12.5, fontFamily: C.mono, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.04em",
              }}>
              ↻ Refresh Logs
            </button>
          </div>
        </div>

        {/* ── System Status Banner ── */}
        <div style={{
          display: "flex", gap: 20, alignItems: "center", justifyContent: "space-between",
          background: "#FFFFFF", border: "1px solid #EAE4E1",
          borderRadius: 16, padding: "14px 20px", marginBottom: 26, flexWrap: "wrap"
        }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "rgba(16, 15, 15, 0.6)", fontFamily: C.mono }}>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#3D8B5A]" />
              SOC SYSTEM STATUS: <strong style={{ color: "#3D8B5A" }}>SECURE</strong>
            </div>
            <div style={{ height: 12, width: 1, background: "rgba(16, 15, 15, 0.1)" }} />
            <div style={{ fontSize: 11.5, color: "rgba(16, 15, 15,0.4)", fontFamily: C.mono }}>
              BLOCKCHAIN LEDGER: <span style={{ color: "var(--color-primary)" }}>CONNECTED (HLF v2.5)</span>
            </div>
            <div style={{ height: 12, width: 1, background: "rgba(16, 15, 15, 0.1)" }} />
            <div style={{ fontSize: 11.5, color: "rgba(16, 15, 15,0.4)", fontFamily: C.mono }}>
              DECISION ENGINE: <span style={{ color: "var(--color-primary)" }}>ACTIVE</span>
            </div>
            <div style={{ height: 12, width: 1, background: "rgba(16, 15, 15, 0.1)" }} />
            <div style={{ fontSize: 11.5, color: "rgba(16, 15, 15,0.4)", fontFamily: C.mono }}>
              PQC SIGNER: <span style={{ color: "var(--color-primary)", fontWeight: 700 }}>🔮 DILITHIUM-3 (NIST FIPS 204)</span>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: "rgba(16, 15, 15,0.5)", fontFamily: C.mono }}>
            ⏰ UTC {new Date().toISOString().slice(11, 19)} · WORKSTATION-ID: <span style={{ color: "var(--color-primary)" }}>SOC-409A</span>
          </div>
        </div>

        {/* ── Metrics ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
          <SOCMetricCard label="Total Reports" value={reports.length} accent="var(--color-primary)" description="Ingressed sessions analyzed" icon="📊" />
          <SOCMetricCard label="Critical Threats" value={critical} accent="#B3261E" glow={critical > 0} description="Active mitigation required" percentage={critical > 0 ? "+18%" : undefined} icon="🚨" />
          <SOCMetricCard label="High Risk Matches" value={high} accent="#B7791F" glow={high > 0} description="Require step-up auth" icon="⚠️" />
          <SOCMetricCard label="Blocked Sessions" value={blocked} accent="#3D8B5A" description="Ingress hard-blocks enforced" icon="🚫" />
        </div>

        {/* ── Active Deception live trap feed ────────────────────────────── */}
        <DeceptionFeed />

        {/* ── Transaction Fraud Scorer ───────────────────────────────────── */}
        <TransactionScorer />

        {/* ── Tabs ─────────────────────────────────────────────────────────
            Eleven tabs will not fit on one row, so they are grouped by role
            and rendered from data instead of ~20 lines of inline JSX each.
            Groups wrap independently, so nothing overflows the viewport. */}
        <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr_1.15fr]" style={{ gap: 12, marginBottom: 24 }}>
          {TAB_GROUPS.map((group) => (
            <div key={group.name} style={{ background: "#F7F3F1", borderRadius: 14, padding: "10px 8px 8px" }}>
              <div style={{ fontFamily: C.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "#767270", padding: "0 8px 8px" }}>
                {group.name}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {group.tabs.map((t) => {
                  const active = activeTab === t.id;
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setActiveTab(t.id)}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.6)"; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 7,
                        padding: "8px 12px", borderRadius: 9, border: "none",
                        fontSize: 13.5, fontWeight: active ? 500 : 400, whiteSpace: "nowrap",
                        fontFamily: "'Inter', sans-serif",
                        background: active ? "#FFFFFF" : "transparent",
                        boxShadow: active ? "0 1px 3px rgba(16,15,15,0.1)" : "none",
                        color: active ? "#100F0F" : "#575452",
                        cursor: "pointer", transition: "background .15s, color .15s",
                      }}
                    >
                      <Icon size={15} strokeWidth={1.8} color={active ? t.color : "#969290"} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {activeTab === "threat_map" ? (
          <div>
            <ThreatMapTab />
          </div>
        ) : activeTab === "mule_network" ? (
          <div>
            <MuleNetworkTab />
          </div>
        ) : activeTab === "blockchain" ? (
          <div>
            <BlockchainLogPage />
          </div>
        ) : activeTab === "voice_mfa" ? (
          // The verifications endpoint is fiu_admin-only, so pass the
          // admin-token-aware fetcher rather than the customer token this
          // page normally carries.
          <VoiceMfaTab fetcher={adminAwareFetch} />
        ) : activeTab === "pqc" ? (
          <PqcShieldPanel />
        ) : activeTab === "deception" ? (
          <DeceptionPanel />
        ) : activeTab === "antispoof" ? (
          <AntiSpoofPanel />
        ) : activeTab === "zkp" ? (
          <ZkPassportPanel />
        ) : activeTab === "qr" ? (
          <div>
            {qrScansLoading && qrScans.length === 0 ? (
              <LoadingRows count={3} />
            ) : qrScans.length === 0 ? (
              <div className="glass-panel text-center" style={{ padding: "72px 24px" }}>
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{
                  background: "#FFFFFF", border: "1px solid #EAE4E1",
                }}>
                  <span style={{ fontSize: 24 }}>📷</span>
                </div>
                <div className="text-[15px] font-semibold mb-2" style={{ color: "#575452" }}>No QR code scans yet</div>
                <div className="text-[12px]" style={{ color: "#969290" }}>
                  Upload and scan a UPI QR code in the Bank Portal to see analysis logs here.
                </div>
              </div>
            ) : (
              <div className={`grid grid-cols-1 ${selectedQrScan ? "lg:grid-cols-2" : ""} gap-5`}>
                {/* List of QR Scans */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {qrScans.map((scan) => {
                    const isActive = selectedQrScan?.id === scan.id;
                    const tc = {
                      SAFE: { text: C.green, bg: "rgba(61, 139, 90, 0.15)", bar: C.green },
                      SUSPICIOUS: { text: C.amber, bg: "rgba(183, 121, 31, 0.15)", bar: C.amber },
                      MALICIOUS: { text: C.red, bg: "rgba(179, 38, 30, 0.15)", bar: C.red },
                    }[scan.verdict as "SAFE" | "SUSPICIOUS" | "MALICIOUS"] || { text: "#FFFFFF", bg: "rgba(16, 15, 15,0.1)", bar: "#FFFFFF" };

                    return (
                      <div
                        key={scan.id}
                        onClick={() => setSelectedQrScan(isActive ? null : scan)}
                        className="glass-card magnetic-hover"
                        style={{
                          padding: "18px 22px",
                          cursor: "pointer",
                          borderRadius: 14,
                          background: isActive ? "rgba(16, 15, 15,0.06)" : "rgba(16, 15, 15,0.02)",
                          border: isActive ? "1px solid rgba(16, 15, 15,0.15)" : "1px solid rgba(16, 15, 15,0.06)",
                          borderLeft: `3px solid ${tc.bar}`,
                          transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                              <span style={{
                                fontSize: 11,
                                fontWeight: 700,
                                fontFamily: C.mono,
                                textTransform: "uppercase",
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: tc.bg,
                                color: tc.text,
                              }}>
                                {scan.verdict}
                              </span>
                              <span style={{ fontSize: 12.5, color: "rgba(16, 15, 15,0.4)", fontFamily: C.mono }}>
                                {scan.created_at ? new Date(scan.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""}
                              </span>
                              {scan.payment_blocked && (
                                <span style={{ fontSize: 11, background: "rgba(179, 38, 30,0.2)", color: "#B3261E", padding: "1px 5px", borderRadius: 4, fontWeight: 700 }}>
                                  BLOCKED
                                </span>
                              )}
                            </div>
                            <h3 style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, fontWeight: 400, color: "#100F0F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {scan.payee_name || scan.vpa || "Unknown Merchant"}
                            </h3>
                            <div style={{ fontSize: 12.5, color: "rgba(16, 15, 15,0.5)", marginTop: 4, fontFamily: C.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              VPA: {scan.vpa || "—"}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 18, fontWeight: 900, color: tc.text, fontFamily: C.mono }}>
                              {scan.risk_score}
                            </div>
                            <div style={{ fontSize: 11, color: "rgba(16, 15, 15,0.3)", fontFamily: C.mono }}>/100 RISK</div>
                            {scan.amount && (
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#100F0F", marginTop: 4 }}>
                                ₹{scan.amount}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Details Panel */}
                <AnimatePresence>
                  {selectedQrScan && (() => {
                    const scan = selectedQrScan;
                    const tc = {
                      SAFE: { text: C.green, bg: "rgba(61, 139, 90, 0.08)", border: "rgba(61, 139, 90, 0.25)", icon: "✅" },
                      SUSPICIOUS: { text: C.amber, bg: "rgba(183, 121, 31, 0.08)", border: "rgba(183, 121, 31, 0.25)", icon: "⚠️" },
                      MALICIOUS: { text: C.red, bg: "rgba(179, 38, 30, 0.08)", border: "rgba(179, 38, 30, 0.25)", icon: "🚨" },
                    }[scan.verdict as "SAFE" | "SUSPICIOUS" | "MALICIOUS"] || { text: "#FFFFFF", bg: "rgba(16, 15, 15,0.05)", border: "rgba(16, 15, 15,0.15)", icon: "❓" };

                    return (
                      <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className="glass-panel"
                        style={{
                          padding: 24,
                          borderRadius: 16,
                          background: "#FFFFFF",
                          border: "1px solid #EAE4E1",
                          height: "fit-content",
                          position: "sticky",
                          top: 72
                        }}
                      >
                        <div className="flex justify-between items-center mb-5 pb-3" style={{ borderBottom: "1px solid #EAE4E1" }}>
                          <span className="text-[12px] font-bold uppercase" style={{
                            color: "#575452", letterSpacing: "0.1em", fontFamily: C.mono
                          }}>
                            QR Analysis Console
                          </span>
                          <button
                            onClick={() => setSelectedQrScan(null)}
                            style={{
                              background: "rgba(16, 15, 15,0.05)", border: "1px solid #EAE4E1",
                              color: "#767270", cursor: "pointer",
                              fontSize: 13.5, width: 28, height: 28, borderRadius: 8,
                              display: "flex", alignItems: "center", justifyContent: "center"
                            }}
                          >
                            ✕
                          </button>
                        </div>

                        {/* Image Preview / QR Code Image */}
                        {scan.qr_image_b64 && (
                          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 20, background: "#FFFFFF", border: "1px solid #EAE4E1", borderRadius: 14, padding: 12 }}>
                            <img src={scan.qr_image_b64} alt="Scanned QR Code Thumbnail" style={{ width: 80, height: 80, objectFit: "contain", borderRadius: 10, background: "#FFFFFF", padding: 4 }} />
                            <div>
                              <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, fontWeight: 400, color: "#100F0F" }}>User: {scan.customer_name || scan.customer_id}</div>
                              <div style={{ fontSize: 11.5, color: "rgba(16, 15, 15,0.4)", marginTop: 4 }}>ID: {scan.customer_id}</div>
                              <div style={{ fontSize: 11.5, color: "rgba(16, 15, 15,0.3)", marginTop: 2 }}>Scan Date: {new Date(scan.created_at).toLocaleString()}</div>
                            </div>
                          </div>
                        )}

                        {/* Verdict Banner */}
                        <div style={{ padding: "12px 16px", borderRadius: 12, background: tc.bg, border: `1px solid ${tc.border}`, display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                          <span style={{ fontSize: 24 }}>{tc.icon}</span>
                          <div>
                            <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, fontWeight: 400, color: tc.text, letterSpacing: "0.03em" }}>{scan.verdict} VERDICT</div>
                            <div style={{ fontSize: 12.5, color: "rgba(16, 15, 15,0.6)", marginTop: 2 }}>Scan Risk Score: <strong style={{ color: tc.text }}>{scan.risk_score}/100</strong></div>
                          </div>
                        </div>

                        {/* Detailed information */}
                        <div style={{ background: "rgba(255, 255, 255,0.15)", borderRadius: 12, border: "1px solid #EAE4E1", padding: 16, display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                          {[
                            { label: "Decoded Scheme / URL", val: scan.upi_url, isMono: true },
                            { label: "UPI Payee VPA", val: scan.vpa, isMono: true },
                            { label: "Payee / Merchant Name", val: scan.payee_name || "—" },
                            { label: "Scanned Target Domain", val: scan.vpa_domain || "—", isMono: true },
                            { label: "Amount Specified", val: scan.amount ? `₹${scan.amount}` : "Any amount" },
                            { label: "Verification Source", val: scan.scan_source?.toUpperCase() || "WHITELIST" },
                          ].map((f) => (
                            <div key={f.label}>
                              <div style={{ fontSize: 11, color: "rgba(16, 15, 15,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: C.mono, marginBottom: 3 }}>{f.label}</div>
                              <div style={{ fontSize: 12.5, color: "#100F0F", fontFamily: f.isMono ? C.mono : "inherit", wordBreak: "break-all" }}>{f.val}</div>
                            </div>
                          ))}
                        </div>

                        {/* Warning Flags */}
                        {scan.flags && scan.flags.length > 0 && (
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(16, 15, 15,0.4)", fontFamily: C.mono, marginBottom: 8, textTransform: "uppercase" }}>
                              Analysis Flags & Indicators
                            </div>
                            {scan.flags.map((flag: string, idx: number) => (
                              <div key={idx} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "rgba(16, 15, 15,0.7)", background: "#FFFFFF", border: "1px solid #EAE4E1", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
                                <span style={{ color: tc.text }}>■</span>
                                <div>{flag}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* VirusTotal details */}
                        {scan.vt_stats && Object.keys(scan.vt_stats).length > 0 && (
                          <div style={{ marginBottom: 16, background: "#FFFFFF", border: "1px solid #EAE4E1", borderRadius: 12, padding: 14 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(16, 15, 15,0.4)", fontFamily: C.mono, marginBottom: 8, textTransform: "uppercase" }}>VirusTotal Threat Engine Stats</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, textAlign: "center" }}>
                              {[
                                { label: "MALICIOUS", val: scan.vt_stats.malicious || 0, color: C.red },
                                { label: "SUSPICIOUS", val: scan.vt_stats.suspicious || 0, color: C.amber },
                                { label: "CLEAN / HARMLESS", val: (scan.vt_stats.harmless || 0) + (scan.vt_stats.undetected || 0), color: C.green },
                              ].map((vt) => (
                                <div key={vt.label} style={{ background: "rgba(255, 255, 255,0.15)", borderRadius: 8, padding: 8, border: "1px solid rgba(16, 15, 15,0.03)" }}>
                                  <div style={{ fontSize: 16, fontWeight: 900, color: vt.color, fontFamily: C.mono }}>{vt.val}</div>
                                  <div style={{ fontSize: 10, color: "rgba(16, 15, 15,0.4)", marginTop: 2 }}>{vt.label}</div>
                                </div>
                              ))}
                            </div>
                            {scan.vt_permalink && (
                              <a href={scan.vt_permalink} target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center", fontSize: 11.5, color: "var(--color-primary)", marginTop: 12 }}>View Scan Report on VirusTotal.com ↗</a>
                            )}
                          </div>
                        )}

                        {/* Payment Outcome */}
                        <div style={{ display: "flex", gap: 10 }}>
                          <div style={{ flex: 1, background: scan.payment_attempted ? "rgba(61, 139, 90,0.05)" : "rgba(16, 15, 15,0.02)", border: `1px solid ${scan.payment_attempted ? "rgba(61, 139, 90,0.15)" : "rgba(16, 15, 15,0.06)"}`, borderRadius: 10, padding: 10, textAlign: "center" }}>
                            <div style={{ fontSize: 11, color: "rgba(16, 15, 15,0.4)", textTransform: "uppercase", fontFamily: C.mono }}>Payment Attempted</div>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: scan.payment_attempted ? C.green: "rgba(16, 15, 15,0.5)", marginTop: 4 }}>{scan.payment_attempted ? "YES" : "NO"}</div>
                          </div>
                          <div style={{ flex: 1, background: scan.payment_blocked ? "rgba(179, 38, 30,0.05)" : "rgba(16, 15, 15,0.02)", border: `1px solid ${scan.payment_blocked ? "rgba(179, 38, 30,0.15)" : "rgba(16, 15, 15,0.06)"}`, borderRadius: 10, padding: 10, textAlign: "center" }}>
                            <div style={{ fontSize: 11, color: "rgba(16, 15, 15,0.4)", textTransform: "uppercase", fontFamily: C.mono }}>Payment Blocked</div>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: scan.payment_blocked ? C.red: "rgba(16, 15, 15,0.5)", marginTop: 4 }}>{scan.payment_blocked ? "YES" : "NO"}</div>
                          </div>
                        </div>

                      </motion.div>
                    );
                  })()}
                </AnimatePresence>
              </div>
            )}
          </div>
        ) : activeTab === "gravity" ? (
          <div>
            <FinancialGravityPage isEmbedded={true} />
          </div>
        ) : activeTab === "consortium" ? (
          <div>
            <ConsortiumMapPage />
          </div>
        ) : activeTab === "emergency" ? (
          <div>
            {incidentsLoading && incidents.length === 0 ? (
              <LoadingRows count={3} />
            ) : incidents.length === 0 ? (
              <div className="glass-panel text-center" style={{ padding: "72px 24px" }}>
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{
                  background: "#FFFFFF", border: "1px solid #EAE4E1",
                }}>
                  <span style={{ fontSize: 24 }}>🛡️</span>
                </div>
                <div className="text-[15px] font-semibold mb-2" style={{ color: "#575452" }}>No emergency incidents</div>
                <div className="text-[12px]" style={{ color: "#969290" }}>
                  No users have triggered the Duress PIN protocol at this time.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* List of Incidents */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {incidents.map((inc) => {
                    const isActive = selectedIncident?.incident_id === inc.incident_id;
                    const isAlertActive = inc.status === "ACTIVE";
                    return (
                      <div
                        key={inc.incident_id}
                        onClick={() => setSelectedIncident(isActive ? null : inc)}
                        className="glass-card magnetic-hover"
                        style={{
                          padding: "18px 22px",
                          cursor: "pointer",
                          borderRadius: 14,
                          background: isActive ? "rgba(16, 15, 15,0.06)" : "rgba(16, 15, 15,0.02)",
                          border: isActive ? "1px solid rgba(16, 15, 15,0.15)" : "1px solid rgba(16, 15, 15,0.06)",
                          borderLeft: isAlertActive ? "3px solid #B3261E" : "3px solid #3D8B5A",
                          transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                          <div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                              <span style={{
                                fontSize: 11,
                                fontWeight: 700,
                                fontFamily: C.mono,
                                textTransform: "uppercase",
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: isAlertActive ? "rgba(179, 38, 30, 0.15)" : "rgba(61, 139, 90, 0.15)",
                                color: isAlertActive ? "#B3261E" : "#3D8B5A",
                              }}>
                                {inc.status}
                              </span>
                              <span style={{ fontSize: 12.5, color: "rgba(16, 15, 15,0.4)", fontFamily: C.mono }}>
                                {new Date(inc.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <h3 style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 21, fontWeight: 400, color: "#100F0F" }}>
                              {inc.user_name || inc.user_id}
                            </h3>
                            <div style={{ fontSize: 12.5, color: "rgba(16, 15, 15,0.5)", marginTop: 4 }}>
                              ID: <span style={{ fontFamily: C.mono }}>{inc.customer_id || inc.user_id}</span>
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 12.5, color: "#B3261E", fontWeight: 700, fontFamily: C.mono }}>
                              {inc.risk_priority} PRIORITY
                            </div>
                             <div style={{ fontSize: 11.5, color: "rgba(16, 15, 15,0.3)", marginTop: 4, fontFamily: C.mono }}>
                               {inc.device_info && typeof inc.device_info === "object"
                                 ? `${inc.device_info.channel || ""} ${inc.device_info.userAgent ? `(${inc.device_info.userAgent.slice(0, 20)}...)` : ""}`.trim()
                                 : (inc.device_info || "Unknown Device")}
                             </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Details Panel */}
                <AnimatePresence>
                  {selectedIncident && (
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="glass-card"
                      style={{
                        padding: 24,
                        borderRadius: 16,
                        background: "#FFFFFF",
                        border: "1px solid #EAE4E1",
                        height: "fit-content"
                      }}
                    >
                      <h3 style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 24, fontWeight: 400, color: "#100F0F", marginBottom: 16 }}>
                        Incident Response Console
                      </h3>

                      {/* Map */}
                      <div style={{ width: "100%", height: 200, borderRadius: 12, overflow: "hidden", background: "var(--color-canvas)", marginBottom: 16, border: "1px solid #EAE4E1" }}>
                        <iframe
                          title="Incident Location Map"
                          width="100%"
                          height="100%"
                          frameBorder="0"
                          style={{ border: 0 }}
                          src={`https://maps.google.com/maps?q=${selectedIncident.latitude},${selectedIncident.longitude}&z=15&output=embed&iwloc=near`}
                          allowFullScreen
                        />
                      </div>

                      {/* Held Transaction details */}
                      {selectedIncident.payment_amount !== undefined && selectedIncident.payment_amount !== null && (
                        <div style={{ background: "rgba(179, 38, 30,0.08)", border: "1px solid rgba(179, 38, 30,0.2)", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
                          <div style={{ fontSize: 11.5, color: "#B3261E", fontWeight: 700, textTransform: "uppercase", fontFamily: C.mono, marginBottom: 4 }}>
                            🛡️ Transaction Held Under Duress
                          </div>
                          <div style={{ fontSize: 14, color: "#100F0F", display: "flex", justifyContent: "space-between" }}>
                            <span>Amount Held: <strong>₹{selectedIncident.payment_amount.toLocaleString()}</strong></span>
                            <span>Recipient: <strong>{selectedIncident.payment_recipient || "N/A"}</strong></span>
                          </div>
                          <div style={{ fontSize: 11.5, color: "rgba(16, 15, 15,0.5)", marginTop: 6, fontFamily: C.mono }}>
                            Status: TRANSACTION UNDER PROCESSING
                          </div>
                        </div>
                      )}

                      {/* Info grid */}
                      <div className="grid grid-cols-2 gap-4 mb-6">
                        <div>
                          <div style={{ fontSize: 11.5, color: "rgba(16, 15, 15,0.4)", textTransform: "uppercase", fontFamily: C.mono }}>
                            Location Coordinates
                          </div>
                           <div style={{ fontSize: 13.5, color: "#100F0F", fontFamily: C.mono, marginTop: 4 }}>
                            {selectedIncident.latitude !== null && selectedIncident.latitude !== undefined ? selectedIncident.latitude.toFixed(6) : "N/A"}, {selectedIncident.longitude !== null && selectedIncident.longitude !== undefined ? selectedIncident.longitude.toFixed(6) : "N/A"}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11.5, color: "rgba(16, 15, 15,0.4)", textTransform: "uppercase", fontFamily: C.mono }}>
                            Emergency Contact
                          </div>
                          <div style={{ fontSize: 13.5, color: "#100F0F", marginTop: 4 }}>
                            {selectedIncident.contact_1_name || "None"}
                          </div>
                        </div>
                      </div>

                      {/* Timeline */}
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ fontSize: 11.5, color: "rgba(16, 15, 15,0.4)", textTransform: "uppercase", fontFamily: C.mono, marginBottom: 12 }}>
                          Location Ping History
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {(selectedIncident.location_timeline || []).length === 0 ? (
                            <div style={{ fontSize: 12.5, color: "rgba(16, 15, 15,0.3)", fontStyle: "italic" }}>
                              No additional pings received yet.
                            </div>
                          ) : (
                            selectedIncident.location_timeline.map((update: any, idx: number) => (
                              <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#B3261E" }} />
                                <div style={{ fontSize: 12.5, color: "rgba(16, 15, 15,0.7)", fontFamily: C.mono }}>
                                  {update.latitude !== null && update.latitude !== undefined ? update.latitude.toFixed(6) : "N/A"}, {update.longitude !== null && update.longitude !== undefined ? update.longitude.toFixed(6) : "N/A"}
                                </div>
                                <div style={{ fontSize: 11, color: "rgba(16, 15, 15,0.3)", marginLeft: "auto", fontFamily: C.mono }}>
                                  {new Date(update.timestamp).toLocaleTimeString()}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Admin Actions */}
                      {selectedIncident.status === "ACTIVE" && (
                        <div style={{ display: "flex", gap: 10 }}>
                          <button
                            onClick={() => handleResolveIncident(selectedIncident.incident_id, "RESOLVED")}
                            style={{
                              flex: 1,
                              padding: "10px 16px",
                              borderRadius: 8,
                              background: "#3D8B5A",
                              color: "#FFFFFF",
                              border: "none",
                              fontSize: 13.5,
                              fontWeight: 700,
                              fontFamily: C.mono,
                              cursor: "pointer"
                            }}
                          >
                            ✓ RESOLVE INCIDENT
                          </button>
                          <button
                            onClick={() => handleResolveIncident(selectedIncident.incident_id, "FALSE_ALARM")}
                            style={{
                              flex: 1,
                              padding: "10px 16px",
                              borderRadius: 8,
                              background: "rgba(16, 15, 15,0.06)",
                              color: "rgba(16, 15, 15,0.7)",
                              border: "1px solid #D7D2D0",
                              fontSize: 13.5,
                              fontWeight: 700,
                              fontFamily: C.mono,
                              cursor: "pointer"
                            }}
                          >
                            ⚠️ FALSE ALARM
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Filter / Search Bar */}
            {activeTab === "fraud" && !loading && reports.length > 0 && (
              <div style={{
                display: "flex", gap: 14, marginBottom: 18, alignItems: "center", justifyContent: "space-between",
                flexWrap: "wrap", background: "#FFFFFF", padding: "12px 18px", borderRadius: 14,
                border: "1px solid #EAE4E1", backdropFilter: "blur(10px)"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 260 }}>
                  <span style={{ fontSize: 14, opacity: 0.5 }}>🔍</span>
                  <input
                    type="text"
                    placeholder="Search by User ID or Session ID..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{
                      background: "transparent", border: "none", color: "#100F0F", fontSize: 13.5,
                      fontFamily: C.mono, outline: "none", width: "100%"
                    }}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} style={{ background: "transparent", border: "none", color: "rgba(16, 15, 15,0.4)", cursor: "pointer", fontSize: 11.5 }}>✕ Clear</button>
                  )}
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11.5, color: "rgba(16, 15, 15, 0.35)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: C.mono, marginRight: 6 }}>Filter:</span>
                  {(["ALL", "HARD_BLOCK", "STEP_UP", "APPROVE"] as const).map(dec => (
                    <button
                      key={dec}
                      onClick={() => setFilterDecision(dec)}
                      style={{
                        padding: "5px 12px", borderRadius: 8, fontSize: 11.5, fontFamily: C.mono, fontWeight: 700,
                        cursor: "pointer", transition: "all 0.2s",
                        background: filterDecision === dec ? "rgba(170, 65, 42, 0.15)" : "rgba(16, 15, 15,0.02)",
                        border: `1px solid ${filterDecision === dec ? "rgba(170, 65, 42, 0.3)" : "rgba(16, 15, 15,0.06)"}`,
                        color: filterDecision === dec 
                          ? (dec === "HARD_BLOCK" ? "#B3261E" : dec === "STEP_UP" ? "#B7791F" : dec === "APPROVE" ? "#3D8B5A" : "var(--color-primary)")
                          : "rgba(16, 15, 15, 0.4)"
                      }}
                    >
                      {dec.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Stale-data warning ─────────────────────────────────────────── */}
            {stale && (
              <div
                className="glass-panel"
                style={{
                  padding: "12px 16px", marginBottom: 12, fontSize: 14,
                  color: "#B7791F", border: "1px solid rgba(183, 121, 31,0.35)",
                  background: "rgba(183, 121, 31,0.08)",
                }}
              >
                ⚠ {stale}
              </div>
            )}

            {/* ── Loading ────────────────────────────────────────────────────── */}
            {loading && <LoadingRows count={4} />}

        {/* ── Empty state ───────────────────────────────────────────────── */}
        {!loading && reports.length === 0 && (
          <div className="glass-panel text-center" style={{ padding: "72px 24px" }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{
              background: "#FFFFFF", border: "1px solid #EAE4E1",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.4 }}>
                <circle cx="11" cy="11" r="7" stroke="rgba(20, 19, 19,0.5)" strokeWidth="1.5" />
                <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="rgba(20, 19, 19,0.5)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="text-[15px] font-semibold mb-2" style={{ color: "#575452" }}>No fraud reports yet</div>
            <div className="text-[12px]" style={{ color: "#969290" }}>
              Run an attack scenario on the Login Demo tab, then generate an investigation report
            </div>
          </div>
        )}

        {/* ── Search Empty State ── */}
        {activeTab === "fraud" && !loading && reports.length > 0 && filteredReports.length === 0 && (
          <div className="glass-panel text-center" style={{ padding: "64px 24px" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, fontWeight: 400, color: "rgba(16, 15, 15,0.5)", marginBottom: 4 }}>No Matching Reports</div>
            <div style={{ fontSize: 12.5, color: "rgba(16, 15, 15,0.3)" }}>No logs matched query parameters or filter criteria.</div>
          </div>
        )}

        {/* ── Report list + detail panel ────────────────────────────────── */}
        {activeTab === "fraud" && !loading && filteredReports.length > 0 && (
          <div className={`grid grid-cols-1 ${selected ? "lg:grid-cols-2" : ""} gap-5`}>

            {/* Report cards */}
            <motion.div
              initial="hidden" animate="show"
              variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } }}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {filteredReports.map(r => {
                const tc = THREAT_COLORS[r.threat_level || "MEDIUM"] || THREAT_COLORS.MEDIUM;
                const isActive = selected?.report_id === r.report_id;
                return (
                  <motion.div key={r.report_id}
                    variants={{ hidden: { opacity: 0, y: 15 }, show: { opacity: 1, y: 0 } }}
                    onClick={() => setSelected(isActive ? null : r)}
                    whileHover={{ y: -2 }}
                    className="glass-card magnetic-hover"
                    style={{
                      padding: "18px 22px", cursor: "pointer", borderRadius: 14,
                      background: isActive ? "rgba(16, 15, 15,0.06)" : "rgba(16, 15, 15,0.02)",
                      border: isActive ? "1px solid rgba(16, 15, 15,0.15)" : "1px solid rgba(16, 15, 15,0.06)",
                      borderLeft: `3px solid ${tc.bar}`,
                      transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 7, flexWrap: "wrap" }}>
                          {r.threat_level && (
                            <span style={{
                              fontSize: 11.5, fontWeight: 700, padding: "2px 9px",
                              borderRadius: 20, background: tc.bg, color: tc.text,
                              border: `1px solid ${tc.text}30`, letterSpacing: "0.04em",
                            }}>
                              {r.threat_level}
                            </span>
                          )}
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: DECISION_COLOR[r.decision] || C.textMuted }}>
                            {r.decision}
                          </span>
                          {(r.pqc_verified || r.pqc_algorithm) && (
                            <span style={{
                              fontSize: 11, fontWeight: 700, padding: "1px 6px",
                              borderRadius: 4, background: "rgba(170, 65, 42,0.15)", color: "var(--color-primary)",
                              border: "1px solid rgba(170, 65, 42,0.3)", letterSpacing: "0.04em", fontFamily: C.mono
                            }}>
                              🔮 PQC-SECURED
                            </span>
                          )}
                          <span style={{ fontSize: 12.5, color: "var(--color-muted-soft)" }}>
                            · {r.channel?.replace(/_/g, " ")}
                          </span>
                        </div>
                        <div style={{ fontSize: 13.5, color: "var(--color-muted)", lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.report_text?.split("\n")[0]?.replace(/^\[.*?\]\s*/, "") || "No summary"}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--color-muted-soft)", marginTop: 5, fontFamily: C.mono }}>
                          {r.user_id} · {r.created_at ? new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: DECISION_COLOR[r.decision] || C.textPrimary, fontFamily: C.mono, letterSpacing: "-1px" }}>
                          {r.risk_score}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--color-muted-soft)", fontFamily: C.mono }}>/1000</div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>

            {/* Detail panel */}
            <AnimatePresence>
              {selected && (
                <motion.div
                  key={selected.report_id}
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.25 }}
                  className="glass-panel"
                  style={{
                    position: "sticky", top: 72, alignSelf: "start",
                    maxHeight: "calc(100vh - 90px)", overflowY: "auto",
                    padding: "28px 32px", borderRadius: 20,
                    border: "1px solid #EAE4E1",
                    background: "rgba(235, 230, 227,0.8)",
                  }}>
                  {/* Panel header */}
                  <div className="flex justify-between items-center mb-5 pb-3" style={{ borderBottom: "1px solid #EAE4E1" }}>
                    <span className="text-[12px] font-bold uppercase" style={{
                      color: "#575452", letterSpacing: "0.1em", fontFamily: C.mono
                    }}>
                      Investigation Report
                    </span>
                    <button
                      onClick={() => setSelected(null)} style={{
                        background: "rgba(16, 15, 15,0.05)", border: "1px solid #EAE4E1",
                        color: "#767270", cursor: "pointer",
                        fontSize: 13.5, width: 28, height: 28, borderRadius: 8,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.2s"
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  {/* User Profile & Image */}
                  {selected.face_image && (
                    <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 20, background: "#FFFFFF", border: "1px solid #EAE4E1", borderRadius: 14, padding: 12 }}>
                      <img src={selected.face_image} alt="User Verification Snapshot" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 10, border: "2px solid rgba(16, 15, 15,0.1)" }} />
                      <div>
                        <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, fontWeight: 400, color: "#100F0F" }}>Verified User: {selected.user_id}</div>
                        <div style={{ fontSize: 11.5, color: "rgba(16, 15, 15,0.4)", marginTop: 4 }}>Biometric Face Signature Matched</div>
                        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                          <span style={{ fontSize: 11, background: "rgba(61, 139, 90,0.15)", border: "1px solid rgba(61, 139, 90,0.3)", color: "#3D8B5A", borderRadius: 4, padding: "2px 6px" }}>3-POSE OK</span>
                          <span style={{ fontSize: 11, background: "rgba(170, 65, 42,0.15)", border: "1px solid rgba(170, 65, 42,0.3)", color: "var(--color-primary)", borderRadius: 4, padding: "2px 6px" }}>VERIFIED</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Threat banner */}
                  {selected.threat_level && (() => {
                    const tc = THREAT_COLORS[selected.threat_level] || THREAT_COLORS.MEDIUM;
                    return (
                      <div className="rounded-xl px-4 py-2.5 mb-4" style={{
                        background: tc.bg, border: `1px solid ${tc.text}25`,
                      }}>
                        <span className="text-[12px] font-extrabold uppercase" style={{ color: tc.text, letterSpacing: "0.06em" }}>
                          {selected.threat_level} THREAT
                        </span>
                      </div>
                    );
                  })()}

                  {/* Network & Location Fingerprint */}
                  {(selected.login_ip || selected.login_country || selected.vpn_detected) && (
                    <div style={{
                      background: "#FFFFFF",
                      border: "1px solid #EAE4E1",
                      borderRadius: 14,
                      padding: "14px 16px",
                      marginBottom: 16,
                      fontSize: 13.5
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(16, 15, 15,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontFamily: C.mono }}>
                        📡 Network & Location Fingerprint
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {selected.login_ip && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "rgba(16, 15, 15,0.4)" }}>Client IP:</span>
                            <span style={{ color: "#100F0F", fontFamily: C.mono, fontWeight: 600 }}>{selected.login_ip}</span>
                          </div>
                        )}
                        {(selected.login_city || selected.login_country) && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "rgba(16, 15, 15,0.4)" }}>Resolved Geo:</span>
                            <span style={{ color: "#100F0F", fontWeight: 600 }}>
                              {selected.login_city ? `${selected.login_city}, ` : ""}{selected.login_country || ""}
                            </span>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, padding: "4px 0", borderTop: "1px solid #EAE4E1", paddingTop: 6 }}>
                          <span style={{ color: "rgba(16, 15, 15,0.4)" }}>IP Integrity:</span>
                          {selected.vpn_detected ? (
                            <span style={{
                              fontSize: 11, background: "rgba(179, 38, 30,0.15)", border: "1px solid rgba(179, 38, 30,0.3)",
                              color: "#B3261E", borderRadius: 4, padding: "2px 6px", fontWeight: 700
                            }}>
                              🔴 ANONYMOUS PROXY / VPN
                            </span>
                          ) : (
                            <span style={{
                              fontSize: 11, background: "rgba(61, 139, 90,0.15)", border: "1px solid rgba(61, 139, 90,0.3)",
                              color: "#3D8B5A", borderRadius: 4, padding: "2px 6px", fontWeight: 700
                            }}>
                              🟢 CLEAN ISP RESIDENTIAL
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Report text */}
                  <div className="text-[12px] leading-relaxed mb-4" style={{ color: "#575452" }}>
                    {selected.report_text}
                  </div>

                  {/* Evidence */}
                  {selected.evidence && selected.evidence.length > 0 && (
                    <div className="mb-4">
                      <div className="text-[10px] uppercase tracking-[0.1em] mb-3 font-semibold" style={{ color: "#969290", fontFamily: C.mono }}>
                        Evidence
                      </div>
                      {selected.evidence.map((e, i) => (
                        <div key={i} className="flex gap-2.5 mb-2 text-[12px] leading-relaxed p-3 rounded-lg" style={{
                          color: "#575452",
                          background: "#FFFFFF", border: "1px solid #EAE4E1",
                        }}>
                          <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--color-primary)" }}>◆</span>
                          {e}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recommended action */}
                  {selected.recommended_action && (
                    <motion.div
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="mb-4 p-4 rounded-xl"
                      style={{
                        background: "rgba(255,180,0,0.06)",
                        border: "1px solid rgba(255,180,0,0.15)",
                      }}>
                      <div className="text-[10px] font-bold uppercase tracking-[0.1em] mb-1.5" style={{ color: "rgba(255,180,0,0.7)", fontFamily: C.mono }}>
                        Recommended Action
                      </div>
                      <div className="text-[13px] font-bold" style={{ color: "#B7791F", letterSpacing: "0.01em" }}>
                        {selected.recommended_action}
                      </div>
                    </motion.div>
                  )}

                  {/* SHAP Chart */}
                  <ShapBarChart features={shap} loading={shapLoading} />

                  {/* Behavioral Telemetry Map */}
                  {(selected.mouse_events && selected.mouse_events.length > 0) && (
                    <div style={{ marginTop: 20, marginBottom: 20, background: "rgba(235, 235, 235, 0.45)", border: "1px solid #EAE4E1", borderRadius: 16, padding: 14 }}>
                      <div style={{ fontSize: 11, color: "rgba(16, 15, 15,0.45)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: C.mono, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                        <span>🛰️ TELEMETRY SPATIAL MAP (MOUSE & TOUCH)</span>
                        <span style={{ color: "var(--color-primary)" }}>STATUS: ANALYZED</span>
                      </div>
                      <div style={{ position: "relative", width: "100%", height: 160, background: "rgba(255, 255, 255, 0.3)", borderRadius: 10, overflow: "hidden", border: "1px solid #EAE4E1" }}>
                        <svg width="100%" height="100%" viewBox="0 0 1000 800" style={{ position: "absolute", top: 0, left: 0 }}>
                          <defs>
                            <filter id="radarPointGlow">
                              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                              <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                              </feMerge>
                            </filter>
                          </defs>

                          {/* Sonar target grid rings */}
                          {[150, 300, 450, 600].map(r => (
                            <circle key={r} cx="500" cy="400" r={r} fill="none" stroke="rgba(170, 65, 42, 0.08)" strokeWidth={1} strokeDasharray="3 5" />
                          ))}

                          {/* Sonar scope crosshairs */}
                          <line x1="500" y1="0" x2="500" y2="800" stroke="rgba(170, 65, 42, 0.08)" strokeWidth={1} strokeDasharray="4 4" />
                          <line x1="0" y1="400" x2="1000" y2="400" stroke="rgba(170, 65, 42, 0.08)" strokeWidth={1} strokeDasharray="4 4" />

                          {/* Mouse trace line */}
                          {selected.mouse_events?.length > 1 && (() => {
                            const validPts = selected.mouse_events
                              .filter((e: any) => typeof e.x === "number" && typeof e.y === "number")
                              .map((e: any) => `${e.x},${e.y}`).join(" ");
                            return <polyline points={validPts} fill="none" stroke="var(--color-primary)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.65} filter="url(#radarPointGlow)" />;
                          })()}

                          {/* Mouse trace points */}
                          {selected.mouse_events?.map((e: any, idx: number) => (
                            idx % 4 === 0 && typeof e.x === "number" && typeof e.y === "number" && (
                              <circle key={idx} cx={e.x} cy={e.y} r={5} fill="var(--color-primary)" opacity={0.8} filter="url(#radarPointGlow)" />
                            )
                          ))}

                          {/* Touch/Tap event targets */}
                          {selected.touch_events?.map((e: any, idx: number) => (
                            typeof e.x === "number" && typeof e.y === "number" && (
                              <g key={idx}>
                                <circle cx={e.x} cy={e.y} r={14} fill="none" stroke="#B3261E" strokeWidth={1.5} opacity={0.7} filter="url(#radarPointGlow)" />
                                <circle cx={e.x} cy={e.y} r={4} fill="#B3261E" opacity={0.9} />
                              </g>
                            )
                          ))}
                        </svg>
                        <div style={{ position: "absolute", bottom: 8, right: 8, fontSize: 10, color: "rgba(16, 15, 15,0.25)", fontFamily: C.mono }}>
                          SCOPE COORDINATES · {selected.mouse_count || 0} mouse pts · {selected.touch_count || 0} taps
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Metadata chips */}
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: "Session", value: selected.session_id?.slice(0, 8) + "…" },
                      { label: "Risk Score", value: `${selected.risk_score}/1000` },
                      { label: "Confidence", value: selected.confidence ? (selected.confidence * 100).toFixed(0) + "%" : "—" },
                      { label: "Pathway", value: selected.pathway?.replace(/_/g, " ") || "—" },
                    ].map(({ label, value }) => (
                      <motion.div key={label}
                        whileHover={{ y: -1 }}
                        className="magnetic-hover"
                        style={{
                          background: "#FFFFFF", borderRadius: 10, padding: "8px 12px",
                          border: "1px solid #EAE4E1", transition: "all 0.2s"
                        }}>
                        <div className="text-[9px] uppercase tracking-[0.1em] font-semibold mb-1" style={{ color: "#969290", fontFamily: C.mono }}>
                          {label}
                        </div>
                        <div className="text-[11px] font-bold" style={{ color: "#100F0F", fontFamily: C.mono }}>
                          {value}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
