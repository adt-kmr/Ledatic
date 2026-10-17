import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { C } from "../lib/theme";
import { apiFetch, ensureDemoToken } from "../lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PredictedTxn {
  payee: string;
  category: string;
  amount: number;
  predicted_day: number;
  probability: number;
  description: string;
}

interface MonthDNA {
  month_label: string;
  month_index: number;
  distribution: Record<string, number>;
  payees: string[];
  transactions: TxnRecord[];
  gravity_score: number;
  decision: string;
  has_anomaly: boolean;
  anomaly_signals?: AnomalySignal[];
  predicted_transactions?: PredictedTxn[];
}

interface TxnRecord {
  payee: string;
  category: string;
  amount: number;
  hour: number;
  is_known_payee: boolean;
  anomalous: boolean;
  signals?: string[];
}

interface AnomalySignal {
  id: string;
  label: string;
  severity: number;
  color: string;
  contribution?: number;
}

interface GravityProfile {
  customer_id: string;
  monthly_income: number;
  salary_credit_day: number;
  baseline_distribution: Record<string, number>;
  category_colors: Record<string, string>;
  known_payees_count: number;
  months: MonthDNA[];
  anomaly_month: MonthDNA;
  anomaly_signals: AnomalySignal[];
  current_gravity_score: number;
  current_decision: string;
  future_intent?: MonthDNA;
}

const DEMO_USERS = ["Harsh", "attacker_sim", "coercion_victim"];

const DECISION_COLOR: Record<string, string> = {
  APPROVE: "#3D8B5A",
  STEP_UP: "#B7791F",
  HARD_BLOCK: "#B3261E",
};

const DECISION_BG: Record<string, string> = {
  APPROVE: "rgba(61, 139, 90,0.12)",
  STEP_UP: "rgba(183, 121, 31,0.12)",
  HARD_BLOCK: "rgba(179, 38, 30,0.12)",
};

