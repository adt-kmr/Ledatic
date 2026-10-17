/**
 * Citadel — Punjab Criminal Syndicate Network Graph
 * "Amritsar SIM Ring" — 3-city mule network tied to the 50 Punjab incidents.
 *
 * Node types:
 *   accused     → Red   #FF453A
 *   victim      → Green #30D158
 *   mule_account→ Cyan  #00D2FF
 *   phone       → Magenta #BF5AF2
 *   vehicle     → Purple #9B59B6
 *   bank        → Yellow #FFD60A
 *   campaign    → Rose  #FF6B9D
 *   behavior    → Emerald #34D399
 *
 * Edge types:
 *   controls_mule, owns_sim, transferred_to, victim_of,
 *   uses_vehicle, money_transfer, behavior_match, campaign_member
 */

import type { GraphData, GraphNode, GraphEdge, GraphNodeType, GraphEdgeType } from "../types/btic";

let _uid = 1;
function uid(prefix: string): string {
  return `${prefix}-${String(_uid++).padStart(4, "0")}`;
}

// ── Accused (Kingpins) ────────────────────────────────────────────────────────
const vikramSingh: GraphNode = {
  id: uid("accused"),
  type: "user",
  label: "Vikram Singh",
  confidence: 0.96,
  importance: 10,
  metadata: {
    role: "Accused — Kingpin",
    city: "Amritsar",
    riskLevel: "CRITICAL",
    customerHash: "a7d3f8c2",
    sessions: 22,
    firstSeen: "2026-06-01T09:00:00Z",
    lastSeen: "2026-07-30T21:15:00Z",
    imei: "352839107342891",
    ip: "103.21.144.77",
    lostAmount: null,
    muleAccount: "SBI-MUL-88122",
    gang: "AMRITSAR_SYNDICATE",
    note: "Mastermind of Punjab SIM Ring; controls all mule chain layers",
  },
};

const gurpreetMaan: GraphNode = {
  id: uid("accused"),
  type: "user",
  label: "Gurpreet Maan",
  confidence: 0.89,
  importance: 9,
  metadata: {
    role: "Accused — Operator",
    city: "Ludhiana",
    riskLevel: "CRITICAL",
    customerHash: "b8e9a1d5",
    sessions: 14,
    firstSeen: "2026-06-10T11:00:00Z",
    lastSeen: "2026-07-28T18:30:00Z",
    imei: "490213874563021",
    ip: "49.36.87.203",
    lostAmount: null,
    muleAccount: "PNB-MUL-77441",
    gang: "AMRITSAR_SYNDICATE",
    note: "SIM re-registrations coordinator; runs Ludhiana front",
  },
};

// ── Victims ───────────────────────────────────────────────────────────────────
const victims: GraphNode[] = [
  { id: uid("victim"), type: "recipient", label: "Harpreet Kaur (Victim)", confidence: 0.98, importance: 6,
    metadata: { role: "Victim", city: "Amritsar", lostAmount: 285000, attackType: "SIM_SWAP", riskLevel: "HIGH", gang: "AMRITSAR_SYNDICATE" } },
  { id: uid("victim"), type: "recipient", label: "Mandeep Singh (Victim)", confidence: 0.97, importance: 5,
    metadata: { role: "Victim", city: "Patiala",  lostAmount: 142000, attackType: "CREDENTIAL_THEFT", riskLevel: "HIGH", gang: "AMRITSAR_SYNDICATE" } },
  { id: uid("victim"), type: "recipient", label: "Rajinder Kumar (Victim)", confidence: 0.95, importance: 5,
    metadata: { role: "Victim", city: "Ludhiana", lostAmount: 390000, attackType: "SIM_SWAP", riskLevel: "HIGH", gang: "AMRITSAR_SYNDICATE" } },
  { id: uid("victim"), type: "recipient", label: "Simranjeet Bedi (Victim)", confidence: 0.93, importance: 4,
    metadata: { role: "Victim", city: "Amritsar", lostAmount: 76000, attackType: "COERCION", riskLevel: "MEDIUM", gang: "AMRITSAR_SYNDICATE" } },
];

// ── Mule Accounts ─────────────────────────────────────────────────────────────
const mule1: GraphNode = {
  id: uid("mule"),
  type: "bank",
  label: "AC-88122 (Mule — Amritsar)",
  confidence: 0.91,
  importance: 8,
  metadata: {
    role: "Mule Account — Layer 1",
    city: "Amritsar",
    accountNumber: "SBI-MUL-88122",
    totalReceived: 897000,
    transactionCount: 31,
    riskLevel: "CRITICAL",
    gang: "AMRITSAR_SYNDICATE",
    note: "Primary collection account; funds layered to AC-99320",
  },
};

