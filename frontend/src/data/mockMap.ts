import { latLngToCell, cellToLatLng } from "h3-js";
import type {
  MapHexCell,
  MapConnection,
  ThreatType,
  ThreatSeverity,
} from "../types/btic";
import { INDIAN_STATES, CITIES } from "./indianGeography";

// ── Deterministic seeded RNG for reproducible mock data ────────────────────
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rand = seededRandom(42);

// ── H3 resolution 5 cell size: ~2.5km² ────────────────────────────────────
const H3_RES = 5;

// ── Generate real H3 hex cells covering India ──────────────────────────────
function generateHexGrid(): MapHexCell[] {
  const cells: MapHexCell[] = [];
  const seenH3 = new Set<string>();

  // For each state, generate H3 cells around its center and major cities
  for (const state of INDIAN_STATES) {
    const [baseLat, baseLng] = state.center;
    const clusterRadius = 1.8 + state.threatWeight * 0.7;

    // Generate a grid of H3 cells covering the state area (finer step for more density)
    for (let dLat = -clusterRadius; dLat <= clusterRadius; dLat += 0.3) {
      for (let dLng = -clusterRadius; dLng <= clusterRadius; dLng += 0.3) {
        const lat = baseLat + dLat + (rand() - 0.5) * 0.2;
        const lng = baseLng + dLng + (rand() - 0.5) * 0.2;

        // Skip cells outside India's approximate bounding box
        if (lat < 6.5 || lat > 37 || lng < 68 || lng > 98) continue;

        const h3Index = latLngToCell(lat, lng, H3_RES);
        if (seenH3.has(h3Index)) continue;
        seenH3.add(h3Index);

        // Get the actual cell center from H3
        const [cellLat, cellLng] = cellToLatLng(h3Index);

        // Distance from state center affects threat density
        const distFromCenter = Math.sqrt(
          (cellLat - baseLat) ** 2 + (cellLng - baseLng) ** 2,
        );
        const densityFactor = Math.max(0, 1 - distFromCenter / clusterRadius);

        // Skip low-density cells far from state centers
        if (densityFactor < 0.08 && rand() > 0.35) continue;

        const threatCount = Math.floor(
          state.threatWeight * 12 * densityFactor * (0.5 + rand()),
        );
        if (threatCount === 0) continue;

        const severity = deriveSeverity(state.threatWeight, densityFactor, rand);
        const threatTypes = pickThreatTypes(1 + Math.floor(rand() * 3));

        cells.push({
          h3Index,
          lat: cellLat,
          lng: cellLng,
          severity,
          confidence: 0.55 + rand() * 0.45,
          threatCount,
          threatTypes,
          state: state.name,
          city: findNearestCity(cellLat, cellLng),
        });
      }
    }
  }

  // Add extra density around Tier-1 cities (more cells, wider spread)
  for (const city of CITIES.slice(0, 20)) {
    const cityDensity = Math.floor(city.population / 2000000) + 2;
    for (let i = 0; i < cityDensity; i++) {
      const offsetLat = (rand() - 0.5) * 0.8;
      const offsetLng = (rand() - 0.5) * 0.8;
      const lat = city.lat + offsetLat;
      const lng = city.lng + offsetLng;

      const h3Index = latLngToCell(lat, lng, H3_RES);
      if (seenH3.has(h3Index)) continue;
      seenH3.add(h3Index);

      const [cellLat, cellLng] = cellToLatLng(h3Index);

      cells.push({
        h3Index,
        lat: cellLat,
        lng: cellLng,
        severity: deriveSeverity(1.4, 0.8, rand),
        confidence: 0.65 + rand() * 0.35,
        threatCount: 3 + Math.floor(rand() * 14),
        threatTypes: pickThreatTypes(1 + Math.floor(rand() * 3)),
        state: city.state,
        city: city.name,
      });
    }
  }

  return cells;
}

// ── Generate connections between related H3 cells ──────────────────────────
function generateConnections(cells: MapHexCell[]): MapConnection[] {
  const connections: MapConnection[] = [];
  const usedPairs = new Set<string>();

  // Intra-state connections (cells within same state)
  const stateGroups = new Map<string, MapHexCell[]>();
  for (const cell of cells) {
    const group = stateGroups.get(cell.state) || [];
    group.push(cell);
    stateGroups.set(cell.state, group);
  }

  for (const [, stateCells] of stateGroups) {
    if (stateCells.length < 2) continue;
    const numConn = Math.min(Math.floor(stateCells.length * 0.4), 8);

    for (let i = 0; i < numConn; i++) {
      const a = stateCells[Math.floor(rand() * stateCells.length)];
      const b = stateCells[Math.floor(rand() * stateCells.length)];
      if (a.h3Index === b.h3Index) continue;

      const pairKey = [a.h3Index, b.h3Index].sort().join(":");
      if (usedPairs.has(pairKey)) continue;
      usedPairs.add(pairKey);

      connections.push({
        source: { lat: a.lat, lng: a.lng, h3Index: a.h3Index },
        target: { lat: b.lat, lng: b.lng, h3Index: b.h3Index },
        confidence: 0.4 + rand() * 0.6,
        type: a.threatTypes[0] || "BEHAVIORAL_ANOMALY",
      });
    }
  }

  // Cross-state connections (campaign propagation)
  const cellArr = Array.from(cells);
  for (let i = 0; i < 35; i++) {
    const a = cellArr[Math.floor(rand() * cellArr.length)];
    const b = cellArr[Math.floor(rand() * cellArr.length)];
    if (a.state === b.state) continue;

    const pairKey = [a.h3Index, b.h3Index].sort().join(":");
    if (usedPairs.has(pairKey)) continue;
    usedPairs.add(pairKey);

    connections.push({
      source: { lat: a.lat, lng: a.lng, h3Index: a.h3Index },
      target: { lat: b.lat, lng: b.lng, h3Index: b.h3Index },
      confidence: 0.3 + rand() * 0.5,
      type: "SIM_SWAP",
      campaignId: `cmp-${String(Math.floor(rand() * 10) + 1).padStart(3, "0")}`,
    });
  }

  return connections;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function deriveSeverity(
  threatWeight: number,
  density: number,
  rng: () => number,
): ThreatSeverity {
  const score = threatWeight * density * (0.5 + rng());
  if (score > 2.8) return "CRITICAL";
  if (score > 2.0) return "HIGH";
  if (score > 1.2) return "MEDIUM";
  return "LOW";
}

function pickThreatTypes(count: number): ThreatType[] {
  const all: ThreatType[] = [
    "SIM_SWAP",
    "CREDENTIAL_THEFT",
    "COERCION",
    "MONEY_MULE",
    "BEHAVIORAL_ANOMALY",
    "MERCHANT_ABUSE",
    "IDENTITY_MISMATCH",
  ];
  const shuffled = [...all].sort(() => rand() - 0.5);
  return shuffled.slice(0, count);
}

function findNearestCity(lat: number, lng: number): string {
  let nearest = CITIES[0].name;
  let minDist = Infinity;
  for (const city of CITIES) {
    const dist = Math.sqrt((lat - city.lat) ** 2 + (lng - city.lng) ** 2);
    if (dist < minDist) {
      minDist = dist;
      nearest = city.name;
    }
  }
  return nearest;
}

// ── Export pre-computed data ───────────────────────────────────────────────
export const MOCK_HEX_CELLS: MapHexCell[] = generateHexGrid();
export const MOCK_CONNECTIONS: MapConnection[] =
  generateConnections(MOCK_HEX_CELLS);

// Named exports for tests
export const generateMockHexCells = generateHexGrid;
export const generateMockConnections = generateConnections;
