import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";

// Component that throws an error
function ThrowingComponent(): React.ReactNode {
  throw new Error("Test error");
}

// Component that works fine
function WorkingComponent() {
  return <div>Working content</div>;
}

describe("ErrorBoundary Component", () => {
  // Suppress console.error for expected errors
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    consoleSpy.mockClear();
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary name="Test">
        <WorkingComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Working content")).toBeInTheDocument();
  });

  it("renders error UI when child throws", () => {
    render(
      <ErrorBoundary name="TestComponent">
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/TestComponent failed to render/)).toBeInTheDocument();
    expect(screen.getByText("Test error")).toBeInTheDocument();
  });

  it("shows retry button", () => {
    render(
      <ErrorBoundary name="Test">
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("uses custom fallback when provided", () => {
    render(
      <ErrorBoundary name="Test" fallback={<div>Custom fallback</div>}>
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
    expect(screen.queryByText(/failed to render/)).not.toBeInTheDocument();
  });

  it("uses default name when not provided", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Component failed to render/)).toBeInTheDocument();
  });
});