const mule2: GraphNode = {
  id: uid("mule"),
  type: "bank",
  label: "AC-99320 (Mule — Patiala)",
  confidence: 0.88,
  importance: 8,
  metadata: {
    role: "Mule Account — Layer 2",
    city: "Patiala",
    accountNumber: "BOI-MUL-99320",
    totalReceived: 541000,
    transactionCount: 18,
    riskLevel: "CRITICAL",
    gang: "AMRITSAR_SYNDICATE",
    note: "Layering hop; funds split and forwarded to AC-77441 + crypto",
  },
};

const mule3: GraphNode = {
  id: uid("mule"),
  type: "bank",
  label: "AC-77441 (Mule — Ludhiana)",
  confidence: 0.86,
  importance: 7,
  metadata: {
    role: "Mule Account — Layer 3",
    city: "Ludhiana",
    accountNumber: "PNB-MUL-77441",
    totalReceived: 312000,
    transactionCount: 11,
    riskLevel: "HIGH",
    gang: "AMRITSAR_SYNDICATE",
    note: "Final withdrawal point via ATM clusters near Ludhiana Bus Stand",
  },
};

// ── Phone Nodes ───────────────────────────────────────────────────────────────
const phones: GraphNode[] = [
  { id: uid("phone"), type: "telecom", label: "+91 98140 33812 (Amritsar)", confidence: 0.93, importance: 6,
    metadata: { role: "Phone — SIM Swap Origin", circle: "Punjab", simChanges: 4, lastChange: "2026-07-15T13:20:00Z", gang: "AMRITSAR_SYNDICATE" } },
  { id: uid("phone"), type: "telecom", label: "+91 70091 22548 (Patiala)",  confidence: 0.87, importance: 5,
    metadata: { role: "Phone — Relay SIM",       circle: "Punjab", simChanges: 2, lastChange: "2026-07-20T09:10:00Z", gang: "AMRITSAR_SYNDICATE" } },
  { id: uid("phone"), type: "telecom", label: "+91 99889 01143 (Ludhiana)", confidence: 0.84, importance: 5,
    metadata: { role: "Phone — Burner",          circle: "Punjab", simChanges: 1, lastChange: "2026-07-28T17:55:00Z", gang: "AMRITSAR_SYNDICATE" } },
];

// ── Vehicle Node ──────────────────────────────────────────────────────────────
const vehicle: GraphNode = {
  id: uid("vehicle"),
  type: "device",
  label: "PB-10-MJ-8210 (Vehicle)",
  confidence: 0.79,
  importance: 4,
  metadata: {
    role: "Vehicle",
    registeredOwner: "Vikram Singh",
    type: "Car",
    model: "Maruti Swift",
    spotted: ["Amritsar", "Patiala"],
    riskLevel: "MEDIUM",
    gang: "AMRITSAR_SYNDICATE",
  },
};

// ── Campaign ──────────────────────────────────────────────────────────────────
const campaign: GraphNode = {
  id: uid("campaign"),
  type: "campaign",
  label: "Punjab SIM Ring — 2026",
  confidence: 0.97,
  importance: 10,
  metadata: {
    campaignId: "PUNJAB-SIM-RING-2026",
    status: "ACTIVE",
    victimCount: 50,
    estimatedLoss: 4250000,
    cities: ["Amritsar", "Patiala", "Ludhiana"],
    activeSince: "2026-06-01T00:00:00Z",
    gang: "AMRITSAR_SYNDICATE",
  },
};

// ── Behavior Node ─────────────────────────────────────────────────────────────
const behavior: GraphNode = {
  id: uid("behavior"),
  type: "behavior",
  label: "Shared Behavioral Fingerprint",
  confidence: 0.88,
  importance: 7,
  metadata: {
    typingStability: 0.18,
    touchRhythm: 0.27,
    interactionConsistency: 0.14,
    driftFromBaseline: 0.84,
    gang: "AMRITSAR_SYNDICATE",
    note: "Both accused share a 84% behavioral drift — likely operate from same device pool",
  },
};

// ── All Nodes ─────────────────────────────────────────────────────────────────
const nodes: GraphNode[] = [
  vikramSingh, gurpreetMaan,
  ...victims,
  mule1, mule2, mule3,
  ...phones,
  vehicle, campaign, behavior,
];

