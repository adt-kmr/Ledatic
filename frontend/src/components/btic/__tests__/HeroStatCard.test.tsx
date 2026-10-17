import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroStatCard } from "../HeroStatCard";
import type { HeroStat } from "../../../types/btic";

// Mock requestAnimationFrame for the counter animation
vi.mock("../../../hooks/useInterval", () => ({
  useInterval: () => {},
}));

describe("HeroStatCard Component", () => {
  const mockStat: HeroStat = {
    label: "Identity Confidence",
    value: 87,
    subtitle: "Avg trust across active sessions",
    trend: [75, 80, 82, 85, 87],
    status: "green",
    icon: "shield-check",
  };

  it("renders the label", () => {
    render(<HeroStatCard stat={mockStat} />);
    expect(screen.getByText("Identity Confidence")).toBeInTheDocument();
  });

  it("renders the subtitle", () => {
    render(<HeroStatCard stat={mockStat} />);
    expect(screen.getByText("Avg trust across active sessions")).toBeInTheDocument();
  });

  it("renders with red status", () => {
    const redStat = { ...mockStat, status: "red" as const };
    render(<HeroStatCard stat={redStat} />);
    expect(screen.getByText("Identity Confidence")).toBeInTheDocument();
  });

  it("renders with amber status", () => {
    const amberStat = { ...mockStat, status: "amber" as const };
    render(<HeroStatCard stat={amberStat} />);
    expect(screen.getByText("Identity Confidence")).toBeInTheDocument();
  });

  it("has glass-card class", () => {
    const { container } = render(<HeroStatCard stat={mockStat} />);
    const card = container.querySelector(".glass-card");
    expect(card).toBeInTheDocument();
  });
});
