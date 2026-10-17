import { describe, it, expect } from "vitest";
import {
  generateThreatEvent,
  generateMockThreats,
  INITIAL_THREATS,
} from "../mockThreats";
import type { ThreatEvent, ThreatType, ThreatSeverity } from "../../types/btic";

describe("Mock Threats", () => {
  describe("generateThreatEvent", () => {
    it("generates a valid threat event", () => {
      const event = generateThreatEvent();

      expect(event.id).toBeTruthy();
      expect(event.timestamp).toBeTruthy();
      expect(event.type).toBeTruthy();
      expect(event.severity).toBeTruthy();
      expect(event.confidence).toBeGreaterThanOrEqual(0.6);
      expect(event.confidence).toBeLessThanOrEqual(1);
      expect(event.riskScore).toBeGreaterThanOrEqual(300);
      expect(event.riskScore).toBeLessThanOrEqual(1000);
      expect(event.location.lat).toBeGreaterThanOrEqual(8);
      expect(event.location.lat).toBeLessThanOrEqual(35);
      expect(event.location.lng).toBeGreaterThanOrEqual(68);
      expect(event.location.lng).toBeLessThanOrEqual(97);
    });

    it("generates events with valid types", () => {
      const validTypes: ThreatType[] = [
        "SIM_SWAP",
        "CREDENTIAL_THEFT",
        "COERCION",
        "MONEY_MULE",
        "BEHAVIORAL_ANOMALY",
        "MERCHANT_ABUSE",
        "IDENTITY_MISMATCH",
      ];

      for (let i = 0; i < 50; i++) {
        const event = generateThreatEvent();
        expect(validTypes).toContain(event.type);
      }
    });

    it("generates events with valid severities", () => {
      const validSeverities: ThreatSeverity[] = [
        "CRITICAL",
        "HIGH",
        "MEDIUM",
        "LOW",
        "INFO",
      ];

      for (let i = 0; i < 50; i++) {
        const event = generateThreatEvent();
        expect(validSeverities).toContain(event.severity);
      }
    });

    it("generates events with valid decisions", () => {
      const validDecisions = ["APPROVE", "STEP_UP", "HARD_BLOCK"];

      for (let i = 0; i < 50; i++) {
        const event = generateThreatEvent();
        expect(validDecisions).toContain(event.decision);
      }
    });

    it("uses provided timestamp", () => {
      const ts = new Date("2026-01-01T00:00:00Z");
      const event = generateThreatEvent(ts);
      expect(event.timestamp).toBe(ts.toISOString());
    });

    it("generates unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateThreatEvent().id);
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("generateMockThreats", () => {
    it("generates the requested number of threats", () => {
      const threats = generateMockThreats(10);
      expect(threats.length).toBe(10);
    });

    it("generates events sorted by timestamp (newest first)", () => {
      const threats = generateMockThreats(20);
      for (let i = 1; i < threats.length; i++) {
        const prev = new Date(threats[i - 1].timestamp).getTime();
        const curr = new Date(threats[i].timestamp).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });

    it("generates zero threats when count is 0", () => {
      const threats = generateMockThreats(0);
      expect(threats.length).toBe(0);
    });
  });

  describe("INITIAL_THREATS", () => {
    it("is pre-generated with 200 events", () => {
      expect(INITIAL_THREATS.length).toBe(200);
    });

    it("contains valid events", () => {
      INITIAL_THREATS.forEach((event) => {
        expect(event.id).toBeTruthy();
        expect(event.type).toBeTruthy();
        expect(event.severity).toBeTruthy();
      });
    });
  });
});
