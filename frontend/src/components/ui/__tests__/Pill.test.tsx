import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pill } from "../Pill";

describe("Pill Component", () => {
  it("renders the text", () => {
    render(<Pill text="CRITICAL" color="#FF453A" />);
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
  });

  it("applies the color", () => {
    render(<Pill text="HIGH" color="#FF9F0A" />);
    const pill = screen.getByText("HIGH");
    expect(pill).toHaveStyle({ color: "#FF9F0A" });
  });

  it("renders with empty text", () => {
    render(<Pill text="" color="#FF453A" />);
    const pill = document.querySelector("span");
    expect(pill).toBeTruthy();
  });

  it("has correct styling", () => {
    render(<Pill text="TEST" color="#34C759" />);
    const pill = screen.getByText("TEST");
    expect(pill).toHaveStyle({
      fontSize: "10px",
      fontWeight: "500",
      borderRadius: "6px",
      textTransform: "uppercase",
    });
  });
});
