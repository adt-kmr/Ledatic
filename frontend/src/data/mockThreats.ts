import type { ThreatEvent, ThreatType, ThreatSeverity, Decision, GeoLocation } from "../types/btic";
import { randomIndianLocation } from "./indianGeography";

const THREAT_TYPES: ThreatType[] = [
  "SIM_SWAP",
  "CREDENTIAL_THEFT",
  "COERCION",
  "MONEY_MULE",
  "BEHAVIORAL_ANOMALY",
  "MERCHANT_ABUSE",
  "IDENTITY_MISMATCH",
];

const TYPE_SEVERITY_MAP: Record<ThreatType, ThreatSeverity> = {
  SIM_SWAP: "CRITICAL",
  CREDENTIAL_THEFT: "CRITICAL",
  COERCION: "HIGH",
  MONEY_MULE: "HIGH",
  BEHAVIORAL_ANOMALY: "MEDIUM",
  MERCHANT_ABUSE: "MEDIUM",
  IDENTITY_MISMATCH: "HIGH",
};

const TYPE_WEIGHTS: Record<ThreatType, number> = {
  SIM_SWAP: 0.15,
  CREDENTIAL_THEFT: 0.2,
  COERCION: 0.1,
  MONEY_MULE: 0.12,
  BEHAVIORAL_ANOMALY: 0.25,
  MERCHANT_ABUSE: 0.08,
  IDENTITY_MISMATCH: 0.1,
};

const CHANNELS = ["web", "mobile_app", "ussd", "api", "atm"];
const PATHWAYS = ["behavioral", "imei", "blockchain", "telecom", "hybrid"];

function weightedRandom<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [key, weight] of entries) {
    r -= weight;
    if (r <= 0) return key;
  }
  return entries[0][0];
}

function generateHash(): string {
  const chars = "0123456789abcdef";
  let hash = "";
  for (let i = 0; i < 32; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return hash;
}

function generateDetails(type: ThreatType, location: GeoLocation): string {
  switch (type) {
    case "SIM_SWAP":
      return `SIM swap detected in ${location.state}. New SIM registered ${Math.floor(Math.random() * 48) + 1}h ago.`;
    case "CREDENTIAL_THEFT":
      return `Credentials correct but behavioral fingerprint mismatch in ${location.city}.`;
    case "COERCION":
      return `Screen sharing + clipboard activity detected. Coercion probability: ${(0.6 + Math.random() * 0.4).toFixed(2)}.`;
    case "MONEY_MULE":
      return `Recipient account receiving from ${Math.floor(Math.random() * 15) + 3} unique victims in ${location.state}.`;
    case "BEHAVIORAL_ANOMALY":
      return `Behavior drift of ${(20 + Math.random() * 60).toFixed(0)}% from established baseline.`;
    case "MERCHANT_ABUSE":
      return `Merchant volume spike: ${Math.floor(Math.random() * 500) + 100} transactions in last hour.`;
    case "IDENTITY_MISMATCH":
      return `Password correct, OTP correct, behavioral identity confidence: ${(10 + Math.random() * 30).toFixed(0)}%.`;
  }
}

export function generateThreatEvent(timestamp?: Date): ThreatEvent {
  const ts = timestamp || new Date();
  const location = randomIndianLocation();
  const type = weightedRandom(TYPE_WEIGHTS);
  const severity = TYPE_SEVERITY_MAP[type];

  return {
    id: crypto.randomUUID(),
    timestamp: ts.toISOString(),
    type,
    severity,
    confidence: 0.6 + Math.random() * 0.4,
    location: {
      state: location.state,
      stateCode: location.stateCode,
      city: location.name,
      lat: location.lat,
      lng: location.lng,
    },
    customerHash: generateHash(),
    sessionId: crypto.randomUUID(),
    riskScore:
      severity === "CRITICAL"
        ? 700 + Math.random() * 300
        : severity === "HIGH"
          ? 500 + Math.random() * 200
          : 300 + Math.random() * 200,
    decision:
      severity === "CRITICAL"
        ? "HARD_BLOCK"
        : severity === "HIGH"
          ? Math.random() > 0.3 ? "HARD_BLOCK" : "STEP_UP"
          : "STEP_UP",
    details: generateDetails(type, {
      state: location.state,
      stateCode: location.stateCode,
      city: location.name,
      lat: location.lat,
      lng: location.lng,
    }),
    channel: CHANNELS[Math.floor(Math.random() * CHANNELS.length)],
    pathway: PATHWAYS[Math.floor(Math.random() * PATHWAYS.length)],
  };
}

export function generateMockThreats(count: number): ThreatEvent[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const offset = Math.random() * 24 * 60 * 60 * 1000; // within last 24h
    return generateThreatEvent(new Date(now - offset));
  }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export const INITIAL_THREATS = generateMockThreats(200);
