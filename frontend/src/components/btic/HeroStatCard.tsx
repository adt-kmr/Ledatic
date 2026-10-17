import { useEffect, useRef, useState, memo } from "react";
import type { HeroStat } from "../../types/btic";

const STATUS_COLORS: Record<string, string> = {
  green: "#3D8B5A",
  amber: "#B7791F",
  red: "#B3261E",
};
const STATUS_LABEL: Record<string, string> = { green: "Healthy", amber: "Watch", red: "Critical" };

function useAnimatedCounter(target: number, duration = 1200): number {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    startRef.current = null;
    const startValue = value;

    const animate = (timestamp: number) => {
      if (!startRef.current) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(startValue + (target - startValue) * eased));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return value;
}

const MiniSparkline = memo(function MiniSparkline({
  data,
  color,
}: {
  data: number[];
  color: string;
}) {
  if (!data.length) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 96;
  const height = 34;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={color} opacity={0.08} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});

export const HeroStatCard = memo(function HeroStatCard({
  stat,
}: {
  stat: HeroStat;
}) {
  const animatedValue = useAnimatedCounter(stat.value);
  const color = STATUS_COLORS[stat.status];

  return (
    <div className="glass-card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14, position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span className="cc-mono" style={{ color: "#767270" }}>{stat.label}</span>
        <span className="cc-mono" style={{ display: "inline-flex", alignItems: "center", gap: 6, color, background: `color-mix(in oklch, ${color} 10%, transparent)`, padding: "3px 8px", borderRadius: 6, fontSize: 11.5 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
          {STATUS_LABEL[stat.status]}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 48, fontWeight: 300, color: "#100F0F", lineHeight: 0.9, letterSpacing: "-0.03em" }}>
          {animatedValue.toLocaleString()}
        </span>
        <MiniSparkline data={stat.trend} color={color} />
      </div>

      <span style={{ fontSize: 14, color: "#575452", borderTop: "1px solid #F1EAE7", paddingTop: 12 }}>{stat.subtitle}</span>
    </div>
  );
});
