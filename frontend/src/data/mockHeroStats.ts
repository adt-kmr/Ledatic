import type { HeroStat } from "../types/btic";

function generateSparkline(min: number, max: number, points: number = 24): number[] {
  const data: number[] = [];
  let value = min + Math.random() * (max - min);
  for (let i = 0; i < points; i++) {
    value += (Math.random() - 0.5) * ((max - min) * 0.15);
    value = Math.max(min, Math.min(max, value));
    data.push(Math.round(value));
  }
  return data;
}

export function getHeroStats(): HeroStat[] {
  return [
    {
      label: "Identity Confidence",
      value: 87,
      subtitle: "Avg trust across active sessions",
      trend: generateSparkline(75, 95),
      status: "green",
      icon: "shield-check",
    },
    {
      label: "Active Threats",
      value: 12,
      subtitle: "Campaigns running in last 1h",
      trend: generateSparkline(3, 18),
      status: "amber",
      icon: "alert-triangle",
    },
    {
      label: "Critical Incidents",
      value: 5,
      subtitle: "Hard blocks in last 24h",
      trend: generateSparkline(1, 9),
      status: "red",
      icon: "shield-alert",
    },
    {
      label: "Protected Transactions",
      value: 1847,
      subtitle: "Approved sessions today",
      trend: generateSparkline(1200, 2200),
      status: "green",
      icon: "check-circle",
    },
  ];
}
