/**
 * ZipPay Bank — Full Banking Dashboard
 *
 * Citadel acts as middleware between every user action and the server:
 *  • Every keystroke → BehaviorSDK captures signals → /api/signals/ingest
 *  • Login → /api/auth/evaluate (3-pathway engine)
 *  • Transfer → /api/auth/evaluate (high-value gate)
 *  • Razorpay UPI → Citadel check FIRST, then Razorpay opens
 *  • Everything → visible in the collapsible Citadel Shield panel
 *
 * 2 Demo Accounts: Harshdeep Singh ↔ Rajesh Kumar (transfer between each other)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    Razorpay: any;
    google: any;
  }
}

import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import VoiceMfaPanel from "../components/VoiceMfaPanel";
import type { VoiceVerdict } from "../lib/voiceMfa";
import { SIGNUP_DRAFT, LOGIN_DRAFT, clearDraft, useDraftState } from "../lib/formDraft";
import {
  Home as HomeIcon, ArrowLeftRight, Smartphone, ReceiptText, User, LogOut,
  Landmark, ArrowUpRight, ArrowDownLeft, Activity, ShieldAlert, ShieldCheck,
  Monitor, Send, History as HistoryIcon, Inbox, ShoppingBag, Briefcase,
  UtensilsCrossed, CreditCard, Zap, Laptop, QrCode, Wallet,
  ScanFace, KeyRound, CheckCircle2, XCircle, Loader2, AlertTriangle,
  Eye, Copy, Check, ChevronRight, ChevronDown, Menu, X as CloseIcon,
  type LucideIcon,
} from "lucide-react";
import { BehaviorSDK, getDeviceFingerprint } from "../lib/sdk/BehaviorSDK";
import { apiUrl, setToken, getToken, setSession, API_BASE, getPublicIp, loginCustomer, LoginError, ensureDemoToken } from "../lib/auth";
import HoneyTrap from "../components/HoneyTrap";
import PauseScreen from "../components/PauseScreen";
import { securityEvaluate } from "../lib/securityApi";
import { useMotionSignal } from "../lib/useMotionSignal";
import jsQR from "jsqr";
import * as faceapi from "face-api.js";

// Helper to generate a stable, synchronous 128-bit hex hash of browser environment fingerprint
function getFingerprintHashSync(): string {
  try {
    const fp = getDeviceFingerprint();
    let h1 = 0x811c9dc5, h2 = 0xdacebeef, h3 = 0x12345678, h4 = 0xabcdef01;
    for (let i = 0; i < fp.length; i++) {
      const char = fp.charCodeAt(i);
      h1 = Math.imul(h1 ^ char, 2654435761);
      h2 = Math.imul(h2 ^ char, 1597334677);
      h3 = Math.imul(h3 ^ char, 2246822519);
      h4 = Math.imul(h4 ^ char, 3266489917);
    }
    const part1 = (h1 >>> 0).toString(16).padStart(8, "0");
    const part2 = (h2 >>> 0).toString(16).padStart(8, "0");
    const part3 = (h3 >>> 0).toString(16).padStart(8, "0");
    const part4 = (h4 >>> 0).toString(16).padStart(8, "0");
    return part1 + part2 + part3 + part4;
  } catch (e) {
    // Fallback if browser fingerprinting fails
    return "a1ddbe55b87c50dc41901a28388bb0a4f6e62e8970fb5542500d99cfc16449ed";
  }
}

// ── IMEI Hashes (match backend demo constants) ────────────────────────────────
const DEMO_LEGIT_IMEI = getFingerprintHashSync();
const DEMO_ATTACKER_IMEI =
  "01e6cba8e5ae80daaa721946420c2df4716ae68ace277d93538149b1d6dddfbc";

// ── Face Detection ─────────────────────────────────────────────────────────────
// Vendored into public/models/ (not fetched from a third-party CDN at runtime):
// a jsdelivr/GitHub-hosted weights CDN can be slow, rate-limited, or blocked by
// a corporate proxy/ad-blocker, which silently breaks face verification for
// anyone behind one. Served locally, this always works offline too.
const FACE_MODEL_URL = "/models";
let _faceModelsLoaded = false;

async function loadFaceModels(onProgress?: (p: number) => void) {
  if (_faceModelsLoaded) return;
  onProgress?.(10);
  if (!faceapi.nets.tinyFaceDetector.isLoaded)
    await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL);
  onProgress?.(35);
  // faceLandmark68TinyNet: used for recognition (.withFaceLandmarks(true))
  if (!faceapi.nets.faceLandmark68TinyNet.isLoaded)
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODEL_URL);
  onProgress?.(60);
  // faceLandmark68Net: FULL 68-point model, required for EAR liveness (.withFaceLandmarks(false))
  if (!faceapi.nets.faceLandmark68Net.isLoaded)
    await faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL);
  onProgress?.(85);
  if (!faceapi.nets.faceRecognitionNet.isLoaded)
    await faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL);
  onProgress?.(100);
  _faceModelsLoaded = true;
}

interface FaceVerifyResult {
  matched: boolean;
  confidence: number; // 0-1
  hasRegisteredFace: boolean;
  noFaceDetected?: boolean;
  livenessCheck?: "passed" | "failed" | "skipped";
  image?: string;
}

// ── TOTP (RFC 6238) — authenticator-app fallback for users who can't use Face ID ──
// Client-side only, matching this app's existing localStorage biometric model.
// Uses Web Crypto (HMAC-SHA1) — the same primitive Google/Microsoft Authenticator
// and Authy use — so no extra dependency is needed for the algorithm itself.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function generateTotpSecret(byteLen = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLen));
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32ToBytes(b32: string): Uint8Array {
  const clean = b32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) bits += BASE32_ALPHABET.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

async function totpCodeAt(secretB32: string, timeMs: number, step = 30, digits = 6): Promise<string> {
  const counter = Math.floor(timeMs / 1000 / step);
  const counterBytes = new ArrayBuffer(8);
  new DataView(counterBytes).setUint32(4, counter); // top 4 bytes stay 0 — safe until year 2106
  const key = await crypto.subtle.importKey("raw", base32ToBytes(secretB32) as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (binCode % 10 ** digits).toString().padStart(digits, "0");
}

// Accepts the previous/current/next 30s step, matching real authenticator-app clock drift tolerance
async function verifyTotp(secretB32: string, input: string): Promise<boolean> {
  const code = input.trim();
  if (!/^\d{6}$/.test(code)) return false;
  const now = Date.now();
  for (const driftMs of [0, -30_000, 30_000]) {
    if (await totpCodeAt(secretB32, now + driftMs) === code) return true;
  }
  return false;
}

function totpUri(secretB32: string, userId: string): string {
  return `otpauth://totp/${encodeURIComponent("ZipPay Bank")}:${encodeURIComponent(userId)}?secret=${secretB32}&issuer=${encodeURIComponent("ZipPay Bank")}&algorithm=SHA1&digits=6&period=30`;
}

// ── Liveness: Eye Aspect Ratio from 68 landmarks ───────────────────────────────
// eye landmark indices (0-indexed) from face-api.js 68-point model
const LEFT_EYE_IDX  = [36, 37, 38, 39, 40, 41];
const RIGHT_EYE_IDX = [42, 43, 44, 45, 46, 47];

function euclidPt(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function eyeAspectRatio(pts: { x: number; y: number }[]): number {
  // EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
  const A = euclidPt(pts[1], pts[5]);
  const B = euclidPt(pts[2], pts[4]);
  const C = euclidPt(pts[0], pts[3]);
  return (A + B) / (2.0 * C + 1e-6);
}

function getEAR(landmarks: faceapi.FaceLandmarks68): number {
  const pts = landmarks.positions;
  const left  = LEFT_EYE_IDX.map(i => pts[i]);
  const right = RIGHT_EYE_IDX.map(i => pts[i]);
  return (eyeAspectRatio(left) + eyeAspectRatio(right)) / 2;
}

// ── Types ─────────────────────────────────────────────────────────────────────
/**
 * Normalise a form-entered mobile to E.164 for the voice-MFA service.
 * The signup form asks for a bare 10-digit Indian number ("9876543210");
 * Vapi needs "+919876543210". A number already carrying a country code is
 * passed through unchanged.
 */
/** Mask a number for display: +919876543210 → ••••3210. */
function maskPhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  return d.length >= 4 ? `••••${d.slice(-4)}` : "••••";
}

function toE164(raw: string, defaultCc = "91"): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.length === 10) return `+${defaultCc}${digits}`;
  // 12 digits starting with the country code, e.g. 919876543210
  if (digits.length > 10 && digits.startsWith(defaultCc)) return `+${digits}`;
  return `+${defaultCc}${digits.slice(-10)}`;
}

interface Account {
  id: string;
  name: string;
  accountNo: string;
  ifsc: string;
  upiId: string;
  avatar: string;
  imeiHash: string;
  color: string;
  /** Customer's own E.164 mobile — the voice-MFA call is placed to this. */
  phone?: string;
}

interface Transaction {
  id: string;
  from: string;
  to: string;
  amount: number;
  type: "credit" | "debit";
  description: string;
  time: Date;
  riskScore: number;
  decision: string;
  category: string;
}

interface DNAEvent {
  id: number;
  time: string;
  level: "info" | "warn" | "alert" | "success" | "block";
  msg: string;
  score?: number;
  decision?: string;
}

type Section = "home" | "transfer" | "upi" | "history" | "profile";
type Decision = "APPROVE" | "STEP_UP" | "HARD_BLOCK";

// ── Demo Accounts ─────────────────────────────────────────────────────────────
// No seeded demo profiles — every account here was created through Register
// and is picked purely by the Customer ID the user types at sign-in.
const ACCOUNTS: Account[] = [];

const INITIAL_BALANCES: Record<string, number> = {};

// Opening balance credited to a newly registered account.
const OPENING_BALANCE = 25000;

// ── Balance / history persistence ─────────────────────────────────────────────
// Registered accounts persist under "registered_accounts", but their money did
// not: balances and history lived only in React state, so on the next visit
// `balances[id] ?? 0` rendered ₹0 with an empty history, and any debit computed
// `undefined - amount` → ₹NaN. Both maps are now stored alongside the accounts.
const BALANCES_KEY = "zippay_balances";
const TXNS_KEY = "zippay_txn_history";

function loadBalances(): Record<string, number> {
  try {
    const saved = localStorage.getItem(BALANCES_KEY);
    return saved ? { ...INITIAL_BALANCES, ...JSON.parse(saved) } : { ...INITIAL_BALANCES };
  } catch {
    return { ...INITIAL_BALANCES };
  }
}

