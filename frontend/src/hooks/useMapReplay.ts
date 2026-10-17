import { useState, useCallback, useRef, useEffect } from "react";
import { MOCK_HEX_CELLS } from "../data/mockMap";
import type { MapHexCell } from "../types/btic";

/**
 * Hook that provides time-travel replay functionality for the map.
 * Filters hex cells based on a moving time window and animates the playback.
 */
export function useMapReplay() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [historyStart] = useState(Date.now() - 24 * 60 * 60 * 1000); // 24h ago
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Generate historical data by progressively revealing cells
  const getReplayCells = useCallback(
    (time: number): MapHexCell[] => {
      const progress = (time - historyStart) / (Date.now() - historyStart);
      const revealCount = Math.floor(progress * MOCK_HEX_CELLS.length);

      return MOCK_HEX_CELLS.slice(0, revealCount).map((cell, i) => {
        // Cells that appeared more recently are smaller/fainter
        const age = (revealCount - i) / revealCount;
        return {
          ...cell,
          threatCount: Math.max(1, Math.floor(cell.threatCount * age)),
          confidence: cell.confidence * (0.5 + age * 0.5),
        };
      });
    },
    [historyStart],
  );

  // Playback control
  useEffect(() => {
    if (!isPlaying) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    const stepMs = 60000 / playbackSpeed; // 1 minute per tick at 1x speed
    intervalRef.current = setInterval(() => {
      setCurrentTime((t) => {
        const next = t + stepMs * 10;
        if (next >= Date.now()) {
          setIsPlaying(false);
          return Date.now();
        }
        return next;
      });
    }, 100);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, playbackSpeed]);

  const play = useCallback(() => {
    if (currentTime >= Date.now()) {
      setCurrentTime(historyStart);
    }
    setIsPlaying(true);
  }, [currentTime, historyStart]);

  const pause = useCallback(() => setIsPlaying(false), []);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(Date.now());
  }, []);

  const scrubTo = useCallback((time: number) => {
    setIsPlaying(false);
    setCurrentTime(time);
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
  }, []);

  return {
    isPlaying,
    currentTime,
    historyStart,
    playbackSpeed,
    play,
    pause,
    reset,
    scrubTo,
    setSpeed,
    getReplayCells,
    progress: (currentTime - historyStart) / (Date.now() - historyStart),
  };
}
