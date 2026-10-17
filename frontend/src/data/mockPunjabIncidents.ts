/**
 * Citadel — Punjab Cyber-Fraud Incident Dataset
 * 50 live-generated incidents spread across Amritsar, Patiala, Ludhiana.
 * All three cities are linked via a single campaign "PUNJAB-SIM-RING-2026".
 */

export type AttackType =
  | "SIM_SWAP"
  | "MONEY_MULE"
  | "CREDENTIAL_THEFT"
  | "COERCION"
  | "BEHAVIORAL_ANOMALY"
  | "IDENTITY_MISMATCH";

export type IncidentSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface PunjabIncident {
  id: string;
  city: "Amritsar" | "Patiala" | "Ludhiana";
  lat: number;
  lng: number;
  attackType: AttackType;
  severity: IncidentSeverity;
  riskScore: number;
  victimCount: number;
  /** Amount laundered in INR */
  amountINR: number;
  ip: string;
  deviceHash: string;
  imei: string;
  operatorCircle: string;
  /** IDs of incidents in other cities this is linked to */
  linkedIncidentIds: string[];
  /** ISO timestamp */
  timestamp: string;
  /** Human-readable summary */
  details: string;
  /** Mule account that received funds */
  muleAccount: string;
  /** Whether prediction says this will escalate */
  predicted: boolean;
  /** Predicted next-48h risk level */
  predictedRisk: IncidentSeverity;
  decision: "HARD_BLOCK" | "STEP_UP" | "APPROVE";
}

// ── Deterministic seeded RNG ──────────────────────────────────────────────────
function seedRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function pickRng<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}

function fmtINR(n: number): string {
  return `₹${(n / 100000).toFixed(1)}L`;
}

// ── City Definitions ──────────────────────────────────────────────────────────
const CITIES = {
  Amritsar: { lat: 31.634, lng: 74.872, circle: "Punjab" },
  Patiala:  { lat: 30.340, lng: 76.390, circle: "Punjab" },
  Ludhiana: { lat: 30.901, lng: 75.857, circle: "Punjab" },
} as const;

type CityName = keyof typeof CITIES;

// ── Attack type distributions per city ───────────────────────────────────────
const CITY_ATTACK_WEIGHTS: Record<CityName, AttackType[]> = {
  Amritsar: [
    "SIM_SWAP", "SIM_SWAP", "SIM_SWAP",
    "CREDENTIAL_THEFT", "CREDENTIAL_THEFT",
    "COERCION", "MONEY_MULE", "IDENTITY_MISMATCH",
  ],
  Patiala: [
    "MONEY_MULE", "MONEY_MULE", "MONEY_MULE",
    "SIM_SWAP", "SIM_SWAP",
    "BEHAVIORAL_ANOMALY", "CREDENTIAL_THEFT", "IDENTITY_MISMATCH",
  ],
  Ludhiana: [
    "BEHAVIORAL_ANOMALY", "BEHAVIORAL_ANOMALY",
    "MONEY_MULE", "MONEY_MULE",
    "SIM_SWAP", "COERCION", "CREDENTIAL_THEFT", "IDENTITY_MISMATCH",
  ],
};

const ATTACK_SEVERITY: Record<AttackType, IncidentSeverity> = {
  SIM_SWAP: "CRITICAL",
  CREDENTIAL_THEFT: "CRITICAL",
  COERCION: "HIGH",
  MONEY_MULE: "HIGH",
  BEHAVIORAL_ANOMALY: "MEDIUM",
  IDENTITY_MISMATCH: "HIGH",
};

const ATTACK_DETAILS: Record<AttackType, (city: string, rng: () => number) => string> = {
  SIM_SWAP: (c, r) =>
    `SIM swap confirmed in ${c} Telecom Circle. New SIM activated ${Math.floor(r() * 6) + 1}h ago. IMEI mismatch on Hyperledger ledger.`,
  CREDENTIAL_THEFT: (c, r) =>
    `Password + OTP correct but behavioral fingerprint deviated ${(20 + r() * 60).toFixed(0)}% from ${c} baseline.`,
  COERCION: (c, r) =>
    `Screen-share + clipboard activity detected in ${c}. Coercion probability: ${(0.62 + r() * 0.35).toFixed(2)}.`,
  MONEY_MULE: (c, r) =>
    `Mule account receiving from ${Math.floor(r() * 12) + 3} unique victims. Layering detected across ${c} UPI ecosystem.`,
  BEHAVIORAL_ANOMALY: (c, r) =>
    `Typing-rhythm drift of ${(30 + r() * 55).toFixed(0)}% from enrolled baseline. Session flagged by CNN-LSTM detector.`,
  IDENTITY_MISMATCH: (c, r) =>
    `BehaveFormer identity confidence ${(8 + r() * 25).toFixed(0)}% — probable credential-share in ${c}.`,
};

function randIp(r: () => number): string {
  const prefixes = ["103.21", "103.87", "49.36", "182.74", "223.190", "117.218"];
  return `${pickRng(prefixes, r)}.${Math.floor(r() * 255)}.${Math.floor(r() * 255)}`;
}

