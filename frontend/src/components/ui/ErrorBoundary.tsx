import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div
            style={{
              padding: 24,
              background: "rgba(16, 15, 15,0.03)",
              border: "1px solid rgba(255,69,58,0.3)",
              borderRadius: 12,
              color: "rgba(20, 19, 19,0.7)",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13,
            }}
          >
            <div
              style={{
                fontWeight: 600,
                color: "#FF453A",
                marginBottom: 8,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              {this.props.name || "Component"} failed to render
            </div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              {this.state.error?.message || "An unexpected error occurred"}
            </div>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                marginTop: 12,
                padding: "6px 14px",
                borderRadius: 8,
                border: "1px solid rgba(16, 15, 15,0.1)",
                background: "rgba(16, 15, 15,0.05)",
                color: "#141313",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
