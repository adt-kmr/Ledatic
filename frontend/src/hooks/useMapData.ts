import { useEffect, useCallback } from "react";
import { fetchThreatAggregate } from "../lib/bticApi";
import { useBticStore } from "../stores/bticStore";
import { MOCK_HEX_CELLS, MOCK_CONNECTIONS } from "../data/mockMap";
import type { MapHexCell, MapConnection } from "../types/btic";

/**
 * Hook that fetches real map data from the backend and stores it in the Zustand store.
 * Falls back to mock data when the API is unavailable.
 * Merges SSE threat events into hex cells for real-time updates.
 */
export function useMapData(options?: { hours?: number; enabled?: boolean }) {
  const { hours = 24, enabled = true } = options || {};
  const setMapHexCells = useBticStore((s) => s.setMapHexCells);
  const setMapConnections = useBticStore((s) => s.setMapConnections);
  const mapHexCells = useBticStore((s) => s.mapHexCells);
  const recentThreats = useBticStore((s) => s.recentThreats);

  // Fetch initial data from backend. Skipped when disabled so a caller that
  // supplies its own cells doesn't have them overwritten by the global feed.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      const data = await fetchThreatAggregate(hours);
      if (cancelled) return;

      if (data && data.hexCells && data.hexCells.length > 0) {
        setMapHexCells(data.hexCells);
        if (data.connections) {
          setMapConnections(data.connections);
        }
      } else {
        // Fallback to mock data
        setMapHexCells(MOCK_HEX_CELLS);
        setMapConnections(MOCK_CONNECTIONS);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [hours, enabled, setMapHexCells, setMapConnections]);

  // Merge SSE threat events into hex cells (update threat counts and add new cells)
  const mergeThreatIntoCells = useCallback(
    (threat: { lat: number; lng: number; severity: string; type: string }) => {
      const cells = useBticStore.getState().mapHexCells;
      if (cells.length === 0) return;

      // Find nearest cell within ~50km
      let nearestIdx = -1;
      let minDist = Infinity;
      for (let i = 0; i < cells.length; i++) {
        const dist = Math.sqrt(
          (cells[i].lat - threat.lat) ** 2 + (cells[i].lng - threat.lng) ** 2,
        );
        if (dist < minDist) {
          minDist = dist;
          nearestIdx = i;
        }
      }

      if (nearestIdx >= 0 && minDist < 0.5) {
        // Update existing cell
        const updated = [...cells];
        const cell = { ...updated[nearestIdx] };
        cell.threatCount += 1;
        cell.confidence = Math.min(1, cell.confidence + 0.02);
        // Escalate severity if needed
        if (threat.severity === "CRITICAL" && cell.severity !== "CRITICAL") {
          cell.severity = "CRITICAL";
        } else if (threat.severity === "HIGH" && cell.severity === "LOW") {
          cell.severity = "HIGH";
        }
        // Add threat type if not present
        if (!cell.threatTypes.includes(threat.type as any)) {
          cell.threatTypes = [...cell.threatTypes, threat.type as any].slice(0, 4);
        }
        updated[nearestIdx] = cell;
        setMapHexCells(updated);
      }
    },
    [setMapHexCells],
  );

  // Subscribe to recentThreats changes and merge into cells
  useEffect(() => {
    if (recentThreats.length === 0) return;
    const latest = recentThreats[0];
    mergeThreatIntoCells({
      lat: latest.location.lat,
      lng: latest.location.lng,
      severity: latest.severity,
      type: latest.type,
    });
  }, [recentThreats.length, mergeThreatIntoCells]);

  return { mapHexCells };
}
