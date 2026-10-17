import { useEffect, useRef, useState, useCallback } from "react";

interface PerformanceMetrics {
  fps: number;
  renderTime: number;
  memoryUsage: number;
}

/**
 * Lightweight performance monitor for BTIC.
 * Tracks FPS, render time, and memory usage.
 * Only active in development or when explicitly enabled.
 */
export function usePerformanceMonitor(enabled = false) {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: 0,
    renderTime: 0,
    memoryUsage: 0,
  });
  const frameRef = useRef<number>(0);
  const lastTimeRef = useRef(performance.now());
  const frameCountRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    let running = true;

    const measure = () => {
      if (!running) return;

      frameCountRef.current++;
      const now = performance.now();
      const elapsed = now - lastTimeRef.current;

      if (elapsed >= 1000) {
        const fps = Math.round((frameCountRef.current * 1000) / elapsed);
        frameCountRef.current = 0;
        lastTimeRef.current = now;

        // Memory usage (if available)
        const memory = (performance as any).memory;
        const memoryUsage = memory
          ? Math.round(memory.usedJSHeapSize / 1024 / 1024)
          : 0;

        setMetrics({ fps, renderTime: 0, memoryUsage });
      }

      frameRef.current = requestAnimationFrame(measure);
    };

    frameRef.current = requestAnimationFrame(measure);

    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [enabled]);

  return metrics;
}

/**
 * Hook to measure component render time.
 * Wraps a callback and returns the time it took to execute.
 */
export function useRenderTimer(label: string) {
  const startRef = useRef(0);

  const start = useCallback(() => {
    startRef.current = performance.now();
  }, []);

  const end = useCallback(() => {
    const duration = performance.now() - startRef.current;
    if (duration > 16) {
      // Log only slow renders (>16ms = below 60fps)
      console.debug(`[BTIC] ${label}: ${duration.toFixed(1)}ms`);
    }
    return duration;
  }, [label]);

  return { start, end };
}
