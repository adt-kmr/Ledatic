// ── BTIC TypeScript Types ─────────────────────────────────────────────────────
// All interfaces for the Citadel Threat Intelligence Command Center

// ── Threat Events ─────────────────────────────────────────────────────────────
export type ThreatType =
  | "SIM_SWAP"
  | "CREDENTIAL_THEFT"
  | "COERCION"
  | "MONEY_MULE"
  | "BEHAVIORAL_ANOMALY"
  | "MERCHANT_ABUSE"
  | "IDENTITY_MISMATCH";

export type ThreatSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type Decision = "APPROVE" | "STEP_UP" | "HARD_BLOCK";

export interface GeoLocation {
  state: string;
  stateCode: string;
  city: string;
  lat: number;
  lng: number;
}

export interface ThreatEvent {
  id: string;
  timestamp: string;
  type: ThreatType;
  severity: ThreatSeverity;
  confidence: number;
  location: GeoLocation;
  customerHash: string;
  sessionId: string;
  riskScore: number;
  decision: Decision;
  details: string;
  channel: string;
  pathway: string;
}

// ── Map Types ─────────────────────────────────────────────────────────────────
export interface MapHexCell {
  h3Index: string;
  lat: number;
  lng: number;
  severity: ThreatSeverity;
  confidence: number;
  threatCount: number;
  threatTypes: ThreatType[];
  state: string;
  city: string;
}

export type MapLayer =
  | "identity_confidence"
  | "behavior_drift"
  | "credential_theft"
  | "sim_swap"
  | "money_mule"
  | "merchant_intelligence"
  | "campaigns";

export interface MapConnection {
  source: { lat: number; lng: number; h3Index: string };
  target: { lat: number; lng: number; h3Index: string };
  confidence: number;
  type: ThreatType;
  campaignId?: string;
}

// ── Graph Types ───────────────────────────────────────────────────────────────
export type GraphNodeType =
  | "user"
  | "device"
  | "behavior"
  | "recipient"
  | "merchant"
  | "telecom"
  | "campaign"
  | "bank";

export type GraphEdgeType =
  | "shared_device"
  | "behavior_similarity"
  | "shared_recipient"
  | "money_transfer"
  | "shared_merchant"
  | "shared_sim"
  | "shared_ip"
  | "campaign_member"
  | "shared_clipboard"
  | "shared_screen_share"
  | "shared_beneficiary"
  | "shared_payment_pattern";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  confidence: number;
  importance: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  confidence: number;
  evidenceCount: number;
  firstSeen: string;
  lastSeen: string;
  explanation: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Campaign Types ────────────────────────────────────────────────────────────
export type CampaignStatus = "ACTIVE" | "CONTAINED" | "INVESTIGATING" | "RESOLVED";

export interface Campaign {
  id: string;
  name: string;
  type: ThreatType;
  status: CampaignStatus;
  confidence: number;
  victimCount: number;
  estimatedLoss: number;
  primaryRegion: string;
  affectedBanks: string[];
  behaviorPattern: string;
  moneyMuleCount: number;
  growthRate: number;
  createdAt: string;
  updatedAt: string;
  color: string;
}

// ── Hero Stats ────────────────────────────────────────────────────────────────
export interface HeroStat {
  label: string;
  value: number;
  subtitle: string;
  trend: number[];
  status: "green" | "amber" | "red";
  icon: string;
}

// ── Ticker Types ──────────────────────────────────────────────────────────────
export interface TickerMessage {
  id: string;
  timestamp: string;
  severity: ThreatSeverity;
  type: ThreatType;
  location: string;
  detail: string;
  sessionId?: string;
  customerHash?: string;
}

// ── Investigation Types ───────────────────────────────────────────────────────
export interface InvestigationSession {
  sessionId: string;
  customerHash: string;
  decision: Decision;
  riskScore: number;
  channel: string;
  pathway: string;
  timestamp: string;
  threats: ThreatEvent[];
  evidence: EvidenceItem[];
  timeline: TimelineEvent[];
  behaviorPassport: BehaviorPassport;
  moneyFlow: MoneyFlowItem[];
  relatedSessions: string[];
}

export interface EvidenceItem {
  id: string;
  type: string;
  description: string;
  confidence: number;
  timestamp: string;
  source: string;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: string;
  description: string;
  severity: ThreatSeverity;
  relatedNodeId?: string;
}

export interface BehaviorPassport {
  typingStability: number;
  touchRhythm: number;
  interactionConsistency: number;
  behaviorDrift: number;
  identityConfidence: number;
  historicalStability: number;
  factors: BehaviorFactor[];
}

export interface BehaviorFactor {
  name: string;
  value: number;
  baseline: number;
  delta: number;
  unit: string;
}

export interface MoneyFlowItem {
  id: string;
  sourceHash: string;
  targetHash: string;
  amount: number;
  currency: string;
  timestamp: string;
  type: "transfer" | "payment" | "withdrawal";
}

// ── Analytics Types ───────────────────────────────────────────────────────────
export interface ThreatTrend {
  date: string;
  count: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface DecisionDistribution {
  decision: Decision;
  count: number;
  percentage: number;
}

export interface GeographicDensity {
  state: string;
  stateCode: string;
  threatCount: number;
  severity: ThreatSeverity;
  lat: number;
  lng: number;
}

// ── Navigation ────────────────────────────────────────────────────────────────
export type NavItem =
  | "home"
  | "threats"
  | "soc"
  | "fraud-reports"
  | "emergency"
  | "campaigns"
  | "graph"
  | "investigate"
  | "analytics"
  | "settings";

// ── Indian Geography ──────────────────────────────────────────────────────────
export interface IndianState {
  name: string;
  code: string;
  center: [number, number];
  threatWeight: number;
}

export interface IndianCity {
  name: string;
  state: string;
  stateCode: string;
  lat: number;
  lng: number;
  population: number;
}

export interface TelecomCircle {
  name: string;
  center: [number, number];
  states: string[];
}