// ── Edges ─────────────────────────────────────────────────────────────────────
function edge(
  source: string,
  target: string,
  type: GraphEdgeType,
  confidence: number,
  explanation: string,
  evidenceCount = 1,
  amount?: number,
): GraphEdge {
  return {
    id: uid("edge"),
    source,
    target,
    type,
    confidence,
    evidenceCount,
    firstSeen: "2026-06-01T00:00:00Z",
    lastSeen:  "2026-07-30T00:00:00Z",
    explanation,
    ...(amount !== undefined ? { amount } : {}),
  } as GraphEdge & { amount?: number };
}

const edges: GraphEdge[] = [
  // Vikram controls mule chain
  edge(vikramSingh.id, mule1.id, "shared_recipient", 0.96, "Vikram Singh controls AC-88122; confirmed via UPI linkage", 18, 897000),
  edge(mule1.id, mule2.id, "money_transfer", 0.91, "₹5.41L transferred from AC-88122 → AC-99320 across 18 transactions", 18, 541000),
  edge(mule2.id, mule3.id, "money_transfer", 0.87, "₹3.12L onward from Patiala mule → Ludhiana withdrawal account", 11, 312000),

  // Gurpreet controls Ludhiana leg
  edge(gurpreetMaan.id, mule3.id, "shared_recipient", 0.89, "Gurpreet Maan listed as beneficiary of AC-77441", 9, 312000),
  edge(gurpreetMaan.id, mule2.id, "money_transfer", 0.84, "Relay coordination — Gurpreet authorised AC-99320 forwarding", 7, 541000),

  // Victims → Mule 1
  ...victims.map((v) =>
    edge(v.id, mule1.id, "money_transfer", 0.93 - Math.random() * 0.05,
      `${v.label.split(" (")[0]} funds moved to primary mule AC-88122`, 3,
      (v.metadata as any).lostAmount)
  ),

  // Phone linkages
  edge(vikramSingh.id, phones[0].id, "shared_sim", 0.94, "+91 98140 33812 SIM registered under Vikram's stolen documents", 4),
  edge(gurpreetMaan.id, phones[2].id, "shared_sim", 0.88, "Burner phone traced to Gurpreet's safehouse in Ludhiana", 2),
  edge(vikramSingh.id, phones[1].id, "shared_sim", 0.82, "Relay SIM used to intercept victim OTPs during SIM-swap window", 3),

  // Vehicle
  edge(vikramSingh.id, vehicle.id, "shared_device", 0.79, "Vehicle spotted at 3 victim ATM withdrawals in Amritsar & Patiala", 3),

  // Campaign membership
  edge(vikramSingh.id, campaign.id, "campaign_member", 0.97, "Confirmed campaign leader — 22 blocked sessions pattern-matched", 14),
  edge(gurpreetMaan.id, campaign.id, "campaign_member", 0.91, "Operator-level membership — coordinates Ludhiana arm", 10),

  // Behavioral fingerprint
  edge(vikramSingh.id, behavior.id, "behavior_similarity", 0.88, "84% behavioral drift from enrolled baseline across all sessions", 22),
  edge(gurpreetMaan.id, behavior.id, "behavior_similarity", 0.83, "Shares typing cadence fingerprint with Vikram — common device pool likely", 14),
];

// ── Exported clusters ─────────────────────────────────────────────────────────
export const PUNJAB_GRAPH: GraphData = { nodes, edges };

export const PUNJAB_CLUSTERS = [
  {
    id: "AMRITSAR_SYNDICATE",
    label: "Amritsar Syndicate",
    color: "#FF453A",
    nodeIds: [vikramSingh.id, mule1.id, phones[0].id, phones[1].id, vehicle.id, campaign.id, behavior.id, ...victims.map((v) => v.id)],
  },
  {
    id: "PATIALA_MULE_RING",
    label: "Patiala Mule Ring",
    color: "#00D2FF",
    nodeIds: [mule2.id],
  },
  {
    id: "LUDHIANA_FRONT",
    label: "Ludhiana Front",
    color: "#BF5AF2",
    nodeIds: [gurpreetMaan.id, mule3.id, phones[2].id],
  },
];

// Money flow chain for visualization (Victim → Mule1 → Mule2 → Mule3 → Withdrawal)
export const MONEY_FLOW_CHAIN = [
  { label: "Victim Accounts (×4)", amount: 893000, color: "#30D158", icon: "👤" },
  { label: "AC-88122 (Amritsar Mule)", amount: 897000, color: "#00D2FF", icon: "🏦" },
  { label: "AC-99320 (Patiala Mule)", amount: 541000, color: "#FFD60A", icon: "🏦" },
  { label: "AC-77441 (Ludhiana Mule)", amount: 312000, color: "#FF9F0A", icon: "🏦" },
  { label: "ATM Withdrawal / Crypto", amount: 289000, color: "#FF453A", icon: "💸" },
];
