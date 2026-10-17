import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { C } from "../lib/theme";

// ── Animated counter hook ─────────────────────────────────────────────────
export function useAnimatedCounter(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    const start = Date.now();
    let id: number;
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) {
        id = requestAnimationFrame(tick);
      }
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, duration]);
  return value;
}

// ── MetricCard ────────────────────────────────────────────────────────────
interface MetricCardProps {
  label: string;
  value: number;
  accent?: string;
  glow?: boolean;
}

export function MetricCard({ label, value, accent = C.textPrimary, glow = false }: MetricCardProps) {
  const animated = useAnimatedCounter(value);
  return (
    <motion.div
      className="glass-card magnetic-hover"
      style={{
        padding: '18px 22px',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 14,
        ...(glow ? {
          borderTop: `1px solid ${accent}`,
          background: `linear-gradient(180deg, color-mix(in oklch, ${accent} 6%, transparent) 0%, rgba(16, 15, 15,0.02) 100%)`
        } : {
          borderTop: '1px solid rgba(16, 15, 15,0.06)'
        })
      }}
    >
      {glow && (
        <div style={{
          position: 'absolute', top: 0, left: '20%', right: '20%', height: 1,
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          boxShadow: `0 0 10px 1px color-mix(in oklch, ${accent} 40%, transparent)`
        }} />
      )}
      <div style={{
        fontSize: 9.5, color: "rgba(20, 19, 19,0.35)",
        textTransform: 'uppercase', letterSpacing: '0.1em',
        marginBottom: 8, fontWeight: 600, fontFamily: C.mono,
      }}>
        {label}
      </div>
      <motion.div
        key={animated}
        initial={{ opacity: 0.8, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        style={{
          fontSize: 28, fontWeight: 800, color: "#141313",
          fontFamily: C.mono, lineHeight: 1,
          letterSpacing: '-0.03em',
          display: 'flex', alignItems: 'center', gap: 8
        }}
      >
        {animated}
        {glow && <span style={{ color: accent, fontSize: 10, filter: `drop-shadow(0 0 4px ${accent})` }}>●</span>}
      </motion.div>
    </motion.div>
  );
}

// ── SkeletonBlock ─────────────────────────────────────────────────────────
export function SkeletonBlock({ height = 20, width = '100%', radius = 6 }: {
  height?: number; width?: number | string; radius?: number;
}) {
  return (
    <div className="skeleton" style={{ height, width, borderRadius: radius }} />
  );
}

// ── LoadingRows ───────────────────────────────────────────────────────────
export function LoadingRows({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl p-4" style={{
          background: "rgba(16, 15, 15,0.02)",
          border: "1px solid rgba(16, 15, 15,0.05)",
        }}>
          <div className="flex justify-between mb-3">
            <SkeletonBlock height={12} width="28%" />
            <SkeletonBlock height={12} width="10%" />
          </div>
          <SkeletonBlock height={10} width="65%" />
          <div className="mt-2">
            <SkeletonBlock height={8} width="35%" />
          </div>
        </div>
      ))}
    </div>
  );
}

