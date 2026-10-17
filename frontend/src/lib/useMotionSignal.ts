// Citadel — useMotionSignal
// =============================
// Captures a rolling buffer of pointer-movement deltas (dx) with timestamps,
// used by the Anti-Spoofing FFT to look for human micro-tremor. Human hands
// produce fine involuntary jitter; scripted/GAN trajectories are unnaturally
// smooth. Buffer is capped so memory stays bounded during a long session.

import { useEffect, useRef, useCallback } from "react";

const MAX_SAMPLES = 256;

export function useMotionSignal() {
  const values = useRef<number[]>([]);
  const timestamps = useRef<number[]>([]);
  const lastX = useRef<number | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (lastX.current !== null) {
        values.current.push(e.clientX - lastX.current);
        timestamps.current.push(e.timeStamp);
        if (values.current.length > MAX_SAMPLES) {
          values.current.shift();
          timestamps.current.shift();
        }
      }
      lastX.current = e.clientX;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const snapshot = useCallback(
    () => ({ values: [...values.current], timestamps: [...timestamps.current] }),
    [],
  );

  return { snapshot };
}
