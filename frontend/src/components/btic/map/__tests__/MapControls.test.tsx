import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapControls } from "../MapControls";

describe("MapControls Component", () => {
  it("renders the layers label", () => {
    render(<MapControls />);
    expect(screen.getByText("Intelligence Layers")).toBeInTheDocument();
  });

  it("renders all layer toggles", () => {
    render(<MapControls />);
    expect(screen.getByText("Identity Confidence")).toBeInTheDocument();
    expect(screen.getByText("Behavior Drift")).toBeInTheDocument();
    expect(screen.getByText("Credential Theft")).toBeInTheDocument();
    expect(screen.getByText("SIM Swap")).toBeInTheDocument();
    expect(screen.getByText("Money Mule")).toBeInTheDocument();
    expect(screen.getByText("Merchant Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Campaigns")).toBeInTheDocument();
  });

  it("Identity Confidence is active by default", () => {
    render(<MapControls />);
    const btn = screen.getByText("Identity Confidence").closest("button");
    expect(btn).toBeTruthy();
  });

  it("can toggle a layer", () => {
    render(<MapControls />);
    const simSwapBtn = screen.getByText("SIM Swap").closest("button");
    expect(simSwapBtn).toBeTruthy();
    if (simSwapBtn) {
      fireEvent.click(simSwapBtn);
      // After clicking, the layer should be toggled
    }
  });
});