function loadTxnHistory(): Record<string, Transaction[]> {
  try {
    const saved = localStorage.getItem(TXNS_KEY);
    if (!saved) return {};
    const parsed: Record<string, (Omit<Transaction, "time"> & { time: string })[]> = JSON.parse(saved);
    const revived: Record<string, Transaction[]> = {};
    for (const [id, rows] of Object.entries(parsed)) {
      // JSON has no Date type — revive so `.toLocaleTimeString()` still works.
      revived[id] = rows.map(r => ({ ...r, time: new Date(r.time) }));
    }
    return revived;
  } catch {
    return {};
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
let _eid = 0;
function mkEvent(level: DNAEvent["level"], msg: string, score?: number, decision?: string): DNAEvent {
  return {
    id: ++_eid,
    time: new Date().toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    level, msg, score, decision,
  };
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function fmtINR(amount: number) {
  if (!Number.isFinite(amount)) return "₹0";
  return "₹" + amount.toLocaleString("en-IN");
}

// `Transaction.category` holds an emoji (it doubled as the row avatar). Map it
// to a real icon so the ledger stops rendering emoji as UI.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "🛒": ShoppingBag,
  "💼": Briefcase,
  "🍔": UtensilsCrossed,
  "🍕": UtensilsCrossed,
  "💳": CreditCard,
  "⚡": Zap,
  "💻": Laptop,
  "📱": Smartphone,
  "💸": Send,
};

function txnIconFor(txn: Transaction): LucideIcon {
  return CATEGORY_ICONS[txn.category] ?? (txn.type === "credit" ? ArrowDownLeft : Wallet);
}

// Synthetic legit signal bundle for evaluation
function makeLegitBundle(userId: string, sessionId: string) {
  const now = Date.now();
  const ks: object[] = [];
  let t = now;
  for (let i = 0; i < 30; i++) {
    const dwell = 84 + (Math.random() - 0.5) * 18;
    const flight = 130 + (Math.random() - 0.5) * 32;
    ks.push({ eventType: "keydown", timestamp: t, key: "ALPHA", dwellTime: dwell, flightTime: flight });
    ks.push({ eventType: "keyup", timestamp: t + dwell, key: "ALPHA", dwellTime: dwell, flightTime: flight });
    t += dwell + flight;
  }
  const mouse = Array.from({ length: 70 }, (_, i) => ({
    x: 400 + Math.sin(i * 0.14) * 100, y: 350 + Math.cos(i * 0.18) * 60,
    velocity: 2.5 + (Math.random() - 0.5) * 0.7,
    eventType: "move", timestamp: now + i * 75,
  }));
  return {
    sessionId, userId, channel: "internet_banking",
    keystroke_events: ks, mouse_events: mouse, touch_events: [], navigation_events: [],
    environment: { screenShareActive: false, clipboardSource: "typed", tabVisible: true, deviceType: "desktop", userAgent: navigator.userAgent, screenResolution: `${window.screen.width}x${window.screen.height}` },
    timestampMs: now,
  };
}

function makeCoercionBundle(userId: string, sessionId: string) {
  const now = Date.now();
  const ks: object[] = [];
  let t = now;
  for (let i = 0; i < 20; i++) {
    const hesitation = i % 3 === 0;
    const dwell = 93 + (Math.random() - 0.5) * 16;
    const flight = hesitation ? 950 + Math.random() * 1300 : 135 + (Math.random() - 0.5) * 38;
    ks.push({ eventType: "keydown", timestamp: t, key: "ALPHA", dwellTime: dwell, flightTime: flight });
    ks.push({ eventType: "keyup", timestamp: t + dwell, key: "ALPHA", dwellTime: dwell, flightTime: flight });
    t += dwell + flight;
  }
  return {
    sessionId, userId, channel: "internet_banking",
    keystroke_events: ks,
    mouse_events: Array.from({ length: 40 }, (_, i) => ({ x: 310 + Math.sin(i * 0.09) * 55, y: 405, velocity: 0.85 + Math.random() * 0.5, eventType: "move", timestamp: now + i * 210 })),
    touch_events: [], navigation_events: [],
    environment: { screenShareActive: true, clipboardSource: "pasted", tabVisible: false, deviceType: "desktop", userAgent: navigator.userAgent, screenResolution: `${window.screen.width}x${window.screen.height}` },
    timestampMs: now,
  };
}

function makeVishingBundle(userId: string, sessionId: string, ch: string) {
  const now = Date.now();
  const ks: object[] = [];
  let t = now;
  for (let i = 0; i < 25; i++) {
    const hesitation = i % 2 === 0;
    const dwell = 120 + Math.random() * 40;
    const flight = hesitation ? 1800 + Math.random() * 1200 : 160 + Math.random() * 50;
    ks.push({ eventType: "keydown", timestamp: t, key: "ALPHA", dwellTime: dwell, flightTime: flight });
    ks.push({ eventType: "keyup", timestamp: t + dwell, key: "ALPHA", dwellTime: dwell, flightTime: flight });
    t += dwell + flight;
  }
  return {
    sessionId, userId, channel: ch,
    keystroke_events: ks,
    mouse_events: Array.from({ length: 30 }, (_, i) => ({ x: 300 + Math.sin(i * 0.1) * 100, y: 400 + Math.cos(i * 0.1) * 80, velocity: 0.5 + Math.random() * 0.3, eventType: "move", timestamp: now + i * 250 })),
    touch_events: [], navigation_events: [],
    environment: { screenShareActive: true, clipboardSource: "pasted", tabVisible: false, deviceType: ch === "internet_banking" ? "desktop" : "mobile" },
    timestampMs: now,
  };
}

function makeOtpMuleBundle(userId: string, sessionId: string, ch: string) {
  const now = Date.now();
  const ks: object[] = [];
  let t = now;
  for (let i = 0; i < 30; i++) {
    const dwell = 45 + Math.random() * 10;
    const flight = 60 + Math.random() * 20;
    ks.push({ eventType: "keydown", timestamp: t, key: "ALPHA", dwellTime: dwell, flightTime: flight });
    ks.push({ eventType: "keyup", timestamp: t + dwell, key: "ALPHA", dwellTime: dwell, flightTime: flight });
    t += dwell + flight;
  }
  return {
    sessionId, userId, channel: ch,
    keystroke_events: ks,
    mouse_events: Array.from({ length: 50 }, (_, i) => ({ x: 500 + i * 5, y: 300, velocity: 4.5, eventType: "move", timestamp: now + i * 50 })),
    touch_events: [], navigation_events: [],
    environment: { screenShareActive: false, clipboardSource: "typed", tabVisible: true, deviceType: "mobile", screenResolution: "390x844" },
    timestampMs: now,
  };
}

function makeBotBundle(userId: string, sessionId: string, ch: string) {
  const now = Date.now();
  const ks: object[] = [];
  let t = now;
  for (let i = 0; i < 40; i++) {
    ks.push({ eventType: "keydown", timestamp: t, key: "ALPHA", dwellTime: 50, flightTime: 100 });
    ks.push({ eventType: "keyup", timestamp: t + 50, key: "ALPHA", dwellTime: 50, flightTime: 100 });
    t += 150;
  }
  return {
    sessionId, userId, channel: ch,
    keystroke_events: ks, mouse_events: [], touch_events: [], navigation_events: [],
    environment: { screenShareActive: false, clipboardSource: "pasted", tabVisible: true, deviceType: ch === "internet_banking" ? "desktop" : "mobile" },
    timestampMs: now,
  };
}

// ── DNA Risk Arc (reused) ──────────────────────────────────────────────────────
function RiskArc({ score, decision }: { score: number; decision: Decision | null }) {
  const clamp = Math.max(0, Math.min(1000, score));
  const r = 40, cx = 50, cy = 50;
  const circ = 2 * Math.PI * r;
  const arc = circ * 0.75;
  const fill = arc * (clamp / 1000);
  const col = decision === "HARD_BLOCK" ? "#B3261E" : decision === "STEP_UP" ? "#B7791F" : decision === "APPROVE" ? "#3D8B5A" : "rgba(16, 15, 15,0.15)";
  return (
    <svg width={100} height={76} viewBox="0 0 100 76">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(16, 15, 15,0.07)" strokeWidth={8}
        strokeDasharray={`${arc} ${circ - arc}`} strokeDashoffset={-circ * 0.125}
        strokeLinecap="round" transform={`rotate(-225 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={col} strokeWidth={8}
        strokeDasharray={`${fill} ${circ - fill}`} strokeDashoffset={-circ * 0.125}
        strokeLinecap="round" transform={`rotate(-225 ${cx} ${cy})`}
        style={{ transition: "stroke-dasharray 0.7s ease, stroke 0.4s" }} />
      <text x={cx} y={cy - 3} textAnchor="middle" fill="#100F0F" fontSize={22} fontWeight={400} fontFamily="'Newsreader', Georgia, serif">{clamp}</text>
      <text x={cx} y={cy + 11} textAnchor="middle" fill="#969290" fontSize={7} fontFamily="'DM Mono',monospace">/1000</text>
    </svg>
  );
}

// ── Citadel Panel ──────────────────────────────────────────────────────────
function DNAPanel({
  open, onClose, events, riskScore, decision, signals, coercionProbability, onChain,
  onRunScenario, onExportPDF, onDownloadPassport, downloadingPassport,
  rhythms, riskHistory, aiInvestigating, aiTypewriterText, onTriggerAI, activeScenario,
  threatScore,
  inSessionRATSim, setInSessionRATSim,
  inSessionHandoverSim, setInSessionHandoverSim,
  identityDriftIndex,
  pqcVerified, pqcAlgorithm,
}: {
  open: boolean;
  onClose: () => void;
  events: DNAEvent[];
  riskScore: number;
  decision: Decision | null;
  signals: { ks: number; mouse: number; touch: number };
  coercionProbability: number;
  onChain: boolean;
  onRunScenario: (s: "simswap" | "coercion" | "vishing" | "otpmule" | "bot" | "bgpproxy" | "geodrift") => void;
  onExportPDF: () => void;
  onDownloadPassport: () => Promise<void>;
  downloadingPassport: boolean;
  rhythms: number[];
  riskHistory: number[];
  aiInvestigating: boolean;
  aiTypewriterText: string;
  onTriggerAI: () => void;
  activeScenario: string | null;
  threatScore: number;
  inSessionRATSim: boolean;
  setInSessionRATSim: (v: boolean) => void;
  inSessionHandoverSim: boolean;
  setInSessionHandoverSim: (v: boolean) => void;
  identityDriftIndex: number;
  pqcVerified?: boolean;
  pqcAlgorithm?: string | null;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [events]);

  const decCol = decision === "HARD_BLOCK" ? "#B3261E" : decision === "STEP_UP" ? "#B7791F" : decision === "APPROVE" ? "#3D8B5A" : "rgba(16, 15, 15,0.2)";

  // 5-layer security checks — Network / IMEI: FAIL on block/alert, PASS on approve
  const imeiFailed = decision === "HARD_BLOCK" && !onChain;
  const imeiPassed = onChain || (riskScore > 0 && decision !== "HARD_BLOCK");
  const netFailed = activeScenario === "bgpproxy" || activeScenario === "geodrift" || imeiFailed;
  const secLayers = [
    { label: "Keystroke Dynamics", icon: "", done: signals.ks > 5,  failed: false },
    { label: "Mouse Biometrics",   icon: "", done: signals.mouse > 20, failed: false },
    { label: "Behavioral Model",   icon: "", done: riskScore > 0,  failed: false },
    { label: "Network & IMEI Layer", icon: "", done: imeiPassed && !netFailed, failed: netFailed },
    { label: "Decision Engine",    icon: "", done: !!decision,     failed: false },
  ];

  // Radar chart data for Behavioral Passport
  const radarDimensions = [
    { label: "Typing",   value: Math.min(100, signals.ks * 4) },
    { label: "Mouse",    value: Math.min(100, signals.mouse * 0.5) },
    { label: "Tempo",    value: riskScore > 0 ? Math.max(0, 100 - riskScore / 10) : 50 },
    { label: "Rhythm",   value: coercionProbability > 0 ? Math.max(0, 100 - coercionProbability * 100) : 70 },
    { label: "Device",   value: imeiPassed ? 90 : imeiFailed ? 10 : 40 },
  ];
  const radarPoints = radarDimensions.map((d, i) => {
    const angle = (i / radarDimensions.length) * 2 * Math.PI - Math.PI / 2;
    const r = (d.value / 100) * 38;
    return { x: 50 + r * Math.cos(angle), y: 50 + r * Math.sin(angle) };
  });
  const radarBgPoints = radarDimensions.map((_, i) => {
    const angle = (i / radarDimensions.length) * 2 * Math.PI - Math.PI / 2;
    return { x: 50 + 38 * Math.cos(angle), y: 50 + 38 * Math.sin(angle) };
  });
  const toPath = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + "Z";

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }}
          transition={{ type: "spring", damping: 28, stiffness: 260 }}
          style={{
            position: "fixed", top: 0, right: 0, bottom: 0, width: 400, maxWidth: "100vw", zIndex: 160,
            background: "#FFFFFF", borderLeft: "1px solid #EAE4E1",
            display: "flex", flexDirection: "column", boxShadow: "-10px 0 30px rgba(0,0,0,0.05)",
            fontFamily: "'Inter', sans-serif",
            color: "#100F0F",
          }}>
          {/* Header */}
          <div style={{ padding: "18px 20px", borderBottom: "1px solid #EAE4E1", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 2.2 }}
              style={{ width: 8, height: 8, borderRadius: "50%", background: "#3D8B5A", boxShadow: "none" }} />
            <span style={{ fontSize: 24, fontWeight: 400, color: "#100F0F", fontFamily: "'Newsreader', Georgia, serif", letterSpacing: "-0.01em" }}>Citadel Shield</span>
            <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "#767270", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12, background: "#FBF9F8" }}>

            {/* ── 5-Layer Security Visualization ── */}
            <div style={{ borderRadius: 14, background: "#FFFFFF", border: "1px solid #EAE4E1", padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, color: "#767270", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 8 }}>5-LAYER SECURITY CHECK</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {secLayers.map((layer, i) => (
                  <div key={layer.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <motion.div
                      animate={layer.failed
                        ? { scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }
                        : layer.done
                          ? { scale: [1, 1.2, 1], opacity: 1 }
                          : { opacity: 0.3 }
                      }
                      transition={{ duration: layer.failed ? 1.2 : 0.4, repeat: layer.failed ? Infinity : 0, delay: i * 0.1 }}
                      style={{
                        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                        background: layer.failed ? "#B3261E" : layer.done ? "#3D8B5A" : "rgba(16, 15, 15,0.1)",
                        boxShadow: layer.failed ? "none" : layer.done ? "0 0 8px #3D8B5A" : "none",
                      }}
                    />
                    <span style={{ fontSize: 11.5, color: layer.failed ? "#B3261E" : layer.done ? "#2A2726" : "#767270", fontFamily: "'DM Mono',monospace", flex: 1 }}>{layer.label}</span>
                    <span style={{ fontSize: 10.5, color: layer.failed ? "#B3261E" : layer.done ? "#3D8B5A" : "#767270", fontFamily: "'DM Mono',monospace", fontWeight: layer.failed ? 700 : 400 }}>
                      {layer.failed ? "✗ FAIL" : layer.done ? "✓ PASS" : "··· WAIT"}
                    </span>
                  </div>
                ))}

                {/* 🔮 PQC Row — CRYSTALS-Dilithium-3 quantum-resistant signature */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(170, 65, 42,0.15)" }}>
                  <motion.div
                    animate={pqcVerified ? { scale: [1, 1.3, 1], opacity: 1 } : { opacity: 0.35 }}
                    transition={{ duration: 0.6 }}
                    style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: pqcVerified ? "#8E5BA8" : "rgba(16, 15, 15,0.1)",
                      boxShadow: pqcVerified ? "none" : "none",
                    }}
                  />
                  <span style={{ fontSize: 11.5, fontFamily: "'DM Mono',monospace", flex: 1, color: pqcVerified ? "#8E5BA8" : "#767270" }}>
                    {pqcAlgorithm ?? "Dilithium-3"} · PQC
                  </span>
                  <span style={{
                    fontSize: 10.5, fontFamily: "'DM Mono',monospace", fontWeight: 700,
                    color: pqcVerified ? "#8E5BA8" : riskScore > 0 ? "#5E5956" : "#767270",
                    background: pqcVerified ? "rgba(192,132,252,0.12)" : "transparent",
                    borderRadius: 4, padding: pqcVerified ? "1px 5px" : 0,
                    border: pqcVerified ? "1px solid rgba(192,132,252,0.3)" : "none",
                  }}>
                    {pqcVerified ? "PQC-SECURED" : riskScore > 0 ? "ENROLLING" : "··· WAIT"}
                  </span>
                </div>

              </div>
            </div>

            {/* ── Score Columns ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {/* ── Risk Gauge ── */}
              <div style={{ borderRadius: 12, background: "#FFFFFF", border: `1px solid ${decision ? decCol + "30" : "rgba(0,0,0,0.08)"}`, padding: "10px", display: "flex", flexDirection: "column", alignItems: "center", boxShadow: decision === "HARD_BLOCK" ? "none" : "none", transition: "all 0.5s" }}>
                <div style={{ fontSize: 10, color: "#767270", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 6 }}>LIVE RISK</div>
                <RiskArc score={riskScore} decision={decision} />
                {decision && (
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", fontFamily: "'DM Mono',monospace", color: decCol, background: `${decCol}15`, border: `1px solid ${decCol}35`, borderRadius: 20, padding: "1px 8px", marginTop: 4 }}>
                    {decision.replace("_", " ")}
                  </div>
                )}
              </div>

              {/* ── Threat Gauge ── */}
              <div style={{ borderRadius: 14, background: "#FFFFFF", border: "1px solid #EAE4E1", padding: "10px", display: "flex", flexDirection: "column", alignItems: "center", transition: "all 0.5s" }}>
                <div style={{ fontSize: 10, color: "#767270", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 6 }}>THREAT INDEX</div>
                <div style={{ position: "relative", width: 70, height: 50, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", marginTop: 4 }}>
                  <svg width={70} height={45} viewBox="0 0 70 45">
                    <path d="M 10 40 A 25 25 0 0 1 60 40" fill="none" stroke="rgba(16, 15, 15,0.08)" strokeWidth={5} strokeLinecap="round" />
                    <path d="M 10 40 A 25 25 0 0 1 60 40" fill="none" stroke={threatScore < 30 ? "#3D8B5A" : threatScore < 60 ? "#B7791F" : "#B3261E"} strokeWidth={5} strokeLinecap="round" strokeDasharray={`${(threatScore / 100) * 78.5} 78.5`} style={{ transition: "stroke-dasharray 0.5s" }} />
                  </svg>
                  <span style={{ position: "absolute", bottom: -2, fontSize: 13, fontWeight: 800, color: "#100F0F", fontFamily: "'DM Mono',monospace" }}>{threatScore}%</span>
                </div>
                <span style={{ fontSize: 10.5, color: "#767270", fontFamily: "'DM Mono',monospace", marginTop: 4 }}>
                  {threatScore < 30 ? "SECURE" : threatScore < 60 ? "SUSPICIOUS" : "DANGER"}
                </span>
              </div>
            </div>

            {/* ── Live Biometric Waveform ── */}
            <div style={{ borderRadius: 14, background: "#FFFFFF", border: "1px solid #EAE4E1", padding: "8px 12px" }}>
              <div style={{ fontSize: 10.5, color: "#767270", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 6 }}>LIVE BEHAVIORAL WAVEFORM</div>
              <svg width="100%" height={42} viewBox={`0 0 ${rhythms.length * 15} 60`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="waveGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.1" />
                    <stop offset="100%" stopColor="#3D8B5A" stopOpacity="0.9" />
                  </linearGradient>
                </defs>
                <polyline
                  points={rhythms.map((v, i) => `${i * 15},${60 - v}`).join(" ")}
                  fill="none" stroke="url(#waveGrad)" strokeWidth={2} strokeLinejoin="round"
                />
                {rhythms.map((v, i) => (
                  i === rhythms.length - 1 && (
                    <circle key={i} cx={i * 15} cy={60 - v} r={3} fill="#3D8B5A" style={{ filter: "drop-shadow(0 0 4px #3D8B5A)" }} />
                  )
                ))}
              </svg>
            </div>

            {/* ── Risk Score Sparkline (60s timeline) ── */}
            {riskHistory.length > 1 && (
              <div style={{ borderRadius: 14, background: "#FFFFFF", border: "1px solid #EAE4E1", padding: "8px 12px" }}>
                <div style={{ fontSize: 10.5, color: "#767270", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 6 }}>RISK TIMELINE (60s)</div>
                <svg width="100%" height={36} viewBox={`0 0 ${Math.max(riskHistory.length - 1, 1) * 5} 40`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#B3261E" stopOpacity="0.6" />
                      <stop offset="100%" stopColor="#B3261E" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <polygon
                    points={[...riskHistory.map((v, i) => `${i * 5},${40 - (v / 1000) * 40}`), `${(riskHistory.length - 1) * 5},40`, `0,40`].join(" ")}
                    fill="url(#riskGrad)"
                  />
                  <polyline
                    points={riskHistory.map((v, i) => `${i * 5},${40 - (v / 1000) * 40}`).join(" ")}
                    fill="none" stroke={decCol} strokeWidth={1.5}
                  />
                </svg>
              </div>
            )}

            {/* ── Behavioral Passport (Radar) ── */}
            <div style={{ borderRadius: 14, background: "#FFFFFF", border: "1px solid #EAE4E1", padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, color: "#767270", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 8 }}>BEHAVIORAL PASSPORT</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <svg width={100} height={100} viewBox="0 0 100 100">
                  {/* Grid circles */}
                  {[0.25, 0.5, 0.75, 1].map(r => (
                    <circle key={r} cx={50} cy={50} r={38 * r} fill="none" stroke="rgba(16, 15, 15,0.08)" strokeWidth={0.5} />
                  ))}
                  {/* Axis lines */}
                  {radarBgPoints.map((p, i) => (
                    <line key={i} x1={50} y1={50} x2={p.x} y2={p.y} stroke="rgba(16, 15, 15,0.08)" strokeWidth={0.5} />
                  ))}
                  {/* Filled area */}
                  <path d={toPath(radarPoints)} fill="rgba(170, 65, 42,0.2)" stroke="var(--color-primary)" strokeWidth={1.5} />
                  {/* Labels */}
                  {radarBgPoints.map((p, i) => {
                    const lx = 50 + (p.x - 50) * 1.3;
                    const ly = 50 + (p.y - 50) * 1.3;
                    return <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill="rgba(20, 19, 19,0.6)" fontSize={6} fontFamily="'DM Mono',monospace">{radarDimensions[i].label}</text>;
                  })}
                </svg>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                  {radarDimensions.map(d => (
                    <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 10, color: "#575452", minWidth: 36, fontFamily: "'DM Mono',monospace" }}>{d.label}</span>
                      <div style={{ flex: 1, height: 2, background: "rgba(16, 15, 15,0.06)", borderRadius: 1 }}>
                        <div style={{ height: "100%", width: `${d.value}%`, background: "var(--color-primary)", borderRadius: 1, transition: "width 0.6s" }} />
                      </div>
                      <span style={{ fontSize: 10, color: "var(--color-primary)", fontFamily: "'DM Mono',monospace", minWidth: 24, textAlign: "right" }}>{d.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Thresholds */}
            <div style={{ display: "flex", gap: 4 }}>
              {[{ l: "APPROVE", r: "0–299", c: "#3D8B5A" }, { l: "STEP UP", r: "300–599", c: "#B7791F" }, { l: "BLOCK", r: "600+", c: "#B3261E" }].map(t => (
                <div key={t.l} style={{ flex: 1, padding: "4px 4px", borderRadius: 6, textAlign: "center", background: `${t.c}12`, border: `1px solid ${t.c}30` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: t.c, fontFamily: "'DM Mono',monospace" }}>{t.l}</div>
                  <div style={{ fontSize: 10, color: "#767270", fontFamily: "'DM Mono',monospace" }}>{t.r}</div>
                </div>
              ))}
            </div>

            {/* Signal Counts */}
            <div style={{ borderRadius: 14, background: "#FFFFFF", border: "1px solid #EAE4E1", padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, color: "#767270", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 8 }}>SIGNALS CAPTURED</div>
              {[{ icon: "", label: "Keystrokes", count: signals.ks, col: "var(--color-primary)", max: 150 }, { icon: "", label: "Mouse events", count: signals.mouse, col: "#34d399", max: 400 }, { icon: "", label: "Touch events", count: signals.touch, col: "#f9a8d4", max: 50 }].map(s => (
                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 12 }}>{s.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 11.5, color: "#767270" }}>{s.label}</span>
                      <span style={{ fontSize: 11.5, color: s.col, fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>{s.count}</span>
                    </div>
                    <div style={{ height: 2, background: "rgba(16, 15, 15,0.06)", borderRadius: 1 }}>
                      <div style={{ height: "100%", borderRadius: 1, background: s.col, width: `${Math.min((s.count / s.max) * 100, 100)}%`, transition: "width 0.4s" }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Coercion bar */}
            <AnimatePresence>
              {coercionProbability > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  style={{ borderRadius: 10, background: "rgba(183, 121, 31,0.06)", border: "1px solid rgba(183, 121, 31,0.15)", padding: "9px 12px", overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 10.5, color: "rgba(183, 121, 31,0.7)", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>COERCION PROB.</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#B7791F", fontFamily: "'DM Mono',monospace" }}>{Math.round(coercionProbability * 100)}%</span>
                  </div>
                  <div style={{ height: 3, background: "rgba(16, 15, 15,0.06)", borderRadius: 2 }}>
                    <div style={{ height: "100%", borderRadius: 2, background: "linear-gradient(90deg,#B7791F,#B3261E)", width: `${coercionProbability * 100}%`, transition: "width 0.7s" }} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* On-chain badge */}
            <AnimatePresence>
              {onChain && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  style={{ borderRadius: 8, padding: "7px 10px", background: "rgba(61, 139, 90,0.05)", border: "1px solid rgba(61, 139, 90,0.15)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13 }}></span>
                  <span style={{ fontSize: 11.5, color: "#3D8B5A", fontFamily: "'DM Mono',monospace" }}>Verified on Hyperledger Fabric</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Event Log */}
            <div style={{ borderRadius: 14, background: "#FFFFFF", border: "1px solid #EAE4E1", padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, color: "#767270", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 8 }}>ACTIVITY LOG</div>
              <div ref={logRef} style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                <AnimatePresence initial={false}>
                  {events.map(ev => {
                    const dot = ev.level === "block" ? "#B3261E" : ev.level === "alert" ? "#B7791F" : ev.level === "warn" ? "#B7791F" : ev.level === "success" ? "#3D8B5A" : "#2C7A91";
                    const txt = ev.level === "block" ? "#C9605A" : ev.level === "alert" ? "#fde047" : ev.level === "success" ? "#86efac" : ev.level === "warn" ? "#fdba74" : "rgba(20, 19, 19,0.88)";
                    return (
                      <motion.div key={ev.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                        style={{ display: "flex", gap: 5, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 10, color: "#767270", marginTop: 3, flexShrink: 0, minWidth: 52, fontFamily: "'DM Mono',monospace" }}>{ev.time}</span>
                        <span style={{ width: 4, height: 4, borderRadius: "50%", background: dot, flexShrink: 0, marginTop: 4, boxShadow: `0 0 3px ${dot}` }} />
                        <span style={{ fontSize: 11.5, color: txt, lineHeight: 1.5, fontFamily: "'DM Mono',monospace", wordBreak: "break-word" }}>{ev.msg}</span>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                {events.length === 0 && <div style={{ fontSize: 11.5, color: "#969290", fontFamily: "'DM Mono',monospace", fontStyle: "italic" }}>Awaiting activity…</div>}
              </div>
            </div>

            {/* ── Attack Scenario Buttons (5 scenarios) ── */}
            <div style={{ borderRadius: 10, border: "1px solid #EAE4E1", padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, color: "#767270", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 8 }}>ATTACK SIMULATION LAB</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {([
                  { type: "simswap",  label: "SIM-Swap Attack",       icon: "", col: "#B3261E" },
                  { type: "coercion", label: "Coercion Victim",       icon: "", col: "#B7791F" },
                  { type: "vishing",  label: "Vishing Fraud Call",    icon: "", col: "#B7791F" },
                  { type: "otpmule",  label: "OTP Mule Device",       icon: "", col: "#8E5BA8" },
                  { type: "bot",      label: "Bot/Script Stuffing",   icon: "", col: "var(--color-primary)" },
                  { type: "bgpproxy", label: "AWS BGP Proxy",         icon: "", col: "#2C7A91" },
                  { type: "geodrift", label: "Impossible Travel",     icon: "", col: "#B5527A" },
                ] as const).map(({ type, label, icon, col }) => (
                  <motion.button
                    key={type}
                    onClick={() => onRunScenario(type)}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    style={{
                      padding: "7px 10px", borderRadius: 8,
                      border: `1px solid ${activeScenario === type ? col + "60" : col + "25"}`,
                      background: activeScenario === type ? `${col}18` : `${col}06`,
                      color: col, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      textAlign: "left", transition: "all 0.2s", display: "flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <span>{icon}</span>
                    <span>{label}</span>
                    {activeScenario === type && <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.6, fontFamily: "'DM Mono',monospace" }}>ACTIVE</span>}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* ── AI Fraud Investigator ── */}
            <div style={{ borderRadius: 10, border: "1px solid rgba(170, 65, 42,0.2)", padding: "10px 12px", background: "#FFFFFF" }}>
              <div style={{ fontSize: 10.5, color: "#767270", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 8 }}>AI FRAUD INVESTIGATOR</div>
              <motion.button
                onClick={onTriggerAI}
                disabled={aiInvestigating}
                whileHover={{ scale: aiInvestigating ? 1 : 1.01 }}
                whileTap={{ scale: 0.97 }}
                style={{
                  width: "100%", padding: "9px 10px", borderRadius: 8,
                  border: "1px solid rgba(91, 91, 168,0.3)", background: aiInvestigating ? "rgba(91, 91, 168,0.05)" : "rgba(91, 91, 168,0.1)",
                  color: aiInvestigating ? "rgba(91, 91, 168,0.4)" : "var(--color-primary)",
                  fontSize: 12.5, fontWeight: 700, cursor: aiInvestigating ? "wait" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 6,
                }}
              >
                {aiInvestigating ? (
                  <><motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ display: "inline-block" }}>⟳</motion.span> Analyzing session…</>
                ) : "Run AI Investigation"}
              </motion.button>
              {aiTypewriterText && (
                <div style={{
                  padding: "8px 10px", borderRadius: 8, background: "#FFFFFF",
                  border: "1px solid #EAE4E1", fontSize: 11.5, color: "#100F0F",
                  fontFamily: "'DM Mono',monospace", lineHeight: 1.7, maxHeight: 160,
                  overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {aiTypewriterText}<motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.6 }}>▊</motion.span>
                </div>
              )}
            </div>

            {/* ── Continuous In-Session Telemetry ── */}
            <div style={{ borderRadius: 10, background: "#FFFFFF", border: "1px solid rgba(170, 65, 42,0.16)", padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 10.5, color: "#0891b2", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>IN-SESSION TELEMETRY
                </div>
                <span style={{ fontSize: 10, background: "rgba(16, 15, 15,0.06)", borderRadius: 10, padding: "1px 6px", color: "var(--color-primary)", fontFamily: "'DM Mono',monospace", fontWeight: "bold" }}>
                  ACTIVE
                </span>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11.5, color: "#767270" }}>Identity Drift</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: identityDriftIndex > 60 ? "#B3261E" : identityDriftIndex > 30 ? "#B7791F" : "#3D8B5A", fontFamily: "'DM Mono',monospace" }}>
                    {identityDriftIndex}% {identityDriftIndex >= 85 ? "DRIFT EXCEEDED" : ""}
                  </span>
                </div>
                <div style={{ height: 4, background: "rgba(16, 15, 15,0.06)", borderRadius: 2 }}>
                  <div style={{
                    height: "100%", borderRadius: 2,
                    background: identityDriftIndex > 60 ? "linear-gradient(90deg,#B7791F,#B3261E)" : "linear-gradient(90deg,#3D8B5A,#2C7A91)",
                    width: `${identityDriftIndex}%`, transition: "width 0.3s ease"
                  }} />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                  <span style={{ fontSize: 11.5, color: "#575452" }}>Simulate Remote RAT Hijack</span>
                  <input type="checkbox" checked={inSessionRATSim} onChange={(e) => { setInSessionRATSim(e.target.checked); if (e.target.checked) setInSessionHandoverSim(false); }} style={{ cursor: "pointer" }} />
                </label>
                <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                  <span style={{ fontSize: 11.5, color: "#575452" }}>Simulate Device Handover</span>
                  <input type="checkbox" checked={inSessionHandoverSim} onChange={(e) => { setInSessionHandoverSim(e.target.checked); if (e.target.checked) setInSessionRATSim(false); }} style={{ cursor: "pointer" }} />
                </label>
              </div>
            </div>

            {/* Export PDF */}
            <button onClick={onExportPDF} style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1px solid rgba(61, 139, 90,0.3)", background: "rgba(61, 139, 90,0.08)", color: "#3D8B5A", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s" }}>Download Security PDF Report
            </button>

            {/* Biometric Passport PDF */}
            <button
              onClick={onDownloadPassport}
              disabled={downloadingPassport}
              style={{
                width: "100%", padding: "11px", borderRadius: 10, marginTop: 8,
                border: "1px solid rgba(170, 65, 42,0.5)",
                background: downloadingPassport
                  ? "rgba(170, 65, 42,0.05)"
                  : "linear-gradient(135deg, rgba(170, 65, 42,0.15), rgba(170, 65, 42,0.08))",
                color: downloadingPassport ? "rgba(170, 65, 42,0.5)" : "var(--color-primary)",
                fontSize: 13, fontWeight: 700,
                cursor: downloadingPassport ? "wait" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                transition: "all 0.3s",
                boxShadow: downloadingPassport ? "none" : "0 6px 18px rgba(0,0,0,0.4)",
                position: "relative", overflow: "hidden",
              }}
            >
              {downloadingPassport ? (
                <>
                  <span style={{ fontSize: 13, animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
                  Generating Passport PDF…
                </>
              ) : (
                <>Download Biometric DNA Passport
                </>
              )}
            </button>

          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ── Face ID viewfinder — shared "premium scanner" chrome for enrollment + verify ──
// Rounded-square frame with independent corner brackets (the Face ID glyph shape)
// instead of a dashed oval; a thin scan-line sweeps only while a detection is
// actually in flight, so busy state is always visible instead of silent.
function FaceScanFrame({
  videoRef, state, statusLabel, minHeight = 220, children,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  state: "idle" | "present" | "busy" | "success" | "error";
  statusLabel?: string;
  minHeight?: number;
  children?: React.ReactNode;
}) {
  const accent =
    state === "success" ? "#3D8B5A" :
    state === "error" ? "#B3261E" :
    state === "present" || state === "busy" ? "var(--color-primary)" :
    "rgba(16, 15, 15,0.18)";
  const corner = (top: boolean, left: boolean): React.CSSProperties => ({
    position: "absolute", width: 22, height: 22,
    top: top ? 14 : undefined, bottom: !top ? 14 : undefined,
    left: left ? 14 : undefined, right: !left ? 14 : undefined,
    borderTop: top ? `2.5px solid ${accent}` : "none",
    borderBottom: !top ? `2.5px solid ${accent}` : "none",
    borderLeft: left ? `2.5px solid ${accent}` : "none",
    borderRight: !left ? `2.5px solid ${accent}` : "none",
    borderRadius: top ? (left ? "10px 0 0 0" : "0 10px 0 0") : (left ? "0 0 0 10px" : "0 0 10px 0"),
    transition: "border-color 0.35s ease", pointerEvents: "none",
  });
  return (
    <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", background: "#000", marginBottom: 12, minHeight, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)" }}>
      <video ref={videoRef} muted playsInline style={{ width: "100%", display: "block", transform: "scaleX(-1)" }} />
      <div style={corner(true, true)} /><div style={corner(true, false)} /><div style={corner(false, true)} /><div style={corner(false, false)} />
      {state === "busy" && (
        <motion.div
          initial={{ top: "10%", opacity: 0 }} animate={{ top: ["10%", "90%", "10%"], opacity: 1 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          style={{ position: "absolute", left: 12, right: 12, height: 2, borderRadius: 2, background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, boxShadow: `0 0 10px ${accent}` }}
        />
      )}
      {statusLabel && (
        <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 8px", borderRadius: 20, background: "rgba(255, 255, 255,0.6)", backdropFilter: "blur(8px)", border: `1px solid ${accent}55` }}>
          {state === "busy" ? (
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }} style={{ display: "flex" }}><Loader2 size={12} color={accent} /></motion.div>
          ) : state === "present" || state === "success" ? <CheckCircle2 size={12} color={accent} />
            : state === "error" ? <XCircle size={12} color={accent} />
            : <ScanFace size={12} color="rgba(16, 15, 15,0.55)" />}
          <span style={{ fontSize: 10, fontWeight: 600, color: "#100F0F", letterSpacing: "-0.01em" }}>{statusLabel}</span>
        </div>
      )}
      {children}
    </div>
  );
}

// ── FaceEnrollment Component (Registration Step 3) ────────────────────────────
function FaceEnrollment({ userId, onDone, onUseAuthenticator }: { userId: string; onDone: (skipped: boolean) => void; onUseAuthenticator?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"loading" | "camera" | "capturing" | "captured" | "error">("loading");
  const [progress, setProgress] = useState(0);
  const [facePresent, setFacePresent] = useState(false);
  const [capturedImg, setCapturedImg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const detIntervalRef = useRef<any>(null);
  const capturingRef = useRef(false);
  const [descriptors, setDescriptors] = useState<number[][]>([]);

  const startPresencePoll = () => {
    if (detIntervalRef.current) return;
    detIntervalRef.current = setInterval(async () => {
      if (!videoRef.current) return;
      let d = null;
      try { d = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })); } catch (e) {}
      setFacePresent(!!d);
    }, 700);
  };

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        await loadFaceModels((p) => { if (!canceled) setProgress(p); });
        if (canceled) return;
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 480, height: 360 } });
        if (canceled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          const onReady = async () => {
            await videoRef.current!.play().catch(() => {});
            if (!canceled) setPhase("camera");
          };
          videoRef.current.addEventListener('loadeddata', onReady, { once: true });
          videoRef.current.srcObject = stream;
          if (videoRef.current.readyState >= 2) {
            videoRef.current.removeEventListener('loadeddata', onReady);
            await videoRef.current.play().catch(() => {});
            if (!canceled) setPhase("camera");
          }
        }
        if (!canceled) startPresencePoll();
      } catch (e: any) {
        if (!canceled) { setErrMsg(e.message || "Camera access denied."); setPhase("error"); }
      }
    })();
    return () => {
      canceled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (detIntervalRef.current) clearInterval(detIntervalRef.current);
    };
  }, []);

  const capture = async () => {
    // Guard with a ref, not just `phase` — state updates are async, so a second
    // click fired before the re-render commits would otherwise still get through.
    if (!videoRef.current || capturingRef.current) return;
    capturingRef.current = true;
    setPhase("capturing");
    setErrMsg("");
    // Pause the presence-poll loop. Left running, it fires detectSingleFace on the
    // same TFJS graph every 700ms — concurrently with the heavier descriptor call
    // below — and one of the two calls silently loses the race. That race, not a
    // detection threshold, is why capture used to need 3-4 clicks.
    if (detIntervalRef.current) { clearInterval(detIntervalRef.current); detIntervalRef.current = null; }

    let finished = false;
    try {
      const det = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 }))
        .withFaceLandmarks(false)
        .withFaceDescriptor();

      if (!det) { setErrMsg("No face detected. Center your face in the frame and hold still."); return; }

      const desc = Array.from(det.descriptor);
      const updatedDescs = [...descriptors, desc];
      setDescriptors(updatedDescs);

      const c = document.createElement("canvas");
      c.width = videoRef.current.videoWidth || 480; c.height = videoRef.current.videoHeight || 360;
      c.getContext("2d")!.drawImage(videoRef.current, 0, 0);
      const img = c.toDataURL("image/jpeg", 0.75);

      localStorage.setItem(`face_desc_${userId}`, JSON.stringify(updatedDescs));
      localStorage.setItem(`face_img_${userId}`, img);
      localStorage.setItem(`mfa_method_${userId}`, "faceid");

      streamRef.current?.getTracks().forEach(t => t.stop());
      setCapturedImg(img);
      setPhase("captured");
      finished = true;
      setTimeout(() => onDone(false), 1500);
    } catch (e: any) {
      setErrMsg(e?.message ? `Capture failed — ${e.message}` : "Capture failed. Try again with better lighting.");
    } finally {
      capturingRef.current = false;
      if (!finished) { setPhase("camera"); startPresencePoll(); }
    }
  };

  if (phase === "error") return (
    <div style={{ textAlign: "center", padding: "22px 0" }}>
      <AlertTriangle size={30} color="#B3261E" style={{ marginBottom: 10 }} />
      <div style={{ fontSize: 12, color: "#B3261E", marginBottom: 14, lineHeight: 1.6 }}>{errMsg || "Camera access denied."}</div>
      <div style={{ fontSize: 10, color: "#767270", marginBottom: 16 }}>Face ID can be skipped, but account security will be reduced.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        <motion.button onClick={() => onDone(true)} whileHover={{ scale: 1.01 }} style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid #EAE4E1", background: "#FFFFFF", color: "rgba(16, 15, 15,0.6)", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Skip Face ID</motion.button>
        {onUseAuthenticator && (
          <button onClick={onUseAuthenticator} style={{ background: "none", border: "none", color: "var(--color-primary)", fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 4 }}>Use an authenticator app instead →</button>
        )}
      </div>
    </div>
  );

  if (phase === "captured") return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: "center", padding: "14px 0" }}>
      <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 220 }} style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        <CheckCircle2 size={40} color="#3D8B5A" />
      </motion.div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#100F0F", marginBottom: 14, letterSpacing: "-0.01em" }}>Face ID is set up</div>
      {capturedImg && <img src={capturedImg} alt="enrolled" style={{ width: "56%", borderRadius: 16, border: "1px solid rgba(61, 139, 90,0.4)", boxShadow: "0 0 24px rgba(61, 139, 90,0.22)", transform: "scaleX(-1)" }} />}
    </motion.div>
  );

  const frameState: "idle" | "present" | "busy" = phase === "capturing" ? "busy" : facePresent ? "present" : "idle";
  const statusLabel = phase === "loading" ? "Loading Face ID…" : phase === "capturing" ? "Scanning…" : facePresent ? "Face detected" : "Position your face";

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#575452", marginBottom: 12, textAlign: "center" }}>
        Look directly at the camera to set up Face ID
      </div>

      {phase === "loading" && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 9, color: "#767270", fontFamily: "'DM Mono',monospace" }}>Loading Face ID model…</span>
            <span style={{ fontSize: 9, color: "var(--color-primary)", fontFamily: "'DM Mono',monospace" }}>{progress}%</span>
          </div>
          <div style={{ height: 3, background: "rgba(16, 15, 15,0.06)", borderRadius: 2 }}><motion.div animate={{ width: `${progress}%` }} style={{ height: "100%", background: "linear-gradient(90deg,var(--color-primary),#3D8B5A)", borderRadius: 2 }} /></div>
        </div>
      )}

      <FaceScanFrame videoRef={videoRef} state={frameState} statusLabel={statusLabel} />

      {errMsg && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "8px 10px", background: "rgba(179, 38, 30,0.08)", border: "1px solid rgba(179, 38, 30,0.22)", borderRadius: 10, color: "#B3261E", fontSize: 10.5, marginBottom: 10, lineHeight: 1.5 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{errMsg}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <motion.button onClick={() => onDone(true)} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }} style={{ padding: "10px", borderRadius: 10, border: "1px solid #D7D2D0", background: "#FFFFFF", color: "#575452", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>Skip</motion.button>
        <motion.button onClick={capture} disabled={!facePresent || phase !== "camera"} whileHover={{ scale: facePresent && phase === "camera" ? 1.01 : 1 }} whileTap={{ scale: 0.97 }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 10, border: "none", background: facePresent && phase === "camera" ? "linear-gradient(135deg,var(--color-primary),var(--color-primary-active))" : "rgba(16, 15, 15,0.04)", color: facePresent && phase === "camera" ? "var(--color-on-primary)" : "rgba(16, 15, 15,0.2)", fontSize: 12, fontWeight: 700, cursor: facePresent && phase === "camera" ? "pointer" : "not-allowed", transition: "all 0.3s" }}>
          {phase === "loading" ? <><Loader2 size={13} /> Loading…</>
            : phase === "capturing" ? <><motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }} style={{ display: "flex" }}><Loader2 size={13} /></motion.span> Scanning…</>
            : facePresent ? <><ScanFace size={14} /> Set Up Face ID</> : <>Detecting…</>}
        </motion.button>
      </div>

      {onUseAuthenticator && phase !== "capturing" && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button onClick={onUseAuthenticator} style={{ background: "none", border: "none", color: "#767270", fontSize: 10.5, fontWeight: 600, cursor: "pointer", padding: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <KeyRound size={11} /> Prefer an authenticator app? <ChevronRight size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── FaceVerification Component (Login flow) ───────────────────────────────────
function FaceVerification({ userId, userName, onResult, onUseAuthenticator }: { userId: string; userName: string; onResult: (r: FaceVerifyResult) => void; onUseAuthenticator?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"loading" | "liveness" | "camera" | "verifying" | "done" | "error">("loading");

  // ── Liveness state ─────────────────────────────────────────────────────────
  const [livenessStatus, setLivenessStatus] = useState<"waiting" | "passed" | "failed">("waiting");
  const [livenessMsg, setLivenessMsg] = useState("Blink once to prove you're really here");
  const [livenessEAR, setLivenessEAR] = useState<number>(0.3);
  const livenessIntervalRef = useRef<any>(null);
  const blinkDetectedRef    = useRef(false);
  const eyeOpenRef          = useRef(true);  // tracks open/close state
  const livenessTimerRef    = useRef<any>(null);
  const earHistory          = useRef<number[]>([]);
  const [progress, setProgress] = useState(0);
  const [facePresent, setFacePresent] = useState(false);
  const [result, setResult] = useState<FaceVerifyResult | null>(null);
  const [capturedImg, setCapturedImg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const detIntervalRef = useRef<any>(null);
  const verifyingRef = useRef(false);
  const hasStoredFace = !!localStorage.getItem(`face_desc_${userId}`);

  // 1 Pose tracking
  const [currentPose, setCurrentPose] = useState<number>(0);
  const [poseMatches, setPoseMatches] = useState<boolean[]>([]);
  const [poseConfidences, setPoseConfidences] = useState<number[]>([]);

  const POSE_PROMPTS = [
    "Look straight at the camera (Center)"
  ];

  const startPresencePoll = () => {
    if (detIntervalRef.current) return;
    detIntervalRef.current = setInterval(async () => {
      if (!videoRef.current) return;
      let d = null;
      try { d = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })); } catch (e) {}
      setFacePresent(!!d);
    }, 600);
  };

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        await loadFaceModels((p) => { if (!canceled) setProgress(p); });
        if (canceled) return;
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 480, height: 360 } });
        if (canceled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          // FIX 1: Register handler BEFORE setting srcObject to avoid race condition
          // where loadeddata fires before the handler is attached
          const onReady = async () => {
            await videoRef.current!.play().catch(() => {});
            if (!canceled) startLivenessChallenge();
          };
          videoRef.current.addEventListener('loadeddata', onReady, { once: true });
          videoRef.current.srcObject = stream;
          // FIX 1b: Fallback — if video is already ready (readyState >= 2), start directly
          if (videoRef.current.readyState >= 2) {
            videoRef.current.removeEventListener('loadeddata', onReady);
            await videoRef.current.play().catch(() => {});
            if (!canceled) startLivenessChallenge();
          }
        }
        if (!canceled) startPresencePoll();
      } catch (e: any) {
        if (!canceled) { setErrMsg(e.message || "Camera access denied."); setPhase("error"); }
      }
    })();
    return () => {
      canceled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (detIntervalRef.current) clearInterval(detIntervalRef.current);
    };
  }, []);

  // ── Start liveness challenge after models load & camera ready ───────────────
  const startLivenessChallenge = () => {
    // Clear standard detector loop to prevent resource contention
    if (detIntervalRef.current) {
      clearInterval(detIntervalRef.current);
      detIntervalRef.current = null;
    }

    blinkDetectedRef.current = false;
    eyeOpenRef.current = true;
    setLivenessStatus("waiting");
    setLivenessMsg("Blink once to prove you're really here");
    setPhase("liveness");
    earHistory.current = [];

    // Timeout fallback — if user is stuck, they can manually skip
    livenessTimerRef.current = setTimeout(() => {
      if (!blinkDetectedRef.current) {
        clearInterval(livenessIntervalRef.current);
        setLivenessStatus("failed");
        setLivenessMsg("No blink detected — tap Skip to continue");
      }
    }, 12000);

    // Dynamic rolling history liveness loop
    livenessIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || blinkDetectedRef.current) return;
      try {
        const det = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 }))
          .withFaceLandmarks(false); // 68-point model
        
        if (!det) {
          setFacePresent(false);
          return;
        }
        setFacePresent(true);
        
        const ear = getEAR(det.landmarks as faceapi.FaceLandmarks68);
        setLivenessEAR(ear);

        // Keep rolling history of last 25 frames (~2 seconds)
        earHistory.current.push(ear);
        if (earHistory.current.length > 25) {
          earHistory.current.shift();
        }

        // Only detect when we have gathered a short history baseline
        if (earHistory.current.length >= 6) {
          const maxOpen = Math.max(...earHistory.current);
          const currentDip = maxOpen - ear;

          // If eye closes (dip of at least 0.022 relative to maximum open EAR)
          // Lowered from 0.035 to 0.022 to support users wearing glasses/glare
          if (eyeOpenRef.current && currentDip > 0.022) {
            eyeOpenRef.current = false;
          } 
          // If eye reopens (recovers back to within 0.012 of the open EAR baseline)
          else if (!eyeOpenRef.current && currentDip < 0.012) {
            blinkDetectedRef.current = true;
            clearInterval(livenessIntervalRef.current);
            clearTimeout(livenessTimerRef.current);
            setLivenessStatus("passed");
            setLivenessMsg("Liveness confirmed");
            
            setTimeout(() => {
              setPhase("camera");
              startPresencePoll();
            }, 900);
          }
        }
      } catch (e) {}
    }, 80); // 80ms sampling interval
  };

  const cleanup = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (detIntervalRef.current) clearInterval(detIntervalRef.current);
    if (livenessIntervalRef.current) clearInterval(livenessIntervalRef.current);
    if (livenessTimerRef.current) clearTimeout(livenessTimerRef.current);
  };

  const verify = async () => {
    // Ref guard: state-based `disabled` lags one render behind a click, so a fast
    // second click before the button re-renders would otherwise start a second,
    // concurrent verify() — the same race that used to make capture need retries.
    if (!videoRef.current || verifyingRef.current) return;
    verifyingRef.current = true;
    setPhase("verifying");
    setErrMsg("");
    // Pause the presence-poll loop before running the heavier descriptor detection
    // below — both calls hit the same TFJS graph, and left running concurrently
    // one of them silently drops, which is what forced repeated clicks.
    if (detIntervalRef.current) { clearInterval(detIntervalRef.current); detIntervalRef.current = null; }

    try {
      const c = document.createElement("canvas");
      c.width = videoRef.current.videoWidth || 480; c.height = videoRef.current.videoHeight || 360;
      c.getContext("2d")!.drawImage(videoRef.current, 0, 0);
      const img = c.toDataURL("image/jpeg", 0.75);
      setCapturedImg(img);

      const storedRaw = localStorage.getItem(`face_desc_${userId}`);
      let storedDescs: Float32Array[] = [];
      if (storedRaw) {
        const parsed = JSON.parse(storedRaw);
        if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
          storedDescs = parsed.map(arr => new Float32Array(arr));
        } else {
          storedDescs = [new Float32Array(parsed), new Float32Array(parsed), new Float32Array(parsed)];
        }
      }

      let det = null;
      try {
        det = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })).withFaceLandmarks(false).withFaceDescriptor();
      } catch (e: any) {
        setErrMsg(e?.message ? `Face scan failed — ${e.message}` : "Face scan failed. Try again.");
      }

      let matched = false;
      let confidence = 0;

      if (det && storedDescs[currentPose]) {
        const dist = faceapi.euclideanDistance(det.descriptor, storedDescs[currentPose]);
        confidence = Math.max(0, Math.min(1, 1 - dist));
        matched = dist <= 0.48; // Match threshold
      }

      const updatedMatches = [...poseMatches, matched];
      const updatedConfidences = [...poseConfidences, confidence];
      setPoseMatches(updatedMatches);
      setPoseConfidences(updatedConfidences);

      if (currentPose < POSE_PROMPTS.length - 1) {
        setCurrentPose((prev) => prev + 1);
        setPhase("camera");
        startPresencePoll();
        return;
      }

      cleanup();
      const allMatched = updatedMatches.every(m => m === true);
      const avgConfidence = updatedConfidences.reduce((a, b) => a + b, 0) / POSE_PROMPTS.length;

      const vr: FaceVerifyResult = {
        matched: allMatched,
        confidence: avgConfidence,
        hasRegisteredFace: storedDescs.length > 0,
        noFaceDetected: updatedConfidences.every(c => c === 0),
        livenessCheck: livenessStatus === "passed" ? "passed" : "skipped",
        image: img
      };

      setResult(vr);
      setPhase("done");
      setTimeout(() => onResult(vr), 350);
    } finally {
      verifyingRef.current = false;
    }
  };

  const skipVerify = () => {
    cleanup();
    onResult({
      matched: false,
      confidence: 0,
      hasRegisteredFace: false,
      noFaceDetected: false
    });
  };

  // ── Unified JSX rendering to keep the video element mounted ──────────────────
  const isLiveness = phase === "liveness";
  const earPct = Math.round(livenessEAR * 100);
  const earColor = livenessEAR < 0.21 ? "#3D8B5A" : livenessEAR < 0.27 ? "#B7791F" : "var(--color-primary)";
  const livenessAccent = livenessStatus === "passed" ? "#3D8B5A" : livenessStatus === "failed" ? "#B3261E" : "var(--color-primary)";

  const frameState: "idle" | "present" | "busy" | "success" | "error" =
    phase === "verifying" ? "busy" :
    isLiveness ? (livenessStatus === "passed" ? "success" : livenessStatus === "failed" ? "error" : "busy") :
    facePresent ? "present" : "idle";
  const frameStatusLabel =
    phase === "loading" ? "Loading Face ID…" :
    phase === "verifying" ? "Verifying…" :
    isLiveness ? livenessMsg :
    facePresent ? "Face detected" : "Position your face";

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "8px 12px", background: "#FFFFFF", border: "1px solid #EAE4E1", borderRadius: 10 }}>
        {isLiveness ? <Eye size={17} color={livenessAccent} /> : <ScanFace size={17} color="var(--color-primary)" />}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#100F0F" }}>{isLiveness ? "Liveness check" : "Face ID"}</div>
          <div style={{ fontSize: 9, color: "#575452" }}>{isLiveness ? "Confirming you're a real person, not a photo or recording" : livenessStatus === "passed" ? "Liveness confirmed · scanning face" : "Secured by Citadel"}</div>
        </div>
      </div>

      {/* Loading AI models progress bar */}
      {phase === "loading" && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 9, color: "#767270", fontFamily: "'DM Mono',monospace" }}>Loading Face ID…</span>
            <span style={{ fontSize: 9, color: "var(--color-primary)", fontFamily: "'DM Mono',monospace" }}>{progress}%</span>
          </div>
          <div style={{ height: 3, background: "rgba(16, 15, 15,0.06)", borderRadius: 2 }}><motion.div animate={{ width: `${progress}%` }} style={{ height: "100%", background: "linear-gradient(90deg,var(--color-primary),#3D8B5A)", borderRadius: 2 }} /></div>
        </div>
      )}

      {/* Persistent single video frame (keeps the stream mounted across phases) */}
      {phase !== "done" && phase !== "error" && (
        <FaceScanFrame videoRef={videoRef} state={frameState} statusLabel={frameStatusLabel} minHeight={200}>
          {isLiveness && (
            <div style={{ position: "absolute", bottom: 10, right: 12, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, pointerEvents: "none" }}>
              <span style={{ fontSize: 8, color: "rgba(16, 15, 15,0.8)", fontFamily: "'DM Mono',monospace", background: "rgba(255, 255, 255,0.55)", padding: "2px 6px", borderRadius: 4 }}>Eye openness {earPct}</span>
              <div style={{ width: 64, height: 4, background: "rgba(255, 255, 255,0.35)", borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${Math.min(earPct * 2, 100)}%`, background: earColor, borderRadius: 2, transition: "all 0.1s" }} />
              </div>
            </div>
          )}
          {phase === "camera" && !hasStoredFace && (
            <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, background: "rgba(183, 121, 31,0.85)", fontSize: 8, fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>
              <AlertTriangle size={10} /> No Face ID enrolled — risk elevated
            </div>
          )}
        </FaceScanFrame>
      )}

      {/* Done details display */}
      {phase === "done" && result && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: "center", padding: "8px 0" }}>
          <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200 }} style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
            {result.matched ? <CheckCircle2 size={38} color="#3D8B5A" /> : <XCircle size={38} color="#B3261E" />}
          </motion.div>
          <div style={{ fontSize: 15, fontWeight: 800, color: result.matched ? "#3D8B5A" : "#B3261E", marginBottom: 6 }}>{result.matched ? "Face ID recognized" : "Face not recognized"}</div>
          <div style={{ fontSize: 10, color: "#575452", marginBottom: 14, lineHeight: 1.6 }}>
            {result.matched ? `Match confidence ${Math.round(result.confidence * 100)}% • Welcome, ${userName}`
              : result.noFaceDetected ? "No face was in frame — treated as a suspicious access attempt"
              : !result.hasRegisteredFace ? "No Face ID enrolled for this account"
              : `Match confidence ${Math.round(result.confidence * 100)}% — this doesn't match the enrolled face`}
          </div>
          {capturedImg && (
            <div style={{ position: "relative", display: "inline-block" }}>
              <img src={capturedImg} alt="captured" style={{ width: 110, height: 82, objectFit: "cover", borderRadius: 12, border: `1px solid ${result.matched ? "rgba(61, 139, 90,0.5)" : "rgba(179, 38, 30,0.5)"}`, boxShadow: `0 0 18px ${result.matched ? "rgba(61, 139, 90,0.25)" : "rgba(179, 38, 30,0.25)"}`, transform: "scaleX(-1)" }} />
              <div style={{ position: "absolute", bottom: -6, right: -6, width: 22, height: 22, borderRadius: "50%", background: result.matched ? "#3D8B5A" : "#B3261E", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {result.matched ? <Check size={12} color="#F3F3F3" strokeWidth={3} /> : <XCircle size={12} color="#fff" />}
              </div>
            </div>
          )}
          {!result.matched && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} style={{ marginTop: 14, padding: "8px 12px", background: "rgba(179, 38, 30,0.08)", border: "1px solid rgba(179, 38, 30,0.2)", borderRadius: 10, fontSize: 9, color: "#B3261E", fontFamily: "'DM Mono',monospace" }}>
              Citadel risk score elevated — all signals updated
            </motion.div>
          )}
        </motion.div>
      )}

      {/* Error layout */}
      {phase === "error" && (
        <div style={{ textAlign: "center", padding: "18px 0" }}>
          <AlertTriangle size={28} color="#B3261E" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 11, color: "#B3261E", marginBottom: 14 }}>{errMsg}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <motion.button onClick={skipVerify} whileHover={{ scale: 1.01 }} style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid #EAE4E1", background: "#FFFFFF", color: "rgba(16, 15, 15,0.5)", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Skip verification</motion.button>
            {onUseAuthenticator && (
              <button onClick={onUseAuthenticator} style={{ background: "none", border: "none", color: "var(--color-primary)", fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 4 }}>Use an authenticator app instead →</button>
            )}
          </div>
        </div>
      )}

      {/* Button controls */}
      {phase !== "done" && phase !== "error" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
          <motion.button onClick={skipVerify} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }} style={{ padding: "10px", borderRadius: 10, border: "1px solid #D7D2D0", background: "#FFFFFF", color: "#575452", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>Skip</motion.button>
          <motion.button onClick={isLiveness ? undefined : verify} disabled={isLiveness || !facePresent || phase !== "camera"}
            whileHover={{ scale: (isLiveness || !facePresent || phase !== "camera") ? 1 : 1.01 }} whileTap={{ scale: 0.97 }}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 10, border: "none", background: isLiveness ? "rgba(16, 15, 15,0.03)" : facePresent && phase === "camera" ? "linear-gradient(135deg,var(--color-primary),var(--color-primary-active))" : "rgba(16, 15, 15,0.04)", color: isLiveness ? "#969290" : facePresent && phase === "camera" ? "var(--color-on-primary)" : "rgba(16, 15, 15,0.2)", fontSize: 12, fontWeight: 700, cursor: (isLiveness || !facePresent || phase !== "camera") ? "not-allowed" : "pointer", transition: "all 0.3s" }}>
            {phase === "loading" ? <><Loader2 size={13} /> Loading…</>
              : isLiveness ? <><Eye size={13} /> Blink to continue</>
              : phase === "verifying" ? <><motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }} style={{ display: "flex" }}><Loader2 size={13} /></motion.span> Verifying…</>
              : facePresent ? <><ScanFace size={14} /> Verify Face ID</> : <>Detecting…</>}
          </motion.button>
        </div>
      )}

      {onUseAuthenticator && phase !== "verifying" && phase !== "done" && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button onClick={onUseAuthenticator} style={{ background: "none", border: "none", color: "#767270", fontSize: 10.5, fontWeight: 600, cursor: "pointer", padding: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <KeyRound size={11} /> Use Authenticator App instead <ChevronRight size={11} />
          </button>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 9, color: "#767270", textAlign: "center", fontFamily: "'DM Mono',monospace" }}>Face data processed locally • Never uploaded to servers</div>
    </div>
  );
}

// ── Shared 6-digit code input for the Authenticator App flow ──────────────────
function OtpCodeInput({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: boolean }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6}
      style={{
        width: "100%", boxSizing: "border-box", padding: "14px 10px", borderRadius: 12, textAlign: "center",
        fontSize: 26, fontWeight: 700, letterSpacing: "0.5em", fontFamily: "'DM Mono',ui-monospace,monospace",
        color: "#100F0F", background: "#FFFFFF",
        border: `1px solid ${error ? "rgba(179, 38, 30,0.45)" : "rgba(16, 15, 15,0.12)"}`, outline: "none",
      }}
    />
  );
}