function randDevice(r: () => number): string {
  const chars = "0123456789abcdef";
  return Array.from({ length: 16 }, () => chars[Math.floor(r() * chars.length)]).join("").toUpperCase();
}

function randIMEI(r: () => number): string {
  return Array.from({ length: 15 }, () => Math.floor(r() * 10)).join("");
}

function randMule(r: () => number): string {
  const banks = ["SBI", "PNB", "HDFC", "ICICI", "BOI"];
  return `${pickRng(banks, r)}-MUL-${Math.floor(r() * 90000 + 10000)}`;
}

// ── Generate incidents ────────────────────────────────────────────────────────
function generatePunjabIncidents(): PunjabIncident[] {
  const rng = seedRng(2026);
  const now = Date.now();

  const distribution: { city: CityName; count: number }[] = [
    { city: "Amritsar", count: 20 },
    { city: "Patiala",  count: 17 },
    { city: "Ludhiana", count: 13 },
  ];

  // First pass — create IDs
  const allIds: { city: CityName; id: string }[] = [];
  for (const { city, count } of distribution) {
    for (let i = 0; i < count; i++) {
      allIds.push({ city, id: `INC-PB-${city.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, "0")}` });
    }
  }

  // Build cross-city linkage map (each incident links to 1–2 incidents in other cities)
  const byCity: Record<CityName, string[]> = { Amritsar: [], Patiala: [], Ludhiana: [] };
  for (const { city, id } of allIds) byCity[city].push(id);

  const cityList: CityName[] = ["Amritsar", "Patiala", "Ludhiana"];

  const incidents: PunjabIncident[] = [];

  for (const { city, id } of allIds) {
    const attackType = pickRng(CITY_ATTACK_WEIGHTS[city], rng);
    const severity = ATTACK_SEVERITY[attackType];
    const riskScore =
      severity === "CRITICAL" ? Math.floor(700 + rng() * 300) :
      severity === "HIGH"     ? Math.floor(500 + rng() * 200) :
                                Math.floor(280 + rng() * 220);

    // Link to 1–2 incidents in OTHER cities
    const otherCities = cityList.filter((c) => c !== city);
    const linked: string[] = [];
    for (const oc of otherCities) {
      if (rng() > 0.35 && byCity[oc].length > 0) {
        const idx = Math.floor(rng() * byCity[oc].length);
        linked.push(byCity[oc][idx]);
      }
    }

    const cityCoord = CITIES[city];
    const jitterLat = (rng() - 0.5) * 0.08;
    const jitterLng = (rng() - 0.5) * 0.08;

    const hoursAgo = Math.floor(rng() * 72);
    const ts = new Date(now - hoursAgo * 3600 * 1000).toISOString();

    const predicted = rng() > 0.55;
    const predictedSeverities: IncidentSeverity[] = ["CRITICAL", "HIGH", "HIGH", "MEDIUM"];
    const predictedRisk = pickRng(predictedSeverities, rng);

    const decision: PunjabIncident["decision"] =
      severity === "CRITICAL" ? "HARD_BLOCK" :
      severity === "HIGH"     ? (rng() > 0.35 ? "HARD_BLOCK" : "STEP_UP") :
                                "STEP_UP";

    incidents.push({
      id,
      city,
      lat:          cityCoord.lat + jitterLat,
      lng:          cityCoord.lng + jitterLng,
      attackType,
      severity,
      riskScore,
      victimCount:  Math.floor(rng() * 8) + 1,
      amountINR:    Math.floor(rng() * 2000000) + 50000,
      ip:           randIp(rng),
      deviceHash:   randDevice(rng),
      imei:         randIMEI(rng),
      operatorCircle: cityCoord.circle,
      linkedIncidentIds: linked,
      timestamp:    ts,
      details:      ATTACK_DETAILS[attackType](city, rng),
      muleAccount:  randMule(rng),
      predicted,
      predictedRisk,
      decision,
    });
  }

  return incidents;
}

export const PUNJAB_INCIDENTS: PunjabIncident[] = generatePunjabIncidents();

// Grouped by city for easy lookup
export const INCIDENTS_BY_CITY = {
  Amritsar: PUNJAB_INCIDENTS.filter((i) => i.city === "Amritsar"),
  Patiala:  PUNJAB_INCIDENTS.filter((i) => i.city === "Patiala"),
  Ludhiana: PUNJAB_INCIDENTS.filter((i) => i.city === "Ludhiana"),
};

// Total stats
export const PUNJAB_STATS = {
  total: PUNJAB_INCIDENTS.length,
  critical: PUNJAB_INCIDENTS.filter((i) => i.severity === "CRITICAL").length,
  high: PUNJAB_INCIDENTS.filter((i) => i.severity === "HIGH").length,
  totalVictims: PUNJAB_INCIDENTS.reduce((s, i) => s + i.victimCount, 0),
  totalAmountINR: PUNJAB_INCIDENTS.reduce((s, i) => s + i.amountINR, 0),
  campaignId: "PUNJAB-SIM-RING-2026",
  activeSince: "2026-06-01T00:00:00Z",
};