// ── Orbital SVG Visualisation ─────────────────────────────────────────────────
function OrbitalChart({
  profile,
  showAnomaly,
  animating,
  showPrediction,
}: {
  profile: GravityProfile;
  showAnomaly: boolean;
  animating: boolean;
  showPrediction: boolean;
}) {
  const cx = 250, cy = 250;
  const RING_RADII = [90, 145, 195];
  const predictionRadius = 232;
  const CATEGORIES = Object.keys(profile.baseline_distribution);
  const categoryColors = profile.category_colors;

  // Place category labels around the outermost ring
  const labelRadius = 225;

  // Generate dot positions for each month's transactions (one dot per category)
  function getDotsForMonth(month: MonthDNA, radius: number) {
    return CATEGORIES.map((cat, i) => {
      const angleDeg = (i / CATEGORIES.length) * 360 - 90;
      const angleRad = (angleDeg * Math.PI) / 180;
      const pct = month.distribution[cat] || 0;
      // Slight radial jitter based on % (± 12px)
      const jitter = (pct / 30 - 0.5) * 24;
      const r = radius + jitter;
      return {
        x: cx + r * Math.cos(angleRad),
        y: cy + r * Math.sin(angleRad),
        category: cat,
        pct,
        color: categoryColors[cat] || "#7B7774",
        size: 3 + (pct / 30) * 6,
      };
    });
  }

  // Anomaly vector — shoots from the centre-right area outward
  const anomalyAngle = 38; // degrees
  const anomalyAngleRad = (anomalyAngle * Math.PI) / 180;
  const anomalyStart = { x: cx + 195 * Math.cos(anomalyAngleRad), y: cy + 195 * Math.sin(anomalyAngleRad) };
  const anomalyEnd = { x: cx + 310 * Math.cos(anomalyAngleRad), y: cy + 310 * Math.sin(anomalyAngleRad) };

  return (
    <svg
      viewBox="0 0 500 500"
      style={{ width: "100%", maxWidth: 480, display: "block", margin: "0 auto" }}
      aria-label="Financial orbit visualisation"
    >
      {/* ── Ambient glow background ── */}
      <defs>
        <radialGradient id="bgGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1e1b4b" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--color-canvas)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="anomalyGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#B3261E" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#B3261E" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="predictionGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2C7A91" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#2C7A91" stopOpacity="0" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="redGlow">
          <feGaussianBlur stdDeviation="6" result="coloredBlur" />
          <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="cyanGlow">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <marker id="arrowRed" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#B3261E" />
        </marker>
      </defs>

      {/* Background circle */}
      <circle cx={cx} cy={cy} r={240} fill="url(#bgGlow)" />

      {/* ── Orbit rings ── */}
      {RING_RADII.map((r, i) => (
        <circle
          key={r}
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={`rgba(170, 65, 42,${0.12 + i * 0.06})`}
          strokeWidth={1}
          strokeDasharray="4 6"
        />
      ))}

      {/* Month ring labels */}
      {["M-3", "M-2", "M-1"].map((label, i) => (
        <text
          key={label}
          x={cx + RING_RADII[i] * Math.cos((-120 * Math.PI) / 180)}
          y={cy + RING_RADII[i] * Math.sin((-120 * Math.PI) / 180) - 6}
          fontSize={8}
          fill="rgba(170, 65, 42,0.45)"
          fontFamily="Fragment Mono, monospace"
          textAnchor="middle"
        >
          {label}
        </text>
      ))}

      {/* ── Prediction ring ── */}
      <AnimatePresence>
        {showPrediction && profile.future_intent && (
          <>
            <motion.circle
              initial={{ r: 195, opacity: 0 }}
              animate={{ r: predictionRadius, opacity: 0.6 }}
              exit={{ r: 195, opacity: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              cx={cx} cy={cy}
              fill="none"
              stroke="#2C7A91"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              filter="url(#cyanGlow)"
            />
            <motion.text
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.4 }}
              x={cx + predictionRadius * Math.cos((-120 * Math.PI) / 180)}
              y={cy + predictionRadius * Math.sin((-120 * Math.PI) / 180) - 6}
              fontSize={8}
              fill="#2C7A91"
              fontFamily="Fragment Mono, monospace"
              fontWeight="bold"
              textAnchor="middle"
            >
              M+1 (AI)
            </motion.text>
          </>
        )}
      </AnimatePresence>

      {/* ── Category axis spokes ── */}
      {CATEGORIES.map((cat, i) => {
        const angle = ((i / CATEGORIES.length) * 360 - 90) * (Math.PI / 180);
        return (
          <line
            key={cat}
            x1={cx + 20 * Math.cos(angle)} y1={cy + 20 * Math.sin(angle)}
            x2={cx + 215 * Math.cos(angle)} y2={cy + 215 * Math.sin(angle)}
            stroke={`${categoryColors[cat]}22`}
            strokeWidth={1}
          />
        );
      })}

      {/* ── Dots for each normal month ── */}
      {profile.months.map((month, mi) => {
        const dots = getDotsForMonth(month, RING_RADII[mi]);
        return (
          <g key={month.month_label} opacity={showAnomaly ? 0.3 : showPrediction ? 0.4 : 0.85}>
            {/* Connect dots in a polygon for this ring */}
            <polygon
              points={dots.map(d => `${d.x},${d.y}`).join(" ")}
              fill="none"
              stroke={`rgba(170, 65, 42,${0.15 + mi * 0.08})`}
              strokeWidth={1}
              strokeDasharray="3 5"
            />
            {dots.map((d, di) => (
              <circle
                key={di}
                cx={d.x} cy={d.y} r={d.size}
                fill={d.color}
                opacity={0.7}
                filter="url(#glow)"
              />
            ))}
          </g>
        );
      })}

      {/* ── Dots for predicted future month (Intent AI) ── */}
      <AnimatePresence>
        {showPrediction && profile.future_intent && (
          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            {(() => {
              const dots = getDotsForMonth(profile.future_intent, predictionRadius);
              return (
                <g>
                  {/* Connect dots in a polygon for this ring */}
                  <polygon
                    points={dots.map(d => `${d.x},${d.y}`).join(" ")}
                    fill="none"
                    stroke="rgba(170, 65, 42,0.3)"
                    strokeWidth={1.5}
                    strokeDasharray="5 5"
                  />
                  {dots.map((d, di) => (
                    <circle
                      key={di}
                      cx={d.x} cy={d.y} r={d.size + 1}
                      fill="#2C7A91"
                      opacity={0.95}
                      filter="url(#cyanGlow)"
                    />
                  ))}
                </g>
              );
            })()}
          </motion.g>
        )}
      </AnimatePresence>

      {/* ── Category labels (outermost ring) ── */}
      {CATEGORIES.map((cat, i) => {
        const angleDeg = (i / CATEGORIES.length) * 360 - 90;
        const angleRad = (angleDeg * Math.PI) / 180;
        const x = cx + labelRadius * Math.cos(angleRad);
        const y = cy + labelRadius * Math.sin(angleRad);
        const anchor = x < cx - 10 ? "end" : x > cx + 10 ? "start" : "middle";
        return (
          <text
            key={cat}
            x={x} y={y}
            fontSize={7.5}
            fill={categoryColors[cat] || "#595552"}
            opacity={0.7}
            fontFamily="Fragment Mono, monospace"
            textAnchor={anchor}
            dominantBaseline="middle"
          >
            {cat.split(" ")[0]}
          </text>
        );
      })}

      {/* ── Centre core ── */}
      <circle cx={cx} cy={cy} r={18} fill="rgba(170, 65, 42,0.15)" stroke="rgba(170, 65, 42,0.3)" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={6} fill="var(--color-primary)" filter="url(#glow)" />
      <text x={cx} y={cy + 30} fontSize={8} fill="rgba(170, 65, 42,0.5)" fontFamily="Fragment Mono, monospace" textAnchor="middle">
        FINANCIAL CORE
      </text>

      {/* ── Anomaly vector (orbit break) ── */}
      <AnimatePresence>
        {showAnomaly && (
          <>
            {/* Red glow zone */}
            <motion.circle
              initial={{ r: 0, opacity: 0 }}
              animate={{ r: animating ? 130 : 100, opacity: animating ? 0 : 0.15 }}
              transition={{ duration: 1.2, ease: "easeOut" }}
              cx={anomalyEnd.x} cy={anomalyEnd.y}
              fill="url(#anomalyGlow)"
            />

            {/* Broken orbit segment */}
            <motion.line
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              x1={anomalyStart.x} y1={anomalyStart.y}
              x2={anomalyEnd.x} y2={anomalyEnd.y}
              stroke="#B3261E"
              strokeWidth={2.5}
              strokeLinecap="round"
              filter="url(#redGlow)"
              markerEnd="url(#arrowRed)"
            />

            {/* Anomaly dot */}
            <motion.circle
              initial={{ r: 0, opacity: 0 }}
              animate={{ r: animating ? 18 : 10, opacity: animating ? 0 : 1 }}
              transition={{ duration: 0.6, delay: 0.7, ease: "easeOut" }}
              cx={anomalyEnd.x} cy={anomalyEnd.y}
              fill="#B3261E"
              filter="url(#redGlow)"
            />

            {/* Label */}
            <motion.text
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.1 }}
              x={anomalyEnd.x + 14} y={anomalyEnd.y - 16}
              fontSize={9}
              fill="#B3261E"
              fontFamily="Fragment Mono, monospace"
              fontWeight="700"
            >
              ORBIT BROKEN
            </motion.text>
            <motion.text
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.3 }}
              x={anomalyEnd.x + 14} y={anomalyEnd.y - 4}
              fontSize={7.5}
              fill="rgba(179, 38, 30,0.7)"
              fontFamily="Fragment Mono, monospace"
            >
              GRAVITY SCORE 87.3
            </motion.text>
          </>
        )}
      </AnimatePresence>
    </svg>
  );
}

// ── Gravity Score Gauge ───────────────────────────────────────────────────────
function GravityGauge({ score, decision }: { score: number; decision: string }) {
  const r = 54;
  const circumference = Math.PI * r;
  const pct = Math.min(score / 100, 1);
  const color = DECISION_COLOR[decision] || "#7B7774";
  const strokeDash = circumference * pct;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <svg width={140} height={80} viewBox="0 0 140 80">
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3D8B5A" />
            <stop offset="50%" stopColor="#B7791F" />
            <stop offset="100%" stopColor="#B3261E" />
          </linearGradient>
        </defs>
        {/* Track — subtle */}
        <path
          d={`M 16 74 A ${r} ${r} 0 0 1 124 74`}
          fill="none" stroke="rgba(16, 15, 15,0.04)" strokeWidth={8} strokeLinecap="round"
        />
        {/* Active arc — rich colour */}
        <motion.path
          d={`M 16 74 A ${r} ${r} 0 0 1 124 74`}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - strokeDash }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
        {/* Score text — centered, clean */}
        <text x={70} y={58} textAnchor="middle" fontSize={26} fontWeight="700"
          fill={color} fontFamily="'Inter', sans-serif" letterSpacing="-0.02em">
          {score.toFixed(0)}
        </text>
        <text x={70} y={72} textAnchor="middle" fontSize={8} fill="rgba(16, 15, 15,0.35)"
          fontFamily="Fragment Mono, monospace" letterSpacing="0.04em">
          /100
        </text>
      </svg>
      <div style={{
        fontSize: 11.5, fontWeight: 600, letterSpacing: "0.08em", fontFamily: C.mono,
        color, background: DECISION_BG[decision], padding: "5px 16px", borderRadius: 20,
        border: `1px solid ${color}50`, textTransform: "uppercase",
      }}>
        {decision.replace("_", " ")}
      </div>
    </div>
  );
}

