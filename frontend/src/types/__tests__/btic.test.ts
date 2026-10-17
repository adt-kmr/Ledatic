import { describe, it, expect } from "vitest";
import type {
  ThreatEvent,
  MapHexCell,
  GraphNode,
  GraphEdge,
  Campaign,
  HeroStat,
  TickerMessage,
  MapLayer,
  ThreatType,
  ThreatSeverity,
  Decision,
  GraphNodeType,
  GraphEdgeType,
} from "../btic";

describe("BTIC Types", () => {
  it("ThreatEvent has all required fields", () => {
    const event: ThreatEvent = {
      id: "test-1",
      timestamp: "2026-07-06T00:00:00Z",
      type: "SIM_SWAP",
      severity: "CRITICAL",
      confidence: 0.95,
      location: {
        state: "Maharashtra",
        stateCode: "MH",
        city: "Mumbai",
        lat: 19.08,
        lng: 72.88,
      },
      customerHash: "abc123",
      sessionId: "session-1",
      riskScore: 850,
      decision: "HARD_BLOCK",
      details: "SIM swap detected",
      channel: "web",
      pathway: "behavioral",
    };

    expect(event.id).toBe("test-1");
    expect(event.type).toBe("SIM_SWAP");
    expect(event.severity).toBe("CRITICAL");
    expect(event.decision).toBe("HARD_BLOCK");
    expect(event.confidence).toBeGreaterThan(0);
    expect(event.confidence).toBeLessThanOrEqual(1);
    expect(event.riskScore).toBeGreaterThanOrEqual(0);
    expect(event.riskScore).toBeLessThanOrEqual(1000);
  });

  it("MapHexCell has valid structure", () => {
    const cell: MapHexCell = {
      h3Index: "852a10003ff",
      lat: 19.08,
      lng: 72.88,
      severity: "HIGH",
      confidence: 0.8,
      threatCount: 15,
      threatTypes: ["SIM_SWAP", "CREDENTIAL_THEFT"],
      state: "Maharashtra",
      city: "Mumbai",
    };

    expect(cell.h3Index).toBeTruthy();
    expect(cell.threatCount).toBeGreaterThan(0);
    expect(cell.threatTypes.length).toBeGreaterThan(0);
    expect(cell.confidence).toBeGreaterThanOrEqual(0);
    expect(cell.confidence).toBeLessThanOrEqual(1);
  });

  it("GraphNode has valid structure", () => {
    const node: GraphNode = {
      id: "user-1",
      type: "user",
      label: "Test User",
      confidence: 0.9,
      importance: 5,
      metadata: { riskLevel: "HIGH" },
    };

    expect(node.id).toBeTruthy();
    expect(["user", "device", "behavior", "recipient", "merchant", "telecom", "campaign", "bank"]).toContain(node.type);
    expect(node.importance).toBeGreaterThan(0);
  });

  it("GraphEdge has valid structure", () => {
    const edge: GraphEdge = {
      id: "edge-1",
      source: "user-1",
      target: "device-1",
      type: "shared_device",
      confidence: 0.85,
      evidenceCount: 5,
      firstSeen: "2026-06-01T00:00:00Z",
      lastSeen: "2026-07-06T00:00:00Z",
      explanation: "Shared device in 5 sessions",
    };

    expect(edge.source).toBeTruthy();
    expect(edge.target).toBeTruthy();
    expect(edge.confidence).toBeGreaterThanOrEqual(0);
    expect(edge.confidence).toBeLessThanOrEqual(1);
    expect(edge.evidenceCount).toBeGreaterThan(0);
  });

  it("Campaign has valid structure", () => {
    const campaign: Campaign = {
      id: "cmp-001",
      name: "Test Campaign",
      type: "SIM_SWAP",
      status: "ACTIVE",
      confidence: 0.92,
      victimCount: 34,
      estimatedLoss: 4200000,
      primaryRegion: "Delhi NCR",
      affectedBanks: ["SBI", "HDFC"],
      behaviorPattern: "Rapid SIM change",
      moneyMuleCount: 8,
      growthRate: 2.3,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-06T00:00:00Z",
      color: "#FF453A",
    };

    expect(campaign.status).toMatch(/^(ACTIVE|CONTAINED|INVESTIGATING|RESOLVED)$/);
    expect(campaign.victimCount).toBeGreaterThan(0);
    expect(campaign.confidence).toBeGreaterThanOrEqual(0);
    expect(campaign.confidence).toBeLessThanOrEqual(1);
  });

  it("TickerMessage has valid structure", () => {
    const msg: TickerMessage = {
      id: "tick-1",
      timestamp: "2026-07-06T00:00:00Z",
      severity: "CRITICAL",
      type: "SIM_SWAP",
      location: "Mumbai, MH",
      detail: "SIM swap detected in Mumbai",
    };

    expect(msg.id).toBeTruthy();
    expect(msg.location).toBeTruthy();
    expect(msg.detail).toBeTruthy();
  });

  it("MapLayer types are valid", () => {
    const layers: MapLayer[] = [
      "identity_confidence",
      "behavior_drift",
      "credential_theft",
      "sim_swap",
      "money_mule",
      "merchant_intelligence",
      "campaigns",
    ];

    expect(layers.length).toBe(7);
    layers.forEach((layer) => {
      expect(typeof layer).toBe("string");
    });
  });

  it("ThreatType covers all expected types", () => {
    const types: ThreatType[] = [
      "SIM_SWAP",
      "CREDENTIAL_THEFT",
      "COERCION",
      "MONEY_MULE",
      "BEHAVIORAL_ANOMALY",
      "MERCHANT_ABUSE",
      "IDENTITY_MISMATCH",
    ];

    expect(types.length).toBe(7);
  });

  it("Decision covers all expected values", () => {
    const decisions: Decision[] = ["APPROVE", "STEP_UP", "HARD_BLOCK"];
    expect(decisions.length).toBe(3);
  });
});