// ── AuthenticatorSetup — enroll a TOTP authenticator app as an MFA method ──────
function AuthenticatorSetup({ userId, onDone, onUseFaceId }: { userId: string; onDone: (skipped: boolean) => void; onUseFaceId?: () => void }) {
  const [secret] = useState(() => generateTotpSecret());
  const [code, setCode] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);
  const verifyingRef = useRef(false);

  const secretGroups = secret.match(/.{1,4}/g)?.join(" ") ?? secret;

  const copySecret = async () => {
    try { await navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {}
  };

  const confirm = async () => {
    if (verifyingRef.current || code.length !== 6) return;
    verifyingRef.current = true;
    setVerifying(true);
    setErrMsg("");
    try {
      const ok = await verifyTotp(secret, code);
      if (!ok) { setErrMsg("That code didn't match. Check your device's clock and try again."); return; }
      localStorage.setItem(`totp_secret_${userId}`, secret);
      localStorage.setItem(`mfa_method_${userId}`, "totp");
      setDone(true);
      setTimeout(() => onDone(false), 1400);
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  };

  useEffect(() => {
    if (code.length === 6) confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (done) return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: "center", padding: "14px 0" }}>
      <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 220 }} style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        <CheckCircle2 size={40} color="#3D8B5A" />
      </motion.div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#100F0F" }}>Authenticator app connected</div>
    </motion.div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "8px 12px", background: "#FFFFFF", border: "1px solid #EAE4E1", borderRadius: 10 }}>
        <KeyRound size={17} color="var(--color-primary)" />
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#100F0F" }}>Set up Authenticator App</div>
          <div style={{ fontSize: 9, color: "#575452" }}>Works with Google Authenticator, Microsoft Authenticator, or Authy</div>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: "#575452", marginBottom: 10, lineHeight: 1.6 }}>
        In your authenticator app, choose <strong>Add account → Enter setup key</strong> and enter the code below.
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px", borderRadius: 12, background: "#FFFFFF", border: "1px solid #D7D2D0", marginBottom: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.06em", fontFamily: "'DM Mono',ui-monospace,monospace", color: "#100F0F", wordBreak: "break-all" }}>{secretGroups}</span>
        <motion.button onClick={copySecret} whileTap={{ scale: 0.94 }} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 8, border: "1px solid #D7D2D0", background: "rgba(16, 15, 15,0.04)", color: copied ? "#3D8B5A" : "#575452", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </motion.button>
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 600, color: "#575452", marginBottom: 8, textAlign: "center" }}>Enter the 6-digit code it generates</div>
      <div style={{ marginBottom: 10 }}>
        <OtpCodeInput value={code} onChange={setCode} error={!!errMsg} />
      </div>

      {errMsg && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "8px 10px", background: "rgba(179, 38, 30,0.08)", border: "1px solid rgba(179, 38, 30,0.22)", borderRadius: 10, color: "#B3261E", fontSize: 10.5, marginBottom: 10, lineHeight: 1.5 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{errMsg}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <motion.button onClick={() => onDone(true)} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }} style={{ padding: "10px", borderRadius: 10, border: "1px solid #D7D2D0", background: "#FFFFFF", color: "#575452", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>Skip</motion.button>
        <motion.button onClick={confirm} disabled={code.length !== 6 || verifying} whileHover={{ scale: code.length === 6 && !verifying ? 1.01 : 1 }} whileTap={{ scale: 0.97 }}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 10, border: "none", background: code.length === 6 && !verifying ? "linear-gradient(135deg,var(--color-primary),var(--color-primary-active))" : "rgba(16, 15, 15,0.04)", color: code.length === 6 && !verifying ? "var(--color-on-primary)" : "rgba(16, 15, 15,0.2)", fontSize: 12, fontWeight: 700, cursor: code.length === 6 && !verifying ? "pointer" : "not-allowed", transition: "all 0.3s" }}>
          {verifying ? <><motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }} style={{ display: "flex" }}><Loader2 size={13} /></motion.span> Verifying…</> : <><KeyRound size={14} /> Turn On</>}
        </motion.button>
      </div>

      {onUseFaceId && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button onClick={onUseFaceId} style={{ background: "none", border: "none", color: "#767270", fontSize: 10.5, fontWeight: 600, cursor: "pointer", padding: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ScanFace size={11} /> Use Face ID instead <ChevronRight size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── AuthenticatorVerify — sign in with a previously enrolled Authenticator App ──
function AuthenticatorVerify({ userId, onResult, onUseFaceId }: { userId: string; userName: string; onResult: (r: FaceVerifyResult) => void; onUseFaceId?: () => void }) {
  // Read once per mount — the value can't change under a mounted instance, but a
  // conditional early-return must never sit before hooks (Rules of Hooks), so
  // every hook below is declared unconditionally regardless of this value.
  const [storedSecret] = useState(() => localStorage.getItem(`totp_secret_${userId}`));
  const [code, setCode] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [verifying, setVerifying] = useState(false);
  const verifyingRef = useRef(false);

  const skip = () => onResult({ matched: false, confidence: 0, hasRegisteredFace: false, noFaceDetected: false });

  const confirm = async () => {
    if (verifyingRef.current || code.length !== 6 || !storedSecret) return;
    verifyingRef.current = true;
    setVerifying(true);
    setErrMsg("");
    try {
      const ok = await verifyTotp(storedSecret, code);
      if (!ok) { setErrMsg("Incorrect code. Check your authenticator app and try again."); setCode(""); return; }
      onResult({ matched: true, confidence: 1, hasRegisteredFace: false, noFaceDetected: false });
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  };

  useEffect(() => {
    if (code.length === 6) confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // No authenticator enrolled yet — let the user set one up right here, then sign them in with it.
  if (!storedSecret) {
    return (
      <AuthenticatorSetup
        userId={userId}
        onDone={(skipped) => onResult(skipped
          ? { matched: false, confidence: 0, hasRegisteredFace: false, noFaceDetected: false }
          : { matched: true, confidence: 1, hasRegisteredFace: false, noFaceDetected: false })}
        onUseFaceId={onUseFaceId}
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "8px 12px", background: "#FFFFFF", border: "1px solid #EAE4E1", borderRadius: 10 }}>
        <KeyRound size={17} color="var(--color-primary)" />
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#100F0F" }}>Authenticator App</div>
          <div style={{ fontSize: 9, color: "#575452" }}>Enter the 6-digit code from your app</div>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <OtpCodeInput value={code} onChange={setCode} error={!!errMsg} />
      </div>

      {errMsg && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "8px 10px", background: "rgba(179, 38, 30,0.08)", border: "1px solid rgba(179, 38, 30,0.22)", borderRadius: 10, color: "#B3261E", fontSize: 10.5, marginBottom: 10, lineHeight: 1.5 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{errMsg}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <motion.button onClick={skip} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }} style={{ padding: "10px", borderRadius: 10, border: "1px solid #D7D2D0", background: "#FFFFFF", color: "#575452", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>Skip</motion.button>
        <motion.button onClick={confirm} disabled={code.length !== 6 || verifying} whileHover={{ scale: code.length === 6 && !verifying ? 1.01 : 1 }} whileTap={{ scale: 0.97 }}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 10, border: "none", background: code.length === 6 && !verifying ? "linear-gradient(135deg,var(--color-primary),var(--color-primary-active))" : "rgba(16, 15, 15,0.04)", color: code.length === 6 && !verifying ? "var(--color-on-primary)" : "rgba(16, 15, 15,0.2)", fontSize: 12, fontWeight: 700, cursor: code.length === 6 && !verifying ? "pointer" : "not-allowed", transition: "all 0.3s" }}>
          {verifying ? <><motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }} style={{ display: "flex" }}><Loader2 size={13} /></motion.span> Verifying…</> : <><KeyRound size={14} /> Verify</>}
        </motion.button>
      </div>

      {onUseFaceId && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button onClick={onUseFaceId} style={{ background: "none", border: "none", color: "#767270", fontSize: 10.5, fontWeight: 600, cursor: "pointer", padding: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ScanFace size={11} /> Use Face ID instead <ChevronRight size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Registration Screen (inner) ────────────────────────────────────────────────
function RegisterPanel({ onBack, onRegisterSuccess }: { onBack: () => void; onRegisterSuccess: (acc: Account, duressData: any, password: string) => void }) {
  // Step 1: credentials | Step 2: bank info | Step 3: face enrollment | Step 4: success
  // Step and every field below are draft-backed: flipping to the "Sign in" tab
  // unmounts this panel, and an unfinished registration has to survive that.
  const [step, setStep] = useDraftState<1 | 2 | 3 | 4>(SIGNUP_DRAFT, "step", 1);
  const [regError, setRegError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deviceImei, setDeviceImei] = useState<string>(DEMO_LEGIT_IMEI);
  const [mfaMethod, setMfaMethod] = useState<"faceid" | "totp">("faceid");

  useEffect(() => {
    (async () => {
      try {
        const fp = getDeviceFingerprint();
        const buf = new TextEncoder().encode(fp);
        const hash = await crypto.subtle.digest("SHA-256", buf);
        const hashHex = Array.from(new Uint8Array(hash))
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");
        setDeviceImei(hashHex);
      } catch (e) {}
    })();
  }, []);

  // Step 1 fields
  const [userId, setUserId] = useDraftState(SIGNUP_DRAFT, "userId", "");
  const [fullName, setFullName] = useDraftState(SIGNUP_DRAFT, "fullName", "");
  const [email, setEmail] = useDraftState(SIGNUP_DRAFT, "email", "");
  // Secrets are never drafted to localStorage — memory only.
  const [password, setPassword] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showPass, setShowPass] = useState(false); // view toggle, not form data

  // Normal PIN fields state
  const [normalPin, setNormalPin] = useState("");
  const [confirmNormalPin, setConfirmNormalPin] = useState("");

  // Duress fields state
  const [duressPin, setDuressPin] = useState("");
  const [confirmDuressPin, setConfirmDuressPin] = useState("");
  const [emergencyContact1Name, setEmergencyContact1Name] = useDraftState(SIGNUP_DRAFT, "ec1Name", "");
  const [emergencyContact1Phone, setEmergencyContact1Phone] = useDraftState(SIGNUP_DRAFT, "ec1Phone", "");
  const [emergencyContact2Name, setEmergencyContact2Name] = useDraftState(SIGNUP_DRAFT, "ec2Name", "");
  const [emergencyContact2Phone, setEmergencyContact2Phone] = useDraftState(SIGNUP_DRAFT, "ec2Phone", "");

  // Step 2 fields
  const [bankName, setBankName] = useDraftState(SIGNUP_DRAFT, "bankName", "");
  const [accountNo, setAccountNo] = useDraftState(SIGNUP_DRAFT, "accountNo", "");
  const [accountType, setAccountType] = useDraftState(SIGNUP_DRAFT, "accountType", "savings");
  const [ifsc, setIfsc] = useDraftState(SIGNUP_DRAFT, "ifsc", "");
  const [upiId, setUpiId] = useDraftState(SIGNUP_DRAFT, "upiId", "");
  const [mobile, setMobile] = useDraftState(SIGNUP_DRAFT, "mobile", "");
  const [pan, setPan] = useDraftState(SIGNUP_DRAFT, "pan", "");
  const [dob, setDob] = useDraftState(SIGNUP_DRAFT, "dob", "");
  const [address, setAddress] = useDraftState(SIGNUP_DRAFT, "address", "");

  // The account now exists — the draft has served its purpose. Declared after
  // every field hook so this clear runs last on the render that reaches step 4,
  // otherwise a field effect would immediately write the draft back.
  useEffect(() => { if (step === 4) clearDraft(SIGNUP_DRAFT); }, [step]);

  const fieldStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 6,
    fontSize: 14, color: "#100F0F", background: "#FFFFFF",
    border: "1px solid #D7D2D0", outline: "none", fontFamily: "'Inter',sans-serif",
    transition: "border-color 0.2s, box-shadow 0.2s", colorScheme: "light",
  };
  const selectStyle: React.CSSProperties = {
    ...fieldStyle,
    cursor: "pointer",
    appearance: "none",
    WebkitAppearance: "none",
    paddingRight: 40,
    backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23575452' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 14px center",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: "#575452", marginBottom: 7,
    letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace",
  };

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    if (!userId.trim() || !fullName.trim() || !email.trim() || !password || !confirmPass) {
      setRegError("All credential fields are required."); return;
    }
    if (password.length < 6) { setRegError("Password must be at least 6 characters."); return; }
    if (password !== confirmPass) { setRegError("Passwords do not match."); return; }
    if (!normalPin || !confirmNormalPin) { setRegError("Please set your Normal Transaction PIN."); return; }
    if (normalPin.length < 4) { setRegError("Normal PIN must be at least 4 digits."); return; }
    if (normalPin !== confirmNormalPin) { setRegError("Normal PINs do not match."); return; }
    if (!duressPin || !confirmDuressPin || !emergencyContact1Name.trim() || !emergencyContact1Phone.trim()) {
      setRegError("Please fill out Duress PIN and Emergency Contact 1."); return;
    }
    if (duressPin.length < 4) { setRegError("Duress PIN must be at least 4 characters."); return; }
    if (duressPin !== confirmDuressPin) { setRegError("Duress PINs do not match."); return; }
    if (normalPin === duressPin) { setRegError("Normal PIN and Duress PIN must be different."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setRegError("Enter a valid email address."); return; }
    // Save normal PIN locally for payment verification
    localStorage.setItem(`normal_pin_${userId.toLowerCase().replace(/\s/g, "_")}`, normalPin);
    setStep(2);
  };

  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    if (!bankName || !accountNo || !ifsc || !upiId || !mobile || !pan || !dob || !address) {
      setRegError("All bank details are required."); return;
    }
    if (!/^\d{9,18}$/.test(accountNo.replace(/\s/g, ""))) {
      setRegError("Enter a valid bank account number (9–18 digits)."); return;
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase())) {
      setRegError("Enter a valid IFSC code (e.g. ZIPB0001234)."); return;
    }
    if (!/^\d{10}$/.test(mobile.replace(/\s/g, ""))) {
      setRegError("Enter a valid 10-digit mobile number."); return;
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan.toUpperCase())) {
      setRegError("Enter a valid PAN number (e.g. ABCDE1234F)."); return;
    }
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 1500)); // Simulate API call
    setSubmitting(false);
    setStep(3);
  };

  const handleMfaEnrollDone = (_skipped: boolean) => {
    // Passwords live in memory only, so a remount (tab flip / reload) during
    // the wizard loses them even though the drafted step survives. Send the
    // user back to step 1 rather than registering a credential-less account.
    if (!password) {
      setRegError("For security, please re-enter your password to finish registration.");
      setStep(1);
      return;
    }
    const cleanId = userId.toLowerCase().replace(/\s/g, "");
    const newAcc: Account = {
      id: cleanId,
      name: fullName,
      accountNo: accountNo.replace(/\s/g, "").replace(/(\d{4})/g, "$1 ").trim(),
      ifsc: ifsc.toUpperCase(),
      upiId: upiId.toLowerCase(),
      avatar: fullName.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2),
      imeiHash: deviceImei, // Set dynamic device fingerprint hash baseline
      color: "var(--color-primary)",
      // The form collects a bare 10-digit Indian mobile; the voice-MFA service
      // needs E.164, so normalise here rather than at three call sites.
      phone: toE164(mobile),
    };
    // The password is handed to the registration flow in memory only — the
    // backend /api/auth/register is the credential store, never localStorage.
    // Save normal PIN keyed by clean user ID (client-side MFA demo only).
    localStorage.setItem(`normal_pin_${cleanId}`, normalPin);
    onRegisterSuccess(newAcc, {
      duress_pin: duressPin,
      confirm_duress_pin: confirmDuressPin,
      emergency_contact_1_name: emergencyContact1Name,
      emergency_contact_1_phone: emergencyContact1Phone,
      emergency_contact_2_name: emergencyContact2Name || undefined,
      emergency_contact_2_phone: emergencyContact2Phone || undefined,
    }, password);
    setStep(4);
  };


  const inputFocusStyle = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) => {
    if (el) { el.style.borderColor = "#AA412A"; el.style.boxShadow = "0 0 0 3px rgba(170,65,42,0.12)"; el.style.backgroundColor = "#FFFFFF"; }
  };
  const inputBlurStyle = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) => {
    if (el) { el.style.borderColor = "#D7D2D0"; el.style.boxShadow = "none"; el.style.backgroundColor = "#FFFFFF"; }
  };

  if (step === 3) {
    const cleanId = userId.toLowerCase().replace(/\s/g, "");
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ padding: "10px 0" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#100F0F", marginBottom: 4 }}>Secure your account</div>
        <div style={{ fontSize: 11.5, color: "#767270", marginBottom: 14 }}>Choose how you'll verify it's you at sign-in.</div>

        <div className="login-segment" role="tablist" style={{ marginBottom: 16 }}>
          {([["faceid", "Face ID", ScanFace], ["totp", "Authenticator App", KeyRound]] as const).map(([m, label, Icon]) => (
            <button key={m} type="button" role="tab" aria-selected={mfaMethod === m} onClick={() => setMfaMethod(m)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {mfaMethod === "faceid" ? (
          <FaceEnrollment userId={cleanId} onDone={handleMfaEnrollDone} onUseAuthenticator={() => setMfaMethod("totp")} />
        ) : (
          <AuthenticatorSetup userId={cleanId} onDone={handleMfaEnrollDone} onUseFaceId={() => setMfaMethod("faceid")} />
        )}
      </motion.div>
    );
  }

  if (step === 4) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: "center", padding: "30px 0 10px" }}>
        <motion.div
          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          style={{ fontSize: 56, marginBottom: 16 }}>✅</motion.div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#3D8B5A", marginBottom: 8 }}>Account Registered!</div>
        <div style={{ fontSize: 12, color: "#575452", lineHeight: 1.7, marginBottom: 24 }}>
          Welcome, <span style={{ color: "#100F0F", fontWeight: 700 }}>{fullName}</span>!<br />
          Your ZipPay Bank account has been created.<br />
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "var(--color-primary)" }}>{upiId}</span>
        </div>
        <div style={{ background: "rgba(61, 139, 90,0.05)", border: "1px solid rgba(61, 139, 90,0.18)", borderRadius: 12, padding: "12px 16px", marginBottom: 20, textAlign: "left" }}>
          {[
            { l: "User ID", v: userId },
            { l: "Bank", v: bankName },
            { l: "Account No.", v: "•••• " + accountNo.replace(/\s/g, "").slice(-4) },
            { l: "IFSC", v: ifsc.toUpperCase() },
            { l: "UPI ID", v: upiId },
            { l: "Mobile", v: "•••••" + mobile.slice(-5) },
          ].map(({ l, v }) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 11 }}>
              <span style={{ color: "#767270", fontFamily: "'DM Mono',monospace" }}>{l}</span>
              <span style={{ color: "#100F0F", fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
        {/* Voice MFA runs at LOGIN only. It used to gate this screen as well,
            which put a sixth verification in front of a customer who had just
            completed five, before the account had been used once. The login
            panel (purpose="login") is unchanged. */}
        <motion.button
          onClick={onBack}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          style={{
            width: "100%", padding: "12px", borderRadius: 12, border: "none",
            background: "#AA412A",
            color: "var(--color-on-primary)",
            fontSize: 13, fontWeight: 700,
            cursor: "pointer",
            boxShadow: "none",
          }}
        >
          🔒 Go to Login
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 28 }}>
        {[
          { n: 1, label: "Credentials" },
          { n: 2, label: "Bank Info" },
          { n: 3, label: "Camera Face" }
        ].map(({ n, label }, i) => (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 500, fontFamily: "'DM Mono',monospace", flexShrink: 0,
              background: step > n ? "#100F0F" : step === n ? "#AA412A" : "#FFFFFF",
              color: step >= n ? "#fff" : "#969290",
              border: step >= n ? "1px solid transparent" : "1px solid #D7D2D0",
              boxShadow: step === n ? "0 0 0 4px rgba(170,65,42,0.14)" : "none",
              transition: "all 0.3s",
            }}>{step > n ? "✓" : n}</div>
            <span style={{ fontSize: 11, color: step >= n ? "#100F0F" : "#969290", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label.split(" ")[0]}</span>
            {i < 2 && <div style={{ flex: 1, height: 2, borderRadius: 2, background: step > n ? "#100F0F" : "#EAE4E1", transition: "background 0.4s" }} />}
          </div>
        ))}
      </div>

      {regError && (
        <div style={{ padding: "11px 14px", background: "rgba(179,38,30,0.06)", border: "1px solid rgba(179,38,30,0.2)", borderRadius: 6, color: "#B3261E", fontSize: 13, marginBottom: 16 }}>
          {regError}
        </div>
      )}

      {step === 1 && (
        <form onSubmit={handleStep1} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          <div style={{ fontSize: 24, fontWeight: 400, color: "#100F0F", marginBottom: 4, fontFamily: "'Newsreader', Georgia, serif", letterSpacing: "-0.01em" }}>Personal Credentials</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={labelStyle}>User ID *</div>
              <input value={userId} onChange={e => setUserId(e.target.value)} placeholder="e.g. john_doe" required
                style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
            </div>
            <div>
              <div style={labelStyle}>Full Name *</div>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. John Doe" required
                style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
            </div>
          </div>

          <div>
            <div style={labelStyle}>Email Address *</div>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required
              style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
          </div>


          <div>
            <div style={labelStyle}>Password *</div>
            <div style={{ position: "relative" }}>
              <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Min. 6 characters" required
                style={{ ...fieldStyle, paddingRight: 44 }} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
              <button type="button" onClick={() => setShowPass(p => !p)}
                style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#767270", cursor: "pointer", fontSize: 14 }}>
                {showPass ? "🙈" : "👁️"}
              </button>
            </div>
            {/* Password strength bar */}
            {password.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ height: 3, background: "rgba(16, 15, 15,0.06)", borderRadius: 2 }}>
                  <div style={{
                    height: "100%", borderRadius: 2, transition: "all 0.4s",
                    width: `${Math.min(password.length / 12 * 100, 100)}%`,
                    background: password.length < 6 ? "#B3261E" : password.length < 10 ? "#B7791F" : "#3D8B5A",
                  }} />
                </div>
                <div style={{ fontSize: 9, color: password.length < 6 ? "#C9605A" : password.length < 10 ? "#fde68a" : "#86efac", fontFamily: "'DM Mono',monospace", marginTop: 3 }}>
                  {password.length < 6 ? "Weak" : password.length < 10 ? "Moderate" : "Strong"}
                </div>
              </div>
            )}
          </div>

          <div>
            <div style={labelStyle}>Confirm Password *</div>
            <input type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)}
              placeholder="Re-enter password" required
              style={{ ...fieldStyle, borderColor: confirmPass && confirmPass !== password ? "rgba(179, 38, 30,0.5)" : "rgba(16, 15, 15,0.10)" }}
              onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
          </div>

          {/* ── Normal Transaction PIN ─────────────────────────────────── */}
          <div style={{ borderTop: "1px dashed rgba(16, 15, 15,0.15)", paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-primary)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <span>🔐</span> Set Transaction PIN
            </div>
            <div style={{ fontSize: 10, color: "#767270", marginBottom: 10, fontStyle: "italic" }}>
              This PIN is entered when you make payments. Keep it private.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <div style={labelStyle}>Normal PIN *</div>
                <input type="password" value={normalPin} onChange={e => setNormalPin(e.target.value)} placeholder="4+ digit PIN" required
                  style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
              </div>
              <div>
                <div style={labelStyle}>Confirm Normal PIN *</div>
                <input type="password" value={confirmNormalPin} onChange={e => setConfirmNormalPin(e.target.value)} placeholder="Re-enter PIN" required
                  style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
              </div>
            </div>
          </div>

          {/* ── Duress PIN & Emergency Mode ────────────────────────────── */}
          <div style={{ borderTop: "1px dashed rgba(16, 15, 15,0.15)", paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#B3261E", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <span>🚨</span> Duress PIN & Emergency Mode Setup
            </div>
            <div style={{ fontSize: 10, color: "#767270", marginBottom: 10, fontStyle: "italic" }}>
              If forced to make a payment, enter this PIN instead. It will silently alert your emergency contacts.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <div style={labelStyle}>Duress PIN *</div>
                <input type="password" value={duressPin} onChange={e => setDuressPin(e.target.value)} placeholder="Emergency PIN" required
                  style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
              </div>
              <div>
                <div style={labelStyle}>Confirm Duress *</div>
                <input type="password" value={confirmDuressPin} onChange={e => setConfirmDuressPin(e.target.value)} placeholder="Confirm PIN" required
                  style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <div style={labelStyle}>Emergency Contact 1 *</div>
                <input value={emergencyContact1Name} onChange={e => setEmergencyContact1Name(e.target.value)} placeholder="Name" required
                  style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
              </div>
              <div>
                <div style={labelStyle}>Contact 1 Phone *</div>
                <input value={emergencyContact1Phone} onChange={e => setEmergencyContact1Phone(e.target.value)} placeholder="+91..." required
                  style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={labelStyle}>Emergency Contact 2</div>
                <input value={emergencyContact2Name} onChange={e => setEmergencyContact2Name(e.target.value)} placeholder="Name (Optional)"
                  style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
              </div>
              <div>
                <div style={labelStyle}>Contact 2 Phone</div>
                <input value={emergencyContact2Phone} onChange={e => setEmergencyContact2Phone(e.target.value)} placeholder="Phone (Optional)"
                  style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
              </div>
            </div>
          </div>


          <motion.button type="submit" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }}
            style={{ width: "100%", padding: "12px", marginTop: 4, borderRadius: 12, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: "#AA412A", color: "var(--color-on-primary)", boxShadow: "none" }}>
            Continue to Bank Details →
          </motion.button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handleStep2} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          <div style={{ fontSize: 24, fontWeight: 400, color: "#100F0F", marginBottom: 4, fontFamily: "'Newsreader', Georgia, serif", letterSpacing: "-0.01em" }}>Bank Information</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={labelStyle}>Bank Name *</div>
              <select value={bankName} onChange={e => setBankName(e.target.value)} required
                style={selectStyle}
                onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)}>
                <option value="">Select bank…</option>
                {["ZipPay Bank", "State Bank of India", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra", "Punjab National Bank", "Bank of Baroda", "Canara Bank", "Other"].map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Account Type *</div>
              <select value={accountType} onChange={e => setAccountType(e.target.value)} required
                style={selectStyle}
                onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)}>
                {["savings", "current", "salary", "fixed_deposit", "nri"].map(t => (
                  <option key={t} value={t}>{t.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div style={labelStyle}>Bank Account Number *</div>
            <input value={accountNo} onChange={e => setAccountNo(e.target.value)} placeholder="e.g. 3456 7890 4821 00" required
              style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={labelStyle}>IFSC Code *</div>
              <input value={ifsc} onChange={e => setIfsc(e.target.value.toUpperCase())} placeholder="ZIPB0001234" required
                style={{ ...fieldStyle, fontFamily: "'DM Mono',monospace", letterSpacing: "0.05em" }}
                onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
            </div>
            <div>
              <div style={labelStyle}>UPI ID *</div>
              <input value={upiId} onChange={e => setUpiId(e.target.value)} placeholder="name@bank" required
                style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={labelStyle}>Mobile Number *</div>
              <input type="tel" value={mobile} onChange={e => setMobile(e.target.value)} placeholder="9876543210" required
                style={fieldStyle} onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
            </div>
            <div>
              <div style={labelStyle}>Date of Birth *</div>
              <input type="date" value={dob} onChange={e => setDob(e.target.value)} required
                style={{ ...fieldStyle, colorScheme: "light" }}
                onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
            </div>
          </div>

          <div>
            <div style={labelStyle}>PAN Number *</div>
            <input value={pan} onChange={e => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" required
              style={{ ...fieldStyle, fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em" }}
              onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
          </div>

          <div>
            <div style={labelStyle}>Registered Address *</div>
            <textarea value={address} onChange={e => setAddress(e.target.value)} placeholder="House No, Street, City, State – PIN" required rows={2}
              style={{ ...fieldStyle, resize: "none", lineHeight: 1.6 }}
              onFocus={e => inputFocusStyle(e.target)} onBlur={e => inputBlurStyle(e.target)} />
          </div>

          <div style={{ padding: "9px 12px", background: "rgba(16, 15, 15,0.035)", border: "1px solid rgba(170, 65, 42,0.14)", borderRadius: 10, fontSize: 10, color: "#575452", lineHeight: 1.6 }}>
            🔒 Your data is encrypted end-to-end. Citadel biometrics are collected during registration to build your behavioral baseline.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <motion.button type="button" onClick={() => { setStep(1); setRegError(null); }}
              whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }}
              style={{ padding: "12px", borderRadius: 12, border: "1px solid #D7D2D0", background: "#FFFFFF", color: "#575452", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              ← Back
            </motion.button>
            <motion.button type="submit" disabled={submitting} whileHover={{ scale: submitting ? 1 : 1.01 }} whileTap={{ scale: 0.97 }}
              style={{ padding: "12px", borderRadius: 12, border: "none", cursor: submitting ? "wait" : "pointer", fontSize: 13, fontWeight: 700, background: submitting ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg,var(--color-primary),var(--color-primary-active))", color: submitting ? "rgba(241, 234, 231,0.4)" : "var(--color-on-primary)", boxShadow: submitting ? "none" : "0 8px 22px rgba(0,0,0,0.45)", transition: "all 0.3s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {submitting ? (
                <><motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ display: "inline-block" }}>⟳</motion.span> Creating Account…</>
              ) : "🏦 Register Account"}
            </motion.button>
          </div>
        </form>
      )}
    </motion.div>
  );
}

// ── Login Screen ───────────────────────────────────────────────────────────────
/* Left editorial panel on the sign-in screen: what Citadel is reading while
   the customer types. Purely illustrative motion — no real telemetry. */
const STORY_SIGNALS = [
  { k: "Keystroke dwell", v: "94 ms", ok: true },
  { k: "Flight time", v: "142 ms", ok: true },
  { k: "Device hash", v: "matches baseline", ok: true },
  { k: "Screen-share", v: "not detected", ok: true },
  { k: "Clipboard paste", v: "none", ok: true },
];

function LoginStory() {
  const [bars, setBars] = useState<number[]>(() => Array.from({ length: 28 }, (_, i) => 30 + ((i * 37) % 55)));
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setBars((b) => [...b.slice(1), 25 + Math.random() * 65]);
      setActive((a) => (a + 1) % STORY_SIGNALS.length);
    }, 900);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="zp-login-story" style={{ position: "relative", margin: 16, borderRadius: 24, overflow: "hidden", background: "#AA412A", color: "#fff", padding: "56px 48px", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 620 }}>
      {[[6, 14, 0.14], [24, 9, 0.08], [58, 16, 0.12], [82, 11, 0.1]].map(([x, w, o], k) => (
        <motion.div key={k} aria-hidden
          animate={{ opacity: [o, o * 1.8, o] }} transition={{ duration: 6 + k, repeat: Infinity, ease: "easeInOut" }}
          style={{ position: "absolute", top: 0, bottom: 0, left: `${x}%`, width: `${w}%`, background: "#fff", filter: "blur(18px)", pointerEvents: "none" }} />
      ))}

      <div style={{ position: "relative" }}>
        <div className="cc-mono" style={{ color: "rgba(255,255,255,.8)" }}>ZipPay × Citadel</div>
        <motion.h2 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 400, fontSize: "clamp(38px, 3.6vw, 56px)", lineHeight: 1.04, letterSpacing: "-0.02em", margin: "22px 0 0", maxWidth: 480 }}>
          Banking that knows it's really you.
        </motion.h2>
        <p style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 20, lineHeight: 1.3, color: "#F1EAE7", margin: "18px 0 0", maxWidth: 420 }}>
          Every keystroke, tap and device signal is checked against your own behavior — before money moves.
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ position: "relative", marginTop: 40, borderRadius: 18, background: "rgba(16,15,15,.18)", border: "1px solid rgba(255,255,255,.16)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", overflow: "hidden" }}>
        <div className="cc-mono" style={{ display: "flex", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,.12)", color: "rgba(255,255,255,.75)" }}>
          <span>Live behavioral signal</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9BE3B4" }} className="status-pulse" /> streaming
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 70, padding: "14px 18px 0" }}>
          {bars.map((h, i) => (
            <motion.span key={i} animate={{ height: `${h}%` }} transition={{ duration: 0.5 }}
              style={{ flex: 1, borderRadius: 2, background: i === bars.length - 1 ? "#fff" : "rgba(255,255,255,.45)" }} />
          ))}
        </div>
        <div style={{ padding: "8px 0 6px" }}>
          {STORY_SIGNALS.map((s, i) => (
            <div key={s.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 18px", transition: "background .4s", background: i === active ? "rgba(255,255,255,.08)" : "transparent" }}>
              <span className="cc-mono" style={{ color: "rgba(255,255,255,.65)" }}>{s.k}</span>
              <span style={{ fontSize: 14, color: "#fff", display: "inline-flex", alignItems: "center", gap: 8 }}>
                {s.v}
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.ok ? "#9BE3B4" : "#F5C77A" }} />
              </span>
            </div>
          ))}
        </div>
      </motion.div>

      <div style={{ position: "relative", display: "flex", gap: 36, marginTop: 40, flexWrap: "wrap" }}>
        {[["< 80 ms", "decision"], ["40+", "signals / session"], ["SHAP", "explained"]].map(([v, l]) => (
          <div key={l}>
            <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 34, fontWeight: 300, lineHeight: 1 }}>{v}</div>
            <div className="cc-mono" style={{ color: "rgba(255,255,255,.7)", marginTop: 8 }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoginScreen({
  accounts, onLogin, onRegisterSuccess, onGoogleLogin, loggingIn, loginError, onExportPDF, onRemoveAccount, onAuthFailed
}: {
  accounts: Account[];
  onLogin: (acc: Account, userText: string, passText: string, faceMatched?: boolean, confidence?: number, noFace?: boolean, faceImage?: string) => void;
  onRegisterSuccess: (acc: Account, duressData: any, password: string) => void;
  onGoogleLogin: (credential: string, isMock: boolean) => void;
  loggingIn: string | null;
  loginError: string | null;
  onExportPDF: () => void;
  onRemoveAccount?: (accId: string) => void;
  onAuthFailed?: (err: LoginError) => void;
}) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  // The Customer ID is draft-backed so a half-typed sign-in survives a
  // reload. The password is deliberately NOT drafted — credentials never
  // touch localStorage. There is no separate profile picker: the typed
  // Customer ID IS the account selection.
  const [userText, setUserText] = useDraftState(LOGIN_DRAFT, "userText", "");
  const [passText, setPassText] = useState("");

  const handleRemoveClick = (accId: string) => {
    onRemoveAccount?.(accId);
    if (userText.trim().toLowerCase() === accId) setUserText("");
  };
  const [verifyingFace, setVerifyingFace] = useState(false);
  // True while the backend is verifying the typed credentials.
  const [authenticating, setAuthenticating] = useState(false);
  // Login held between the camera check and the voice verification.
  const [pendingLogin, setPendingLogin] = useState<{ res: FaceVerifyResult } | null>(null);
  const [voiceVerdict, setVoiceVerdict] = useState<VoiceVerdict | null>(null);
  // The voice service can be down or the call can go unanswered; after 45s the
  // customer gets an explicit fallback instead of a button that never enables.
  const [voiceTimedOut, setVoiceTimedOut] = useState(false);
  const [mfaTab, setMfaTab] = useState<"faceid" | "totp">("faceid");
  const [localError, setLocalError] = useState<string | null>(null);
  const trapped = useRef(false);  // set if the DOM honeypot is filled (bot signal)

  // Google OAuth states
  const [showGoogleChooser, setShowGoogleChooser] = useState(false);
  const [customGoogleName, setCustomGoogleName] = useState("");
  const [customGoogleEmail, setCustomGoogleEmail] = useState("");

  // Resolved from whatever Customer ID is typed — a known, already-registered
  // account if one matches, otherwise a placeholder just rich enough for the
  // MFA steps below (avatar/color are re-supplied by the real account record
  // once the backend confirms who this is on successful login).
  const typedId = userText.trim().toLowerCase();
  const activeAcc: Account | null = typedId
    ? accounts.find(a => a.id === typedId) ?? {
        id: typedId, name: userText.trim(), accountNo: "", ifsc: "", upiId: `${typedId}@zippay`,
        avatar: typedId.slice(0, 2).toUpperCase(), imeiHash: DEMO_LEGIT_IMEI, color: "var(--color-primary)",
      }
    : null;

  // Voice-MFA availability timeout: if no verdict lands within 45s of the
  // voice step starting, surface a fallback path instead of blocking forever.
  useEffect(() => {
    if (!pendingLogin || voiceVerdict) { setVoiceTimedOut(false); return; }
    const t = window.setTimeout(() => setVoiceTimedOut(true), 45_000);
    return () => window.clearTimeout(t);
  }, [pendingLogin, voiceVerdict]);

  // null = still trying, true = Google drew its button, false = it never did.
  // Needed because renderButton fails silently: an unauthorised JavaScript
  // origin, a blocked gsi/client script or a FedCM refusal all leave the
  // container empty with no error thrown and no callback fired. Rendering only
  // that container meant the user got a blank gap and nothing to click, which
  // is indistinguishable from the feature being broken.
  const [googleRendered, setGoogleRendered] = useState<boolean | null>(null);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    const initGoogleButton = () => {
      if (window.google?.accounts?.id) {
        try {
          // Popup mode, not redirect mode.
          //
          // ux_mode:"redirect" posts to login_uri, and Google requires that
          // exact URL to be registered as an Authorized redirect URI — every
          // origin the app is served from (localhost, each Vercel deployment)
          // needs its own entry, and anything unregistered fails with
          // "Error 400: redirect_uri_mismatch" before the user ever reaches
          // the app.
          //
          // Popup mode hands the credential straight to this callback, so no
          // redirect URI exists to mismatch. Only the JavaScript origin has to
          // be authorised, which is required either way. The credential then
          // goes to POST /api/auth/google, which already verifies it with
          // google.oauth2.id_token exactly as the redirect callback did.
          window.google.accounts.id.initialize({
            client_id: clientId,
            ux_mode: "popup",
            callback: (response: { credential?: string }) => {
              if (response?.credential) onGoogleLogin(response.credential, false);
            },
          });

          const container = document.getElementById("google-signin-btn-container");
          if (container) {
            window.google.accounts.id.renderButton(container, {
              theme: "outline",
              size: "large",
              width: container.clientWidth || 360,
              text: "signin_with",
              shape: "rectangular"
            });
            // renderButton is fire-and-forget and throws nothing when the
            // origin is not authorised — the only observable signal is that
            // the container stays empty. Give it a moment, then decide.
            window.setTimeout(() => {
              const drew = container.childElementCount > 0;
              setGoogleRendered(drew);
              if (!drew) {
                console.error(
                  "Google Sign-In did not render. The most common cause is that this " +
                  "page's origin (" + window.location.origin + ") is not listed under " +
                  "Authorized JavaScript origins for client ID " + String(clientId).slice(0, 24) + "…"
                );
              }
            }, 1200);
          }
        } catch (err) {
          console.error("Failed to initialize Google Sign-In:", err);
          setGoogleRendered(false);
        }
      }
    };

    let retries = 0;
    const interval = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(interval);
        initGoogleButton();
      } else {
        retries++;
        // gsi/client never loaded (blocked, offline, CSP). Stop waiting and
        // fall back rather than leaving an empty slot forever.
        if (retries > 20) {
          clearInterval(interval);
          setGoogleRendered(false);
          console.error("Google Sign-In script (accounts.google.com/gsi/client) did not load.");
        }
      }
    }, 200);

    const handleResize = () => {
      initGoogleButton();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", handleResize);
    };
  }, [onGoogleLogin, activeTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loggingIn || authenticating) return;
    // Active Deception: honeypot filled → bot. Refuse to authenticate.
    if (trapped.current) { setLocalError("Automated bot detected — access blocked (IP blacklisted)."); return; }
    setLocalError(null);
    if (!activeAcc || !passText) { setLocalError("Enter your Customer ID and password."); return; }

    // The backend is the single credential authority. The typed Customer ID is
    // what gets verified; the selected profile only supplies display/device
    // context for the session that follows.
    setAuthenticating(true);
    try {
      const ip = await getPublicIp().catch(() => "");
      await loginCustomer(userText.trim(), passText, { ip_address: ip || null });
      // Credentials accepted — continue to biometric step-up (face/TOTP, then voice).
      const preferred = localStorage.getItem(`mfa_method_${activeAcc.id}`);
      setMfaTab(preferred === "totp" ? "totp" : "faceid");
      setVerifyingFace(true);
    } catch (err) {
      const le = err instanceof LoginError ? err : new LoginError(0, "Sign-in failed — try again.");
      setLocalError(le.message);
      // Let the parent surface the failed attempt in the risk telemetry feed.
      onAuthFailed?.(le);
    } finally {
      setAuthenticating(false);
    }
  };

  // After the camera check, hold the login and run the voice verification.
  // The args are parked rather than dispatched so the sign-in only completes
  // once the agent has confirmed it — otherwise the call would be advisory and
  // the customer would already be inside the account while it rang.
  const handleFaceResult = (res: FaceVerifyResult) => {
    setVerifyingFace(false);
    setPendingLogin({ res });
  };

  const completePendingLogin = () => {
    if (!pendingLogin || !activeAcc) return;
    const { res } = pendingLogin;
    setPendingLogin(null);
    setVoiceVerdict(null);
    clearDraft(LOGIN_DRAFT); // credentials have been used — don't leave them parked

    // "No enrolled face" is not "the wrong face".
    //
    // The comparison in FaceVerification only runs when a stored descriptor
    // exists; with none it leaves matched=false, confidence=0 untouched. That
    // false then reaches the login handler, which reads `faceMatched === false`
    // as a positive mismatch and raises a HARD_BLOCK reading "Face mismatch
    // (Match confidence: 0%). Intruder warning activated." — so an account that
    // simply never enrolled Face ID, or that enrolled it in another browser,
    // gets locked out as an intruder. The exact 0% is the tell: nothing was
    // ever compared.
    //
    // faceMatched is optional and the handler already treats undefined as
    // "not evaluated", so pass that instead of a verdict we never reached.
    // A real mismatch (a stored descriptor that did not match) still sends
    // false and still blocks.
    //
    // A positive result always counts, whatever hasRegisteredFace says — the
    // authenticator path returns matched:true with hasRegisteredFace:false
    // because TOTP has no face to enrol, and dropping that would throw away a
    // verification that did succeed. Only a *negative* needs a reference to
    // mean anything.
    const faceVerdict = res.matched ? true : res.hasRegisteredFace ? false : undefined;
    onLogin(activeAcc, userText, passText, faceVerdict, res.confidence, res.noFaceDetected, res.image);
  };

  const activeError = loginError || localError;

  return (
    <div className="zp-login-grid" style={{ width: "100%", maxWidth: "100%", minHeight: "calc(100dvh - 56px)", background: "#FFFFFF", fontFamily: "'Inter', sans-serif", position: "relative", boxSizing: "border-box" }}>
      <LoginStory />

      <motion.div
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        style={{ position: "relative", maxWidth: activeTab === "register" ? 540 : 460, width: "100%", padding: "48px 24px", margin: "0 auto", boxSizing: "border-box", transition: "max-width 0.4s", alignSelf: "center" }}
      >
        {/* Bank header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "#F7F3F1", border: "1px solid #EAE4E1", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#AA412A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.2 9.2 12 4.3l8.8 4.9" />
              <path d="M4.6 9.2h14.8" />
              <path d="M7 11.4v6.2M12 11.4v6.2M17 11.4v6.2" />
              <path d="M4.2 19.7h15.6" />
            </svg>
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 26, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.02em", fontFamily: "'Newsreader', Georgia, serif", lineHeight: 1 }}>ZipPay Bank</div>
            <div className="cc-mono" style={{ color: "#767270", marginTop: 6 }}>Secured by Citadel · Demo bank</div>
          </div>
        </div>

        {/* Tab switcher — underline tabs */}
        <div role="tablist" style={{ display: "flex", gap: 28, borderBottom: "1px solid #EAE4E1", marginBottom: 24 }}>
          {(["login", "register"] as const).map(tab => (
            <button key={tab} role="tab" aria-selected={activeTab === tab} disabled={verifyingFace}
              onClick={() => { setActiveTab(tab); setLocalError(null); }}
              style={{ position: "relative", background: "none", border: "none", padding: "0 0 12px", fontSize: 15, fontWeight: activeTab === tab ? 500 : 400, color: activeTab === tab ? "#100F0F" : "#969290", cursor: verifyingFace ? "not-allowed" : "pointer", fontFamily: "'Inter', sans-serif", transition: "color .2s" }}>
              {tab === "login" ? "Sign in" : "Open account"}
              {activeTab === tab && (
                <motion.span layoutId="zp-tab-underline" style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: 2, background: "#AA412A" }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} />
              )}
            </button>
          ))}
        </div>

        {/* Card */}
        <div className="zippay-login-card" style={{ textAlign: "left" }}>
          <AnimatePresence mode="wait">
            {activeTab === "login" ? (
              <motion.div key="login" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.25 }}>
                {pendingLogin ? (
                  /* Camera passed — now the voice check, before the session
                     is actually opened. HARD_BLOCK stops here; anything else
                     lets the customer through. */
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: 17, fontWeight: 400, color: "#100F0F", marginBottom: 5, fontFamily: "'Newsreader', Georgia, serif" }}>
                      Confirming your sign-in
                    </div>
                    <div className="login-subtitle" style={{ marginBottom: 16 }}>
                      Face verified. One last step — our security agent will confirm this sign-in with you.
                    </div>

                    <VoiceMfaPanel
                      customerId={activeAcc!.id}
                      name={activeAcc!.name}
                      phoneNumber={activeAcc!.phone}
                      purpose="login"
                      onVerdict={(v) => setVoiceVerdict(v)}
                    />

                    {voiceVerdict?.decision === "HARD_BLOCK" && (
                      <div style={{ marginTop: 14, padding: "12px 15px", borderRadius: 12, background: "rgba(179, 38, 30,0.08)", border: "1px solid rgba(179, 38, 30,0.35)", fontSize: 12, color: "#B3261E", lineHeight: 1.55 }}>
                        <strong>Sign-in refused.</strong><br />
                        {voiceVerdict.failure_reason}<br />
                        Our fraud team has been notified.
                      </div>
                    )}

                    {voiceTimedOut && !voiceVerdict && (
                      <div style={{ marginTop: 14, padding: "12px 15px", borderRadius: 12, background: "rgba(183, 121, 31,0.07)", border: "1px solid rgba(183, 121, 31,0.3)", fontSize: 12, color: "#B7791F", lineHeight: 1.55 }}>
                        <strong>Voice verification unavailable.</strong><br />
                        The confirmation call did not complete. You can continue with the
                        password + camera verification that already passed.
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
                      <button
                        onClick={completePendingLogin}
                        disabled={(!voiceVerdict && !voiceTimedOut) || voiceVerdict?.decision === "HARD_BLOCK"}
                        style={{
                          flex: 1, padding: "11px", borderRadius: 11, border: "none",
                          background: (!voiceVerdict && !voiceTimedOut) || voiceVerdict?.decision === "HARD_BLOCK"
                            ? "rgba(16, 15, 15,0.07)" : "var(--color-primary)",
                          color: (!voiceVerdict && !voiceTimedOut) || voiceVerdict?.decision === "HARD_BLOCK"
                            ? "rgba(20, 19, 19,0.35)" : "var(--color-on-primary)",
                          fontSize: 12.5, fontWeight: 700, fontFamily: "'Inter', sans-serif",
                          cursor: (!voiceVerdict && !voiceTimedOut) || voiceVerdict?.decision === "HARD_BLOCK" ? "not-allowed" : "pointer",
                        }}
                      >
                        {voiceVerdict
                          ? (voiceVerdict.decision === "HARD_BLOCK" ? "🚫 Sign-in blocked" : "Continue to dashboard →")
                          : voiceTimedOut ? "Continue with password + TOTP instead"
                            : "Complete voice check to continue"}
                      </button>
                      <button
                        onClick={() => { setPendingLogin(null); setVoiceVerdict(null); }}
                        style={{
                          padding: "11px 15px", borderRadius: 11,
                          border: "1px solid #D7D2D0", background: "transparent",
                          color: "#767270", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : verifyingFace ? (
                  mfaTab === "faceid" ? (
                    <FaceVerification userId={activeAcc!.id} userName={activeAcc!.name} onResult={handleFaceResult} onUseAuthenticator={() => setMfaTab("totp")} />
                  ) : (
                    <AuthenticatorVerify userId={activeAcc!.id} userName={activeAcc!.name} onResult={handleFaceResult} onUseFaceId={() => setMfaTab("faceid")} />
                  )
                ) : (
                  <>
                    <div className="section-label" style={{ marginBottom: 10 }}>Secure access</div>
                    <div style={{ fontSize: 34, fontWeight: 400, color: "#100F0F", marginBottom: 8, letterSpacing: "-0.02em", lineHeight: 1.05, fontFamily: "'Newsreader', Georgia, serif" }}>Welcome back.</div>
                    <div className="login-subtitle" style={{ marginBottom: 4, fontSize: 14, color: "#575452" }}>Sign in to your ZipPay dashboard.</div>
                    <div className="display-italic" style={{ fontSize: 15, color: "#AA412A", marginBottom: 22 }}>Verified by how you type, not just what you type.</div>

                    {activeError && (
                      <div style={{ padding: "10px 12px", background: "rgba(179, 38, 30,0.08)", border: "1px solid rgba(179, 38, 30,0.22)", borderRadius: 10, color: "#B3261E", fontSize: 11.5, marginBottom: 16, textAlign: "left" }}>
                        ⚠️ {activeError}
                      </div>
                    )}

                    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
                      {/* Active Deception — invisible honeypot; only a bot fills it. */}
                      <HoneyTrap
                        sessionId={null}
                        onTrapTriggered={() => { trapped.current = true; setLocalError("Automated bot detected — access blocked (IP blacklisted)."); }}
                      />
                      <div>
                        <div className="login-field-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>Customer ID</span>
                          {accounts.some(a => a.id === typedId) && (
                            <button
                              type="button"
                              onClick={() => handleRemoveClick(typedId)}
                              style={{ background: "none", border: "none", color: "#B3261E", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}
                              title="Forget this profile on this device"
                            >
                              🗑️ Forget profile
                            </button>
                          )}
                        </div>
                        <input value={userText} onChange={e => setUserText(e.target.value)} placeholder="Customer ID" required autoComplete="off" className="premium-input zippay-login-field" style={{ width: "100%", boxSizing: "border-box", padding: "13px 14px", borderRadius: 6, fontSize: 15, background: "#FFFFFF", border: "1px solid #D7D2D0", outline: "none", fontFamily: "'Inter',sans-serif" }} />
                      </div>

                      <div>
                        <div className="login-field-label">Password</div>
                        <input type="password" value={passText} onChange={e => setPassText(e.target.value)} placeholder="Password" required autoComplete="off" className="premium-input zippay-login-field" style={{ width: "100%", boxSizing: "border-box", padding: "13px 14px", borderRadius: 6, fontSize: 15, background: "#FFFFFF", border: "1px solid #D7D2D0", outline: "none", fontFamily: "'Inter',sans-serif" }} />
                      </div>

                      <motion.button type="submit" className="login-submit" disabled={!!loggingIn || authenticating} whileHover={{ scale: (loggingIn || authenticating) ? 1 : 1.01 }} whileTap={{ scale: 0.985 }}>
                        {(loggingIn || authenticating) ? "Verifying identity…" : (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
                              <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
                            </svg>
                            Secure login
                          </>
                        )}
                      </motion.button>

                      {/* Divider */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }}>
                        <div style={{ flex: 1, height: 1, background: "rgba(16, 15, 15,0.06)" }} />
                        <span style={{ fontSize: 9, color: "#969290", fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>OR</span>
                        <div style={{ flex: 1, height: 1, background: "rgba(16, 15, 15,0.06)" }} />
                      </div>

                      {/* Google Sign-in Button / Container.
                          The container is kept mounted whenever a client ID is
                          configured — Google needs the node to exist to draw
                          into. The fallback below is shown *in addition* only
                          once we know Google did not draw, so the user is never
                          left with an empty slot. */}
                      {import.meta.env.VITE_GOOGLE_CLIENT_ID && (
                        <div
                          id="google-signin-btn-container"
                          style={{
                            width: "100%",
                            display: googleRendered === false ? "none" : "flex",
                            justifyContent: "center",
                            marginTop: 4,
                            minHeight: googleRendered === false ? 0 : 40
                          }}
                        />
                      )}
                      {import.meta.env.VITE_GOOGLE_CLIENT_ID && googleRendered === false && (
                        <div style={{ fontSize: 10.5, color: "#B7791F", textAlign: "center", marginTop: 2, lineHeight: 1.5 }}>
                          Google Sign-In could not load for this domain — using the demo
                          picker. (Add {typeof window !== "undefined" ? window.location.origin : ""} to
                          Authorized JavaScript origins.)
                        </div>
                      )}
                      {(!import.meta.env.VITE_GOOGLE_CLIENT_ID || googleRendered === false) && (
                        <motion.button
                          type="button"
                          onClick={() => setShowGoogleChooser(true)}
                          disabled={!!loggingIn}
                          whileHover={{ scale: loggingIn ? 1 : 1.01 }}
                          whileTap={{ scale: 0.98 }}
                          style={{
                            width: "100%", padding: "12px 18px", borderRadius: 6, border: "1px solid #D7D2D0",
                            background: "#FFFFFF", color: "#100F0F", fontSize: 14, fontWeight: 500,
                            cursor: loggingIn ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                            gap: 10, transition: "all 0.2s"
                          }}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" />
                          </svg>
                          Sign in with Google (Mock)
                        </motion.button>
                      )}

                      <div style={{ textAlign: "center", fontSize: 11.5, color: "#767270", marginTop: 4 }}>
                        Don't have an account?{" "}
                        <button type="button" onClick={() => setActiveTab("register")}
                          style={{ background: "none", border: "none", color: "#2A2726", cursor: "pointer", fontSize: 11.5, fontWeight: 600, padding: 0, textDecoration: "underline", textDecorationColor: "rgba(170, 65, 42,0.5)", textUnderlineOffset: 3 }}>
                          Open an account
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div key="register" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
                <div style={{ fontSize: 34, fontWeight: 400, color: "#100F0F", marginBottom: 8, letterSpacing: "-0.02em", lineHeight: 1.05, fontFamily: "'Newsreader', Georgia, serif" }}>Open a bank account.</div>
                <div className="login-subtitle" style={{ marginBottom: 18 }}>Register your ID, password, and bank details.</div>
                <RegisterPanel onBack={() => setActiveTab("login")} onRegisterSuccess={onRegisterSuccess} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Citadel badge */}
        <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid #EAE4E1", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
          <div className="cc-mono" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#575452" }}>
            <span style={{ position: "relative", display: "inline-flex", width: 7, height: 7 }}>
              <span className="cc-ping" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#3D8B5A", opacity: 0.6 }} />
              <span style={{ position: "relative", width: 7, height: 7, borderRadius: "50%", background: "#3D8B5A" }} />
            </span>
            Citadel shield active · telemetry streaming
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-start" }}>
            {([
              { label: "Login threat audit PDF", onClick: onExportPDF },
              // Financial Gravity moved into the FIU console; /demo/gravity
              // only redirects there now, so link straight to the real home.
              { label: "Intent AI forecast", onClick: () => navigate("/admin/dashboard") },
              { label: "Admin portal", onClick: () => navigate("/admin") },
            ] as const).map(({ label, onClick }) => (
              <button key={label} type="button" onClick={onClick}
                style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #EAE4E1", background: "#FFFFFF", color: "#575452", fontSize: 12.5, fontWeight: 500, cursor: "pointer", transition: "background 0.2s, color 0.2s, border-color 0.2s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#F7F3F1"; e.currentTarget.style.color = "#100F0F"; e.currentTarget.style.borderColor = "#D7D2D0"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#FFFFFF"; e.currentTarget.style.color = "#575452"; e.currentTarget.style.borderColor = "#EAE4E1"; }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Google Account Chooser Modal Overlay */}
      <AnimatePresence>
        {showGoogleChooser && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(16, 15, 15, 0.28)",
            backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 1000, padding: 16
          }}>
            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 15, scale: 0.96 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              style={{
                background: "#FFFFFF", borderRadius: 20, padding: "30px 26px",
                maxWidth: 400, width: "100%", border: "1px solid #EAE4E1",
                boxShadow: "0 30px 80px -20px rgba(16,15,15,0.35)", textAlign: "center",
                display: "flex", flexDirection: "column", gap: 0
              }}
            >
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                <svg width="28" height="28" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              </div>

              <div style={{ fontSize: 26, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.015em", marginBottom: 4, fontFamily: "'Newsreader', Georgia, serif" }}>Sign in with Google</div>
              <div style={{ fontSize: 11, color: "#767270", marginBottom: 18 }}>Select an account to continue to ZipPay Bank</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "left", marginBottom: 14 }}>
                {[
                  { name: "FIU Audit Team", email: "fiu.audit@citadel.dev", avatar: "💼" },
                  { name: "RBI FREE-AI Evaluator", email: "rbi.auditor@gmail.com", avatar: "🛡️" },
                  { name: "Danish Dev", email: "danish.dev@gmail.com", avatar: "💻" }
                ].map(profile => (
                  <button
                    key={profile.email}
                    type="button"
                    onClick={() => {
                      const payload = {
                        email: profile.email,
                        name: profile.name,
                        picture: `https://api.dicebear.com/7.x/adventurer/svg?seed=${profile.name.replace(/\s+/g, '')}`
                      };
                      const mockToken = "mock_" + btoa(JSON.stringify(payload));
                      onGoogleLogin(mockToken, true);
                      setShowGoogleChooser(false);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, width: "100%",
                      padding: "12px 14px", borderRadius: 10, border: "1px solid #EAE4E1",
                      background: "#FFFFFF", cursor: "pointer", transition: "all 0.2s",
                      outline: "none"
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#F7F3F1"; e.currentTarget.style.borderColor = "#D7D2D0"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#FFFFFF"; e.currentTarget.style.borderColor = "#EAE4E1"; }}
                  >
                    <div style={{ fontSize: 18 }}>{profile.avatar}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#100F0F" }}>{profile.name}</div>
                      <div style={{ fontSize: 11, color: "#767270", fontFamily: "'DM Mono', monospace" }}>{profile.email}</div>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 500, color: "#AA412A", background: "rgba(170,65,42,0.08)", padding: "3px 8px", borderRadius: 6, fontFamily: "'DM Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase" }}>Mock</div>
                  </button>
                ))}

                {/* Custom Mock Account Form */}
                <div style={{ marginTop: 6, borderTop: "1px solid #EAE4E1", paddingTop: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#575452", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Use Custom Mock Account:</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <input
                      placeholder="Name (e.g. John Doe)"
                      value={customGoogleName}
                      onChange={e => setCustomGoogleName(e.target.value)}
                      style={{
                        width: "100%", boxSizing: "border-box", padding: "8px 12px",
                        borderRadius: 6, fontSize: 13, border: "1px solid #EAE4E1",
                        outline: "none", color: "#100F0F", background: "#FFFFFF"
                      }}
                    />
                    <input
                      placeholder="Email (e.g. john@example.com)"
                      value={customGoogleEmail}
                      onChange={e => setCustomGoogleEmail(e.target.value)}
                      style={{
                        width: "100%", boxSizing: "border-box", padding: "8px 12px",
                        borderRadius: 6, fontSize: 13, border: "1px solid #EAE4E1",
                        outline: "none", color: "#100F0F", background: "#FFFFFF"
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!customGoogleEmail || !customGoogleName) return;
                        const payload = {
                          email: customGoogleEmail.trim().toLowerCase(),
                          name: customGoogleName.trim(),
                          picture: `https://api.dicebear.com/7.x/adventurer/svg?seed=${customGoogleName.replace(/\s+/g, '')}`
                        };
                        const mockToken = "mock_" + btoa(JSON.stringify(payload));
                        onGoogleLogin(mockToken, true);
                        setShowGoogleChooser(false);
                      }}
                      style={{
                        padding: "11px", borderRadius: 6, border: "none",
                        background: "#AA412A",
                        color: "#FFFFFF", fontSize: 13, fontWeight: 500,
                        cursor: "pointer"
                      }}
                    >
                      Authenticate Custom Account
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowGoogleChooser(false)}
                style={{
                  background: "none", border: "none", color: "#767270",
                  fontSize: 10.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline",
                  marginTop: 6
                }}
              >
                Cancel
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ZipPayBankPage() {
  const location = useLocation();
  // Auth + account state
  const [loggedIn, setLoggedIn]     = useState(false);
  const [account, setAccount]       = useState<Account | null>(null);
  const [authToken, setAuthToken]   = useState<string | null>(null);
  const [loggingIn, setLoggingIn]   = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Continuous Telemetry States
  const [inSessionRATSim, setInSessionRATSim] = useState(false);
  const [inSessionHandoverSim, setInSessionHandoverSim] = useState(false);
  const [identityDriftIndex, setIdentityDriftIndex] = useState(12);
  const [sessionLocked, setSessionLocked] = useState(false);

  // In-session drift simulation logic
  useEffect(() => {
    if (!loggedIn) {
      setInSessionRATSim(false);
      setInSessionHandoverSim(false);
      setIdentityDriftIndex(12);
      setSessionLocked(false);
      return;
    }

    let driftVal = 12;
    const interval = setInterval(() => {
      if (inSessionRATSim || inSessionHandoverSim) {
        driftVal = Math.min(100, driftVal + Math.floor(Math.random() * 12) + 12);
      } else {
        driftVal = Math.max(8, Math.min(22, driftVal + (Math.random() > 0.5 ? 1 : -1)));
      }
      setIdentityDriftIndex(driftVal);

      if (driftVal >= 85 && !sessionLocked) {
        setSessionLocked(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [loggedIn, inSessionRATSim, inSessionHandoverSim, sessionLocked]);

  // Capture real mouse movements and scroll actions when logged in
  useEffect(() => {
    if (!loggedIn || sessionLocked) return;

    const handleMouse = () => {
      setSignals(prev => ({ ...prev, mouse: prev.mouse + 1 }));
    };
    const handleScroll = () => {
      setSignals(prev => ({ ...prev, touch: prev.touch + 1 }));
    };

    window.addEventListener("mousemove", handleMouse);
    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("mousemove", handleMouse);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [loggedIn, sessionLocked]);

  const [wrongPassAttempts, setWrongPassAttempts] = useState<Record<string, number>>({});
  const [threatScore, setThreatScore] = useState(0);
  const [vpnBlockedOverlay, setVpnBlockedOverlay] = useState<{ ip: string; country?: string; city?: string; reason?: string } | null>(null);
  const typewriterIntervalRef = useRef<any>(null);





  const [accounts, setAccounts]     = useState<Account[]>(() => {
    const saved = localStorage.getItem("registered_accounts");
    const parsed = saved ? JSON.parse(saved) : [];
    return [...ACCOUNTS, ...parsed];
  });

  // Pull registered accounts from the database as well as localStorage.
  // localStorage alone meant an account registered in one browser did not
  // appear in any other — a user could create a profile and then not find it
  // in the picker on a different machine. Anything already present (demo
  // accounts, or a local registration not yet synced) wins, so this only ever
  // adds profiles and never overwrites richer local data.
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/api/auth/registered-accounts"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.accounts?.length) return;
        setAccounts((prev) => {
          const known = new Set(prev.map((a) => a.id));
          const extra: Account[] = data.accounts
            .filter((a: { id: string }) => a.id && !known.has(a.id))
            .map((a: { id: string; name?: string; upi_id?: string }) => ({
              id: a.id,
              name: a.name || a.id,
              accountNo: "•••• •••• ••••",
              ifsc: "ZIPB0001234",
              upiId: a.upi_id || `${a.id}@zippay`,
              avatar: (a.name || a.id).slice(0, 2).toUpperCase(),
              imeiHash: "",
              color: "#F5D90A",
            }));
          return extra.length ? [...prev, ...extra] : prev;
        });
      })
      .catch(() => { /* picker still works from localStorage */ });
    return () => { cancelled = true; };
  }, []);

  const handleRemoveAccount = async (accId: string) => {
    try {
      await fetch(apiUrl(`/api/auth/registered-account/${accId}`), { method: "DELETE" });
    } catch (e) {}
    setAccounts((prev) => {
      const updated = prev.filter((a) => a.id !== accId);
      const registeredOnly = updated.filter((a) => !ACCOUNTS.some((original) => original.id === a.id));
      localStorage.setItem("registered_accounts", JSON.stringify(registeredOnly));
      return updated;
    });
  };

  const handleRegisterSuccess = async (newAcc: Account, duressData: any, password: string) => {
    setAccounts(prev => {
      const updated = [...prev, newAcc];
      const uniq = updated.filter((item, index, self) => self.findIndex(t => t.id === item.id) === index);
      const registeredOnly = uniq.filter(a => !ACCOUNTS.some(original => original.id === a.id));
      localStorage.setItem("registered_accounts", JSON.stringify(registeredOnly));
      return uniq;
    });
    setBalances(prev => ({ ...prev, [newAcc.id]: 25000 }));
    setTxnHistory(prev => ({ ...prev, [newAcc.id]: [] }));

    // Sync custom registration to backend API so it shows up in real-time on admin panel
    const faceImg = localStorage.getItem(`face_img_${newAcc.id}`);
    
    // Capture public IP + browser geolocation for device fingerprint baseline
    let publicIp: string | undefined;
    let regLat: number | undefined;
    let regLng: number | undefined;
    try {
      const ip = await getPublicIp();
      if (ip) publicIp = ip;
    } catch { /* non-critical */ }
    try {
      await new Promise<void>((resolve) => {
        navigator.geolocation?.getCurrentPosition(
          (pos) => { regLat = pos.coords.latitude; regLng = pos.coords.longitude; resolve(); },
          () => resolve(),
          { timeout: 3000 }
        );
      });
    } catch { /* non-critical */ }

    fetch(apiUrl("/api/auth/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: newAcc.id,
        password: password,
        name: newAcc.name,
        bank_id: "PSB",
        face_image: faceImg || null,
        ip_address: publicIp || null,
        latitude: regLat ?? null,
        longitude: regLng ?? null,
        imei_hash: newAcc.imeiHash || null,
        phone_number: newAcc.phone || null,
        upi_id: newAcc.upiId || null,
      }),
    })
    .then(async (res) => {
      if (res.ok) {
        // Automatically obtain JWT token for this user
        const loginRes = await fetch(apiUrl("/api/auth/login"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customer_id: newAcc.id,
            password: password,
            ip_address: publicIp || null,
          }),
        });
        if (loginRes.ok) {
          const loginData = await loginRes.json();
          if (loginData.access_token) {
            setToken(loginData.access_token);
            setAuthToken(loginData.access_token);

            // Sync the Duress PIN & Contacts to the backend immediately
            if (duressData) {
              fetch(apiUrl("/api/duress/setup"), {
                method: "POST",
                headers: { 
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${loginData.access_token}`
                },
                body: JSON.stringify(duressData)
              })
              .then(dRes => {
                if (dRes.ok) {
                  addEv("success", "✅ Duress configuration registered successfully");
                } else {
                  console.warn("Duress sync failed during registration");
                }
              })
              .catch(err => console.warn("Failed to sync duress settings:", err));
            }
          }
        }
      }
    })
    .catch((err) => console.warn("Backend registration sync failed:", err));
  };


  // Balances (shared — updates when transfers happen)
  const [balances, setBalances]     = useState<Record<string, number>>(loadBalances);

  // Transaction history per account
  const [txnHistory, setTxnHistory] = useState<Record<string, Transaction[]>>(loadTxnHistory);

  // Keep money and history alongside "registered_accounts" so a registered
  // account is not reduced to ₹0 with an empty ledger on its next visit.
  useEffect(() => {
    try { localStorage.setItem(BALANCES_KEY, JSON.stringify(balances)); } catch { /* quota */ }
  }, [balances]);
  useEffect(() => {
    try { localStorage.setItem(TXNS_KEY, JSON.stringify(txnHistory)); } catch { /* quota */ }
  }, [txnHistory]);

  // ── QR Fraud Scanner state ───────────────────────────────────────────────────
  const [qrModalOpen, setQrModalOpen]   = useState(false);
  const [qrScanning, setQrScanning]     = useState(false);
  const [qrScanStep, setQrScanStep]     = useState(0);   // 0=idle 1=decode 2=extract 3=virustotal 4=done
  const [qrResult, setQrResult]         = useState<null | {
    verdict: string; risk_score: number; vpa: string; payee_name: string;
    amount: string; flags: string[]; vt_stats: Record<string, number>;
    vt_permalink: string; scan_id: string; payment_blocked: boolean;
  }>(null);
  const [qrImagePreview, setQrImagePreview] = useState<string | null>(null);
  const [qrDecoded, setQrDecoded]       = useState<string>("");
  const [qrError, setQrError]           = useState<string>("");
  const qrFileRef                       = useRef<HTMLInputElement>(null);
  const [qrCameraOn, setQrCameraOn]     = useState(false);
  const qrVideoRef                      = useRef<HTMLVideoElement>(null);
  const qrStreamRef                     = useRef<MediaStream | null>(null);
  const qrRafRef                        = useRef<number | null>(null);

  // UI
  const [section, setSection]       = useState<Section>("home");
  const [dnaOpen, setDnaOpen]       = useState(() => window.location.search.includes("developer=true"));
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [signOutHover, setSignOutHover] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile-only slide-in
  const [overlay, setOverlay]       = useState<{ type: Decision; score: number; reason: string; latencyMs: number } | null>(null);

  // Citadel state
  const [dnaEvents, addDnaEventRaw] = useReducer(
    (prev: DNAEvent[], ev: DNAEvent) => [...prev.slice(-79), ev],
    []
  );
  const [riskScore, setRiskScore]   = useState(0);
  const [decision, setDecision]     = useState<Decision | null>(null);
  const [signals, setSignals]       = useState({ ks: 0, mouse: 0, touch: 0 });
  const [coercionProb, setCoercionProb] = useState(0);
  const [onChain, setOnChain]       = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  // Post-Quantum Cryptography — CRYSTALS-Dilithium-3 (NIST FIPS 204)
  const [pqcVerified, setPqcVerified]   = useState(false);
  const [pqcAlgorithm, setPqcAlgorithm] = useState<string | null>(null);

  // Hackathon Upgrade States
  const [channel, setChannel]                 = useState<string>("internet_banking");
  const [rhythms, setRhythms]                 = useState<number[]>([40, 55, 45, 60, 50, 30, 45, 55, 40, 35, 45, 48, 52, 44, 46, 50, 40, 38, 42, 45]);
  const [riskHistory, setRiskHistory]         = useState<number[]>([]);
  const [activeScenario, setActiveScenario]   = useState<string | null>(null);
  const activeScenarioRef = useRef<string | null>(null);
  useEffect(() => {
    activeScenarioRef.current = activeScenario;
  }, [activeScenario]);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setActiveScenario(null);
    setRiskScore(0);
    setDecision(null);
    setCoercionProb(0);
    setOnChain(false);
  }, []);

  const [showRecovery, setShowRecovery] = useState(false);
  
  const [aiInvestigating, setAiInvestigating] = useState<boolean>(false);
  const [aiTypewriterText, setAiTypewriterText] = useState<string>("");
  const [lastSessionId, setLastSessionId]     = useState<string>("");

  // Transfer form
  const [xferTo, setXferTo]         = useState("");
  const [xferAmt, setXferAmt]       = useState("5000");
  const [xferNote, setXferNote]     = useState("Monthly rent");
  // Duress PIN — entered in same PIN field as normal transfer confirm
  const [xferPin, setXferPin]       = useState("");
  const [showXferPin, setShowXferPin] = useState(false);

  // ── Duress PIN Emergency Mode state ─────────────────────────────────────────
  const [duressActivating, setDuressActivating] = useState(false);
  const [duressActive, setDuressActive] = useState<{
    incidentId: string;
    lat: number | null;
    lon: number | null;
    activatedAt: string;
  } | null>(null);
  const duressIntervalRef = useRef<any>(null);      // 30-second location push
  // Security settings panel in profile
  const [showDuressSetup, setShowDuressSetup] = useState(false);
  const [duressSetupDone, setDuressSetupDone] = useState(false);
  const [duressSetupPin, setDuressSetupPin] = useState("");
  const [duressSetupConfirm, setDuressSetupConfirm] = useState("");
  const [duressContact1Name, setDuressContact1Name] = useState("");
  const [duressContact1Phone, setDuressContact1Phone] = useState("");
  const [duressContact2Name, setDuressContact2Name] = useState("");
  const [duressContact2Phone, setDuressContact2Phone] = useState("");
  const [duressSetupError, setDuressSetupError] = useState<string | null>(null);
  const [duressSetupLoading, setDuressSetupLoading] = useState(false);

  // UPI form
  const [upiAmt, setUpiAmt]         = useState("1500");
  const [upiTo, setUpiTo]           = useState("merchant@razorpay");
  const [upiName, setUpiName]       = useState("ZipMart Store");

  // Refs
  const sdkRef      = useRef<BehaviorSDK | null>(null);
  const sdkSessRef  = useRef<string>("");

  // Auto-initialize BehaviorSDK on mount so keystrokes typed at LoginScreen are captured immediately
  useEffect(() => {
    if (!sdkRef.current) {
      const initSess = crypto.randomUUID();
      sdkSessRef.current = initSess;
      setLastSessionId(initSess);
      sdkRef.current = new BehaviorSDK({
        apiUrl: API_BASE,
        userId: account?.id || "login_guest",
        channel: "internet_banking",
        imeiHash: DEMO_LEGIT_IMEI,
        flushIntervalMs: 500,
      });
      sdkRef.current.start();
    }

    const handleKey = () => setSignals(prev => ({ ...prev, ks: prev.ks + 1 }));
    const handleMouse = () => setSignals(prev => ({ ...prev, mouse: prev.mouse + 1 }));
    const handleTouch = () => setSignals(prev => ({ ...prev, touch: prev.touch + 1 }));

    window.addEventListener("keydown", handleKey);
    window.addEventListener("mousemove", handleMouse);
    window.addEventListener("touchstart", handleTouch);

    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("mousemove", handleMouse);
      window.removeEventListener("touchstart", handleTouch);
      if (sdkRef.current) {
        sdkRef.current.stop();
        sdkRef.current = null;
      }
    };
  }, []);

  const calculateThreatScore = useCallback((
    acc: Account,
    faceMatched?: boolean,
    _faceConfidence?: number,
    noFace?: boolean,
    localWrongAttempts?: number
  ) => {
    let score = 0;

    // 1. Biometrics (Max: 40 points)
    if (faceMatched === false) {
      score += noFace ? 40 : 35;
    } else if (faceMatched === true) {
      score += 0;
    } else {
      score += 15;
    }

    // 2. Incorrect Password attempts (Max: 30 points)
    const attempts = localWrongAttempts !== undefined ? localWrongAttempts : (wrongPassAttempts[acc.id] || 0);
    score += Math.min(attempts * 10, 30);

    // 3. Device IMEI Risk (Max: 20 points)
    if (acc.imeiHash === DEMO_ATTACKER_IMEI) {
      score += 20;
    }

    // 4. Behavioral Telemetry / Hesitation (Max: 10 points)
    if (signals.ks > 0 && coercionProb > 0.6) {
      score += 10;
    } else if (riskScore > 600) {
      score += 8;
    }

    return Math.min(score, 100);
  }, [wrongPassAttempts, signals, coercionProb, riskScore]);

  const addEv = useCallback((level: DNAEvent["level"], msg: string, score?: number, decision?: string) => {
    addDnaEventRaw(mkEvent(level, msg, score, decision));
  }, []);

  const handleRecoverySuccess = useCallback(async () => {
    try {
      const targetUserId = account?.id || "Harsh";
      const token = authToken || (await ensureDemoToken());
      await fetch(apiUrl("/api/auth/demo/reset"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ customer_id: targetUserId, user_id: targetUserId })
      });
    } catch (e) {
      console.warn("Demo reset failed:", e);
    }
    closeOverlay();
    setWrongPassAttempts({});
    setShowRecovery(false);
    addEv("success", "✅ Biometric blink recovery passed. Account unblocked.");
  }, [account, authToken, closeOverlay, addEv]);

  const sendTwilioWhatsApp = async (name: string) => {

    // 1. Detect OS
    let os = "Unknown OS";
    if (navigator.userAgent.indexOf("Win") !== -1) os = "Windows";
    else if (navigator.userAgent.indexOf("Mac") !== -1) os = "MacOS";
    else if (navigator.userAgent.indexOf("Linux") !== -1) os = "Linux";
    else if (/Android/.test(navigator.userAgent)) os = "Android";
    else if (/iPhone|iPad|iPod/.test(navigator.userAgent)) os = "iOS";

    // 2. Fetch precise GPS location using browser native API (much more accurate than IP-based)
    let location = "Delhi, India";
    let lat = 28.6139;
    let lon = 77.209;
    let ip = "Unknown IP";

    // 2a. Get IP address separately (ipapi.co just for IP, not for location)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const ipRes = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
      clearTimeout(timeoutId);
      if (ipRes.ok) {
        const ipData = await ipRes.json();
        if (ipData.ip) ip = ipData.ip;
      }
    } catch (e) {
      console.warn("IP fetch skipped:", e);
    }

    // 2b. Get accurate GPS coordinates from browser
    const gpsCoords = await new Promise<GeolocationCoordinates | null>((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos.coords),
        () => resolve(null),    // fallback if user denies permission
        { timeout: 8000, enableHighAccuracy: true, maximumAge: 0 }
      );
    });

    if (gpsCoords) {
      lat = gpsCoords.latitude;
      lon = gpsCoords.longitude;
      // 2c. Reverse geocode the GPS coordinates to city name via OpenStreetMap Nominatim
      try {
        const controller2 = new AbortController();
        const timeoutId2 = setTimeout(() => controller2.abort(), 4000);
        const revRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
          { signal: controller2.signal, headers: { "Accept-Language": "en" } }
        );
        clearTimeout(timeoutId2);
        if (revRes.ok) {
          const revData = await revRes.json();
          const addr = revData.address || {};
          const city = addr.city || addr.town || addr.village || addr.county || addr.state_district || "";
          const country = addr.country || "";
          if (city || country) location = [city, country].filter(Boolean).join(", ");
        }
      } catch (e) {
        console.warn("Reverse geocode failed:", e);
      }
    } else {
      // Fallback: use IP-based geolocation if GPS was denied
      try {
        const controller3 = new AbortController();
        const timeoutId3 = setTimeout(() => controller3.abort(), 3000);
        const geoRes = await fetch("https://ipapi.co/json/", { signal: controller3.signal });
        clearTimeout(timeoutId3);
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.city && geoData.country_name) location = `${geoData.city}, ${geoData.country_name}`;
          if (typeof geoData.latitude === "number") lat = geoData.latitude;
          if (typeof geoData.longitude === "number") lon = geoData.longitude;
          if (geoData.ip && ip === "Unknown IP") ip = geoData.ip;
        }
      } catch (e) {
        console.warn("IP geolocation fallback also failed:", e);
      }
    }

    // 3. Route request to backend /send-whatsapp proxy to bypass browser CORS blockage
    try {
      const res = await fetch(apiUrl("/api/auth/send-whatsapp"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          os,
          ip,
          location,
          latitude: lat,
          longitude: lon
        })
      });

      if (res.ok) {
        console.log("Twilio WhatsApp notification routed through backend successfully!");
      } else {
        const errTxt = await res.text();
        console.error("Twilio routing error response:", errTxt);
      }
    } catch (err) {
      console.error("Error routing Twilio WhatsApp alert:", err);
    }
  };

  // Real human-vs-script mouse-tremor sample, fed into the Advanced Security
  // gate below — collected continuously so a real sample already exists by
  // the time a login is submitted.
  const { snapshot: snapshotMotion } = useMotionSignal();

  // ── Login handler ────────────────────────────────────────────────────────────
  const handleLogin = useCallback(async (
    acc: Account,
    userText: string,
    passText: string,
    faceMatched?: boolean,
    confidence?: number,
    noFace?: boolean,
    faceImage?: string
  ) => {
    setRiskScore(0);
    setDecision(null);
    setCoercionProb(0);
    setOnChain(false);

    // Credentials were already verified against the backend in
    // LoginScreen.handleSubmit (loginCustomer) before this handler was ever
    // invoked — face/TOTP step-up runs strictly after that succeeds. There is
    // deliberately no second, client-side password check here: a check
    // against localStorage would reject correct passwords typed on any
    // browser other than the one that registered the account, which is
    // exactly the bug that made customer login look broken.
    setWrongPassAttempts(prev => ({ ...prev, [acc.id]: 0 }));
    setLoginError(null);
    setLoggingIn(acc.id);
    addEv("info", `Credentials authenticated. Evaluating biometric profile for: ${acc.name}`);

    // Try to login as the specific custom registered user on the backend
    let token = null;
    let userHash: string | null = null;
    let publicIp = "";
    try {
      publicIp = await getPublicIp();
    } catch (e) {
      console.warn("Could not retrieve client IP:", e);
    }

    try {
      const loginRes = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: acc.id,
          password: passText,
          ip_address: publicIp || null,
        }),
      });
      if (loginRes.ok) {
        const loginData = await loginRes.json();
        token = loginData.access_token;
        userHash = loginData.user_hash ?? null;
      } else if (loginRes.status === 403) {
        const errData = await loginRes.json();
        if (errData.detail && errData.detail.error === "vpn_blocked") {
          const detail = errData.detail;
          setVpnBlockedOverlay({
            ip: detail.ip,
            country: detail.country,
            city: detail.city,
            reason: detail.vpn_reason,
          });
          setLoggingIn(null);
          addEv("block", `⛔ Login blocked: VPN detected (${detail.vpn_reason})`);

          // Report VPN block to backend immediately for the admin portal logs
          (async () => {
            try {
              const t = await ensureDemoToken();
              if (t) {
                const sid = sdkSessRef.current || crypto.randomUUID();
                await fetch(apiUrl("/api/auth/evaluate"), {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
                  body: JSON.stringify({
                    session_id: sid,
                    channel: "internet_banking",
                    imei_hash: acc.imeiHash,
                    user_id: acc.id,
                    // Same as the wrong-password path: a VPN-blocked attempt
                    // needs the face from this attempt, not a null that falls
                    // back to the enrolled customer's registration photo.
                    face_image: faceImage || null,
                    password_status: "success",
                    ip_address: detail.ip || publicIp || null,
                  }),
                });
              }
            } catch (e) {
              console.warn("Failed to report VPN block to backend:", e);
            }
          })();

          return;
        }
      }
    } catch (e) {
      console.warn("Backend login failed for custom user, falling back to demo token:", e);
    }

    if (!token) {
      token = await ensureDemoToken();
      if (!token) {
        addEv("block", "Auth failed — check backend status");
        setLoggingIn(null);
        return;
      }
    }
    setToken(token);
    setAuthToken(token);

    // Evaluate login biometrics through Citadel
    const sid = sdkSessRef.current || crypto.randomUUID();
    
    // Force SDK flush to send all typed credentials biometrics
    if (sdkRef.current) {
      await sdkRef.current.flush().catch(() => {});
    }

    let finalScore = 0;
    let finalDecision: Decision = "STEP_UP";
    let apiReason = "";
    let apiSuccess = false;

    const evaluateBody = JSON.stringify({
      session_id: sid,
      channel: "internet_banking",
      imei_hash: acc.imeiHash,
      user_id: acc.id,
      face_image: faceImage || null,
      face_matched: faceMatched,
      no_face_detected: noFace,
      password_status: "success",
      ip_address: publicIp || null,
    });
    const callEvaluate = (tok: string) => fetch(apiUrl("/api/auth/evaluate"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: evaluateBody,
    });

    try {
      let res = await callEvaluate(token);
      // A 401 here means our own token was rejected (e.g. the backend restarted
      // and rotated its signing key mid-session) — that's a session problem, not
      // a fraud signal. Re-authenticate once and retry before treating a brand
      // new sign-in as risky enough to demand step-up verification.
      if (res.status === 401) {
        addEv("info", "Session token rejected — re-authenticating…");
        const retryLoginRes = await fetch(apiUrl("/api/auth/login"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customer_id: acc.id, password: passText, ip_address: publicIp || null }),
        });
        if (retryLoginRes.ok) {
          const retryData = await retryLoginRes.json();
          if (retryData.access_token) {
            token = retryData.access_token;
            setToken(token);
            setAuthToken(token);
            res = await callEvaluate(token);
          }
        }
      }
      if (res.ok) {
        const d = await res.json();
        finalScore = d.risk_score ?? 0;
        finalDecision = (d.decision ?? "STEP_UP") as Decision;
        apiReason = d.reason ?? "";
        setOnChain(d.on_chain_verified ?? false);
        // PQC Dilithium-3 verification result
        setPqcVerified(d.pqc_verified ?? false);
        setPqcAlgorithm(d.pqc_algorithm ?? null);
        if (d.pqc_verified) {
          addEv("success", `🔮 ${d.pqc_algorithm ?? "Dilithium-3"} PQC signature verified — behavioral passport quantum-secured`);
        }
        apiSuccess = true;
      }
    } catch (e: any) {
      addEv("warn", `Citadel evaluate failed — requiring STEP_UP verification`);
      finalDecision = "STEP_UP";
      finalScore = 450;
    }

    // Advanced Security gate (PQC Shield, Anti-Spoofing, zk-SNARK passport).
    // Runs a real ML-KEM-768 handshake, a signed one-time-nonce replay check,
    // a mouse-tremor sample, and (once this device has enrolled one) a
    // zk-SNARK proof that the score above is within policy — then asks the
    // backend to fuse that with the behavioral score via max(security, ML).
    // Best-effort and additive only: it can raise finalScore/finalDecision if
    // a module flags something, but a failed/slow/unavailable module here
    // never lowers risk or blocks a login on its own. Deception's honeypot
    // already runs separately via <HoneyTrap> on the login form.
    if (apiSuccess) {
      const motion = snapshotMotion();
      const secResult = await Promise.race([
        securityEvaluate({
          sessionId: sid,
          telemetryBundle: { session_id: sid, customer_id: acc.id, ts: Date.now() },
          motionValues: motion.values,
          motionTimestamps: motion.timestamps,
          riskScore: finalScore,
          customerHash: userHash,
          behavioralRisk: finalScore,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ]);
      if (secResult) {
        const fused = secResult.fused_risk_score;
        if (typeof fused === "number" && fused > finalScore) {
          finalScore = fused;
          finalDecision = (secResult.fused_decision as Decision) ?? finalDecision;
          addEv("warn", `Advanced Security raised risk to ${finalScore}/1000: ${secResult.notes.join("; ") || "see cyber verdicts"}`);
        }
        const v = secResult.cyber_verdicts;
        if (v.pqc_shield === "VALID_MLKEM768" && secResult.pqc_kem_verified) {
          addEv("success", "🔐 PQC Shield: ML-KEM-768 handshake confirmed (shared secret matched)");
        }
        if (v.replay_status === "FRESH_SIGNED") addEv("success", "🌀 Anti-Spoof: replay-safe signature verified");
        if (v.zkp_passport_verified === true) addEv("success", "🧮 zk-SNARK: behavioral passport proof verified");
      }
    }

    // Backend unreachable and no explicit face block — fail closed, do not APPROVE.
    if (!apiSuccess && faceMatched !== false) {
      finalDecision = "STEP_UP";
      finalScore = Math.max(finalScore, 450);
    }

    // Recalculate dynamic threat score (0-100)
    const newThreat = calculateThreatScore(acc, faceMatched, confidence, noFace, 0);
    setThreatScore(newThreat);

    // Apply Camera Detection override logic
    if (faceMatched === false) {
      // Mismatch or not detected!
      finalScore = noFace ? 980 : 940;
      finalDecision = "HARD_BLOCK";
      const reason = noFace 
        ? "AI camera check: Face not detected in frame. Login flagged as suspicious." 
        : `AI camera check: Face mismatch (Match confidence: ${Math.round((confidence ?? 0) * 100)}%). Intruder warning activated.`;

      setRiskScore(finalScore);
      setDecision(finalDecision);
      setThreatScore(noFace ? 98 : 92);
      addEv("alert", `🚨 ${reason}`, finalScore, finalDecision);
      
      setOverlay({
        type: "HARD_BLOCK",
        score: finalScore,
        reason: reason,
        latencyMs: 120
      });
      setLoggingIn(null);
      return;
    } else if (faceMatched === true) {
      // Face verified — trust backend ML score (do not downgrade STEP_UP/HARD_BLOCK).
      setRiskScore(finalScore);
      setDecision(finalDecision);
      addEv(
        finalDecision === "APPROVE" ? "success" : finalDecision === "STEP_UP" ? "warn" : "block",
        `AI camera: face verified (${Math.round((confidence ?? 0) * 100)}%) — Citadel ${finalDecision} (${finalScore}/1000)`,
        finalScore,
        finalDecision,
      );
    } else {
      // Enrolled face baseline missing or skipped
      if (apiSuccess) {
        setRiskScore(finalScore);
        setDecision(finalDecision);
        addEv("success", `Citadel verification: ${finalDecision} (${finalScore}/1000)`, finalScore, finalDecision);
      } else {
        setRiskScore(finalScore);
        setDecision(finalDecision);
      }
    }

    if (finalDecision === "HARD_BLOCK") {
      setLoggingIn(null);
      if (apiReason.includes("VPN") || apiReason.includes("IP Integrity Alert")) {
        setVpnBlockedOverlay({
          ip: publicIp || "Unknown IP",
          reason: apiReason,
        });
      } else {
        setOverlay({
          type: "HARD_BLOCK",
          score: finalScore,
          reason: apiReason || `Citadel detected anomaly in biometrics (${finalScore}/1000)`,
          latencyMs: 120
        });
      }
      return;
    }

    if (finalDecision === "STEP_UP") {
      const isColdStart = /cold-start/i.test(apiReason);
      if (!isColdStart) {
        setOverlay({
          type: "STEP_UP",
          score: finalScore,
          reason: apiReason || "Behavioral pattern differs from enrolled passport — additional verification required",
          latencyMs: 120,
        });
      } else {
        addEv("info", `Cold-start baseline building — skipping redundant step-up modal (${apiReason})`);
      }
    }

    addEv("success", `✅ Access granted. Logged into profile: ${acc.name}`);
    sendTwilioWhatsApp(acc.name).catch(err => console.error("Twilio error:", err));
    // An account registered before balances were persisted has no entry at all;
    // credit the opening balance rather than showing it an empty ₹0 account.
    setBalances(prev => prev[acc.id] === undefined ? { ...prev, [acc.id]: OPENING_BALANCE } : prev);
    setAccount(acc);
    setLoggedIn(true);
    setLoggingIn(null);

    // Re-initialize BehaviorSDK for the successfully authenticated user session
    sdkSessRef.current = crypto.randomUUID();
    setLastSessionId(sdkSessRef.current);
    if (sdkRef.current) {
      sdkRef.current.stop();
    }
    sdkRef.current = new BehaviorSDK({
      apiUrl: API_BASE,
      userId: acc.id,
      channel: "internet_banking",
      imeiHash: acc.imeiHash || DEMO_LEGIT_IMEI,
      flushIntervalMs: 500,
    });
    sdkRef.current.start();
    addEv("info", `Citadel telemetry session upgraded for user: ${acc.name} (${sdkSessRef.current.slice(0, 8)}…)`);
  }, [authToken, addEv, calculateThreatScore, snapshotMotion]);

  const handleGoogleLogin = useCallback(async (credential: string, isMock: boolean) => {
    setLoggingIn("google");
    setLoginError(null);
    addEv("info", `Initiating Google authentication...`);

    try {
      const res = await fetch(apiUrl("/api/auth/google"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, is_mock: isMock }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Google login failed");
      }

      const data = await res.json();
      setToken(data.access_token);
      setAuthToken(data.access_token);
      setSession(data.user_id);

      // Check if this account already exists in state
      let existingAcc = accounts.find(a => a.id === data.user_id);
      if (!existingAcc) {
        // Generate new dynamic account for the Google user
        const initials = (data.name || "G")
          .split(" ")
          .map((n: string) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2);
        
        // Deterministic account properties
        const accNo = "9900 " + Math.floor(1000 + Math.random() * 9000) + " " + Math.floor(1000 + Math.random() * 9000);
        
        existingAcc = {
          id: data.user_id,
          name: data.name || data.user_id,
          accountNo: accNo,
          ifsc: "ZIPB0009900",
          upiId: data.user_id.split("@")[0] + "@zippay",
          avatar: initials,
          imeiHash: DEMO_LEGIT_IMEI,
          color: "var(--color-primary)", // Google Indigo
        };

        setAccounts(prev => {
          const updated = [...prev, existingAcc!];
          const uniq = updated.filter((item, index, self) => self.findIndex(t => t.id === item.id) === index);
          const registeredOnly = uniq.filter(a => !ACCOUNTS.some(original => original.id === a.id));
          localStorage.setItem("registered_accounts", JSON.stringify(registeredOnly));
          return uniq;
        });

        // Initialize balance and transaction history with higher tier funding
        setBalances(prev => ({ ...prev, [existingAcc!.id]: 250000 }));
        setTxnHistory(prev => ({ ...prev, [existingAcc!.id]: [] }));
      }

      setAccount(existingAcc);
      setLoggedIn(true);
      addEv("success", `Google authentication successful. Logged in as: ${data.name}`, 15, "APPROVE");
      sendTwilioWhatsApp(existingAcc?.name || data.name).catch(err => console.error("Twilio error:", err));

      // Initialize SDK for this Google user session to trace activities
      sdkSessRef.current = crypto.randomUUID();
      setLastSessionId(sdkSessRef.current);
      if (sdkRef.current) {
        sdkRef.current.stop();
      }
      sdkRef.current = new BehaviorSDK({
        apiUrl: API_BASE,
        userId: data.user_hash,
        channel: "internet_banking",
        imeiHash: DEMO_LEGIT_IMEI,
        flushIntervalMs: 500,
      });
      sdkRef.current.start();

    } catch (e: any) {
      console.error(e);
      setLoginError(e.message || "Failed to authenticate with Google");
      addEv("block", `Google Auth failed: ${e.message || "Connection error"}`);
    } finally {
      setLoggingIn(null);
    }
  }, [accounts, addEv]);

  // ── Parse Google OAuth redirect URL query parameters ───────────────────────
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const oauthToken = params.get("oauth_token");
    const oauthUserId = params.get("oauth_user_id");
    const oauthName = params.get("oauth_name");
    const oauthHash = params.get("oauth_hash");
    const oauthError = params.get("error");

    if (oauthError) {
      setLoginError(oauthError);
      addEv("block", `Google Auth failed: ${oauthError}`);
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (oauthToken && oauthUserId) {
      setToken(oauthToken);
      setAuthToken(oauthToken);
      setSession(oauthUserId);
      
      const initials = (oauthName || "G")
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
      
      const accNo = "9900 " + Math.floor(1000 + Math.random() * 9000) + " " + Math.floor(1000 + Math.random() * 9000);
      
      const googleAcc: Account = {
        id: oauthUserId,
        name: oauthName || oauthUserId,
        accountNo: accNo,
        ifsc: "ZIPB0009900",
        upiId: oauthUserId.split("@")[0] + "@zippay",
        avatar: initials,
        imeiHash: DEMO_LEGIT_IMEI,
        color: "var(--color-primary)",
      };

      setAccounts(prev => {
        const updated = [...prev, googleAcc];
        const uniq = updated.filter((item, index, self) => self.findIndex(t => t.id === item.id) === index);
        const registeredOnly = uniq.filter(a => !ACCOUNTS.some(original => original.id === a.id));
        localStorage.setItem("registered_accounts", JSON.stringify(registeredOnly));
        return uniq;
      });

      setBalances(prev => ({ ...prev, [googleAcc.id]: 250000 }));
      setTxnHistory(prev => ({ ...prev, [googleAcc.id]: [] }));
      
      setAccount(googleAcc);
      setLoggedIn(true);
      addEv("success", `Google authentication successful. Logged in as: ${oauthName || oauthUserId}`, 15, "APPROVE");
      sendTwilioWhatsApp(googleAcc.name).catch(err => console.error("Twilio error:", err));

      window.history.replaceState({}, document.title, window.location.pathname);

      sdkSessRef.current = crypto.randomUUID();
      setLastSessionId(sdkSessRef.current);
      if (sdkRef.current) {
        sdkRef.current.stop();
      }
      sdkRef.current = new BehaviorSDK({
        apiUrl: API_BASE,
        userId: oauthHash || oauthUserId,
        channel: "internet_banking",
        imeiHash: DEMO_LEGIT_IMEI,
        flushIntervalMs: 500,
      });
      sdkRef.current.start();
    }
  }, [location.search, addEv]);

  // ── Poll for active duress status ───────────────────────────────────────────
  useEffect(() => {
    if (!loggedIn || !authToken) {
      setDuressActive(null);
      return;
    }
    const checkActiveDuress = async () => {
      try {
        const res = await fetch(apiUrl("/api/duress/active"), {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.has_active) {
            setDuressActive({
              incidentId: data.incident_id,
              lat: data.latitude,
              lon: data.longitude,
              activatedAt: data.activated_at || new Date().toISOString()
            });
          } else {
            setDuressActive(null);
            if (duressIntervalRef.current) {
              clearInterval(duressIntervalRef.current);
              duressIntervalRef.current = null;
            }
          }
        }
      } catch (e) {
        console.warn("Error checking active duress status:", e);
      }
    };

    checkActiveDuress();
    const interval = setInterval(checkActiveDuress, 10000); // check every 10s
    return () => clearInterval(interval);
  }, [loggedIn, authToken]);

  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  // ── Start SDK immediately on mount to capture login typing dynamics ─────────
  useEffect(() => {
    let countTimer: any;
    let previewInterval: any;

    async function initSDK() {
      const token = await ensureDemoToken();
      if (!token) {
        addEv("warn", "Backend offline. Running in offline fallback mode.");
        return;
      }
      setToken(token);
      setAuthToken(token);

      const sdk = new BehaviorSDK({
        apiUrl: API_BASE,
        userId: accountRef.current?.id ?? "demo-user-harshdeep", // default
        channel: "internet_banking",
        imeiHash: accountRef.current?.imeiHash ?? DEMO_LEGIT_IMEI,
        flushIntervalMs: 500,
      });
      sdk.start();
      sdkRef.current = sdk;
      const sdkSessionId = sdk.currentSessionId;
      sdkSessRef.current = sdkSessionId;
      addEv("info", `Citadel telemetry monitoring started (${sdkSessionId.slice(0, 8)}…)`);

      countTimer = setInterval(() => {
        if (sdkRef.current) {
          const b = sdkRef.current.getSignalBreakdown();
          setSignals({ ks: b.keystrokes, mouse: b.mouseEvents, touch: b.touchEvents });
          if (!activeScenarioRef.current) {
            setRiskScore(prev => {
              if (prev > 0) return prev; // real score already set
              const total = b.keystrokes + b.mouseEvents + b.touchEvents;
              return total > 15 ? Math.max(55, 180 - Math.floor(total / 12)) : 0;
            });
          }
        }
      }, 500);

      const pollFn = async () => {
        if (activeScenarioRef.current) return;
        try {
          const res = await fetch(apiUrl(`/api/auth/preview/${sdkSessionId}`), { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const d = await res.json() as { ready?: boolean; risk_score?: number };
            if (d.ready && typeof d.risk_score === "number" && d.risk_score > 0) {
              setRiskScore(d.risk_score);
              const score = d.risk_score;
              const dec = score >= 600 ? "HARD_BLOCK" : score >= 300 ? "STEP_UP" : "APPROVE";
              setDecision(dec);
            }
          }
        } catch {/* non-fatal */}
      };
      previewInterval = setInterval(pollFn, 2000);
      void pollFn();
    }

    initSDK();

    return () => {
      if (sdkRef.current) sdkRef.current.stop();
      clearInterval(countTimer);
      clearInterval(previewInterval);
    };
  }, []); // Run exactly once on mount

  // ── Track risk history for sparkline ────────────────────────────────────────
  useEffect(() => {
    if (riskScore > 0) {
      setRiskHistory(prev => [...prev.slice(-59), riskScore]);
    }
  }, [riskScore]);

  // ── Make live biometrics waveform react to user input ───────────────────────
  useEffect(() => {
    const onKey = () => setRhythms(prev => { const n = [...prev.slice(1)]; n.push(Math.floor(20 + Math.random() * 60)); return n; });
    const onMouse = () => { if (Math.random() < 0.12) setRhythms(prev => { const n = [...prev.slice(1)]; n.push(Math.floor(10 + Math.random() * 30)); return n; }); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMouse);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousemove", onMouse); };
  }, []);

  // ── Track section navigation ─────────────────────────────────────────────────
  useEffect(() => {
    if (!loggedIn) return;
    const labels: Record<Section, string> = { home: "Dashboard Home", transfer: "Transfer Money", upi: "UPI / Razorpay Pay", history: "Transaction History", profile: "Account Profile" };
    addEv("info", `Navigation → ${labels[section]}`);
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Evaluate helper ──────────────────────────────────────────────────────────
  const evaluate = useCallback(async (context: string, bundle?: object): Promise<{ decision: Decision; score: number; latencyMs: number; coercionProb: number; onChain: boolean; reason: string } | null> => {
    let token = authToken;
    if (!token) {
      token = await ensureDemoToken().catch(() => null);
    }
    if (!token) {
      addEv("warn", `${context}: authentication token unavailable`);
      return null;
    }
    setEvaluating(true);

    // Force SDK flush to send all accumulated biometrics to Redis
    if (sdkRef.current) {
      await sdkRef.current.flush().catch(() => {});
    }

    const sid = sdkSessRef.current || crypto.randomUUID();
    // ⚠️  Do NOT overwrite sdkSessRef here — the preview poll must keep watching
    //     the SDK's own session so the live gauge updates continuously.
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    try {
      // Reset demo state so stale SIM-swap IMEI never bleeds into normal evals
      await fetch(apiUrl("/api/auth/demo/reset"), { method: "POST", headers }).catch(() => {});

      const faceImg = account ? localStorage.getItem(`face_img_${account.id}`) : null;
      const pubIp = await getPublicIp().catch(() => "");
      const payload: any = {
        session_id: sid,
        channel: "internet_banking",
        imei_hash: account?.imeiHash ?? DEMO_LEGIT_IMEI,
        user_id: account?.id ?? "unknown",
        face_image: faceImg || null,
        ip_address: pubIp || null,
      };
      if (bundle) {
        payload.signal_bundle = bundle;
      }

      const res = await fetch(apiUrl("/api/auth/evaluate"), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
        const detail = typeof errBody.detail === "string" ? errBody.detail : `HTTP ${res.status}`;
        addEv("warn", `${context}: backend error — ${detail}`);
        throw new Error(detail);
      }
      const d = await res.json() as {
        decision?: string; risk_score?: number; latency_ms?: number;
        coercion_probability?: number; on_chain_verified?: boolean; reason?: string;
      };
      const decision  = (d.decision   ?? "APPROVE") as Decision;
      const score     = d.risk_score  ?? 0;
      const latencyMs = d.latency_ms  ?? 0;
      const coercion  = d.coercion_probability ?? 0;
      const onChainV  = d.on_chain_verified ?? false;
      const reason    = d.reason ?? "";
      setRiskScore(score);
      setDecision(decision);
      setCoercionProb(coercion);
      setOnChain(onChainV);
      setLastSessionId(sid);
      addEv(
        decision === "HARD_BLOCK" ? "block" : decision === "STEP_UP" ? "alert" : "success",
        `${context}: ${decision} (${score}/1000, ${latencyMs}ms)`,
        score, decision,
      );
      return { decision, score, latencyMs, coercionProb: coercion, onChain: onChainV, reason };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      if (!msg.startsWith("HTTP") && !msg.includes("backend error")) {
        addEv("warn", `${context}: network error — requiring STEP_UP (fail-closed)`);
      }
      const fallback = { decision: "STEP_UP" as Decision, score: 450, latencyMs: 0, coercionProb: 0, onChain: false, reason: "Backend unavailable — STEP_UP required before proceeding" };
      setRiskScore(450); setDecision("STEP_UP");
      return fallback;
    } finally {
      setEvaluating(false);
    }
  }, [authToken, account, addEv]);



  // ── Duress PIN helpers ────────────────────────────────────────────────────────

  /** Get current GPS coordinates (the demo venue, Neeram Hall, Thapar Institute of Engineering and Technology, Patiala, Punjab). */
  const getGPS = (): Promise<{ lat: number; lon: number; accuracy?: number }> =>
    Promise.resolve({ lat: 30.3564, lon: 76.3625, accuracy: 5.0 });

  /**
   * Modified transfer handler that checks the entered PIN first.
   * If normal PIN → proceed with standard Citadel evaluate.
   * If duress PIN → activate emergency mode (silent to attacker).
   */
  const handleDuressTransfer = useCallback(async () => {
    if (!account || evaluating) return;
    const amount = parseInt(xferAmt, 10);
    if (!amount || amount <= 0) return;
    // Tell the user they are short instead of silently clamping the balance.
    if (amount > (balances[account.id] ?? 0)) {
      addEv("block", `Transfer declined — insufficient balance (available ${fmtINR(balances[account.id] ?? 0)})`);
      setOverlay({ type: "BLOCK" as Decision, score: 0, reason: `Insufficient balance.\nAvailable: ${fmtINR(balances[account.id] ?? 0)}\nRequested: ${fmtINR(amount)}`, latencyMs: 0 });
      return;
    }

    // If no PIN entered, run the normal transfer (no duress check)
    if (!xferPin.trim()) {
      addEv("info", `Transfer initiated: ${fmtINR(amount)} to ${xferTo}`);
      const result = await evaluate("Transfer gate");
      if (!result) return;
      if (result.decision === "APPROVE") {
        const recipientId = ACCOUNTS.find(a => a.upiId === xferTo)?.id;
        setBalances(prev => {
          const next = { ...prev, [account.id]: Math.max(0, (prev[account.id] ?? 0) - amount) };
          if (recipientId) next[recipientId] = (next[recipientId] ?? 0) + amount;
          return next;
        });
        const txn: Transaction = {
          id: crypto.randomUUID(), from: account.id, to: xferTo, amount,
          type: "debit", description: xferNote || "Transfer",
          time: new Date(), riskScore: result.score, decision: result.decision, category: "💸",
        };
        setTxnHistory(prev => ({ ...prev, [account.id]: [txn, ...(prev[account.id] ?? [])] }));
        addEv("success", `✅ ${fmtINR(amount)} transferred to ${xferTo}`);
        setOverlay({ type: "APPROVE", score: result.score, reason: "Behavioral pattern matches enrolled passport.", latencyMs: result.latencyMs });
      } else {
        setOverlay({ type: result.decision as Decision, score: result.score, reason: result.reason, latencyMs: result.latencyMs });
      }
      return;
    }

    // PIN entered — check if it is the Duress PIN
    const token = authToken || (await ensureDemoToken());
    if (!token) {
      addEv("warn", "Not authenticated — skipping PIN check");
      return;
    }

    setDuressActivating(true);
    try {
      const verifyRes = await fetch(apiUrl("/api/duress/verify-pin"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin: xferPin }),
      });
      const verifyData = verifyRes.ok ? await verifyRes.json() : { is_duress: false };

      if (!verifyData.is_duress) {
        // Not a duress PIN — validate against the stored Normal PIN
        const storedNormalPin = localStorage.getItem(`normal_pin_${account.id}`);
        if (storedNormalPin && xferPin !== storedNormalPin) {
          // Wrong PIN — reject the transfer
          setDuressActivating(false);
          addEv("warn", "❌ Incorrect PIN entered — transfer rejected");
          setOverlay({
            type: "STEP_UP" as Decision,
            score: 700,
            reason: "❌ Incorrect Transaction PIN. Please try again.",
            latencyMs: 200,
          });
          setXferPin("");
          return;
        }

        // PIN is correct (or no normal PIN stored yet) → run normal transfer
        addEv("info", `Transfer initiated: ${fmtINR(amount)} to ${xferTo}`);
        setDuressActivating(false);
        const result = await evaluate("Transfer gate");
        if (!result) return;
        if (result.decision === "APPROVE") {
          const recipientId = ACCOUNTS.find(a => a.upiId === xferTo)?.id;
          setBalances(prev => {
            const next = { ...prev, [account.id]: Math.max(0, (prev[account.id] ?? 0) - amount) };
            if (recipientId) next[recipientId] = (next[recipientId] ?? 0) + amount;
            return next;
          });
          const txn: Transaction = {
            id: crypto.randomUUID(), from: account.id, to: xferTo, amount,
            type: "debit", description: xferNote || "Transfer",
            time: new Date(), riskScore: result.score, decision: result.decision, category: "💸",
          };
          setTxnHistory(prev => ({ ...prev, [account.id]: [txn, ...(prev[account.id] ?? [])] }));
          addEv("success", `✅ ${fmtINR(amount)} transferred to ${xferTo}`);
          setOverlay({ type: "APPROVE", score: result.score, reason: "Behavioral pattern matches enrolled passport.", latencyMs: result.latencyMs });
        } else {
          setOverlay({ type: result.decision as Decision, score: result.score, reason: result.reason, latencyMs: result.latencyMs });
        }
        return;
      }

      // ── DURESS PIN DETECTED ────────────────────────────────────────────────
      // Silently activate emergency mode in the background.
      // From the attacker's point of view we simply show a generic bank error.
      // NO modal, NO countdown — the emergency fires completely invisibly.
      const gps = await getGPS();

      // Fire-and-forget: silently activate emergency on backend
      fetch(apiUrl("/api/duress/activate"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          duress_pin: xferPin,
          latitude: gps?.lat ?? null,
          longitude: gps?.lon ?? null,
          accuracy_m: gps?.accuracy ?? null,
          device_info: { userAgent: navigator.userAgent, channel: "internet_banking" },
          payment_amount: amount,
          payment_recipient: xferTo,
        }),
      }).then(async (activateRes) => {
        if (activateRes.ok) {
          const activateData = await activateRes.json();
          setDuressActive({ incidentId: activateData.incident_id, lat: gps?.lat ?? null, lon: gps?.lon ?? null, activatedAt: new Date().toISOString() });

          // Start live location push every 30 seconds (up to 15 min = 30 updates)
          let pushCount = 0;
          if (duressIntervalRef.current) clearInterval(duressIntervalRef.current);
          duressIntervalRef.current = setInterval(async () => {
            pushCount++;
            if (pushCount > 30) { clearInterval(duressIntervalRef.current); return; }
            const newGps = await getGPS();
            if (!newGps) return;
            const t = authToken || (await ensureDemoToken());
            if (!t) return;
            await fetch(apiUrl("/api/duress/location-update"), {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
              body: JSON.stringify({ incident_id: activateData.incident_id, latitude: newGps.lat, longitude: newGps.lon, accuracy_m: newGps.accuracy }),
            }).catch(() => {});
          }, 30000);
        }
      }).catch(() => {});

      setDuressActivating(false);
      // ── Show a deceptive "successful submission" overlay ──
      const txId = "TXN" + Math.floor(10000 + Math.random() * 90000);
      setOverlay({
        type: "APPROVE" as Decision,
        score: 145,
        reason: `Transaction Submitted Successfully.\nReference ID: ${txId}\nYour transaction is being processed.`,
        latencyMs: 380,
      });
      // Deduct balance visually from the victim
      setBalances(prev => ({ ...prev, [account.id]: Math.max(0, (prev[account.id] ?? 0) - amount) }));
      // Save simulated transaction under processing
      const txn: Transaction = {
        id: crypto.randomUUID(), from: account.id, to: xferTo, amount,
        type: "debit", description: `${xferNote || "Transfer"} (Transaction under processing)`,
        time: new Date(), riskScore: 145, decision: "APPROVE", category: "💸",
      };
      setTxnHistory(prev => ({ ...prev, [account.id]: [txn, ...(prev[account.id] ?? [])] }));
      addEv("success", `💸 Deceptive payment of ${fmtINR(amount)} submitted (duress mode activated silently)`);
    } catch (err) {
      setDuressActivating(false);
      addEv("warn", "PIN check error — proceeding normally");
    }
    setXferPin("");
  }, [account, evaluating, xferTo, xferAmt, xferNote, xferPin, authToken, evaluate, addEv, balances]);


  /** Save Duress PIN + emergency contacts to backend. */
  const handleDuressSetup = useCallback(async () => {
    if (!duressSetupPin || !duressSetupConfirm || !duressContact1Name || !duressContact1Phone) {
      setDuressSetupError("Please fill Duress PIN and at least one emergency contact."); return;
    }
    if (duressSetupPin !== duressSetupConfirm) {
      setDuressSetupError("Duress PIN and confirmation do not match."); return;
    }
    if (duressSetupPin.length < 4) {
      setDuressSetupError("Duress PIN must be at least 4 characters."); return;
    }
    const token = authToken || (await ensureDemoToken());
    if (!token) { setDuressSetupError("Not authenticated."); return; }
    setDuressSetupLoading(true); setDuressSetupError(null);
    try {
      const res = await fetch(apiUrl("/api/duress/setup"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          duress_pin: duressSetupPin,
          confirm_duress_pin: duressSetupConfirm,
          emergency_contact_1_name: duressContact1Name,
          emergency_contact_1_phone: duressContact1Phone,
          emergency_contact_2_name: duressContact2Name || undefined,
          emergency_contact_2_phone: duressContact2Phone || undefined,
        }),
      });
      if (res.ok) {
        setDuressSetupDone(true);
        setShowDuressSetup(false);
        addEv("success", "✅ Duress PIN & emergency contacts configured securely");
      } else {
        const err = await res.json().catch(() => ({})) as any;
        setDuressSetupError(err.detail || "Setup failed. Please try again.");
      }
    } catch (e) {
      setDuressSetupError("Network error. Please check your connection.");
    } finally {
      setDuressSetupLoading(false);
    }
  }, [duressSetupPin, duressSetupConfirm, duressContact1Name, duressContact1Phone, duressContact2Name, duressContact2Phone, authToken, addEv]);

  // ── Razorpay UPI Payment ────────────────────────────────────────────────────

  const handleRazorpay = useCallback(async () => {
    if (!account || evaluating) return;
    const amount = parseInt(upiAmt, 10);
    if (!amount) return;
    if (amount > (balances[account.id] ?? 0)) {
      addEv("block", `UPI payment declined — insufficient balance (available ${fmtINR(balances[account.id] ?? 0)})`);
      setOverlay({ type: "BLOCK" as Decision, score: 0, reason: `Insufficient balance.\nAvailable: ${fmtINR(balances[account.id] ?? 0)}\nRequested: ${fmtINR(amount)}`, latencyMs: 0 });
      return;
    }

    addEv("info", `UPI payment gate: ${fmtINR(amount)} to ${upiName}`);
    addEv("info", "Citadel evaluating BEFORE Razorpay opens...");

    const result = await evaluate("UPI payment gate");
    if (!result) return;

    if (result.decision !== "APPROVE") {
      addEv("block", `Razorpay blocked by Citadel — payment never reached Razorpay`);
      setOverlay({ type: result.decision as Decision, score: result.score, reason: result.reason, latencyMs: result.latencyMs });
      return;
    }

    addEv("success", `Citadel APPROVED — opening Razorpay checkout...`);

    // Key read from VITE_RAZORPAY_KEY in .env (or Dockerfile build-arg)
    const rzpKey = (import.meta.env.VITE_RAZORPAY_KEY as string | undefined) ?? "rzp_test_1DP5mmOlF5G5ag";

    // Open Razorpay
    if (typeof window.Razorpay !== "undefined") {
      const rzp = new window.Razorpay({
        key: rzpKey,
        amount: amount * 100,
        currency: "INR",
        name: "ZipPay Bank",
        description: `UPI Payment to ${upiName}`,
        image: "https://i.imgur.com/3g7nmJC.png",
        prefill: { name: account.name, email: "demo@zippay.in", contact: "9999999999" },
        notes: { citadel_score: String(result.score), citadel_decision: result.decision },
        theme: { color: "var(--color-primary)" },
        modal: {
          ondismiss: () => addEv("info", "Razorpay checkout dismissed by user"),
          animation: true,
        },
        handler: (response: any) => {
          const pid = response.razorpay_payment_id ?? "(test-mode)";
          addEv("success", `✅ Payment success — Razorpay ID: ${pid}`);
          const txn: Transaction = {
            id: crypto.randomUUID(), from: account.id, to: upiTo, amount,
            type: "debit", description: `UPI: ${upiName}`,
            time: new Date(), riskScore: result.score, decision: result.decision, category: "📱",
          };
          setBalances(prev => ({ ...prev, [account.id]: Math.max(0, (prev[account.id] ?? 0) - amount) }));
          setTxnHistory(prev => ({ ...prev, [account.id]: [txn, ...(prev[account.id] ?? [])] }));
          setOverlay({ type: "APPROVE", score: result.score, reason: `Razorpay payment ${pid} authorized by Citadel.`, latencyMs: result.latencyMs });
        },
      });
      rzp.open();
    } else {
      addEv("warn", "Razorpay SDK not loaded — simulating payment approval");
      setOverlay({ type: "APPROVE", score: result.score, reason: "Razorpay test (SDK not loaded in this environment).", latencyMs: result.latencyMs });
    }
  }, [account, evaluating, upiAmt, upiTo, upiName, evaluate, addEv, balances]);

  // ── QR Code Fraud Scanner handlers ──────────────────────────────────────────

  /** Stop the live camera QR scan and release the stream. */
  const stopQrCamera = useCallback(() => {
    if (qrRafRef.current !== null) { cancelAnimationFrame(qrRafRef.current); qrRafRef.current = null; }
    if (qrStreamRef.current) { qrStreamRef.current.getTracks().forEach(t => t.stop()); qrStreamRef.current = null; }
    setQrCameraOn(false);
  }, []);

  /**
   * Live camera QR scan: opens the back camera; the effect below wires the
   * video element and decodes frames with jsQR in real time. No mock, no fallback.
   */
  const startQrCamera = useCallback(async () => {
    setQrError(""); setQrResult(null); setQrDecoded(""); setQrImagePreview(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } },
      });
      qrStreamRef.current = stream;
      setQrCameraOn(true);  // the effect below attaches the stream + decode loop
    } catch (e) {
      setQrError("Could not access the camera. Allow camera permission or upload a QR image instead.");
      setQrCameraOn(false);
    }
  }, []);

  // Attach the stream to the video and run the jsQR decode loop while the
  // camera is on. Runs after render, so qrVideoRef is mounted.
  useEffect(() => {
    if (!qrCameraOn) return;
    const video = qrVideoRef.current;
    const stream = qrStreamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    let raf = 0;
    const tick = () => {
      if (!qrStreamRef.current || !video.videoWidth) { raf = requestAnimationFrame(tick); qrRafRef.current = raf; return; }
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
      if (code && code.data) {
        setQrImagePreview(canvas.toDataURL("image/png"));
        setQrDecoded(code.data);
        addEv("info", `📷 QR decoded (live camera): ${code.data.slice(0, 60)}…`);
        stopQrCamera();
        return;
      }
      raf = requestAnimationFrame(tick); qrRafRef.current = raf;
    };
    raf = requestAnimationFrame(tick); qrRafRef.current = raf;
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [qrCameraOn, addEv, stopQrCamera]);

  // Release the camera if the modal closes.
  useEffect(() => { if (!qrModalOpen) stopQrCamera(); }, [qrModalOpen, stopQrCamera]);

  /**
   * Decodes a QR code image file client-side using the bundled jsQR.
   * Converts the file to a canvas, extracts pixels, runs jsQR.
   */
  const handleQrFileSelect = useCallback(async (file: File) => {
    setQrError("");
    setQrResult(null);
    setQrScanStep(0);

    // Show image preview
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setQrImagePreview(dataUrl);

      // Decode QR with the bundled jsQR (no CDN, no demo fallback — a real
      // decode or a real error).
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width  = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
          setQrDecoded(code.data);
          addEv("info", `📷 QR decoded: ${code.data.slice(0, 60)}…`);
        } else {
          setQrError("Could not detect a QR code in this image. Please upload a clear QR code image.");
          addEv("warn", "❌ No QR code detected in uploaded image");
        }
      };
      img.onerror = () => setQrError("Failed to load image file.");
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, [addEv]);

  /**
   * Sends the decoded QR URL to the backend for VirusTotal scanning.
   * Drives the step-by-step progress animation.
   */
  const handleScanQR = useCallback(async () => {
    if (!qrDecoded || !authToken) return;
    setQrScanning(true);
    setQrError("");
    setQrScanStep(1);  // Step 1: decoding (already done)
    addEv("info", "🔍 Starting QR fraud scan…");

    await sleep(600);
    setQrScanStep(2);  // Step 2: extract UPI fields

    await sleep(700);
    setQrScanStep(3);  // Step 3: VirusTotal scan

    try {
      const response = await fetch(apiUrl("/api/payments/scan-qr"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          upi_url: qrDecoded,
          qr_image_b64: qrImagePreview,   // store QR thumbnail in DB for admin view
        }),
      });

      setQrScanStep(4);  // Step 4: computing verdict
      await sleep(500);

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: "Server error" }));
        throw new Error(err.detail || "Scan failed");
      }

      const result = await response.json();
      setQrResult(result);

      const verdictEmoji = result.verdict === "SAFE" ? "✅" : result.verdict === "MALICIOUS" ? "🔴" : "⚠️";
      addEv(
        result.verdict === "MALICIOUS" ? "block" : result.verdict === "SUSPICIOUS" ? "warn" : "success",
        `${verdictEmoji} QR Scan: ${result.verdict} (Risk: ${result.risk_score}/100) · VPA: ${result.vpa || "unknown"}`
      );

      if (result.verdict === "MALICIOUS") {
        addEv("block", "🚫 Payment BLOCKED — malicious QR code detected and stored in fraud audit log");
      }

    } catch (err: any) {
      setQrError(err.message || "Scan failed. Please try again.");
      addEv("warn", `❌ QR scan error: ${err.message}`);
    } finally {
      setQrScanning(false);
    }
  }, [qrDecoded, qrImagePreview, authToken, addEv]);

  // ── Attack Scenario Simulation ───────────────────────────────────────────────
  const handleRunScenario = useCallback(async (type: "simswap" | "coercion" | "vishing" | "otpmule" | "bot" | "bgpproxy" | "geodrift") => {
    if (!authToken || evaluating) return;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` };
    setActiveScenario(type);
    setAiTypewriterText("");

    const pubIp = await getPublicIp().catch(() => "");

    if (type === "simswap") {
      addEv("info", "━━ SIM-Swap Attack Simulation ━━");
      try { await fetch(apiUrl("/api/auth/demo/reset"), { method: "POST", headers }); } catch {}
      // Register legit baseline
      const legitSid = crypto.randomUUID();
      await fetch(apiUrl("/api/auth/evaluate"), { method: "POST", headers, body: JSON.stringify({ session_id: legitSid, channel: "internet_banking", imei_hash: DEMO_LEGIT_IMEI, signal_bundle: makeLegitBundle("demo-user-harshdeep", legitSid), ip_address: pubIp || null }) });
      addEv("success", "Baseline IMEI registered on blockchain");
      await sleep(700);
      addEv("warn", "Attacker activates duplicate SIM...");
      await sleep(500);
      const result = await evaluate("SIM-swap attack", makeLegitBundle("demo-user-harshdeep", crypto.randomUUID()));
      // Force attacker IMEI
      const sid = crypto.randomUUID();
      setEvaluating(true);
      try {
        const res = await fetch(apiUrl("/api/auth/evaluate"), { method: "POST", headers, body: JSON.stringify({ session_id: sid, channel: "internet_banking", imei_hash: DEMO_ATTACKER_IMEI, signal_bundle: makeLegitBundle("demo-user-harshdeep", sid), ip_address: pubIp || null }) });
        const d = await res.json();
        setRiskScore(d.risk_score); setDecision(d.decision); setOnChain(d.on_chain_verified ?? false);
        setLastSessionId(sid);
        addEv("block", `IMEI MISMATCH on ledger → ${d.decision} (${d.risk_score}/1000, ${d.latency_ms}ms)`, d.risk_score, d.decision);
        if (d.decision === "HARD_BLOCK") setOverlay({ type: "HARD_BLOCK", score: d.risk_score, reason: "SIM-swap detected. Device IMEI does not match baseline on Hyperledger Fabric.", latencyMs: d.latency_ms ?? 0 });
      } finally { setEvaluating(false); }
      void result;
    } else if (type === "coercion") {
      addEv("info", "━━ Coercion Victim Simulation ━━");
      addEv("warn", "Screen share detected + clipboard paste + keystroke hesitation");
      await sleep(800);
      const sid = crypto.randomUUID();
      setEvaluating(true);
      try {
        const res = await fetch(apiUrl("/api/auth/evaluate"), { method: "POST", headers, body: JSON.stringify({ session_id: sid, channel: "internet_banking", imei_hash: account?.imeiHash ?? DEMO_LEGIT_IMEI, signal_bundle: makeCoercionBundle("demo-user-harshdeep", sid), ip_address: pubIp || null }) });
        const d = await res.json();
        setRiskScore(d.risk_score); setDecision(d.decision); setCoercionProb(d.coercion_probability ?? 0.78);
        setLastSessionId(sid);
        addEv("alert", `Coercion prob ${Math.round((d.coercion_probability ?? 0.78) * 100)}% → ${d.decision}`, d.risk_score, d.decision);
        if (d.decision !== "APPROVE") setOverlay({ type: d.decision, score: d.risk_score, reason: d.reason ?? "Coercion signals detected.", latencyMs: d.latency_ms ?? 0 });
      } finally { setEvaluating(false); }
    } else if (type === "vishing") {
      addEv("info", "━━ Vishing Attack Simulation ━━");
      addEv("warn", "Victim coached to make payment while under phone call duress...");
      await sleep(800);
      const sid = crypto.randomUUID();
      setEvaluating(true);
      try {
        const res = await fetch(apiUrl("/api/auth/evaluate"), { method: "POST", headers, body: JSON.stringify({ session_id: sid, channel: channel, imei_hash: account?.imeiHash ?? DEMO_LEGIT_IMEI, signal_bundle: makeVishingBundle("demo-user-harshdeep", sid, channel), ip_address: pubIp || null }) });
        const d = await res.json();
        const score = d.risk_score || 550; const dec = (d.decision || "STEP_UP") as Decision;
        setRiskScore(score); setDecision(dec); setCoercionProb(d.coercion_probability ?? 0.85);
        setLastSessionId(sid);
        addEv("alert", `Vishing coercion probability: ${Math.round((d.coercion_probability ?? 0.85) * 100)}% → ${dec}`, score, dec);
        setOverlay({ type: dec, score, reason: d.reason || "Vishing pattern detected. High coercion probability + screen sharing active.", latencyMs: d.latency_ms ?? 0 });
      } finally { setEvaluating(false); }
    } else if (type === "otpmule") {
      addEv("info", "━━ OTP Mule Attack Simulation ━━");
      addEv("warn", "Fraudster social-engineers victim's OTP from unauthorized device...");
      await sleep(800);
      const sid = crypto.randomUUID();
      setEvaluating(true);
      try {
        const res = await fetch(apiUrl("/api/auth/evaluate"), { method: "POST", headers, body: JSON.stringify({ session_id: sid, channel: channel, imei_hash: DEMO_ATTACKER_IMEI, signal_bundle: makeOtpMuleBundle("demo-user-harshdeep", sid, channel), ip_address: pubIp || null }) });
        const d = await res.json();
        const score = 1000; const dec: Decision = "HARD_BLOCK";
        setRiskScore(score); setDecision(dec); setOnChain(d.on_chain_verified ?? false);
        setLastSessionId(sid);
        addEv("block", `Mule device flagged. Fabric IMEI mismatch → HARD_BLOCK`, score, dec);
        setOverlay({ type: dec, score, reason: "OTP Mule device flagged on Hyperledger Fabric ledger. Access denied.", latencyMs: d.latency_ms ?? 0 });
      } finally { setEvaluating(false); }
    } else if (type === "bot") {
      addEv("info", "━━ Bot / Credential-Stuffing Simulation ━━");
      addEv("warn", "Automated script running rapid credential submissions...");
      await sleep(800);
      const sid = crypto.randomUUID();
      setEvaluating(true);
      try {
        const res = await fetch(apiUrl("/api/auth/evaluate"), { method: "POST", headers, body: JSON.stringify({ session_id: sid, channel: channel, imei_hash: account?.imeiHash ?? DEMO_LEGIT_IMEI, signal_bundle: makeBotBundle("demo-user-harshdeep", sid, channel), ip_address: pubIp || null }) });
        const d = await res.json();
        const score = Math.max(d.risk_score || 0, 950); const dec: Decision = "HARD_BLOCK";
        setRiskScore(score); setDecision(dec);
        setLastSessionId(sid);
        addEv("block", `Robotic key-timing detected (≤50ms dwell, 0-variance) → HARD_BLOCK`, score, dec);
        setOverlay({ type: dec, score, reason: "Bot / macro script blocked by Citadel keystroke dynamics analysis.", latencyMs: d.latency_ms ?? 0 });
      } finally { setEvaluating(false); }
    } else if (type === "bgpproxy") {
      addEv("info", "━━ BGP Proxy Attack Simulation ━━");
      addEv("warn", "Access routed from cloud datacenter ASN subnet (AWS Delhi)...");
      await sleep(800);
      const sid = crypto.randomUUID();
      setEvaluating(true);
      try {
        const res = await fetch(apiUrl("/api/auth/evaluate"), { method: "POST", headers, body: JSON.stringify({ session_id: sid, channel: channel, imei_hash: account?.imeiHash ?? DEMO_LEGIT_IMEI, signal_bundle: makeLegitBundle("demo-user-harshdeep", sid), ip_address: "3.5.140.2" }) });
        const d = await res.json();
        const score = d.risk_score || 520; const dec = (d.decision || "STEP_UP") as Decision;
        setRiskScore(score); setDecision(dec);
        setLastSessionId(sid);
        addEv("alert", `IP Alert: Datacenter ASN detected → ${dec} (${score}/1000)`, score, dec);
        setOverlay({ type: dec, score, reason: d.reason || "IP Integrity Alert — connection routing from datacenter BGP proxy (AWS Noida). Verification required.", latencyMs: d.latency_ms ?? 0 });
      } finally { setEvaluating(false); }
    } else if (type === "geodrift") {
      addEv("info", "━━ Impossible Travel Geo-drift Simulation ━━");
      addEv("warn", "Location drift detected: Delhi ➔ Mumbai in under 1 second...");
      await sleep(800);
      const sid = crypto.randomUUID();
      setEvaluating(true);
      try {
        const res = await fetch(apiUrl("/api/auth/evaluate"), { method: "POST", headers, body: JSON.stringify({ session_id: sid, channel: channel, imei_hash: account?.imeiHash ?? DEMO_LEGIT_IMEI, signal_bundle: makeLegitBundle("demo-user-harshdeep", sid), ip_address: "192.0.2.1" }) });
        const d = await res.json();
        const score = d.risk_score || 580; const dec = (d.decision || "STEP_UP") as Decision;
        setRiskScore(score); setDecision(dec);
        setLastSessionId(sid);
        addEv("alert", `IP Alert: Impossible Geo-velocity travel detected → ${dec} (${score}/1000)`, score, dec);
        setOverlay({ type: dec, score, reason: d.reason || "IP Geolocation Anomaly — impossible travel velocity detected. Geodistance exceeds threshold. Verification required.", latencyMs: d.latency_ms ?? 0 });
      } finally { setEvaluating(false); }
    }
  }, [authToken, evaluating, account, evaluate, addEv, channel]);

  // ── AI Fraud Investigator (Client-side report generator) ────────────────────
  const handleTriggerAI = useCallback(async () => {
    if (aiInvestigating) return;
    setAiInvestigating(true);
    setAiTypewriterText("");
    addEv("info", "🤖 AI Fraud Investigator initializing...");

    await sleep(600); // simulate processing

    const ts = new Date().toLocaleString("en-IN");
    const scenarioLabels: Record<string, string> = {
      simswap: "SIM-Swap Device Takeover",
      coercion: "Coercion / Social Engineering",
      vishing: "Vishing Voice Phishing",
      otpmule: "OTP Mule Fraud",
      bot: "Bot / Credential Stuffing",
    };
    const scenarioName = activeScenario ? scenarioLabels[activeScenario] ?? activeScenario : "Normal Session";
    const riskLevel = riskScore < 300 ? "LOW" : riskScore < 600 ? "MEDIUM" : "HIGH";
    const decLabel = decision ?? "PENDING";

    let rawText = "";
    const sid = lastSessionId || sdkSessRef.current;
    if (authToken && sid) {
      try {
        const res = await fetch(apiUrl("/api/fraud/report"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({ session_id: sid, user_hash: "" })
        });
        if (res.ok) {
          const data = await res.json();
          rawText = data.report_text;
        }
      } catch (e) {
        console.warn("Real fraud report generation failed, falling back to local simulation:", e);
      }
    }

    if (!rawText) {
      rawText = [
        `╔══════════════════════════════════════════════════╗`,
        `║     Citadel™ AI FRAUD INVESTIGATION REPORT   ║`,
        `╚══════════════════════════════════════════════════╝`,
        ``,
        `Generated   : ${ts}`,
        `Session ID  : ${sid?.slice(0, 16) || "N/A"}…`,
        `Account     : ${account?.name ?? "Unknown"} (${account?.upiId ?? "N/A"})`,
        `Channel     : ${channel === "mobile_banking" ? "Mobile Banking" : "Internet Banking"}`,
        `Scenario    : ${scenarioName}`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `  BIOMETRIC RISK ASSESSMENT`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `  Risk Score      : ${riskScore}/1000  [${riskLevel} RISK]`,
        `  Decision        : ${decLabel}`,
        `  Keystrokes      : ${signals.ks} events captured`,
        `  Mouse Events    : ${signals.mouse} events captured`,
        `  Touch Events    : ${signals.touch} events captured`,
        `  Coercion Prob.  : ${Math.round(coercionProb * 100)}%`,
        `  On-Chain Verify : ${onChain ? "✓ VERIFIED on Hyperledger Fabric" : "✗ Not verified"}`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `  AI BEHAVIORAL ANALYSIS`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ...(activeScenario === "simswap" ? [
          `  ⚠ FINDING: Device IMEI mismatch detected.`,
          `  The authenticating device does not match the`,
          `  baseline IMEI registered on the Hyperledger`,
          `  Fabric ledger for this account. This is a`,
          `  strong indicator of a SIM-swap or device`,
          `  cloning attack. Access has been HARD_BLOCKED.`,
        ] : activeScenario === "coercion" ? [
          `  ⚠ FINDING: Coercion signals detected.`,
          `  Keystroke analysis shows ${Math.round(coercionProb * 100)}% hesitation`,
          `  probability. Screen-sharing active flag and`,
          `  clipboard paste source indicate the user may`,
          `  be acting under duress. Step-up verification`,
          `  or intervention recommended.`,
        ] : activeScenario === "vishing" ? [
          `  ⚠ FINDING: Vishing pattern identified.`,
          `  User is performing transaction while on an`,
          `  active call. High inter-key delay (>1800ms)`,
          `  and screen-share active. Social engineering`,
          `  probability: ${Math.round(coercionProb * 100)}%. Payment blocked.`,
        ] : activeScenario === "otpmule" ? [
          `  🚨 CRITICAL: OTP Mule device flagged.`,
          `  Transaction originated from a device not`,
          `  registered to this account on the distributed`,
          `  ledger. IMEI mismatch + atypical key dynamics`,
          `  match known OTP-mule fraud patterns.`,
          `  Access: HARD_BLOCKED. Case escalated.`,
        ] : activeScenario === "bot" ? [
          `  🚨 CRITICAL: Automated bot detected.`,
          `  Keystroke dwell time: ≤50ms (inhuman).`,
          `  Flight time variance: 0ms (robotic pattern).`,
          `  No mouse movement detected. This matches`,
          `  credential-stuffing script signatures.`,
          `  Access: HARD_BLOCKED immediately.`,
        ] : [
          `  ✓ Session appears legitimate.`,
          `  Keystroke dynamics match enrolled profile.`,
          `  No anomalous mouse or navigation patterns.`,
          `  Device IMEI matches blockchain baseline.`,
          `  Risk score within acceptable threshold.`,
        ]),
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `  RECOMMENDATION`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `  ${decLabel === "HARD_BLOCK" ? "Block access. Alert fraud team. Freeze account pending review." : decLabel === "STEP_UP" ? "Require additional OTP/biometric verification before proceeding." : "Allow transaction. Continue passive monitoring."}`,
        ``,
        `  — Citadel™ AI Engine v2.1 | Powered by`,
        `    Multi-Layer Behavioral Biometrics + Hyperledger`,
      ].join("\n");
    }

    if (typewriterIntervalRef.current) {
      clearInterval(typewriterIntervalRef.current);
      typewriterIntervalRef.current = null;
    }

    let idx = 0;
    typewriterIntervalRef.current = setInterval(() => {
      idx += 3;
      if (idx >= rawText.length) {
        idx = rawText.length;
        if (typewriterIntervalRef.current) {
          clearInterval(typewriterIntervalRef.current);
          typewriterIntervalRef.current = null;
        }
        setAiInvestigating(false);
      }
      setAiTypewriterText(rawText.slice(0, idx));
    }, 16);
    addEv("success", "🤖 AI Fraud Investigation report generated");
  }, [authToken, lastSessionId, aiInvestigating, addEv, activeScenario, riskScore, decision, signals, coercionProb, onChain, account, channel]);

  // ── Download Behavioral DNA Passport PDF ─────────────────────────────────────
  const [downloadingPassport, setDownloadingPassport] = useState(false);
  const downloadBiometricPassport = useCallback(async () => {
    if (!authToken || !account) return;
    setDownloadingPassport(true);
    try {
      const res = await fetch(
        apiUrl(`/api/auth/biometric-passport/${encodeURIComponent(account.id)}`),
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        alert(`Passport generation failed: ${err.detail || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `Citadel_Passport_${account.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`Error downloading passport: ${e.message}`);
    } finally {
      setDownloadingPassport(false);
    }
  }, [authToken, account]);

  // ── Export PDF Threat Audit Report ──────────────────────────────────────────
  const exportPDFReport = useCallback(() => {

    try {
      const { jsPDF } = (window as any).jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });

      // Concurrence-style light report. Built-in jsPDF fonts only encode
      // Latin-1, so every dynamic string is sanitised (emoji / bullets would
      // otherwise render as mojibake like "%Ë").
      const clean = (s: unknown) => String(s ?? "")
        .replace(/₹/g, "Rs. ").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/→/g, "->").replace(/…/g, "...")
        .replace(/[^\x20-\x7E -ÿ]/g, "").replace(/\s+/g, " ").trim();
      type RGB = [number, number, number];
      const INK: RGB = [16, 15, 15], W6: RGB = [87, 84, 82], W5: RGB = [118, 114, 112], W4: RGB = [150, 146, 144];
      const HAIR: RGB = [234, 228, 225], PAPER: RGB = [247, 243, 241], ORANGE: RGB = [170, 65, 42], TEAL: RGB = [8, 50, 65];
      const RED: RGB = [179, 38, 30], AMBER: RGB = [168, 110, 20], GREEN: RGB = [61, 107, 58];
      const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
      const ink = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
      const draw = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
      const M = 16, W = 210 - M * 2, PAGE_H = 297, BOTTOM = 280;
      let y = 0;

      const footer = () => {
        draw(HAIR); doc.setLineWidth(0.2); doc.line(M, 286, 210 - M, 286);
        doc.setFont("courier", "normal"); doc.setFontSize(7); ink(W5);
        doc.text("CITADEL  |  BEHAVIORAL AUTHENTICATION  |  DEMO DATA - SYNTHETIC SESSION", M, 291);
        doc.text(`PAGE ${doc.getNumberOfPages()}`, 210 - M, 291, { align: "right" });
      };
      const ensure = (h: number) => {
        if (y + h > BOTTOM) { footer(); doc.addPage(); y = 20; }
      };
      const label = (txt: string, x: number, yy: number, c: RGB = W5) => {
        doc.setFont("courier", "normal"); doc.setFontSize(7.5); ink(c);
        doc.text(clean(txt).toUpperCase(), x, yy, { charSpace: 0.4 });
      };
      const section = (n: string, title: string) => {
        ensure(22);
        y += 6;
        label(n, M, y, ORANGE);
        doc.setFont("times", "normal"); doc.setFontSize(17); ink(INK);
        doc.text(title, M + 12, y + 0.6);
        y += 4;
        draw(HAIR); doc.setLineWidth(0.25); doc.line(M, y, 210 - M, y);
        y += 7;
      };

      // ── Header band ──────────────────────────────────────────────────────
      fill(ORANGE); doc.rect(0, 0, 210, 52, "F");
      fill([187, 88, 66]); doc.rect(150, 0, 22, 52, "F");
      fill([160, 58, 37]); doc.rect(176, 0, 14, 52, "F");
      label("Citadel  x  ZipPay Bank", M, 16, [255, 236, 228]);
      doc.setFont("times", "normal"); doc.setFontSize(30); ink([255, 255, 255]);
      doc.text("Threat Audit Report", M, 31);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); ink([255, 230, 220]);
      doc.text("Real-time behavioral biometrics, device trust and coercion analysis for one session.", M, 39);
      label(`Generated ${new Date().toLocaleString("en-IN")}`, M, 46, [255, 236, 228]);
      y = 64;

      // ── Verdict hero ─────────────────────────────────────────────────────
      const dec = decision || "PENDING";
      const decCol: RGB = dec === "HARD_BLOCK" ? RED : dec === "STEP_UP" ? AMBER : dec === "APPROVE" ? GREEN : W6;
      label("Verdict", M, y);
      doc.setFont("times", "normal"); doc.setFontSize(34); ink(decCol);
      doc.text(dec.replace("_", " "), M, y + 13);
      const verdictCopy = dec === "HARD_BLOCK" ? "Session frozen before funds moved. Fraud analyst alerted."
        : dec === "STEP_UP" ? "Additional verification required before the session continues."
        : dec === "APPROVE" ? "Behavior matched the customer baseline. No friction applied."
        : "No decision has been issued for this session yet.";
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); ink(W6);
      doc.text(verdictCopy, M, y + 21);
      y += 30;

      // Risk bar 0-1000
      const barW = W, barY = y;
      fill([61, 107, 58]); doc.rect(M, barY, barW * 0.3, 3, "F");
      fill([196, 150, 40]); doc.rect(M + barW * 0.3, barY, barW * 0.3, 3, "F");
      fill(RED); doc.rect(M + barW * 0.6, barY, barW * 0.4, 3, "F");
      const mx = M + barW * Math.max(0, Math.min(1, riskScore / 1000));
      fill(INK); doc.triangle(mx - 2, barY - 3.2, mx + 2, barY - 3.2, mx, barY - 0.4, "F");
      label("0 approve", M, barY + 8);
      label("300 step-up", M + barW * 0.3, barY + 8);
      label("600 hard block", M + barW * 0.6, barY + 8);
      label("1000", 210 - M - 8, barY + 8);
      y += 16;

      // Metric cards
      const metrics: [string, string][] = [
        ["Risk score / 1000", `${riskScore}`],
        ["Threat score / 100", `${threatScore}`],
        ["Coercion", `${Math.round(coercionProb * 100)}%`],
        ["On-chain proof", onChain ? "Yes" : "No"],
      ];
      const gap = 4, cw = (W - gap * 3) / 4;
      metrics.forEach(([k, v], i) => {
        const x = M + i * (cw + gap);
        fill(PAPER); doc.roundedRect(x, y, cw, 24, 3, 3, "F");
        label(k, x + 5, y + 8);
        doc.setFont("times", "normal"); doc.setFontSize(20); ink(INK);
        doc.text(v, x + 5, y + 19);
      });
      y += 32;

      // ── 01 Session profile ───────────────────────────────────────────────
      section("01", "Session profile");
      const profile: [string, string][] = [
        ["Customer", account ? account.name : "Guest session"],
        ["Profile ID", account ? account.id : "N/A"],
        ["UPI address", account ? account.upiId : "N/A"],
        ["Session ID", sdkSessRef.current || "N/A"],
      ];
      profile.forEach(([k, v], i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const x = M + col * (W / 2), yy = y + row * 13;
        label(k, x, yy);
        doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); ink(INK);
        const lines = doc.splitTextToSize(clean(v), W / 2 - 6);
        doc.text(lines[0], x, yy + 5.5);
      });
      y += 28;

      // ── 02 Threat indicators ─────────────────────────────────────────────
      section("02", "Threat indicators");
      const lower = (s: string) => s.toLowerCase();
      const hasSimSwap = dnaEvents.some(ev => lower(ev.msg).includes("sim-swap") || lower(ev.msg).includes("imei mismatch"));
      const hasCoercion = dnaEvents.some(ev => lower(ev.msg).includes("coercion") || lower(ev.msg).includes("screen share")) || coercionProb > 0.3;
      const isMule = dnaEvents.some(ev => lower(ev.msg).includes("mule"));
      const hasFace = !!localStorage.getItem(`face_desc_${account?.id || "demo-user-harshdeep"}`);
      const wrongCount = account ? (wrongPassAttempts[account.id] || 0) : 0;
      const indicators: { name: string; status: "clear" | "warn" | "alert"; detail: string }[] = [
        { name: "Device trust", status: hasSimSwap ? "alert" : "clear", detail: hasSimSwap ? "IMEI hash mismatch against on-chain baseline - SIM-swap pattern." : "Device hash matches the enrolled on-chain baseline." },
        { name: "Coercion context", status: hasCoercion ? "alert" : "clear", detail: hasCoercion ? `Coached-input signals detected (coercion probability ${Math.round(coercionProb * 100)}%).` : "Natural keystroke cadence; no screen-share or paste markers." },
        { name: "Payee registry", status: isMule ? "alert" : "clear", detail: isMule ? "Recipient flagged as a money-mule account on the ledger." : "Recipient clear on the mule registry." },
        { name: "Face biometrics", status: hasFace ? "clear" : "warn", detail: hasFace ? "3-angle face baseline enrolled and active." : "3-angle face enrollment missing or skipped." },
        { name: "Credentials", status: wrongCount > 0 ? "alert" : "clear", detail: wrongCount > 0 ? `${wrongCount} incorrect password attempt(s) this session.` : "Clean single-attempt credential submission." },
      ];
      indicators.forEach((ind) => {
        const detail = doc.splitTextToSize(clean(ind.detail), W - 80);
        const h = Math.max(11, detail.length * 4.6 + 6);
        ensure(h);
        const c: RGB = ind.status === "alert" ? RED : ind.status === "warn" ? AMBER : GREEN;
        fill(c); doc.circle(M + 2, y + 2.6, 1.5, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); ink(INK);
        doc.text(ind.name, M + 7, y + 4);
        const tag = ind.status === "alert" ? "ALERT" : ind.status === "warn" ? "REVIEW" : "CLEAR";
        doc.setFont("courier", "bold"); doc.setFontSize(7.5);
        const tw = doc.getTextWidth(tag) + 5;
        doc.setFillColor(c[0], c[1], c[2]); doc.setGState?.(new (doc as any).GState({ opacity: 0.12 }));
        doc.roundedRect(M + 48, y - 0.4, tw, 6, 1.5, 1.5, "F");
        doc.setGState?.(new (doc as any).GState({ opacity: 1 }));
        ink(c); doc.text(tag, M + 50.5, y + 3.7);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); ink(W6);
        doc.text(detail, M + 78, y + 4);
        y += h;
        draw(HAIR); doc.setLineWidth(0.2); doc.line(M, y - 3, 210 - M, y - 3);
      });
      y += 2;

      // ── 03 Signal telemetry ──────────────────────────────────────────────
      section("03", "Signal telemetry");
      ensure(26);
      const tele: [string, number][] = [["Keystrokes", signals.ks], ["Mouse path points", signals.mouse], ["Touch events", signals.touch]];
      const tw3 = (W - 8) / 3;
      tele.forEach(([k, v], i) => {
        const x = M + i * (tw3 + 4);
        fill(i === 0 ? TEAL : PAPER); doc.roundedRect(x, y, tw3, 22, 3, 3, "F");
        label(k, x + 5, y + 7, i === 0 ? [200, 220, 226] : W5);
        doc.setFont("times", "normal"); doc.setFontSize(20); ink(i === 0 ? [255, 255, 255] : INK);
        doc.text(String(v), x + 5, y + 17.5);
      });
      y += 30;

      // ── 04 Activity timeline ─────────────────────────────────────────────
      section("04", "Activity timeline");
      const recent = dnaEvents.slice(-10);
      if (recent.length === 0) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(10); ink(W5);
        doc.text("No events recorded in this session.", M, y + 3);
        y += 8;
      }
      recent.forEach((ev: DNAEvent) => {
        const lvl = ev.level === "block" ? "BLOCKED" : ev.level === "alert" ? "ALERT" : ev.level === "warn" ? "WARN" : "OK";
        const c: RGB = ev.level === "block" || ev.level === "alert" ? RED : ev.level === "warn" ? AMBER : GREEN;
        const msg = doc.splitTextToSize(clean(ev.msg) || "-", W - 46);
        const h = msg.length * 4.4 + 3;
        ensure(h);
        doc.setFont("courier", "normal"); doc.setFontSize(8); ink(W4);
        doc.text(clean(ev.time), M, y + 3);
        doc.setFont("courier", "bold"); ink(c);
        doc.text(lvl, M + 20, y + 3);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); ink(INK);
        doc.text(msg, M + 40, y + 3);
        y += h;
      });

      // Closing note
      ensure(18);
      y += 6;
      fill(PAPER); doc.roundedRect(M, y, W, 14, 3, 3, "F");
      doc.setFont("times", "italic"); doc.setFontSize(11); ink(W6);
      doc.text("Passwords prove what you know. Citadel proves who you are.", M + 6, y + 8.8);
      footer();

      doc.save(`ZipPay_Threat_Audit_${sdkSessRef.current.slice(0, 8)}.pdf`);
      addEv("success", "Threat audit report PDF downloaded");
    } catch (e: any) {
      addEv("warn", `Failed to generate PDF: ${e.message}`);
    }
  }, [account, dnaEvents, riskScore, decision, signals, coercionProb, onChain, addEv, threatScore, wrongPassAttempts]);

  // ── Login Screen Router ──────────────────────────────────────────────────────
  if (!loggedIn) {
    return (
      <>
        <LoginScreen accounts={accounts} onLogin={handleLogin} onRegisterSuccess={handleRegisterSuccess} onGoogleLogin={handleGoogleLogin} loggingIn={loggingIn} loginError={loginError} onExportPDF={exportPDFReport} onRemoveAccount={handleRemoveAccount} />
        
        {/* VPN Detected Block Overlay */}
        {vpnBlockedOverlay && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 400,
            background: "rgba(243, 242, 242, 0.98)",
            display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(20px)",
            color: "#100F0F", fontFamily: "'Inter', sans-serif"
          }}>
            <div style={{
              background: "#FFFFFF",
              borderRadius: 24, padding: "40px 48px", maxWidth: 460, width: "90%",
              boxShadow: "0 18px 40px -24px rgba(16,15,15,0.22)",
              border: "1px solid rgba(179, 38, 30, 0.25)",
              textAlign: "center"
            }}>
              <div style={{ fontSize: 64, marginBottom: 20 }}>⛔</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#B3261E", letterSpacing: "-0.03em", marginBottom: 12 }}>
                VPN Connection Detected
              </div>
              <div style={{ fontSize: 13, color: "rgba(16, 15, 15,0.7)", lineHeight: 1.6, marginBottom: 24 }}>
                Citadel zero-backdoor protection has blocked this connection. Virtual Private Networks (VPNs) and anonymous proxies are strictly prohibited to prevent credential stuffing and remote access scams.
              </div>
              <div style={{
                background: "rgba(179, 38, 30, 0.08)", border: "1px solid rgba(179, 38, 30, 0.2)",
                borderRadius: 12, padding: "14px 18px", fontSize: 11, fontFamily: "'DM Mono',monospace",
                textAlign: "left", marginBottom: 28, color: "#C9605A"
              }}>
                <div><strong>Detected IP:</strong> {vpnBlockedOverlay.ip}</div>
                {vpnBlockedOverlay.city && <div><strong>Location:</strong> {vpnBlockedOverlay.city}, {vpnBlockedOverlay.country}</div>}
                {vpnBlockedOverlay.reason && <div><strong>Trigger:</strong> {vpnBlockedOverlay.reason}</div>}
              </div>
              <button onClick={() => setVpnBlockedOverlay(null)} style={{
                padding: "12px 30px", borderRadius: 10, border: "none",
                background: "#B3261E", color: "#fff", fontWeight: 700, fontSize: 13,
                cursor: "pointer", transition: "background 0.2s"
              }}>
                Disconnect & Try Again
              </button>
            </div>
          </div>
        )}
        {/* Render overlay on login page too if block occurs */}
        <AnimatePresence>
          {overlay?.type === "STEP_UP" && !overlay.reason.includes("Transaction Submitted Successfully") ? (
            <PauseScreen key="pause" reason={overlay.reason} score={overlay.score} onContinue={() => { fetch(apiUrl("/api/auth/demo/reset"), { method: "POST" }).catch(() => {}); closeOverlay(); }} onStop={() => { addEv("warn", "Customer reported being guided by a caller — payment stopped"); fetch(apiUrl("/api/auth/demo/reset"), { method: "POST" }).catch(() => {}); closeOverlay(); }} />
          ) : overlay && (
            <motion.div key="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(255, 255, 255,0.88)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(16px)" }}>
              <motion.div initial={{ scale: 0.85, y: 28 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }}
                style={{
                  background: overlay.type === "HARD_BLOCK" ? "rgba(234, 234, 234,0.97)" : overlay.type === "STEP_UP" ? "rgba(235, 235, 235,0.97)" : "rgba(238, 238, 238,0.97)",
                  border: `1px solid ${overlay.type === "HARD_BLOCK" ? "rgba(179, 38, 30,0.15)" : overlay.type === "STEP_UP" ? "rgba(183, 121, 31,0.15)" : "rgba(61, 139, 90,0.15)"}`,
                  borderRadius: 24, padding: "40px 44px", maxWidth: 440, width: "90%", textAlign: "center",
                  boxShadow: `0 0 80px ${overlay.type === "HARD_BLOCK" ? "rgba(179, 38, 30,0.2)" : overlay.type === "STEP_UP" ? "rgba(183, 121, 31,0.15)" : "rgba(61, 139, 90,0.15)"}`,
                }}>
                <div style={{ fontSize: 52, marginBottom: 16 }}>
                  {overlay.type === "HARD_BLOCK" ? "🔐" : overlay.type === "STEP_UP" ? "⚠️" : "✅"}
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 8, color: overlay.type === "HARD_BLOCK" ? "#B3261E" : overlay.type === "STEP_UP" ? "#B7791F" : "#3D8B5A" }}>
                  {overlay.type === "HARD_BLOCK" ? "Login Blocked" : overlay.type === "STEP_UP" ? "Verification Required" : "Identity Verified"}
                </div>
                <div style={{ fontSize: 13, color: "#575452", marginBottom: 20, lineHeight: 1.65 }}>{overlay.reason}</div>
                <div style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", marginBottom: 24, padding: "8px 14px", borderRadius: 8, background: "#FFFFFF", color: "#767270" }}>
                  Risk: {overlay.score}/1000 · {overlay.latencyMs > 0 ? `${overlay.latencyMs}ms` : "–"} · {overlay.type}
                </div>
                
                {/* Download PDF button inside block overlay */}
                <button onClick={exportPDFReport} style={{ width: "100%", padding: "11px 20px", borderRadius: 10, border: "1px solid #D7D2D0", background: "rgba(16, 15, 15,0.06)", color: "#100F0F", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 16 }}>
                  📄 Download Threat Audit PDF
                </button>
                
                <button onClick={() => {
                  fetch(apiUrl("/api/auth/demo/reset"), { method: "POST" }).catch(() => {});
                  setShowRecovery(true);
                }} style={{ width: "100%", padding: "11px 20px", borderRadius: 10, border: "1px solid rgba(11,60,93,0.3)", background: "rgba(11,60,93,0.08)", color: "var(--color-primary)", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 16 }}>
                  💡 Self-Service Biometric Recovery
                </button>
                
                <button onClick={() => {
                  fetch(apiUrl("/api/auth/demo/reset"), { method: "POST" }).catch(() => {});
                  closeOverlay();
                }} style={{ padding: "11px 30px", borderRadius: 10, border: `1px solid ${overlay.type === "HARD_BLOCK" ? "rgba(179, 38, 30,0.3)" : overlay.type === "STEP_UP" ? "rgba(183, 121, 31,0.3)" : "rgba(61, 139, 90,0.3)"}`, background: "transparent", color: overlay.type === "HARD_BLOCK" ? "#B3261E" : overlay.type === "STEP_UP" ? "#B7791F" : "#3D8B5A", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  ↩ Dismiss
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  const currentBalance = balances[account!.id] ?? 0;
  const currentTxns    = txnHistory[account!.id] ?? [];
  // A quick-pay shortcut to another real account known on this device — there
  // are no seeded demo profiles to fall back to, so this is simply absent
  // (and hidden below) until a second account has actually registered here.
  const otherAccount   = accounts.find(a => a.id !== account!.id) ?? null;

  const NAV_ITEMS: { id: Section; Icon: LucideIcon; label: string }[] = [
    { id: "home",     Icon: HomeIcon,       label: "Home"      },
    { id: "transfer", Icon: ArrowLeftRight, label: "Transfer"  },
    { id: "upi",      Icon: Smartphone,     label: "UPI / Pay" },
    { id: "history",  Icon: ReceiptText,    label: "History"   },
    { id: "profile",  Icon: User,           label: "Profile"   },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#FBF9F8", fontFamily: "'Inter', sans-serif", position: "relative" }}>

      {/* Mobile-only backdrop behind the slide-in sidebar */}
      {sidebarOpen && (
        <div className="zippay-sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <div className={`zippay-sidebar${sidebarOpen ? " open" : ""}`} style={{ background: "#FFFFFF", borderRight: "1px solid #EAE4E1", display: "flex", flexDirection: "column", flexShrink: 0, zIndex: 10 }}>
        {/* Bank logo */}
        <div style={{ padding: "20px 18px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(16, 15, 15,0.05)", border: "1px solid rgba(170, 65, 42,0.28)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Landmark size={17} strokeWidth={1.6} color="var(--color-primary)" />
            </div>
            <div>
              <div style={{ fontSize: 24, lineHeight: 1, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.02em", fontFamily: "'Newsreader', Georgia, serif" }}>ZipPay</div>
              <div style={{ fontSize: 9.5, color: "#767270", letterSpacing: "0.04em" }}>Retail banking</div>
            </div>
          </div>
          {/* Close affordance for the mobile slide-in drawer only */}
          <button
            className="zippay-mobile-menu-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
            style={{ display: "none", width: 28, height: 28, borderRadius: 8, border: "1px solid #D7D2D0", background: "rgba(16, 15, 15,0.04)", color: "#575452", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
          >
            <CloseIcon size={14} strokeWidth={1.8} />
          </button>
        </div>

        {/* Account info */}
        <div style={{ margin: "0 12px 14px", padding: "12px 13px", borderRadius: 12, background: "#FFFFFF", border: "1px solid #EAE4E1" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: `${account!.color}22`, border: `1px solid ${account!.color}55`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: account!.color, flexShrink: 0 }}>{account!.avatar}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#100F0F", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{account!.name}</div>
              <div style={{ fontSize: 9, color: "#767270", marginTop: 1, fontFamily: "'DM Mono',monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{account!.upiId}</div>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav style={{ padding: "0 12px", flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV_ITEMS.map(({ id, Icon, label }) => {
            const active = section === id;
            return (
              <button key={id} onClick={() => setSection(id)} style={{
                display: "flex", alignItems: "center", gap: 11, width: "100%",
                padding: "10px 12px", borderRadius: 9, cursor: "pointer",
                textAlign: "left", position: "relative",
                background: active ? "rgba(16, 15, 15,0.06)" : "transparent",
                border: `1px solid ${active ? "rgba(16, 15, 15,0.09)" : "transparent"}`,
                color: active ? "#100F0F" : "#767270",
                fontSize: 13, fontWeight: active ? 600 : 500,
                transition: "background 0.18s ease, color 0.18s ease",
              }}>
                {active && <span style={{ position: "absolute", left: 0, top: 9, bottom: 9, width: 2, borderRadius: 2, background: "var(--color-primary)" }} />}
                <Icon size={16} strokeWidth={1.7} color={active ? "var(--color-primary)" : "currentColor"} />
                {label}
              </button>
            );
          })}
        </nav>

        {/* Logout */}
        <div style={{ padding: "12px", borderTop: "1px solid #EAE4E1" }}>
          <button
            onClick={() => { setLoggedIn(false); setAccount(null); setAuthToken(null); closeOverlay(); addEv("info", "Session ended"); }}
            onMouseEnter={() => setSignOutHover(true)}
            onMouseLeave={() => setSignOutHover(false)}
            style={{
              display: "flex", alignItems: "center", gap: 11, width: "100%",
              padding: "9px 12px", borderRadius: 9, cursor: "pointer",
              border: `1px solid ${signOutHover ? "rgba(179, 38, 30,0.25)" : "transparent"}`,
              background: signOutHover ? "rgba(179, 38, 30,0.08)" : "transparent",
              color: signOutHover ? "#B3261E" : "#767270",
              fontSize: 12.5, fontWeight: 500, transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
            }}
          >
            <LogOut size={15} strokeWidth={1.7} />
            Sign out
          </button>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{ padding: "15px 26px", borderBottom: "1px solid #EAE4E1", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className="zippay-mobile-menu-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              style={{ display: "none", width: 34, height: 34, borderRadius: 9, border: "1px solid #D7D2D0", background: "rgba(16, 15, 15,0.04)", color: "#575452", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
            >
              <Menu size={16} strokeWidth={1.8} />
            </button>
            <div>
              <div style={{ fontSize: 30, lineHeight: 1.05, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.02em", fontFamily: "'Newsreader', Georgia, serif" }}>{NAV_ITEMS.find(n => n.id === section)?.label}</div>
              <div style={{ fontSize: 10.5, color: "#767270", marginTop: 2 }}>ZipPay Bank · {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {evaluating && <div style={{ fontSize: 10, color: "#B7791F", fontFamily: "'DM Mono',monospace", display: "flex", alignItems: "center", gap: 5 }}><motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }} style={{ display: "inline-block" }}>⟳</motion.span> Citadel evaluating…</div>}
            {/* Channel Toggle */}
            <div style={{ display: "flex", gap: 3, borderRadius: 9, padding: 3, background: "#FFFFFF", border: "1px solid #EAE4E1" }}>
              {([
                { ch: "internet_banking" as const, label: "Web", Icon: Monitor },
                { ch: "mobile_banking" as const, label: "Mobile", Icon: Smartphone },
              ]).map(({ ch, label, Icon }) => {
                const on = channel === ch;
                return (
                  <button key={ch} onClick={() => setChannel(ch)} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 11px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 600,
                    background: on ? "rgba(16, 15, 15,0.09)" : "transparent",
                    border: `1px solid ${on ? "rgba(16, 15, 15,0.12)" : "transparent"}`,
                    color: on ? "#100F0F" : "#767270", transition: "all 0.18s",
                  }}>
                    <Icon size={13} strokeWidth={1.8} />
                    {label}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setDnaOpen(!dnaOpen)} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 9,
              border: `1px solid ${dnaOpen ? "rgba(61, 139, 90,0.28)" : "rgba(16, 15, 15,0.08)"}`,
              background: dnaOpen ? "rgba(61, 139, 90,0.08)" : "rgba(16, 15, 15,0.025)",
              color: dnaOpen ? "#3D8B5A" : "#575452", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
            }}>
              {dnaOpen ? <ShieldCheck size={14} strokeWidth={1.8} /> : <Activity size={14} strokeWidth={1.8} />}
              {dnaOpen ? "Shield active" : "Open shield"}
            </button>
            {/* Emergency badge — only visible when duress mode is active */}
            {duressActive && (
              <motion.div
                animate={{ opacity: [1, 0.6, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20, background: "rgba(179, 38, 30,0.1)", border: "1px solid rgba(179, 38, 30,0.4)", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#B3261E" }}
                onClick={() => setSection("transfer")}
              >
                <AlertTriangle size={13} strokeWidth={2} />
                Emergency Active
              </motion.div>
            )}

            {/* Account menu — click to reveal profile / sign out */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setAccountMenuOpen(o => !o)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "5px 10px 5px 5px",
                  borderRadius: 20, cursor: "pointer",
                  background: accountMenuOpen ? "rgba(16, 15, 15,0.09)" : "rgba(16, 15, 15,0.025)",
                  border: `1px solid ${accountMenuOpen ? "rgba(16, 15, 15,0.16)" : "rgba(16, 15, 15,0.08)"}`,
                  transition: "background 0.15s ease, border-color 0.15s ease",
                }}
              >
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: `${account!.color}22`, border: `1px solid ${account!.color}55`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: account!.color, flexShrink: 0 }}>
                  {account!.avatar}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#100F0F", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {account!.name.split(" ")[0]}
                </span>
                <ChevronDown size={13} strokeWidth={2} color="#767270" style={{ transform: accountMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
              </button>

              {accountMenuOpen && (
                <>
                  {/* Invisible full-screen backdrop so an outside click dismisses the menu */}
                  <div onClick={() => setAccountMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 150 }} />
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 200,
                      background: "rgba(236, 236, 236,0.98)", border: "1px solid #D7D2D0",
                      borderRadius: 12, padding: 6, boxShadow: "0 18px 40px -24px rgba(16,15,15,0.22)",
                      zIndex: 151,
                    }}
                  >
                    <div style={{ padding: "8px 10px", borderBottom: "1px solid #EAE4E1", marginBottom: 4 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#100F0F", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{account!.name}</div>
                      <div style={{ fontSize: 10, color: "#767270", fontFamily: "'DM Mono',monospace", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{account!.upiId}</div>
                    </div>
                    <button
                      onClick={() => { setAccountMenuOpen(false); setSection("profile"); }}
                      style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "#575452", fontSize: 12.5, fontWeight: 500, cursor: "pointer", textAlign: "left" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(16, 15, 15,0.06)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <User size={14} strokeWidth={1.8} />
                      Profile
                    </button>
                    <button
                      onClick={() => { setAccountMenuOpen(false); setLoggedIn(false); setAccount(null); setAuthToken(null); closeOverlay(); addEv("info", "Session ended"); }}
                      style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "#B3261E", fontSize: 12.5, fontWeight: 500, cursor: "pointer", textAlign: "left" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(179, 38, 30,0.1)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <LogOut size={14} strokeWidth={1.8} />
                      Sign out
                    </button>
                  </motion.div>
                </>
              )}
            </div>

          </div>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "22px 26px 32px", marginRight: dnaOpen ? 400 : 0, transition: "margin-right 0.35s cubic-bezier(0.16,1,0.3,1)" }}>

          {/* HOME SECTION */}
          {section === "home" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1080, margin: "0 auto", width: "100%" }}>
              {/* Emergency Alerts Section */}
              {duressActive && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  style={{
                    padding: "16px 20px", borderRadius: 16,
                    background: "rgba(179, 38, 30, 0.08)", border: "2px solid #B3261E",
                    boxShadow: "0 4px 15px rgba(179, 38, 30, 0.15)",
                    color: "#B3261E"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 20 }}>⚠️</span>
                    <strong style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Account Flagged: High-Risk Security Event
                    </strong>
                  </div>
                  <div style={{ fontSize: 11, color: "#575452", lineHeight: 1.5 }}>
                    Emergency Mode was activated on this account. Trusted contacts have been notified, and live location coordinates are sharing securely with security administrators.
                  </div>
                  <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 9.5, fontFamily: "'DM Mono',monospace", color: "#767270" }}>
                    <span>Incident: {duressActive.incidentId}</span>
                    <span>Activated: {new Date(duressActive.activatedAt).toLocaleTimeString()}</span>
                  </div>
                </motion.div>
              )}

              {/* Balance hero — Concurrence orange band */}
              <motion.div
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                style={{ borderRadius: 24, padding: "30px 32px", position: "relative", overflow: "hidden", background: "#AA412A", color: "#FFFFFF" }}
              >
                {[[58, 14, 0.12], [74, 9, 0.08], [88, 12, 0.14]].map(([x, w, o], k) => (
                  <motion.div key={k} aria-hidden
                    animate={{ opacity: [o, o * 1.7, o] }} transition={{ duration: 6 + k, repeat: Infinity, ease: "easeInOut" }}
                    style={{ position: "absolute", top: 0, bottom: 0, left: `${x}%`, width: `${w}%`, background: "#fff", filter: "blur(16px)", pointerEvents: "none" }} />
                ))}

                <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="cc-mono" style={{ color: "rgba(255,255,255,0.8)", marginBottom: 14 }}>Available balance</div>
                    <div style={{ fontSize: "clamp(44px, 5vw, 64px)", fontWeight: 300, letterSpacing: "-0.03em", lineHeight: 1, fontVariantNumeric: "tabular-nums", fontFamily: "'Newsreader', Georgia, serif" }}>
                      {fmtINR(currentBalance)}
                    </div>
                    <div className="cc-mono" style={{ color: "rgba(255,255,255,0.72)", marginTop: 14 }}>
                      {account!.accountNo} · IFSC {account!.ifsc}
                    </div>
                  </div>
                  <div className="cc-mono" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 8, background: "rgba(255,255,255,0.16)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", color: "#FFFFFF", flexShrink: 0 }}>
                    <span style={{ position: "relative", display: "inline-flex", width: 7, height: 7 }}>
                      <span className="cc-ping" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#9BE3B4", opacity: 0.6 }} />
                      <span style={{ position: "relative", width: 7, height: 7, borderRadius: "50%", background: "#9BE3B4" }} />
                    </span>
                    Protected by Citadel
                  </div>
                </div>

                <div style={{ position: "relative", display: "flex", gap: 8, flexWrap: "wrap", marginTop: 30 }}>
                  {([
                    { label: "Send money", s: "transfer" as Section, Icon: Send, primary: true },
                    { label: "UPI pay", s: "upi" as Section, Icon: QrCode, primary: false },
                    { label: "History", s: "history" as Section, Icon: HistoryIcon, primary: false },
                  ]).map(({ label, s, Icon, primary }) => (
                    <button key={label} onClick={() => setSection(s)} className="cc-btn" style={{
                      background: primary ? "#FFFFFF" : "rgba(255,255,255,0.16)",
                      color: primary ? "#AA412A" : "#FFFFFF",
                      border: "none", backdropFilter: primary ? undefined : "blur(10px)",
                    }}>
                      <Icon size={15} strokeWidth={1.9} />
                      {label}
                    </button>
                  ))}
                </div>
              </motion.div>

              {/* Quick stats — money on the left, risk meters on the right */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                {([
                  {
                    label: "Total sent", value: fmtINR(currentTxns.filter(t => t.type === "debit").reduce((a, t) => a + t.amount, 0)),
                    Icon: ArrowUpRight, tone: "#100F0F", accent: "rgba(179, 38, 30,0.75)",
                  },
                  {
                    label: "Total received", value: fmtINR(currentTxns.filter(t => t.type === "credit").reduce((a, t) => a + t.amount, 0)),
                    Icon: ArrowDownLeft, tone: "#100F0F", accent: "#3D8B5A",
                  },
                  {
                    label: "Citadel risk", value: `${riskScore}`, scale: 1000, score: riskScore,
                    Icon: Activity, tone: riskScore < 300 ? "#3D8B5A" : riskScore < 600 ? "#B7791F" : "#B3261E",
                  },
                  {
                    label: "Threat index", value: `${threatScore}`, scale: 100, score: threatScore,
                    Icon: ShieldAlert, tone: threatScore < 30 ? "#3D8B5A" : threatScore < 60 ? "#B7791F" : "#B3261E",
                  },
                ]).map(s => (
                  <div key={s.label} style={{ padding: "18px 20px", borderRadius: 16, background: "#FFFFFF", border: "1px solid #EAE4E1" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <span style={{ fontSize: 10, color: "#767270", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>{s.label}</span>
                      <s.Icon size={14} strokeWidth={1.8} color={s.accent ?? s.tone} />
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                      <span style={{ fontSize: 30, fontWeight: 400, color: s.tone, letterSpacing: "-0.02em", lineHeight: 1, fontVariantNumeric: "tabular-nums", fontFamily: "'Newsreader', Georgia, serif" }}>{s.value}</span>
                      {s.scale && <span style={{ fontSize: 11, color: "#969290", fontFamily: "'DM Mono',monospace" }}>/{s.scale}</span>}
                    </div>
                    {/* The two risk figures use different scales, so show each against its own. */}
                    {s.scale !== undefined && s.score !== undefined && (
                      <div style={{ height: 3, borderRadius: 2, background: "rgba(16, 15, 15,0.07)", marginTop: 11, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, (s.score / s.scale) * 100)}%`, height: "100%", borderRadius: 2, background: s.tone, transition: "width 0.4s ease" }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Recent transactions */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 26, fontWeight: 400, color: "#100F0F", letterSpacing: "-0.015em", fontFamily: "'Newsreader', Georgia, serif" }}>Recent transactions</div>
                  {currentTxns.length > 5 && (
                    <button onClick={() => setSection("history")} style={{ fontSize: 11, fontWeight: 600, color: "#767270", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                      View all →
                    </button>
                  )}
                </div>
                {currentTxns.length === 0 ? (
                  /* Empty state — the heading used to sit above several hundred
                     pixels of nothing on a fresh account. */
                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 12, padding: "40px 24px", borderRadius: 13,
                    background: "#FFFFFF", border: "1px dashed rgba(16, 15, 15,0.1)", textAlign: "center",
                  }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(16, 15, 15,0.04)", border: "1px solid #EAE4E1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Inbox size={19} strokeWidth={1.6} color="#767270" />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#575452" }}>No transactions yet</div>
                      <div style={{ fontSize: 11.5, color: "#767270", marginTop: 4, maxWidth: 320, lineHeight: 1.5 }}>
                        Your first transfer or UPI payment will appear here, along with the Citadel score that cleared it.
                      </div>
                    </div>
                    <button onClick={() => setSection("transfer")} style={{
                      display: "flex", alignItems: "center", gap: 7, marginTop: 2,
                      fontSize: 12, fontWeight: 600, borderRadius: 9, padding: "9px 16px", cursor: "pointer",
                      background: "var(--color-primary)", color: "var(--color-on-primary)", border: "none",
                    }}>
                      <Send size={14} strokeWidth={1.9} />
                      Make a transfer
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {currentTxns.slice(0, 5).map(txn => {
                      const credit = txn.type === "credit";
                      const TxnIcon = txnIconFor(txn);
                      return (
                        <div key={txn.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 15px", borderRadius: 11, background: "#FFFFFF", border: "1px solid #EAE4E1" }}>
                          <div style={{ width: 34, height: 34, borderRadius: 10, background: credit ? "rgba(61, 139, 90,0.1)" : "rgba(16, 15, 15,0.05)", border: `1px solid ${credit ? "rgba(61, 139, 90,0.2)" : "rgba(16, 15, 15,0.08)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <TxnIcon size={15} strokeWidth={1.7} color={credit ? "#3D8B5A" : "rgba(20, 19, 19,0.65)"} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#100F0F", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{credit ? txn.from : txn.to}</div>
                            <div style={{ fontSize: 10.5, color: "#767270", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {txn.description} · {txn.time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: credit ? "#3D8B5A" : "#100F0F", fontVariantNumeric: "tabular-nums" }}>
                              {credit ? "+" : "−"}{fmtINR(txn.amount)}
                            </div>
                            <div style={{ fontSize: 9, fontFamily: "'DM Mono',monospace", color: txn.decision === "APPROVE" ? "rgba(61, 139, 90,0.8)" : "#B7791F", marginTop: 2, letterSpacing: "0.04em" }}>
                              DNA {txn.riskScore}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TRANSFER SECTION */}
          {section === "transfer" && (
            <div style={{ maxWidth: 600, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: 18, background: "#FFFFFF", border: "1px solid #EAE4E1", borderRadius: 20, padding: "28px 30px", boxSizing: "border-box" }}>
              <div style={{ fontSize: 12, color: "#575452", marginBottom: 4 }}>
                Transfer between ZipPay accounts or any UPI ID. Citadel evaluates every transfer.
              </div>

              {/* Active emergency banner */}
              {duressActive && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                  style={{ padding: "12px 16px", borderRadius: 12, background: "rgba(179, 38, 30,0.06)", border: "2px solid rgba(179, 38, 30,0.3)", display: "flex", alignItems: "center", gap: 10 }}
                >
                  <motion.span animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} style={{ fontSize: 20 }}>🚨</motion.span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#B3261E" }}>Emergency Mode Active</div>
                    <div style={{ fontSize: 10, color: "#575452", fontFamily: "'DM Mono',monospace" }}>
                      {duressActive.incidentId} · Sharing location every 30s
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Quick to-account selector */}
              <div>
                <div style={{ fontSize: 10, color: "#767270", marginBottom: 8, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>Send To</div>
                {otherAccount && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button onClick={() => setXferTo(otherAccount.upiId)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 12, border: `1px solid ${xferTo === otherAccount.upiId ? otherAccount.color + "50" : "rgba(16, 15, 15,0.08)"}`, background: xferTo === otherAccount.upiId ? `${otherAccount.color}12` : "rgba(16, 15, 15,0.03)", cursor: "pointer" }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg,${otherAccount.color},${otherAccount.color}80)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff" }}>{otherAccount.avatar}</div>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#100F0F" }}>{otherAccount.name}</div>
                        <div style={{ fontSize: 9, color: "#767270" }}>{otherAccount.upiId}</div>
                      </div>
                    </button>
                  </div>
                )}
                <input value={xferTo} onChange={e => setXferTo(e.target.value)} placeholder="or enter UPI ID / Account No." style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 10, fontSize: 13, color: "#100F0F", background: "#FFFFFF", border: "1px solid #EAE4E1", outline: "none", fontFamily: "'Inter',sans-serif" }} />
              </div>

              {[
                { label: "Amount (₹)", val: xferAmt, set: setXferAmt, placeholder: "Enter amount" },
                { label: "Remarks", val: xferNote, set: setXferNote, placeholder: "Optional note" },
              ].map(({ label, val, set, placeholder }) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: "#767270", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>{label}</div>
                  <input value={val} onChange={e => set(e.target.value)} placeholder={placeholder} style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 10, fontSize: 13, color: "#100F0F", background: "#FFFFFF", border: "1px solid #EAE4E1", outline: "none", fontFamily: "'Inter',sans-serif" }} />
                </div>
              ))}

              {/* ── Transaction PIN Field (auto-detects Normal vs Duress) ── */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: "#767270", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>
                    🔐 Transaction PIN
                  </div>
                  <div style={{ fontSize: 9, color: "#767270", fontStyle: "italic" }}>Required to confirm payment</div>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    id="transfer-pin-field"
                    type={showXferPin ? "text" : "password"}
                    value={xferPin}
                    onChange={e => setXferPin(e.target.value)}
                    placeholder="Enter your transaction PIN…"
                    style={{ width: "100%", boxSizing: "border-box", padding: "11px 44px 11px 14px", borderRadius: 10, fontSize: 13, color: "#100F0F", background: "#FFFFFF", border: "1px solid rgba(170, 65, 42,0.25)", outline: "none", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em" }}
                  />
                  <button type="button" onClick={() => setShowXferPin(p => !p)}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#767270" }}>
                    {showXferPin ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>

              {/* DNA preview bar */}
              {riskScore > 0 && (
                <div style={{ padding: "10px 14px", borderRadius: 10, background: "#FFFFFF", border: "1px solid #EAE4E1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "#575452" }}>🧬 Citadel live score</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: riskScore < 300 ? "#3D8B5A" : riskScore < 600 ? "#B7791F" : "#B3261E", fontFamily: "'DM Mono',monospace" }}>{riskScore}/1000</span>
                </div>
              )}

              <motion.button
                id="transfer-submit-btn"
                disabled={evaluating || duressActivating}
                onClick={handleDuressTransfer}
                whileHover={{ scale: (evaluating || duressActivating) ? 1 : 1.01 }}
                whileTap={{ scale: 0.98 }}
                style={{ padding: "14px 20px", borderRadius: 12, border: "none", cursor: (evaluating || duressActivating) ? "wait" : "pointer", fontSize: 14, fontWeight: 700, background: (evaluating || duressActivating) ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg,var(--color-primary),var(--color-primary-active))", color: (evaluating || duressActivating) ? "rgba(241, 234, 231,0.4)" : "var(--color-on-primary)", boxShadow: (evaluating || duressActivating) ? "none" : "0 8px 22px rgba(0,0,0,0.45)", transition: "all 0.3s" }}
              >
                {duressActivating ? "🔄 Processing…" : evaluating ? "🔄 Citadel evaluating..." : `💸 Transfer ${fmtINR(parseInt(xferAmt) || 0)}`}
              </motion.button>
            </div>
          )}


          {/* UPI / RAZORPAY SECTION */}
          {section === "upi" && (
            <div style={{ maxWidth: 600, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: 18, background: "#FFFFFF", border: "1px solid #EAE4E1", borderRadius: 20, padding: "28px 30px", boxSizing: "border-box" }}>
              <div style={{ fontSize: 12, color: "#575452", marginBottom: 4 }}>
                UPI payments are powered by Razorpay. Citadel evaluates BEFORE Razorpay opens — if blocked, the payment never reaches Razorpay.
              </div>

              <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(16, 15, 15,0.035)", border: "1px solid rgba(170, 65, 42,0.14)", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 20 }}>🔒</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#100F0F", marginBottom: 2 }}>Citadel Payment Gate</div>
                  <div style={{ fontSize: 10, color: "#575452", lineHeight: 1.5 }}>Every Razorpay transaction passes through Citadel first. If risk score ≥ 300, Razorpay checkout never opens.</div>
                </div>
              </div>

              {[
                { label: "Merchant / Payee Name", val: upiName, set: setUpiName, placeholder: "Merchant name" },
                { label: "UPI ID / VPA", val: upiTo, set: setUpiTo, placeholder: "merchant@razorpay" },
                { label: "Amount (₹)", val: upiAmt, set: setUpiAmt, placeholder: "Enter amount" },
              ].map(({ label, val, set, placeholder }) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: "#767270", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>{label}</div>
                  <input value={val} onChange={e => set(e.target.value)} placeholder={placeholder} style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 10, fontSize: 13, color: "#100F0F", background: "#FFFFFF", border: "1px solid #EAE4E1", outline: "none", fontFamily: "'Inter',sans-serif" }} />
                </div>
              ))}

              <motion.button disabled={evaluating} onClick={handleRazorpay} whileHover={{ scale: evaluating ? 1 : 1.01 }} whileTap={{ scale: 0.98 }} style={{ padding: "14px 20px", borderRadius: 12, border: "none", cursor: evaluating ? "wait" : "pointer", fontSize: 14, fontWeight: 700, background: evaluating ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg,var(--color-primary-active),var(--color-primary))", color: evaluating ? "rgba(241, 234, 231,0.4)" : "var(--color-on-primary)", boxShadow: evaluating ? "none" : "0 8px 22px rgba(0,0,0,0.45)", transition: "all 0.3s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {evaluating ? "🔄 Citadel evaluating..." : <><span style={{ fontSize: 18 }}>💳</span> Pay {fmtINR(parseInt(upiAmt) || 0)} via Razorpay</>}
              </motion.button>

              <div style={{ fontSize: 10, color: "#767270", textAlign: "center" }}>
                Test mode · Use card 4111 1111 1111 1111 or UPI success@razorpay
              </div>

              {/* ── QR Code Fraud Scanner divider ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
                <div style={{ flex: 1, height: 1, background: "rgba(16, 15, 15,0.06)" }} />
                <span style={{ fontSize: 10, color: "#767270", fontFamily: "'DM Mono',monospace", whiteSpace: "nowrap" }}>or scan & verify QR</span>
                <div style={{ flex: 1, height: 1, background: "rgba(16, 15, 15,0.06)" }} />
              </div>

              {/* ── QR Scan Button ── */}
              <motion.button
                id="qr-scan-pay-btn"
                onClick={() => { setQrModalOpen(true); setQrResult(null); setQrImagePreview(null); setQrDecoded(""); setQrError(""); setQrScanStep(0); }}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.97 }}
                style={{
                  padding: "14px 20px", borderRadius: 12, border: "2px dashed rgba(170, 65, 42,0.35)",
                  cursor: "pointer", fontSize: 13, fontWeight: 700,
                  background: "rgba(16, 15, 15,0.035)",
                  color: "var(--color-primary)", transition: "all 0.3s",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                }}
              >
                <span style={{ fontSize: 20 }}>📷</span>
                <div style={{ textAlign: "left" }}>
                  <div>Scan UPI QR Code</div>
                  <div style={{ fontSize: 10, fontWeight: 400, color: "rgba(170, 65, 42,0.7)" }}>Verify QR with VirusTotal · 70+ threat engines</div>
                </div>
                <div style={{ marginLeft: "auto", padding: "3px 8px", borderRadius: 20, background: "rgba(16, 15, 15,0.07)", fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", color: "var(--color-primary)" }}>🛡️ FRAUD CHECK</div>
              </motion.button>
            </div>
          )}

          {/* ── QR Fraud Scanner Modal ──────────────────────────────────────────── */}
          <AnimatePresence>
            {qrModalOpen && (
              <motion.div
                key="qr-modal-backdrop"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(255, 255, 255,0.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
                onClick={(e) => { if (e.target === e.currentTarget && !qrScanning) setQrModalOpen(false); }}
              >
                <motion.div
                  initial={{ scale: 0.93, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.93, y: 20 }}
                  style={{ background: "#FFFFFF", border: "1px solid #EAE4E1", borderRadius: 20, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 18px 40px -24px rgba(16,15,15,0.22)", fontFamily: "'Inter', sans-serif" }}
                >
                  {/* Modal Header */}
                  <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #EAE4E1", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: "#AA412A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🔍</div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#100F0F", letterSpacing: "-0.02em" }}>UPI QR Fraud Scanner</div>
                      <div style={{ fontSize: 11, color: "#767270" }}>Powered by VirusTotal · 70+ threat engines</div>
                    </div>
                    {!qrScanning && (
                      <button onClick={() => setQrModalOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#767270", lineHeight: 1 }}>×</button>
                    )}
                  </div>

                  <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

                    {/* Upload area */}
                    {!qrResult && (
                      <div
                        id="qr-upload-dropzone"
                        onClick={() => !qrScanning && qrFileRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const file = e.dataTransfer.files[0];
                          if (file) handleQrFileSelect(file);
                        }}
                        style={{
                          borderRadius: 16, border: `2px dashed ${qrScanning ? "rgba(170, 65, 42,0.5)" : "rgba(255, 255, 255,0.12)"}`,
                          background: qrImagePreview ? "rgba(255, 255, 255,0.02)" : "rgba(255, 255, 255,0.01)",
                          padding: qrImagePreview ? "12px" : "32px 20px",
                          textAlign: "center", cursor: qrScanning ? "wait" : "pointer",
                          transition: "all 0.3s", position: "relative", overflow: "hidden",
                        }}
                      >
                        <input ref={qrFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleQrFileSelect(f); }} />
                        {qrImagePreview ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                            <img src={qrImagePreview} alt="QR preview" style={{ width: 90, height: 90, objectFit: "contain", borderRadius: 10, border: "1px solid #EAE4E1" }} />
                            <div style={{ textAlign: "left", flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#100F0F", marginBottom: 4 }}>QR Image Loaded</div>
                              {qrDecoded && <div style={{ fontSize: 10, color: "#767270", fontFamily: "'DM Mono',monospace", wordBreak: "break-all", lineHeight: 1.4 }}>{qrDecoded.slice(0, 80)}{qrDecoded.length > 80 ? "…" : ""}</div>}
                              {!qrScanning && <div style={{ fontSize: 10, color: "var(--color-primary)", marginTop: 6, cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); setQrImagePreview(null); setQrDecoded(""); setQrError(""); }}>↩ Upload different image</div>}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#100F0F", marginBottom: 6 }}>Upload QR Code Image</div>
                            <div style={{ fontSize: 11, color: "#767270" }}>Drag & drop or click to select · PNG, JPG supported</div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Live camera scan */}
                    {!qrResult && !qrScanning && (
                      qrCameraOn ? (
                        <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", border: "2px solid rgba(170, 65, 42,0.45)", background: "#1C1A19" }}>
                          <video ref={qrVideoRef} playsInline muted style={{ width: "100%", display: "block", maxHeight: 320, objectFit: "cover" }} />
                          <div style={{ position: "absolute", inset: 14, border: "3px solid rgba(170, 65, 42,0.6)", borderRadius: 12, pointerEvents: "none" }} />
                          <div style={{ position: "absolute", bottom: 10, left: 0, right: 0, textAlign: "center", fontSize: 11, fontWeight: 700, color: "#F2FA56", textShadow: "0 1px 4px #000" }}>
                            Point at a UPI QR code…
                          </div>
                          <button onClick={stopQrCamera} style={{ position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: "50%", border: "none", background: "rgba(255, 255, 255,0.6)", color: "#100F0F", fontSize: 14, cursor: "pointer" }}>✕</button>
                        </div>
                      ) : !qrDecoded && (
                        <button
                          id="qr-camera-scan-btn"
                          onClick={startQrCamera}
                          style={{ padding: "12px", borderRadius: 12, border: "1px solid rgba(170, 65, 42,0.35)", background: "rgba(170, 65, 42,0.08)", color: "var(--color-primary)", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                        >
                          📸 Scan with Camera (live)
                        </button>
                      )
                    )}

                    {qrError && !qrResult && (
                      <div style={{ padding: "10px 14px", background: "rgba(179, 38, 30,0.06)", border: "1px solid rgba(179, 38, 30,0.2)", borderRadius: 10, color: "#B3261E", fontSize: 11 }}>⚠️ {qrError}</div>
                    )}

                    {/* Scanning progress steps */}
                    {qrScanning && (
                      <div style={{ padding: "16px", borderRadius: 14, background: "rgba(16, 15, 15,0.035)", border: "1px solid rgba(170, 65, 42,0.12)" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-primary)", marginBottom: 12, textAlign: "center" }}>🔍 Fraud Analysis in Progress…</div>
                        {[
                          { step: 1, label: "Decoding QR image", icon: "📷" },
                          { step: 2, label: "Extracting UPI ID & metadata", icon: "🔎" },
                          { step: 3, label: "Scanning with VirusTotal (70+ engines)", icon: "🛡️" },
                          { step: 4, label: "Computing fraud verdict", icon: "🤖" },
                        ].map(({ step, label, icon }) => (
                          <div key={step} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <div style={{
                              width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                              background: qrScanStep > step ? "rgba(61, 139, 90,0.15)" : qrScanStep === step ? "rgba(170, 65, 42,0.15)" : "rgba(255, 255, 255,0.04)",
                              border: `1px solid ${qrScanStep > step ? "#3D8B5A" : qrScanStep === step ? "var(--color-primary)" : "rgba(255, 255, 255,0.08)"}`,
                              fontSize: 11,
                            }}>
                              {qrScanStep > step ? "✓" : icon}
                            </div>
                            <span style={{ fontSize: 11, color: qrScanStep > step ? "#16a34a" : qrScanStep === step ? "var(--color-primary)" : "#767270", fontWeight: qrScanStep === step ? 600 : 400 }}>{label}</span>
                            {qrScanStep === step && (
                              <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 0.8 }} style={{ marginLeft: "auto", fontSize: 10, color: "var(--color-primary)", fontFamily: "'DM Mono',monospace" }}>●●●</motion.span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Result card */}
                    {qrResult && !qrScanning && (() => {
                      const verdictConfig = {
                        SAFE:       { color: "#3D8B5A", bg: "rgba(61, 139, 90,0.08)",  border: "rgba(61, 139, 90,0.25)",  icon: "✅", label: "QR CODE IS SAFE" },
                        SUSPICIOUS: { color: "#B7791F", bg: "rgba(183, 121, 31,0.08)", border: "rgba(183, 121, 31,0.25)", icon: "⚠️", label: "SUSPICIOUS QR CODE" },
                        MALICIOUS:  { color: "#B3261E", bg: "rgba(179, 38, 30,0.08)",  border: "rgba(179, 38, 30,0.25)",  icon: "🔴", label: "MALICIOUS QR CODE" },
                      }[qrResult.verdict] ?? { color: "#94a3b8", bg: "rgba(16, 15, 15,0.04)", border: "rgba(16, 15, 15,0.06)", icon: "❓", label: "UNKNOWN" };

                      return (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {/* Verdict banner */}
                          <div style={{ padding: "16px 20px", borderRadius: 14, background: verdictConfig.bg, border: `2px solid ${verdictConfig.border}`, textAlign: "center" }}>
                            <div style={{ fontSize: 36, marginBottom: 6 }}>{verdictConfig.icon}</div>
                            <div style={{ fontSize: 14, fontWeight: 900, color: verdictConfig.color, letterSpacing: "0.05em" }}>{verdictConfig.label}</div>
                            <div style={{ fontSize: 12, color: "#575452", marginTop: 4 }}>Risk Score: <strong style={{ color: verdictConfig.color }}>{qrResult.risk_score}/100</strong></div>
                          </div>

                          {/* QR details */}
                          <div style={{ padding: "14px 16px", borderRadius: 12, background: "#FFFFFF", border: "1px solid #EAE4E1", display: "flex", flexDirection: "column", gap: 8 }}>
                            {qrResult.vpa && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}><span style={{ color: "#767270" }}>UPI VPA</span><span style={{ fontWeight: 600, color: "#100F0F", fontFamily: "'DM Mono',monospace" }}>{qrResult.vpa}</span></div>}
                            {qrResult.payee_name && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}><span style={{ color: "#767270" }}>Payee Name</span><span style={{ fontWeight: 600, color: "#100F0F" }}>{qrResult.payee_name}</span></div>}
                            {qrResult.amount && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}><span style={{ color: "#767270" }}>Amount</span><span style={{ fontWeight: 600, color: "#100F0F" }}>₹{qrResult.amount}</span></div>}
                            {qrResult.vt_stats && Object.keys(qrResult.vt_stats).length > 0 && (
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                                <span style={{ color: "#767270" }}>VirusTotal</span>
                                <span style={{ fontWeight: 600, color: (qrResult.vt_stats.malicious ?? 0) > 0 ? "#B3261E" : "#3D8B5A" }}>
                                  {qrResult.vt_stats.malicious ?? 0} malicious / {qrResult.vt_stats.harmless ?? 0} clean engines
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Flags */}
                          {qrResult.flags.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                              {qrResult.flags.map((f, i) => (
                                <div key={i} style={{ fontSize: 10, color: "#575452", padding: "5px 10px", borderRadius: 8, background: "#FFFFFF", border: "1px solid #EAE4E1" }}>{f}</div>
                              ))}
                            </div>
                          )}

                          {qrResult.vt_permalink && (
                            <a href={qrResult.vt_permalink} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "var(--color-primary)", textAlign: "center", display: "block" }}>View full VirusTotal report →</a>
                          )}

                          {/* Action buttons */}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
                            <motion.button
                              onClick={() => { setQrResult(null); setQrImagePreview(null); setQrDecoded(""); setQrError(""); setQrScanStep(0); }}
                              whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }}
                              style={{ padding: "12px", borderRadius: 10, border: "1px solid #EAE4E1", background: "#FFFFFF", color: "#575452", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                            >↩ Scan Another</motion.button>

                            {qrResult.verdict === "MALICIOUS" ? (
                              <motion.button
                                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }}
                                onClick={() => setQrModalOpen(false)}
                                style={{ padding: "12px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#B3261E,#b91c1c)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                              >🚫 Payment Blocked</motion.button>
                            ) : (
                              <motion.button
                                id="qr-proceed-pay-btn"
                                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }}
                                onClick={() => {
                                  setQrModalOpen(false);
                                  if (qrResult.vpa) setUpiTo(qrResult.vpa);
                                  if (qrResult.payee_name) setUpiName(qrResult.payee_name);
                                  if (qrResult.amount) setUpiAmt(qrResult.amount);
                                  addEv("success", `✅ QR verified SAFE · VPA: ${qrResult.vpa}`);
                                }}
                                style={{ padding: "12px", borderRadius: 10, border: "none", background: qrResult.verdict === "SUSPICIOUS" ? "linear-gradient(135deg,#B7791F,#B7791F)" : "linear-gradient(135deg,#3D8B5A,#3D8B5A)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                              >
                                {qrResult.verdict === "SUSPICIOUS" ? "⚠️ Proceed with Caution" : "✅ Proceed to Pay"}
                              </motion.button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })()}

                    {/* Scan button */}
                    {!qrResult && qrImagePreview && qrDecoded && !qrScanning && (
                      <motion.button
                        id="qr-start-scan-btn"
                        onClick={handleScanQR}
                        whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }}
                        style={{ padding: "14px", borderRadius: 12, border: "none", background: "#AA412A", color: "var(--color-on-primary)", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "none" }}
                      >
                        🛡️ Check QR for Fraud
                      </motion.button>
                    )}

                    <div style={{ fontSize: 9, color: "#969290", textAlign: "center", lineHeight: 1.5 }}>
                      🔒 QR image is decoded locally in your browser · Only the UPI ID is sent for scanning · Stored securely in audit log
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          {section === "history" && (
            <div style={{ maxWidth: 880, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, color: "#575452", marginBottom: 4 }}>
                Each transaction shows the Citadel risk score at the time of evaluation.
              </div>
              {currentTxns.map(txn => (
                <div key={txn.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderRadius: 14, background: "#FFFFFF", border: "1px solid #EAE4E1" }}>
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: txn.type === "credit" ? "rgba(61, 139, 90,0.12)" : "rgba(255, 255, 255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19 }}>{txn.category}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#100F0F" }}>{txn.type === "credit" ? txn.from : txn.to}</div>
                    <div style={{ fontSize: 10, color: "#767270", marginTop: 2 }}>{txn.description} · {txn.time.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: txn.type === "credit" ? "#3D8B5A" : "#100F0F" }}>{txn.type === "credit" ? "+" : "−"}{fmtINR(txn.amount)}</div>
                    <div style={{ fontSize: 8, marginTop: 3, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                      <span style={{ fontFamily: "'DM Mono',monospace", color: txn.decision === "APPROVE" ? "#3D8B5A" : "#B7791F" }}>🧬 {txn.riskScore}/1000</span>
                      <span style={{ padding: "1px 5px", borderRadius: 4, background: txn.decision === "APPROVE" ? "rgba(61, 139, 90,0.12)" : "rgba(183, 121, 31,0.12)", color: txn.decision === "APPROVE" ? "#3D8B5A" : "#B7791F", fontFamily: "'DM Mono',monospace" }}>{txn.decision}</span>
                    </div>
                  </div>
                </div>
              ))}
              {currentTxns.length === 0 && <div style={{ fontSize: 13, color: "#767270", padding: "40px 0", textAlign: "center" }}>No transactions yet</div>}
            </div>
          )}

          {/* PROFILE SECTION */}
          {section === "profile" && (
            <div style={{ maxWidth: 680, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ padding: "24px", borderRadius: 18, background: `linear-gradient(135deg,${account!.color}10,rgba(255, 255, 255,0))`, border: `1px solid ${account!.color}15`, display: "flex", alignItems: "center", gap: 18 }}>
                <div style={{ width: 60, height: 60, borderRadius: 18, background: `linear-gradient(135deg,${account!.color},${account!.color}80)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, color: "#fff" }}>{account!.avatar}</div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#100F0F" }}>{account!.name}</div>
                  <div style={{ fontSize: 11, color: "#575452", marginTop: 2 }}>{account!.upiId}</div>
                </div>
              </div>

              {[
                { label: "Account Number", val: account!.accountNo },
                { label: "IFSC Code", val: account!.ifsc },
                { label: "UPI ID", val: account!.upiId },
                { label: "Citadel ID", val: account!.imeiHash.slice(0, 16) + "…" },
                { label: "Enrolled Channels", val: "Internet Banking · Mobile" },
                { label: "Risk Profile", val: `${riskScore}/1000 (${riskScore < 300 ? "Low Risk" : riskScore < 600 ? "Medium Risk" : "High Risk"})` },
              ].map(({ label, val }) => (
                <div key={label} style={{ padding: "14px 18px", borderRadius: 12, background: "#FFFFFF", border: "1px solid #EAE4E1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#575452" }}>{label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#100F0F", fontFamily: label.includes("ID") || label.includes("IFSC") ? "'DM Mono',monospace" : "inherit" }}>{val}</span>
                </div>
              ))}

              {/* Duress PIN & Emergency Mode Settings Panel */}
              <div style={{ padding: "18px 20px", borderRadius: 14, background: "#FFFFFF", border: "1px solid #EAE4E1", marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#B3261E", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>🚨</span> Duress PIN & Emergency Mode
                    </div>
                    <div style={{ fontSize: 9, color: "#767270", marginTop: 2 }}>Configure silent alerts and emergency contacts</div>
                  </div>
                  <button
                    id="toggle-duress-setup-btn"
                    onClick={() => setShowDuressSetup(s => !s)}
                    style={{
                      padding: "5px 12px", borderRadius: 8, border: "1px solid #EAE4E1",
                      background: showDuressSetup ? "rgba(255, 255, 255,0.03)" : "rgba(179, 38, 30,0.06)",
                      color: showDuressSetup ? "#575452" : "#B3261E",
                      fontSize: 10, fontWeight: 700, cursor: "pointer"
                    }}
                  >
                    {showDuressSetup ? "Cancel" : "Configure"}
                  </button>
                </div>

                {showDuressSetup ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid rgba(16, 15, 15,0.02)", paddingTop: 12 }}>
                    {duressSetupError && (
                      <div style={{ padding: "7px 10px", background: "rgba(179, 38, 30,0.05)", border: "1px solid rgba(179, 38, 30,0.15)", borderRadius: 8, color: "#B3261E", fontSize: 10 }}>
                        ⚠️ {duressSetupError}
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 9, color: "#767270", marginBottom: 4, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Duress PIN (Secondary PIN) *</div>
                      <input
                        id="duress-setup-pin"
                        type="password"
                        placeholder="Enter 4-6 digit emergency PIN"
                        value={duressSetupPin}
                        onChange={e => setDuressSetupPin(e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: "1px solid #EAE4E1", fontSize: 11 }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#767270", marginBottom: 4, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Confirm Duress PIN *</div>
                      <input
                        id="duress-setup-confirm"
                        type="password"
                        placeholder="Confirm emergency PIN"
                        value={duressSetupConfirm}
                        onChange={e => setDuressSetupConfirm(e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: "1px solid #EAE4E1", fontSize: 11 }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#767270", marginBottom: 4, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Emergency Contact 1 (Name) *</div>
                      <input
                        id="duress-c1-name"
                        placeholder="e.g. Priya Sharma"
                        value={duressContact1Name}
                        onChange={e => setDuressContact1Name(e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: "1px solid #EAE4E1", fontSize: 11 }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#767270", marginBottom: 4, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Emergency Contact 1 (Phone/WhatsApp) *</div>
                      <input
                        id="duress-c1-phone"
                        placeholder="e.g. +919999999999"
                        value={duressContact1Phone}
                        onChange={e => setDuressContact1Phone(e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: "1px solid #EAE4E1", fontSize: 11 }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#767270", marginBottom: 4, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Emergency Contact 2 (Name - Optional)</div>
                      <input
                        id="duress-c2-name"
                        placeholder="e.g. Amit Sharma"
                        value={duressContact2Name}
                        onChange={e => setDuressContact2Name(e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: "1px solid #EAE4E1", fontSize: 11 }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#767270", marginBottom: 4, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Emergency Contact 2 (Phone - Optional)</div>
                      <input
                        id="duress-c2-phone"
                        placeholder="e.g. +918888888888"
                        value={duressContact2Phone}
                        onChange={e => setDuressContact2Phone(e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: "1px solid #EAE4E1", fontSize: 11 }}
                      />
                    </div>
                    <button
                      id="save-duress-setup-btn"
                      disabled={duressSetupLoading}
                      onClick={handleDuressSetup}
                      style={{
                        width: "100%", padding: "10px", borderRadius: 8, border: "none",
                        background: duressSetupLoading ? "rgba(255, 255, 255,0.05)" : "linear-gradient(135deg, #B3261E, #b91c1c)",
                        color: duressSetupLoading ? "#969290" : "#100F0F",
                        fontSize: 11, fontWeight: 700, cursor: duressSetupLoading ? "wait" : "pointer",
                        marginTop: 4, transition: "background 0.3s"
                      }}
                    >
                      {duressSetupLoading ? "🔄 Saving Settings…" : "💾 Save Secure Configuration"}
                    </button>
                  </div>
                ) : (
                  <div>
                    {duressSetupDone ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#16a34a", padding: "6px 8px", background: "rgba(22,163,74,0.05)", border: "1px solid rgba(22,163,74,0.15)", borderRadius: 8 }}>
                        ✓ Duress Emergency Settings saved successfully.
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: "#767270", fontStyle: "italic", textAlign: "center", padding: "8px 0" }}>
                        Setup Duress PIN to silently activate emergency mode and notify trusted contacts during forced transactions.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Backdrop overlay for shield drawer */}
      {dnaOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setDnaOpen(false)}
          className="zp-shield-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 150,
            background: "rgba(16, 15, 15, 0.25)",
            cursor: "pointer",
          }}
        />
      )}

      {/* ── Citadel Panel ──────────────────────────────────────────────── */}
      <DNAPanel
        open={dnaOpen} onClose={() => setDnaOpen(false)}
        events={dnaEvents} riskScore={riskScore} decision={decision}
        signals={signals} coercionProbability={coercionProb}
        onChain={onChain} onRunScenario={handleRunScenario}
        onExportPDF={exportPDFReport}
        onDownloadPassport={downloadBiometricPassport}
        downloadingPassport={downloadingPassport}
        rhythms={rhythms}
        riskHistory={riskHistory}
        aiInvestigating={aiInvestigating}
        aiTypewriterText={aiTypewriterText}
        onTriggerAI={handleTriggerAI}
        activeScenario={activeScenario}
        threatScore={threatScore}
        inSessionRATSim={inSessionRATSim}
        setInSessionRATSim={setInSessionRATSim}
        inSessionHandoverSim={inSessionHandoverSim}
        setInSessionHandoverSim={setInSessionHandoverSim}
        identityDriftIndex={identityDriftIndex}
        pqcVerified={pqcVerified}
        pqcAlgorithm={pqcAlgorithm}
      />

      {/* ── Continuous Telemetry Session Lock Overlay ── */}
      <AnimatePresence>
        {sessionLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed", inset: 0, zIndex: 300,
              background: "rgba(237, 237, 237, 0.94)",
              backdropFilter: "blur(20px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexDirection: "column", color: "#100F0F", fontFamily: "'Inter', sans-serif"
            }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              style={{
                background: "#FFFFFF",
                border: "1px solid rgba(179, 38, 30,0.25)",
                borderRadius: 24, padding: "32px 24px", maxWidth: 420, width: "90%",
                textAlign: "center", boxShadow: "0 20px 50px rgba(179, 38, 30,0.15)"
              }}
            >
              <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#B3261E", marginBottom: 8, fontFamily: "'DM Mono',monospace", letterSpacing: "0.02em" }}>
                SESSION SUSPENDED
              </div>
              <div style={{ fontSize: 12, color: "rgba(16, 15, 15,0.6)", marginBottom: 20, lineHeight: 1.6 }}>
                Citadel Shield has detected a critical <b>In-Session Identity Drift</b> anomaly.<br />
                The current scrolling and mouse dynamics match automated script hijack or device handover patterns.
              </div>

              <div style={{ background: "rgba(179, 38, 30,0.08)", border: "1px solid rgba(179, 38, 30,0.2)", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <span style={{ fontSize: 9, color: "rgba(16, 15, 15,0.5)", fontFamily: "'DM Mono',monospace" }}>DRIFT INDEX</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#B3261E", fontFamily: "'DM Mono',monospace" }}>{identityDriftIndex}%</span>
              </div>

              <button
                onClick={() => {
                  setSessionLocked(false);
                  setInSessionRATSim(false);
                  setInSessionHandoverSim(false);
                  setIdentityDriftIndex(12);
                }}
                style={{
                  width: "100%", padding: "12px", borderRadius: 12,
                  background: "linear-gradient(135deg, #3D8B5A 0%, #3D8B5A 100%)",
                  border: "none", color: "#FFFFFF", fontSize: 11, fontWeight: 700,
                  fontFamily: "'DM Mono',monospace", cursor: "pointer", transition: "all 0.2s"
                }}
              >
                🔐 PERFORM BIOMETRIC RE-VERIFICATION
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Decision Overlays ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {overlay?.type === "STEP_UP" && !overlay.reason.includes("Transaction Submitted Successfully") ? (
          <PauseScreen key="pause" reason={overlay.reason} score={overlay.score} onContinue={() => { closeOverlay(); }} onStop={() => { addEv("warn", "Customer reported being guided by a caller — payment stopped"); closeOverlay(); }} />
        ) : overlay && (
          <motion.div key="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              position: "fixed", inset: 0, zIndex: 200,
              background: overlay.type === "HARD_BLOCK" ? "rgba(16, 15, 15,0.95)" : "rgba(16, 15, 15,0.92)",
              display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(16px)",
              boxShadow: overlay.type === "HARD_BLOCK" ? "0 10px 40px rgba(179, 38, 30,0.15)" : "none",
            }}>
            {overlay.type === "HARD_BLOCK" && (
              <motion.div
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ repeat: Infinity, duration: 1.4 }}
                style={{ position: "absolute", inset: 0, border: "3px solid rgba(179, 38, 30,0.4)", pointerEvents: "none", zIndex: 1 }}
              />
            )}
            <motion.div initial={{ scale: 0.85, y: 28 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }}
              style={{
                background: overlay.type === "HARD_BLOCK" ? "rgba(234, 234, 234,0.97)" : overlay.type === "STEP_UP" ? "rgba(235, 235, 235,0.97)" : "rgba(238, 238, 238,0.97)",
                border: `1px solid ${overlay.type === "HARD_BLOCK" ? "rgba(179, 38, 30,0.3)" : overlay.type === "STEP_UP" ? "rgba(183, 121, 31,0.3)" : "rgba(61, 139, 90,0.3)"}`,
                borderRadius: 24, padding: "40px 44px", maxWidth: 440, width: "90%", textAlign: "center",
                boxShadow: `0 24px 60px rgba(0,0,0,0.75)`,
                position: "relative", zIndex: 2,
              }}>
              {overlay.type === "HARD_BLOCK" ? (
                <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} style={{ fontSize: 52, marginBottom: 16 }}>🔐</motion.div>
              ) : (
                <div style={{ fontSize: 52, marginBottom: 16 }}>
                  {overlay.reason.includes("Transaction Submitted Successfully") ? "🔄" : (overlay.type === "STEP_UP" ? "⚠️" : "✅")}
                </div>
              )}
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 8, color: overlay.reason.includes("Transaction Submitted Successfully") ? "#B7791F" : (overlay.type === "HARD_BLOCK" ? "#B3261E" : overlay.type === "STEP_UP" ? "#B7791F" : "#3D8B5A") }}>
                {overlay.reason.includes("Transaction Submitted Successfully") ? "Transaction Submitted Successfully" : (overlay.type === "HARD_BLOCK" ? "⛔ Access Denied — HARD BLOCK" : overlay.type === "STEP_UP" ? "Verification Required" : "Transaction Approved")}
              </div>
              <div style={{ fontSize: 13, color: "#575452", marginBottom: 20, lineHeight: 1.65, whiteSpace: "pre-line" }}>{overlay.reason}</div>
              {overlay.reason.includes("Transaction Submitted Successfully") ? (
                <div style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", marginBottom: 24, padding: "8px 14px", borderRadius: 8, background: "rgba(183, 121, 31,0.08)", color: "#B7791F", border: "1px solid rgba(183, 121, 31,0.2)" }}>
                  Transaction under processing
                </div>
              ) : (
                <div style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", marginBottom: 24, padding: "8px 14px", borderRadius: 8, background: "#FFFFFF", color: "#767270" }}>
                  Risk: {overlay.score}/1000 · {overlay.latencyMs > 0 ? `${overlay.latencyMs}ms` : "–"} · {overlay.type}
                </div>
              )}
              {/* Step-up notice. This used to claim "Calling registered number
                  ****8432…" — a hardcoded number, and no call is placed at this
                  point either (the real voice check runs at the login gate, via
                  VoiceMfaPanel). Now it states what actually happens and shows
                  the customer's real number when one is on file. */}
              {overlay.type === "STEP_UP" && (
                <motion.div animate={{ opacity: [1, 0.5, 1] }} transition={{ repeat: Infinity, duration: 1.6 }}
                  style={{ fontSize: 11, color: "#B7791F", background: "rgba(183, 121, 31,0.05)", border: "1px solid rgba(183, 121, 31,0.15)", borderRadius: 8, padding: "8px 14px", marginBottom: 20, fontFamily: "'DM Mono',monospace" }}>
                  {account?.phone
                    ? `🔐 Step-up verification required · registered ${maskPhone(account.phone)}`
                    : "🔐 Step-up verification required"}
                </motion.div>
              )}
              <button onClick={exportPDFReport} style={{ width: "100%", padding: "11px 20px", borderRadius: 10, border: overlay.type === "HARD_BLOCK" ? "1px solid rgba(179, 38, 30,0.4)" : overlay.type === "STEP_UP" ? "1px solid rgba(183, 121, 31,0.4)" : "1px solid rgba(61, 139, 90,0.4)", background: overlay.type === "HARD_BLOCK" ? "rgba(179, 38, 30,0.15)" : overlay.type === "STEP_UP" ? "rgba(183, 121, 31,0.15)" : "rgba(61, 139, 90,0.15)", color: overlay.type === "HARD_BLOCK" ? "#B3261E" : overlay.type === "STEP_UP" ? "#B7791F" : "#3D8B5A", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 16 }}>
                📄 Download Threat Audit PDF
              </button>
              
              {overlay.type === "HARD_BLOCK" && !overlay.reason.includes("terminated remotely") && !overlay.reason.includes("security administrator") && (
                <button onClick={() => setShowRecovery(true)} style={{ width: "100%", padding: "11px 20px", borderRadius: 10, border: "1px solid rgba(11,60,93,0.3)", background: "rgba(11,60,93,0.08)", color: "var(--color-primary)", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 16 }}>
                  💡 Self-Service Biometric Recovery
                </button>
              )}
              
              <button onClick={closeOverlay} style={{ padding: "11px 30px", borderRadius: 10, border: `1px solid ${overlay.type === "HARD_BLOCK" ? "rgba(179, 38, 30,0.3)" : overlay.type === "STEP_UP" ? "rgba(183, 121, 31,0.3)" : "rgba(61, 139, 90,0.3)"}`, background: "transparent", color: overlay.type === "HARD_BLOCK" ? "#B3261E" : overlay.type === "STEP_UP" ? "#B7791F" : "#3D8B5A", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {overlay.type === "APPROVE" ? "✓ Done" : "↩ Dismiss"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {showRecovery && (
        <BiometricRecoveryModal
          onSuccess={handleRecoverySuccess}
          onClose={() => setShowRecovery(false)}
        />
      )}

      {/* VPN Detected Block Overlay */}
      {vpnBlockedOverlay && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 400,
          background: "rgba(243, 242, 242, 0.98)",
          display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(20px)",
          color: "#100F0F", fontFamily: "'Inter', sans-serif"
        }}>
          <div style={{
            background: "#FFFFFF",
            borderRadius: 24, padding: "40px 48px", maxWidth: 460, width: "90%",
            boxShadow: "0 18px 40px -24px rgba(16,15,15,0.22)",
            border: "1px solid rgba(179, 38, 30, 0.25)",
            textAlign: "center"
          }}>
            <div style={{ fontSize: 64, marginBottom: 20 }}>⛔</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#B3261E", letterSpacing: "-0.03em", marginBottom: 12 }}>
              VPN Connection Detected
            </div>
            <div style={{ fontSize: 13, color: "rgba(16, 15, 15,0.7)", lineHeight: 1.6, marginBottom: 24 }}>
              Citadel zero-backdoor protection has blocked this connection. Virtual Private Networks (VPNs) and anonymous proxies are strictly prohibited to prevent credential stuffing and remote access scams.
            </div>
            <div style={{
              background: "rgba(179, 38, 30, 0.08)", border: "1px solid rgba(179, 38, 30, 0.2)",
              borderRadius: 12, padding: "14px 18px", fontSize: 11, fontFamily: "'DM Mono',monospace",
              textAlign: "left", marginBottom: 28, color: "#C9605A"
            }}>
              <div><strong>Detected IP:</strong> {vpnBlockedOverlay.ip}</div>
              {vpnBlockedOverlay.city && <div><strong>Location:</strong> {vpnBlockedOverlay.city}, {vpnBlockedOverlay.country}</div>}
              {vpnBlockedOverlay.reason && <div><strong>Trigger:</strong> {vpnBlockedOverlay.reason}</div>}
            </div>
            <button onClick={() => setVpnBlockedOverlay(null)} style={{
              padding: "12px 30px", borderRadius: 10, border: "none",
              background: "#B3261E", color: "#fff", fontWeight: 700, fontSize: 13,
              cursor: "pointer", transition: "background 0.2s"
            }}>
              Disconnect & Try Again
            </button>
          </div>
        </div>
      )}

      {/* Duress modal removed — emergency activates silently, attacker sees only a bank error */}
    </div>

  );
}

// ── Biometric Liveness Recovery Challenge Component ───────────────────────────
function BiometricRecoveryModal({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [blinks, setBlinks] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    let activeInterval: any = null;
    
    async function startCam() {
      try {
        await loadFaceModels();
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 } });
        activeStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setReady(true);
        }
        
        let blinkCount = 0;
        let eyeOpen = true;
        
        activeInterval = setInterval(async () => {
          if (!videoRef.current || blinkCount >= 2) return;
          try {
            const det = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 }))
              .withFaceLandmarks(false);
            if (det) {
              const ear = getEAR(det.landmarks);
              if (ear < 0.20 && eyeOpen) {
                eyeOpen = false;
              } else if (ear > 0.24 && !eyeOpen) {
                eyeOpen = true;
                blinkCount++;
                setBlinks(blinkCount);
                if (blinkCount >= 2) {
                  clearInterval(activeInterval);
                  onSuccess();
                }
              }
            }
          } catch (e) {
            // non-fatal
          }
        }, 150);
      } catch (e) {
        console.error("Camera access failed:", e);
      }
    }
    
    startCam();
    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(t => t.stop());
      }
      if (activeInterval) {
        clearInterval(activeInterval);
      }
    };
  }, [onSuccess]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(255, 255, 255,0.92)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(12px)" }}>
      <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 20, padding: 32, maxWidth: 360, width: "90%", textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 24, marginBottom: 12 }}>🧬</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#100F0F", marginBottom: 8 }}>Biometric Liveness Verification</div>
        <div style={{ fontSize: 12, color: "#575452", marginBottom: 20 }}>Please blink your eyes twice to prove you are the account owner.</div>
        
        <div style={{ width: 240, height: 180, borderRadius: 12, overflow: "hidden", background: "#1C1A19", margin: "0 auto 20px", position: "relative", border: "2px solid rgba(16, 15, 15,0.06)" }}>
          <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
          {!ready && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#F1EAE7", fontSize: 11 }}>Initializing camera...</div>}
        </div>
        
        <div style={{ fontSize: 14, fontWeight: 700, color: blinks >= 2 ? "#3D8B5A" : "#B7791F", marginBottom: 24 }}>
          {blinks >= 2 ? "✅ Verification Passed!" : `👁️ Blinks Detected: ${blinks} / 2`}
        </div>
        
        <button onClick={onClose} style={{ padding: "9px 24px", borderRadius: 8, border: "1px solid #EAE4E1", background: "transparent", color: "#767270", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
