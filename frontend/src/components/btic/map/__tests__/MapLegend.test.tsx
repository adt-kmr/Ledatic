import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapLegend } from "../MapLegend";

describe("MapLegend Component", () => {
  it("renders the severity label", () => {
    render(<MapLegend />);
    expect(screen.getByText("Severity")).toBeInTheDocument();
  });

  it("renders all severity levels", () => {
    render(<MapLegend />);
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("MEDIUM")).toBeInTheDocument();
    expect(screen.getByText("LOW")).toBeInTheDocument();
    expect(screen.getByText("INFO")).toBeInTheDocument();
  });

  it("renders tower height legend", () => {
    render(<MapLegend />);
    expect(screen.getByText("Tower Height")).toBeInTheDocument();
  });

  it("renders Low/High labels", () => {
    render(<MapLegend />);
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });
});
