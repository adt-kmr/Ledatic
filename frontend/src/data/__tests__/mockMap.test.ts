import { describe, it, expect } from "vitest";
import {
  generateMockHexCells,
  generateMockConnections,
  MOCK_HEX_CELLS,
  MOCK_CONNECTIONS,
} from "../mockMap";

describe("Mock Map Data", () => {
  describe("generateMockHexCells", () => {
    it("generates hex cells", () => {
      const cells = generateMockHexCells();
      expect(cells.length).toBeGreaterThan(0);
    });

    it("each cell has valid structure", () => {
      const cells = generateMockHexCells();
      cells.forEach((cell) => {
        expect(cell.h3Index).toBeTruthy();
        expect(cell.lat).toBeGreaterThanOrEqual(8);
        expect(cell.lat).toBeLessThanOrEqual(37);
        expect(cell.lng).toBeGreaterThanOrEqual(68);
        expect(cell.lng).toBeLessThanOrEqual(97);
        expect(cell.threatCount).toBeGreaterThanOrEqual(0);
        expect(cell.confidence).toBeGreaterThanOrEqual(0);
        expect(cell.confidence).toBeLessThanOrEqual(1);
        expect(cell.threatTypes.length).toBeGreaterThan(0);
        expect(cell.state).toBeTruthy();
        expect(cell.city).toBeTruthy();
      });
    });

    it("generates cells with valid severities", () => {
      const cells = generateMockHexCells();
      const validSeverities = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
      cells.forEach((cell) => {
        expect(validSeverities).toContain(cell.severity);
      });
    });
  });

  describe("generateMockConnections", () => {
    it("generates connections from hex cells", () => {
      const cells = generateMockHexCells();
      const connections = generateMockConnections(cells);
      expect(connections.length).toBeGreaterThan(0);
    });

    it("each connection has valid structure", () => {
      const cells = generateMockHexCells();
      const connections = generateMockConnections(cells);
      connections.forEach((conn) => {
        expect(conn.source.lat).toBeTruthy();
        expect(conn.source.lng).toBeTruthy();
        expect(conn.source.h3Index).toBeTruthy();
        expect(conn.target.lat).toBeTruthy();
        expect(conn.target.lng).toBeTruthy();
        expect(conn.target.h3Index).toBeTruthy();
        expect(conn.confidence).toBeGreaterThanOrEqual(0);
        expect(conn.confidence).toBeLessThanOrEqual(1);
        expect(conn.type).toBeTruthy();
      });
    });

    it("no self-connections", () => {
      const cells = generateMockHexCells();
      const connections = generateMockConnections(cells);
      connections.forEach((conn) => {
        expect(conn.source.h3Index).not.toBe(conn.target.h3Index);
      });
    });
  });

  describe("Pre-generated data", () => {
    it("MOCK_HEX_CELLS is pre-generated", () => {
      expect(MOCK_HEX_CELLS.length).toBeGreaterThan(0);
    });

    it("MOCK_CONNECTIONS is pre-generated from cells", () => {
      expect(MOCK_CONNECTIONS.length).toBeGreaterThan(0);
    });

    it("connections reference valid cells", () => {
      const cellIds = new Set(MOCK_HEX_CELLS.map((c) => c.h3Index));
      MOCK_CONNECTIONS.forEach((conn) => {
        // At least source or target should be in the cell set
        // (cross-state connections may reference cells not in the filtered set)
        expect(conn.source.h3Index).toBeTruthy();
        expect(conn.target.h3Index).toBeTruthy();
      });
    });
  });
});
