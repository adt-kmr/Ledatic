import { describe, it, expect, beforeEach } from "vitest";
import { useBticStore } from "../bticStore";
import type { ThreatEvent } from "../../types/btic";

describe("BTIC Store", () => {
  beforeEach(() => {
    // Reset store to initial state
    useBticStore.setState({
      activeNav: "home",
      activeMapLayers: ["identity_confidence"],
      selectedHexCell: null,
      selectedGraphNode: null,
      investigationContext: null,
      liveEvents: [],
      recentThreats: [],
      commandPaletteOpen: false,
    });
  });

  describe("Navigation", () => {
    it("has default active nav", () => {
      const state = useBticStore.getState();
      expect(state.activeNav).toBe("home");
    });

    it("can set active nav", () => {
      useBticStore.getState().setActiveNav("threats");
      expect(useBticStore.getState().activeNav).toBe("threats");
    });
  });

  describe("Map Layers", () => {
    it("has default map layer", () => {
      const state = useBticStore.getState();
      expect(state.activeMapLayers).toContain("identity_confidence");
    });

    it("can toggle map layer on", () => {
      useBticStore.getState().toggleMapLayer("sim_swap");
      expect(useBticStore.getState().activeMapLayers).toContain("sim_swap");
    });

    it("can toggle map layer off", () => {
      useBticStore.getState().toggleMapLayer("identity_confidence");
      expect(useBticStore.getState().activeMapLayers).not.toContain("identity_confidence");
    });

    it("toggling same layer twice removes it", () => {
      useBticStore.getState().toggleMapLayer("sim_swap");
      useBticStore.getState().toggleMapLayer("sim_swap");
      expect(useBticStore.getState().activeMapLayers).not.toContain("sim_swap");
    });
  });

  describe("Hex Cell Selection", () => {
    it("defaults to no selected hex cell", () => {
      expect(useBticStore.getState().selectedHexCell).toBeNull();
    });

    it("can select a hex cell", () => {
      useBticStore.getState().setSelectedHexCell("852a10003ff");
      expect(useBticStore.getState().selectedHexCell).toBe("852a10003ff");
    });

    it("can deselect a hex cell", () => {
      useBticStore.getState().setSelectedHexCell("852a10003ff");
      useBticStore.getState().setSelectedHexCell(null);
      expect(useBticStore.getState().selectedHexCell).toBeNull();
    });
  });

  describe("Graph Node Selection", () => {
    it("defaults to no selected graph node", () => {
      expect(useBticStore.getState().selectedGraphNode).toBeNull();
    });

    it("can select a graph node", () => {
      useBticStore.getState().setSelectedGraphNode("user-123");
      expect(useBticStore.getState().selectedGraphNode).toBe("user-123");
    });
  });

  describe("Investigation Context", () => {
    it("defaults to null", () => {
      expect(useBticStore.getState().investigationContext).toBeNull();
    });

    it("can set investigation context", () => {
      const ctx = { customerHash: "abc", sessionId: "session-1" };
      useBticStore.getState().setInvestigationContext(ctx);
      expect(useBticStore.getState().investigationContext).toEqual(ctx);
    });

    it("can clear investigation context", () => {
      useBticStore.getState().setInvestigationContext({ customerHash: "abc", sessionId: "session-1" });
      useBticStore.getState().setInvestigationContext(null);
      expect(useBticStore.getState().investigationContext).toBeNull();
    });
  });

  describe("Live Events", () => {
    it("starts with empty live events", () => {
      expect(useBticStore.getState().liveEvents).toEqual([]);
    });

    it("can add a live event", () => {
      const event = {
        id: "evt-1",
        timestamp: new Date().toISOString(),
        severity: "CRITICAL" as const,
        type: "SIM_SWAP" as const,
        location: "Mumbai",
        detail: "Test event",
      };
      useBticStore.getState().addLiveEvent(event);
      expect(useBticStore.getState().liveEvents.length).toBe(1);
      expect(useBticStore.getState().liveEvents[0].id).toBe("evt-1");
    });

    it("new events are added to the front", () => {
      useBticStore.getState().addLiveEvent({
        id: "evt-1", timestamp: "", severity: "HIGH", type: "COERCION", location: "", detail: "",
      });
      useBticStore.getState().addLiveEvent({
        id: "evt-2", timestamp: "", severity: "LOW", type: "MONEY_MULE", location: "", detail: "",
      });
      const events = useBticStore.getState().liveEvents;
      expect(events[0].id).toBe("evt-2");
      expect(events[1].id).toBe("evt-1");
    });

    it("live events are capped at maxLiveEvents", () => {
      const max = useBticStore.getState().maxLiveEvents;
      for (let i = 0; i < max + 10; i++) {
        useBticStore.getState().addLiveEvent({
          id: `evt-${i}`, timestamp: "", severity: "INFO", type: "BEHAVIORAL_ANOMALY", location: "", detail: "",
        });
      }
      expect(useBticStore.getState().liveEvents.length).toBe(max);
    });
  });

  describe("Recent Threats", () => {
    it("starts with empty recent threats", () => {
      expect(useBticStore.getState().recentThreats).toEqual([]);
    });

    it("can set recent threats", () => {
      const threats: ThreatEvent[] = [
        { id: "t-1", timestamp: "", type: "SIM_SWAP", severity: "CRITICAL", confidence: 0.9, location: { state: "MH", stateCode: "MH", city: "Mumbai", lat: 0, lng: 0 }, customerHash: "", sessionId: "", riskScore: 800, decision: "HARD_BLOCK", details: "", channel: "", pathway: "" },
        { id: "t-2", timestamp: "", type: "COERCION", severity: "HIGH", confidence: 0.8, location: { state: "DL", stateCode: "DL", city: "Delhi", lat: 0, lng: 0 }, customerHash: "", sessionId: "", riskScore: 600, decision: "STEP_UP", details: "", channel: "", pathway: "" },
      ];
      useBticStore.getState().setRecentThreats(threats);
      expect(useBticStore.getState().recentThreats.length).toBe(2);
    });

    it("can add a single threat", () => {
      useBticStore.getState().addRecentThreat({
        id: "t-1", timestamp: "", type: "SIM_SWAP", severity: "CRITICAL", confidence: 0.9, location: { state: "MH", stateCode: "MH", city: "Mumbai", lat: 0, lng: 0 }, customerHash: "", sessionId: "", riskScore: 800, decision: "HARD_BLOCK", details: "", channel: "", pathway: "",
      });
      expect(useBticStore.getState().recentThreats.length).toBe(1);
    });
  });

  describe("Command Palette", () => {
    it("defaults to closed", () => {
      expect(useBticStore.getState().commandPaletteOpen).toBe(false);
    });

    it("can open command palette", () => {
      useBticStore.getState().setCommandPaletteOpen(true);
      expect(useBticStore.getState().commandPaletteOpen).toBe(true);
    });
  });
});