// ── Transaction Timeline ──────────────────────────────────────────────────────
/** Group a month's transactions by spending category, biggest spend first.
 *  Orbit-breaking rows are pulled into their own leading group so the fraud
 *  story stays at the top instead of being filed under a spending category. */
function groupByCategory(txns: TxnRecord[]): { category: string; txns: TxnRecord[]; total: number; anomalous: boolean }[] {
  const buckets = new Map<string, TxnRecord[]>();
  for (const t of txns) {
    const key = t.anomalous ? ANOMALY_GROUP : t.category;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(t); else buckets.set(key, [t]);
  }
  const groups = [...buckets.entries()].map(([category, rows]) => ({
    category,
    txns: rows.sort((a, b) => b.amount - a.amount),
    total: rows.reduce((sum, t) => sum + t.amount, 0),
    anomalous: category === ANOMALY_GROUP,
  }));
  return groups.sort((a, b) =>
    a.anomalous === b.anomalous ? b.total - a.total : (a.anomalous ? -1 : 1));
}

const ANOMALY_GROUP = "Orbit-breaking activity";
const ROWS_PER_GROUP = 4;

function TxnTimeline({ months, anomalyMonth, colors }: {
  months: MonthDNA[];
  anomalyMonth: MonthDNA;
  colors: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState<number | null>(3);

  const allMonths = [...months, anomalyMonth];

  return (
    <div>
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "#969290", fontFamily: C.mono, marginBottom: 14 }}>
        Transaction Timeline — 4 months
      </div>
      {allMonths.map((month, mi) => {
        const isAnomaly = mi === 3;
        const isOpen = expanded === mi;
        const dc = isAnomaly ? "#B3261E" : "#3D8B5A";
        return (
          <div key={mi} style={{ marginBottom: 8 }}>
            <button
              onClick={() => setExpanded(isOpen ? null : mi)}
              style={{
                width: "100%", textAlign: "left",
                padding: "10px 16px",
                background: isAnomaly ? "rgba(179, 38, 30,0.08)" : "rgba(16, 15, 15,0.03)",
                border: `1px solid ${isAnomaly ? "rgba(179, 38, 30,0.25)" : "rgba(16, 15, 15,0.06)"}`,
                borderRadius: 10, cursor: "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                transition: "all 0.2s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: dc, flexShrink: 0, boxShadow: `0 0 6px ${dc}` }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: isAnomaly ? "#B3261E" : "#100F0F", fontFamily: C.mono }}>
                  {month.month_label}
                </span>
                {isAnomaly && (
                  <span style={{ fontSize: 9, background: "rgba(179, 38, 30,0.15)", border: "1px solid rgba(179, 38, 30,0.3)", borderRadius: 20, padding: "1px 8px", color: "#B3261E", fontFamily: C.mono, letterSpacing: "0.06em" }}>
                    ⚠ ORBIT BROKEN
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#767270", fontFamily: C.mono }}>
                  Gravity: <span style={{ color: dc, fontWeight: 700 }}>{month.gravity_score.toFixed(1)}</span>
                </span>
                <span style={{ fontSize: 11, color: "rgba(16, 15, 15,0.3)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
              </div>
            </button>

            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  style={{ overflow: "hidden" }}
                >
                  <div style={{ padding: "12px 4px 4px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {/* Anomaly signals chips */}
                    {isAnomaly && month.anomaly_signals && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                        {month.anomaly_signals.map(sig => (
                          <span key={sig.id} style={{
                            fontSize: 9, padding: "3px 10px", borderRadius: 20,
                            background: `${sig.color}18`, border: `1px solid ${sig.color}40`,
                            color: sig.color, fontFamily: C.mono, fontWeight: 600, letterSpacing: "0.04em",
                          }}>
                            {sig.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Transactions, grouped by spending category */}
                    {groupByCategory(month.transactions).map(group => {
                      const gc = group.anomalous ? "#B3261E" : (colors[group.category] || "#797572");
                      const hidden = group.txns.length - ROWS_PER_GROUP;
                      return (
                        <div key={group.category} style={{ marginBottom: 10 }}>
                          {/* Category header — name, count, subtotal */}
                          <div style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "6px 12px 6px 10px", borderRadius: 8, marginBottom: 3,
                            background: `${gc}14`, borderLeft: `2px solid ${gc}`,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <span style={{
                                fontSize: 10, fontWeight: 700, color: gc, fontFamily: C.mono,
                                letterSpacing: "0.06em", textTransform: "uppercase",
                                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                              }}>
                                {group.anomalous ? `⚠ ${group.category}` : group.category}
                              </span>
                              <span style={{ fontSize: 9, color: "#969290", fontFamily: C.mono, flexShrink: 0 }}>
                                {group.txns.length} txn{group.txns.length > 1 ? "s" : ""}
                              </span>
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: gc, fontFamily: C.mono, flexShrink: 0 }}>
                              ₹{group.total.toLocaleString("en-IN")}
                            </span>
                          </div>

                          {/* Rows in this category — payee, time, amount */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 10 }}>
                            {group.txns.slice(0, ROWS_PER_GROUP).map((txn, ti) => (
                              <div key={ti} style={{
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                padding: "6px 12px", borderRadius: 7,
                                background: txn.anomalous ? "rgba(179, 38, 30,0.06)" : "rgba(16, 15, 15,0.02)",
                                border: `1px solid ${txn.anomalous ? "rgba(179, 38, 30,0.15)" : "rgba(16, 15, 15,0.04)"}`,
                              }}>
                                <div style={{ display: "flex", gap: 9, alignItems: "center", flex: 1, minWidth: 0 }}>
                                  <span style={{ fontSize: 10, flexShrink: 0 }}>{txn.anomalous ? "🚨" : "✓"}</span>
                                  <span style={{
                                    fontSize: 11, color: txn.anomalous ? "#B3261E" : "#100F0F", fontFamily: C.mono,
                                    fontWeight: txn.anomalous ? 700 : 400,
                                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                  }}>
                                    {txn.payee}
                                  </span>
                                  <span style={{ fontSize: 9, color: "#969290", fontFamily: C.mono, flexShrink: 0 }}>
                                    {txn.hour.toString().padStart(2, "0")}:00
                                  </span>
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: txn.anomalous ? "#B3261E" : "#575452", fontFamily: C.mono, flexShrink: 0 }}>
                                  {txn.amount > 0 ? `₹${txn.amount.toLocaleString("en-IN")}` : "—"}
                                </div>
                              </div>
                            ))}
                            {hidden > 0 && (
                              <div style={{ fontSize: 9, color: "#969290", fontFamily: C.mono, paddingLeft: 12, paddingTop: 1 }}>
                                +{hidden} more in {group.category.toLowerCase()}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ── Spending DNA Radar ─────────────────────────────────────────────────────────
function SpendingRadar({ baseline, current, colors }: {
  baseline: Record<string, number>;
  current: Record<string, number>;
  colors: Record<string, string>;
}) {
  const cats = Object.keys(baseline);
  const n = cats.length;
  const cx = 130, cy = 130, maxR = 100;

  function polarToXY(index: number, value: number, maxVal: number) {
    const angle = ((index / n) * 360 - 90) * (Math.PI / 180);
    const r = (value / maxVal) * maxR;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }

  const maxVal = Math.max(...Object.values(baseline), ...Object.values(current), 30);

  const baselinePoints = cats.map((cat, i) => polarToXY(i, baseline[cat] || 0, maxVal));
  const currentPoints = cats.map((cat, i) => polarToXY(i, current[cat] || 0, maxVal));

  return (
    <svg viewBox="0 0 260 260" style={{ width: "100%", maxWidth: 260 }}>
      {/* Grid rings */}
      {[0.25, 0.5, 0.75, 1.0].map(f => (
        <polygon
          key={f}
          points={cats.map((_, i) => {
            const pt = polarToXY(i, maxVal * f, maxVal);
            return `${pt.x},${pt.y}`;
          }).join(" ")}
          fill="none" stroke="rgba(16, 15, 15,0.05)" strokeWidth={1}
        />
      ))}
      {/* Spokes */}
      {cats.map((_, i) => {
        const end = polarToXY(i, maxVal, maxVal);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="rgba(16, 15, 15,0.04)" strokeWidth={1} />;
      })}
      {/* Baseline polygon */}
      <polygon
        points={baselinePoints.map(p => `${p.x},${p.y}`).join(" ")}
        fill="rgba(170, 65, 42,0.12)" stroke="rgba(170, 65, 42,0.4)" strokeWidth={1.5}
      />
      {/* Current polygon */}
      <polygon
        points={currentPoints.map(p => `${p.x},${p.y}`).join(" ")}
        fill="rgba(179, 38, 30,0.1)" stroke="rgba(179, 38, 30,0.55)" strokeWidth={1.5}
        strokeDasharray="5 3"
      />
      {/* Category labels */}
      {cats.map((cat, i) => {
        const pt = polarToXY(i, maxVal * 1.25, maxVal);
        const anchor = pt.x < cx - 8 ? "end" : pt.x > cx + 8 ? "start" : "middle";
        return (
          <text key={cat} x={pt.x} y={pt.y} fontSize={7.5} fill={colors[cat] || "#595552"}
            fontFamily="Fragment Mono, monospace" textAnchor={anchor} dominantBaseline="middle" opacity={0.8}>
            {cat.split(" ")[0]}
          </text>
        );
      })}
      {/* Legend */}
      <rect x={8} y={230} width={8} height={8} fill="rgba(170, 65, 42,0.4)" rx={1} />
      <text x={20} y={237} fontSize={7} fill="rgba(170, 65, 42,0.5)" fontFamily="Fragment Mono, monospace">Baseline</text>
      <rect x={75} y={230} width={8} height={8} fill="rgba(179, 38, 30,0.4)" rx={1} />
      <text x={87} y={237} fontSize={7} fill="rgba(179, 38, 30,0.5)" fontFamily="Fragment Mono, monospace">Anomaly</text>
    </svg>
  );
}

export default function FinancialGravityPage({ isEmbedded = false }: { isEmbedded?: boolean }) {
  const [profile, setProfile] = useState<GravityProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState("Harsh");
  const [showAnomaly, setShowAnomaly] = useState(false);
  const [showPrediction, setShowPrediction] = useState(false);
  const [animating, setAnimating] = useState(false);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fallback mock data (works even if backend is offline)
  function buildMockProfile(customerId: string): GravityProfile {
    const income = customerId === "Harsh" ? 40000 : customerId === "attacker_sim" ? 55000 : 32000;
    // Mirrors backend/app/api/gravity.py — same six categories, same colours,
    // and every payee sits in the category it actually belongs to.
    const colors: Record<string, string> = {
      "University Fees": "#5B5BA8", "Rent / PG": "#5B5BA8",
      "Food & Dining": "#B7791F", "Entertainment": "#B5527A",
      "Utilities": "#2C7A91", "Bank & Savings": "#3D8B5A",
    };
    const baseline: Record<string, number> = {
      "University Fees": 15, "Rent / PG": 22, "Food & Dining": 11,
      "Entertainment": 5, "Utilities": 6, "Bank & Savings": 16,
    };
    const makeMonth = (label: string, idx: number): MonthDNA => ({
      month_label: label, month_index: idx,
      distribution: { ...baseline },
      payees: ["PG Rent", "Mess Fee", "Electricity Board", "Jio Fiber", "Swiggy", "Netflix", "Savings Transfer"],
      transactions: [
        { payee: "PG Rent", category: "Rent / PG", amount: Math.round(income * 0.22), hour: 9, is_known_payee: true, anomalous: false },
        { payee: "Mess Fee", category: "University Fees", amount: 4200, hour: 11, is_known_payee: true, anomalous: false },
        { payee: "Development Fee", category: "University Fees", amount: 3500, hour: 14, is_known_payee: true, anomalous: false },
        { payee: "Electricity Board", category: "Utilities", amount: 1200, hour: 11, is_known_payee: true, anomalous: false },
        { payee: "Jio Fiber", category: "Utilities", amount: 799, hour: 12, is_known_payee: true, anomalous: false },
        { payee: "Swiggy", category: "Food & Dining", amount: 450, hour: 20, is_known_payee: true, anomalous: false },
        { payee: "Zomato", category: "Food & Dining", amount: 380, hour: 21, is_known_payee: true, anomalous: false },
        { payee: "Canteen", category: "Food & Dining", amount: 120, hour: 13, is_known_payee: true, anomalous: false },
        { payee: "Netflix", category: "Entertainment", amount: 649, hour: 22, is_known_payee: true, anomalous: false },
        { payee: "BookMyShow", category: "Entertainment", amount: 560, hour: 19, is_known_payee: true, anomalous: false },
        { payee: "Savings Transfer", category: "Bank & Savings", amount: Math.round(income * 0.12), hour: 10, is_known_payee: true, anomalous: false },
        { payee: "SIP - Mutual Fund", category: "Bank & Savings", amount: 2500, hour: 10, is_known_payee: true, anomalous: false },
      ],
      gravity_score: 12 + idx * 2, decision: "APPROVE", has_anomaly: false,
    });
    // Persona-aware fallback so an offline profile still tells the right story
    // (matches backend/app/api/gravity.py personas & computed signals).
    const persona = /attack|mule|fraud/i.test(customerId) ? "attacker"
      : /coerc|duress|victim/i.test(customerId) ? "coercion" : "legit";
    const signals: AnomalySignal[] =
      persona === "attacker" ? [
        { id: "unknown_beneficiary", label: `Unknown Beneficiary (₹${Math.round(income * 0.47).toLocaleString("en-IN")} to unverified payee)`, severity: 0.9, color: "#B3261E" },
        { id: "new_wallet_creation", label: "New Wallet Created (PhonePe)", severity: 0.85, color: "#B3261E" },
        { id: "half_balance_transfer", label: "47% Balance Transferred", severity: 0.77, color: "#B3261E" },
        { id: "post_salary_velocity", label: "Post-Salary Velocity Spike", severity: 0.7, color: "#B3261E" },
        { id: "night_transfer", label: "Night Transfer (23:46)", severity: 0.35, color: "#B7791F" },
      ] : persona === "coercion" ? [
        { id: "device_change", label: "New Device / Screen-Share Active", severity: 0.55, color: "#B3261E" },
        { id: "night_transfer", label: "Night Transfer (22:26)", severity: 0.35, color: "#B7791F" },
      ] : [];
    const curScore = persona === "attacker" ? 100 : persona === "coercion" ? 59.5 : 11;
    const curDecision = persona === "attacker" ? "HARD_BLOCK" : persona === "coercion" ? "STEP_UP" : "APPROVE";
    const hasAnomaly = persona !== "legit";
    const anomalyDist = hasAnomaly
      ? { ...baseline, "Rent / PG": 22, "Bank & Savings": 0 }
      : { ...baseline };
    const anomalyTxns = persona === "attacker" ? [
        { payee: "UNKNOWN_BENE_ACC7721", category: "Transfer", amount: Math.round(income * 0.47), hour: 23, is_known_payee: false, anomalous: true, signals: ["unknown_beneficiary", "night_transfer", "half_balance_transfer"] },
        { payee: "NewWallet_PhonePe", category: "Wallet Creation", amount: 0, hour: 23, is_known_payee: false, anomalous: true, signals: ["new_wallet_creation"] },
        { payee: "SELF_TRANSFER", category: "Transfer", amount: Math.round(income * 0.15), hour: 0, is_known_payee: false, anomalous: true, signals: ["post_salary_velocity"] },
      ] : persona === "coercion" ? [
        { payee: "COERCED_PAYEE_A88", category: "Transfer", amount: Math.round(income * 0.2), hour: 22, is_known_payee: false, anomalous: true, signals: ["device_change", "night_transfer"] },
      ] : [];
    const anomaly: MonthDNA = {
      month_label: hasAnomaly ? "This Month (ANOMALY)" : "This Month (WITHIN ORBIT)", month_index: 3,
      distribution: anomalyDist,
      payees: [], transactions: [
        ...anomalyTxns,
        { payee: "PG Rent", category: "Rent / PG", amount: Math.round(income * 0.22), hour: 9, is_known_payee: true, anomalous: false },
        { payee: "Swiggy", category: "Food & Dining", amount: 320, hour: 19, is_known_payee: true, anomalous: false },
      ],
      gravity_score: curScore, decision: curDecision, has_anomaly: hasAnomaly,
      anomaly_signals: signals,
    };
    const futureDist = {
      "University Fees": 14.0,
      "Rent / PG": 22.0,
      "Food & Dining": 10.2,
      "Entertainment": 4.5,
      "Utilities": 7.2,
      "Bank & Savings": 16.5,
    };
    const mockFutureIntent: MonthDNA = {
      month_label: "Next Month (Intent AI)",
      month_index: 4,
      distribution: futureDist,
      payees: [],
      transactions: [],
      gravity_score: 9.5,
      decision: "APPROVE",
      has_anomaly: false,
      predicted_transactions: [
        { payee: customerId === "Harsh" ? "PG Rent" : "Hostel Fee", category: customerId === "Harsh" ? "Rent / PG" : "University Fees", amount: Math.round(income * 0.22), predicted_day: 2, probability: 0.99, description: "Auto-recurring rental baseline" },
        { payee: "Electricity Board", category: "Utilities", amount: 1400, predicted_day: 7, probability: 0.88, description: "Expected seasonal usage increase" },
        { payee: "Mess Fee", category: "University Fees", amount: 4200, predicted_day: 8, probability: 0.94, description: "Fixed monthly mess billing" },
        { payee: "Development Fee", category: "University Fees", amount: 3500, predicted_day: 10, probability: 0.76, description: "Cyclic term payment forecast" },
      ]
    };

    return {
      customer_id: customerId, monthly_income: income, salary_credit_day: 2,
      baseline_distribution: baseline, category_colors: colors, known_payees_count: 9,
      months: [makeMonth("3 Months Ago", 0), makeMonth("2 Months Ago", 1), makeMonth("Last Month", 2)],
      anomaly_month: anomaly, anomaly_signals: signals,
      current_gravity_score: curScore, current_decision: curDecision,
      future_intent: mockFutureIntent,
    };
  }

  const fetchProfile = async (userId: string) => {
    setLoading(true);
    setShowAnomaly(false);
    setShowPrediction(false);
    try {
      await ensureDemoToken();
      const r = await apiFetch(`/api/gravity/profile/${userId}`);
      if (r.ok) {
        setProfile(await r.json());
      } else {
        setProfile(buildMockProfile(userId));
      }
    } catch {
      setProfile(buildMockProfile(userId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProfile(selectedUser); }, [selectedUser]);

  const runAnomalyDemo = () => {
    setAnimating(true);
    setShowAnomaly(true);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => setAnimating(false), 1400);
  };

  const resetDemo = () => {
    setShowAnomaly(false);
    setAnimating(false);
  };

  if (loading) {
    return (
      <div style={{ minHeight: isEmbedded ? "300px" : "100vh", background: isEmbedded ? "transparent" : "var(--color-canvas)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }}
          style={{ fontSize: 13, color: "#767270", fontFamily: C.mono, letterSpacing: "0.08em" }}>
          COMPUTING FINANCIAL ORBIT…
        </motion.div>
      </div>
    );
  }

  if (!profile) return null;

  // profile.anomaly_month used throughout JSX via profile reference
  return (
    <div style={{ minHeight: isEmbedded ? "auto" : "100vh", background: isEmbedded ? "transparent" : "var(--color-canvas)", color: "#100F0F", paddingBottom: isEmbedded ? 0 : 80 }}>
      {!isEmbedded && <div className="bg-grid-pattern" style={{ position: "fixed", inset: 0, opacity: 0.08, pointerEvents: "none", zIndex: 0 }} />}

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: isEmbedded ? "12px 0 0 0" : "36px 24px" }}>

        {/* ── Header ── */}
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "rgba(170, 65, 42,0.12)", border: "1px solid rgba(170, 65, 42,0.25)",
              borderRadius: 20, padding: "3px 12px", fontSize: 9,
              color: "rgba(170, 65, 42,0.7)", fontFamily: C.mono, letterSpacing: "0.1em", textTransform: "uppercase",
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--color-primary)", boxShadow: "0 0 6px var(--color-primary)" }} />
              Layer 4 — Financial Gravity Engine
            </div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "rgba(179, 38, 30,0.10)", border: "1px solid rgba(179, 38, 30,0.2)",
              borderRadius: 20, padding: "3px 12px", fontSize: 9,
              color: "rgba(179, 38, 30,0.8)", fontFamily: C.mono, letterSpacing: "0.1em", textTransform: "uppercase",
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#B3261E", boxShadow: "0 0 6px #B3261E" }} />
              Orbital Anomaly Detected
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
            <div>
              <h1 style={{
                fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1,
                fontFamily: "'Newsreader', Georgia, serif", marginBottom: 6, color: "#100F0F",
              }}>
                Financial Gravity Orbit Analyzer
              </h1>
              <p style={{ fontSize: 11, color: "#767270", fontFamily: C.mono, letterSpacing: "0.06em" }}>
                Spending orbit analysis · 90-day behavioural baseline · Anomaly detection
              </p>
            </div>

            {/* User selector */}
            <div style={{ display: "flex", gap: 6 }}>
              {DEMO_USERS.map(u => (
                <button key={u} onClick={() => setSelectedUser(u)} style={{
                  padding: "6px 14px", borderRadius: 8, fontSize: 10, fontFamily: C.mono, fontWeight: 600,
                  letterSpacing: "0.04em", cursor: "pointer", transition: "all 0.2s",
                  background: selectedUser === u ? "rgba(170, 65, 42,0.2)" : "rgba(16, 15, 15,0.04)",
                  border: selectedUser === u ? "1px solid rgba(170, 65, 42,0.4)" : "1px solid rgba(16, 15, 15,0.06)",
                  color: selectedUser === u ? "var(--color-primary)" : "#767270",
                }}>
                  {u === "Harsh" ? "👤 Harsh" : u === "attacker_sim" ? "🔴 Attacker" : "😰 Coercion"}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── Top Row: Orbit + Gauge + Signals ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, marginBottom: 20 }}>

          {/* Orbital visualisation card */}
          <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1, duration: 0.5 }}
            style={{
              background: "#FFFFFF", border: "1px solid #EAE4E1",
              borderRadius: 20, padding: "24px 20px",
            }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#969290", fontFamily: C.mono, marginBottom: 4 }}>
                  Financial Orbit
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#100F0F", fontFamily: C.mono }}>
                  {profile.customer_id} · ₹{profile.monthly_income.toLocaleString("en-IN")}/mo
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {profile.future_intent && (
                  <button onClick={() => setShowPrediction(p => !p)} style={{
                    padding: "8px 18px", borderRadius: 8, fontSize: 11, fontFamily: C.mono, fontWeight: 700,
                    letterSpacing: "0.05em", textTransform: "uppercase" as const, cursor: "pointer",
                    background: showPrediction ? "rgba(170, 65, 42,0.15)" : "rgba(16, 15, 15,0.04)",
                    border: showPrediction ? "1px solid rgba(170, 65, 42,0.4)" : "1px solid rgba(16, 15, 15,0.06)",
                    color: showPrediction ? "#2C7A91" : "#767270", transition: "all 0.2s",
                  }}>
                    🌌 Intent AI prediction
                  </button>
                )}
                {!showAnomaly ? (
                  <button onClick={runAnomalyDemo} style={{
                    padding: "8px 18px", borderRadius: 8, fontSize: 11, fontFamily: C.mono, fontWeight: 700,
                    letterSpacing: "0.05em", textTransform: "uppercase" as const, cursor: "pointer",
                    background: "rgba(179, 38, 30,0.15)", border: "1px solid rgba(179, 38, 30,0.35)",
                    color: "#B3261E", transition: "all 0.2s",
                  }}>
                    🚨 Run Anomaly
                  </button>
                ) : (
                  <button onClick={resetDemo} style={{
                    padding: "8px 18px", borderRadius: 8, fontSize: 11, fontFamily: C.mono, fontWeight: 700,
                    letterSpacing: "0.05em", textTransform: "uppercase" as const, cursor: "pointer",
                    background: "rgba(61, 139, 90,0.12)", border: "1px solid rgba(61, 139, 90,0.25)",
                    color: "#3D8B5A", transition: "all 0.2s",
                  }}>
                    ↺ Reset Orbit
                  </button>
                )}
              </div>
            </div>

            <OrbitalChart profile={profile} showAnomaly={showAnomaly} animating={animating} showPrediction={showPrediction} />

            {/* Legend */}
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
              {Object.entries(profile.category_colors).map(([cat, color]) => (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />
                  <span style={{ fontSize: 8, color: "#767270", fontFamily: C.mono }}>{cat.split(" ")[0]}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right column: Gauge + Signals */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, duration: 0.5 }}
            style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Gravity Score Gauge */}
            <div style={{
              background: "#FFFFFF", border: "1px solid #EAE4E1",
              borderRadius: 20, padding: "22px 20px", textAlign: "center",
            }}>
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "#969290", fontFamily: C.mono, marginBottom: 14 }}>
                Current Gravity Score
              </div>
              <GravityGauge
                score={profile.current_gravity_score}
                decision={profile.current_decision}
              />
              <div style={{ marginTop: 14, fontSize: 11, color: "#767270", fontFamily: C.mono, lineHeight: 1.6, fontWeight: 500 }}>
                {profile.current_decision === "APPROVE"
                  ? "Spending pattern within expected orbital range. No anomaly detected."
                  : `Financial orbit disrupted — ${profile.anomaly_signals.length} risk signal${profile.anomaly_signals.length === 1 ? "" : "s"} detected, ${Math.round(profile.current_gravity_score)}% deviation from baseline.`}
              </div>
            </div>

            {/* Anomaly Signals */}
            <div style={{
              background: profile.anomaly_signals.length > 0 ? "rgba(179, 38, 30,0.05)" : "rgba(16, 15, 15,0.02)",
              border: profile.anomaly_signals.length > 0 ? "1px solid rgba(179, 38, 30,0.2)" : "1px solid rgba(16, 15, 15,0.06)",
              borderRadius: 20, padding: "18px 18px",
              transition: "all 0.4s ease",
            }}>
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "#969290", fontFamily: C.mono, marginBottom: 12 }}>
                Gravity Signals
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {profile.anomaly_signals.length === 0 && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    borderRadius: 8, background: "rgba(61, 139, 90,0.08)", border: "1px solid rgba(61, 139, 90,0.22)",
                  }}>
                    <span style={{ fontSize: 14 }}>✓</span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: "#3D8B5A", fontFamily: C.mono }}>
                      Within orbit — no anomaly signals detected
                    </span>
                  </div>
                )}
                {profile.anomaly_signals.map((sig, i) => (
                  <motion.div
                    key={sig.id}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1, duration: 0.3 }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", borderRadius: 8,
                      background: `${sig.color}12`,
                      border: `1px solid ${sig.color}30`,
                      transition: "all 0.3s",
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: `${sig.color}20`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <span style={{ fontSize: 12 }}>
                        {sig.id === "unknown_beneficiary" ? "👤" :
                         sig.id === "night_transfer" ? "🌙" :
                         sig.id === "post_salary_velocity" ? "⚡" :
                         sig.id === "new_wallet_creation" ? "💳" :
                         sig.id === "device_change" ? "🖥️" :
                         sig.id === "rapid_fire_transfers" ? "🔁" :
                         sig.id === "half_balance_transfer" ? "💸" :
                         sig.id === "benign_new_payee" ? "✅" : "💰"}
                      </span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: sig.color, fontFamily: C.mono }}>
                        {sig.label}
                      </div>
                      <div style={{ marginTop: 3, height: 2, borderRadius: 2, background: "rgba(16, 15, 15,0.06)", overflow: "hidden" }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${sig.severity * 100}%` }}
                          transition={{ delay: i * 0.1 + 0.2, duration: 0.5 }}
                          style={{ height: "100%", background: sig.color, borderRadius: 2 }}
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: sig.color, fontFamily: C.mono, fontWeight: 700 }}>
                      {Math.round(sig.severity * 100)}%
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── Bottom Row: Radar + Timeline ── */}
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20 }}>

          {/* Spending DNA Radar */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}
            style={{
              background: "#FFFFFF", border: "1px solid #EAE4E1",
              borderRadius: 20, padding: "22px 18px",
            }}>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "#969290", fontFamily: C.mono, marginBottom: 12 }}>
              Spending DNA — Radar
            </div>
            <SpendingRadar
              baseline={profile.baseline_distribution}
              current={showAnomaly ? profile.anomaly_month.distribution : profile.months[2]?.distribution || profile.baseline_distribution}
              colors={profile.category_colors}
            />
            <div style={{ marginTop: 10 }}>
              {Object.entries(profile.baseline_distribution).map(([cat, pct]) => (
                <div key={cat} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: profile.category_colors[cat], display: "inline-block" }} />
                    <span style={{ fontSize: 9, color: "#767270", fontFamily: C.mono }}>{cat.split(" ")[0]}</span>
                  </div>
                  <span style={{ fontSize: 9, color: profile.category_colors[cat], fontFamily: C.mono, fontWeight: 600 }}>
                    {pct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Transaction Timeline */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }}
            style={{
              background: "#FFFFFF", border: "1px solid #EAE4E1",
              borderRadius: 20, padding: "22px 20px",
            }}>
            <TxnTimeline months={profile.months} anomalyMonth={profile.anomaly_month} colors={profile.category_colors} />
          </motion.div>
        </div>

        {/* ── Intent AI: Predictive Panel ── */}
        <AnimatePresence>
          {showPrediction && profile.future_intent && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: 15 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: 15 }}
              transition={{ duration: 0.4 }}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 20,
                marginTop: 20,
                overflow: "hidden"
              }}
            >
              {/* Category Distribution Forecast */}
              <div style={{
                background: "rgba(170, 65, 42,0.03)",
                border: "1px solid rgba(170, 65, 42,0.18)",
                borderRadius: 20,
                padding: "22px 20px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "#2C7A91", fontFamily: C.mono, marginBottom: 4 }}>
                      🌌 Intent AI — Category Forecast
                    </div>
                    <div style={{ fontSize: 12, color: "#767270", fontFamily: C.mono }}>
                      Spending baseline vs predicted Month +1 behaviors
                    </div>
                  </div>
                  <span style={{ fontSize: 9, background: "rgba(170, 65, 42,0.15)", border: "1px solid rgba(170, 65, 42,0.3)", borderRadius: 20, padding: "1px 8px", color: "#2C7A91", fontFamily: C.mono, letterSpacing: "0.06em", fontWeight: "bold" }}>
                    PROJECTION ACTIVE
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {Object.entries(profile.baseline_distribution).map(([cat, pct]) => {
                    const futurePct = profile.future_intent?.distribution[cat] ?? pct;
                    const color = profile.category_colors[cat];
                    const diff = futurePct - pct;
                    return (
                      <div key={cat} style={{ background: "#FFFFFF", border: "1px solid rgba(16, 15, 15,0.02)", padding: "10px 14px", borderRadius: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ fontSize: 10, color: "#575452", fontFamily: C.mono, fontWeight: 600 }}>{cat}</span>
                          <div style={{ fontSize: 10, fontFamily: C.mono }}>
                            <span style={{ color: "rgba(16, 15, 15,0.3)" }}>{pct.toFixed(1)}%</span>
                            <span style={{ margin: "0 6px", color: "rgba(16, 15, 15,0.2)" }}>➔</span>
                            <span style={{ color: "#2C7A91", fontWeight: 700 }}>{futurePct.toFixed(1)}%</span>
                            {diff !== 0 && (
                              <span style={{ marginLeft: 6, fontSize: 9, color: diff > 0 ? "#3D8B5A" : "#B3261E", fontWeight: "bold" }}>
                                {diff > 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Overlay comparison progress bar */}
                        <div style={{ height: 4, borderRadius: 2, background: "rgba(16, 15, 15,0.05)", position: "relative", overflow: "hidden" }}>
                          {/* Baseline bar */}
                          <div style={{ height: "100%", width: `${pct * 2.5}%`, background: `${color}40`, position: "absolute", left: 0, top: 0, borderRadius: 2 }} />
                          {/* Future bar */}
                          <div style={{ height: "100%", width: `${futurePct * 2.5}%`, background: "#2C7A91", position: "absolute", left: 0, top: 0, borderRadius: 2, opacity: 0.8 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Risk Drift Gauge */}
                <div style={{
                  marginTop: 18,
                  padding: "12px 16px",
                  borderRadius: 12,
                  background: "rgba(170, 65, 42,0.08)",
                  border: "1px solid rgba(170, 65, 42,0.2)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}>
                  <div>
                    <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", color: "#2C7A91", fontFamily: C.mono, marginBottom: 2 }}>
                      Predicted Orbit Stability
                    </div>
                    <div style={{ fontSize: 11, color: "#100F0F", fontWeight: 600 }}>
                      Orbit trajectory remains within normal limits.
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, color: "#2C7A91", fontWeight: 800, fontFamily: C.mono }}>
                      9.5/100
                    </div>
                    <div style={{ fontSize: 8, color: "rgba(170, 65, 42,0.6)", fontFamily: C.mono }}>
                      EXPECTED RISK
                    </div>
                  </div>
                </div>
              </div>

              {/* Predicted Recurring Transactions */}
              <div style={{
                background: "#FFFFFF",
                border: "1px solid #EAE4E1",
                borderRadius: 20,
                padding: "22px 20px",
              }}>
                <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "#969290", fontFamily: C.mono, marginBottom: 14 }}>
                  📋 Predicted Recurring Transactions (Month +1)
                </div>
                
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {profile.future_intent.predicted_transactions?.map((tx, ti) => {
                    const probColor = tx.probability >= 0.9 ? "#3D8B5A" : tx.probability >= 0.75 ? "#B7791F" : "#B3261E";
                    return (
                      <div key={ti} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "12px 16px", borderRadius: 12,
                        background: "#FFFFFF",
                        border: "1px solid rgba(16, 15, 15,0.03)",
                      }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 8,
                            background: "#FFFFFF",
                            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                            border: "1px solid #EAE4E1",
                          }}>
                            <span style={{ fontSize: 7, color: "#767270", fontFamily: C.mono, textTransform: "uppercase" }}>Day</span>
                            <span style={{ fontSize: 12, color: "#100F0F", fontWeight: 700, fontFamily: C.mono, lineHeight: 1 }}>
                              {tx.predicted_day.toString().padStart(2, "0")}
                            </span>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: "#100F0F", fontFamily: C.mono, fontWeight: 700 }}>
                              {tx.payee}
                            </div>
                            <div style={{ fontSize: 9, color: "#969290", fontFamily: C.mono }}>
                              {tx.category} · {tx.description}
                            </div>
                          </div>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#2C7A91", fontFamily: C.mono }}>
                            ₹{tx.amount.toLocaleString("en-IN")}
                          </div>
                          <span style={{
                            fontSize: 8, padding: "2px 8px", borderRadius: 10,
                            background: `${probColor}15`, border: `1px solid ${probColor}30`,
                            color: probColor, fontFamily: C.mono, fontWeight: 600,
                          }}>
                            {Math.round(tx.probability * 100)}% Match
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{
                  marginTop: 18,
                  fontSize: 10,
                  color: "#969290",
                  fontFamily: C.mono,
                  lineHeight: 1.5,
                  textAlign: "center",
                  padding: "10px",
                  border: "1px dashed rgba(16, 15, 15,0.04)",
                  borderRadius: 10
                }}>
                  Intent AI continuously models future account state by projecting historical velocity. If an upcoming transaction deviates from this prediction, step-up challenges will escalate automatically.
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Architecture note ── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          style={{
            marginTop: 24, padding: "16px 24px", borderRadius: 12,
            background: "rgba(170, 65, 42,0.05)", border: "1px solid rgba(170, 65, 42,0.12)",
            display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          }}>
          <div style={{ fontSize: 9, color: "rgba(170, 65, 42,0.5)", fontFamily: C.mono, letterSpacing: "0.08em" }}>
            ARCHITECTURE
          </div>
          {[
            { label: "Layer 1", desc: "Blockchain IMEI", color: "var(--color-primary)" },
            { label: "Layer 2", desc: "Coercion / CAMARA", color: "var(--color-primary)" },
            { label: "Layer 3", desc: "ML Behavioral Passport", color: "#5B5BA8" },
            { label: "Layer 4", desc: "Financial Gravity ← HERE", color: "#B3261E" },
          ].map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {i > 0 && <span style={{ color: "rgba(16, 15, 15,0.2)", fontSize: 12 }}>→</span>}
              <span style={{
                fontSize: 9, fontFamily: C.mono, fontWeight: 600,
                color: l.color, background: `${l.color}15`,
                border: `1px solid ${l.color}30`, borderRadius: 6, padding: "2px 8px",
              }}>
                {l.label}: {l.desc}
              </span>
            </div>
          ))}
          <div style={{ marginLeft: "auto", fontSize: 9, color: "#969290", fontFamily: C.mono }}>
            90-day rolling window · Seeded per user · Works offline
          </div>
        </motion.div>

      </div>
    </div>
  );
}
