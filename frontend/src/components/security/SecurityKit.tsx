// Citadel — Advanced Security demo UI kit
// ===========================================
// Shared presentational primitives for the four advanced-security module
// panels shown inside the FIU portal (/cbi). Kept in one place so all four
// modules read as one system rather than four separately-styled demos.
//
// Design tokens follow the existing dashboard: Fragment Mono for anything
// machine-generated, glass surfaces, semantic status colours only.

import React from "react";
import { C } from "../../lib/theme";

export const OK = "#3D8B5A";
export const WARN = "#C7892B";
export const BAD = "#B3261E";
export const MUTED = "rgba(20, 19, 19,0.4)";

/** Verdict states a module step can end in. */
export type StepState = "idle" | "running" | "pass" | "fail" | "neutral";

export const stateColor = (s: StepState): string =>
  s === "pass" ? OK : s === "fail" ? BAD : s === "neutral" ? MUTED : s === "running" ? WARN : MUTED;

// ── Module shell ─────────────────────────────────────────────────────────────

/**
 * Outer card for one advanced-security module.
 * `caveat` renders the honest-framing note (e.g. "heuristic, never decides
 * alone") — the repo convention is to disclose limits in the UI rather than
 * overclaim, so this is deliberately part of the shell, not an afterthought.
 */
export const ModuleShell: React.FC<{
  index: number;
  title: string;
  threat: string;
  tech: string;
  caveat?: string;
  children: React.ReactNode;
}> = ({ index, title, threat, tech, caveat, children }) => (
  <div
    style={{
      borderRadius: 16,
      border: "1px solid #EAE4E1",
      background: "#FFFFFF",
      padding: "20px 22px",
      marginBottom: 20,
    }}
  >
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
      <span
        style={{
          fontFamily: C.mono, fontSize: 12.5, fontWeight: 700,
          color: "var(--color-primary)", border: "1px solid rgba(170, 65, 42,0.3)",
          background: "rgba(170, 65, 42,0.08)", borderRadius: 6, padding: "3px 8px",
          flexShrink: 0,
        }}
      >
        MODULE {index}
      </span>
      <span style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 23, fontWeight: 400, color: "#100F0F" }}>
        {title}
      </span>
    </div>

    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 16, fontSize: 12.5, fontFamily: C.mono }}>
      <span style={{ color: MUTED }}>
        KILLS: <span style={{ color: "rgba(16, 15, 15,0.72)" }}>{threat}</span>
      </span>
      <span style={{ color: MUTED }}>
        TECH: <span style={{ color: "rgba(16, 15, 15,0.72)" }}>{tech}</span>
      </span>
    </div>

    {children}

    {caveat && (
      <div
        style={{
          marginTop: 14, padding: "9px 12px", borderRadius: 8,
          background: "rgba(199,137,43,0.07)", border: "1px solid rgba(199,137,43,0.18)",
          fontSize: 12.5, color: "#E0A64B", lineHeight: 1.55, display: "flex", gap: 8,
        }}
      >
        <span style={{ flexShrink: 0 }}>ⓘ</span>
        <span>{caveat}</span>
      </div>
    )}
  </div>
);

// ── Rows & badges ────────────────────────────────────────────────────────────

export const StatRow: React.FC<{
  label: string;
  value: React.ReactNode;
  color?: string;
  mono?: boolean;
}> = ({ label, value, color, mono = true }) => (
  <div
    style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      gap: 16, padding: "8px 0", borderBottom: "1px solid #EAE4E1",
    }}
  >
    <span
      style={{
        fontSize: 12, color: MUTED, letterSpacing: "0.09em",
        textTransform: "uppercase", fontFamily: "'Inter', sans-serif", flexShrink: 0,
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontSize: 13.5, fontWeight: 700, color: color ?? "#100F0F",
        fontFamily: mono ? C.mono : "'Inter', sans-serif",
        textAlign: "right", wordBreak: "break-all", minWidth: 0,
      }}
    >
      {value}
    </span>
  </div>
);

export const VerdictBadge: React.FC<{ state: StepState; text: string }> = ({ state, text }) => (
  <span
    style={{
      display: "inline-block",
      fontFamily: C.mono, fontSize: 12, fontWeight: 700,
      color: stateColor(state),
      background: `color-mix(in oklch, ${stateColor(state)} 14%, transparent)`,
      border: `1px solid color-mix(in oklch, ${stateColor(state)} 32%, transparent)`,
      borderRadius: 20, padding: "3px 10px", letterSpacing: "0.05em", whiteSpace: "nowrap",
    }}
  >
    {text}
  </span>
);

// ── Buttons ──────────────────────────────────────────────────────────────────

export const RunButton: React.FC<{
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "danger" | "ghost";
  children: React.ReactNode;
}> = ({ onClick, busy, disabled, variant = "primary", children }) => {
  const off = busy || disabled;
  const bg =
    variant === "primary" ? "var(--color-primary)"
      : variant === "danger" ? "rgba(179, 38, 30,0.14)"
        : "transparent";
  const fg =
    variant === "primary" ? "var(--color-on-primary)"
      : variant === "danger" ? BAD
        : "rgba(16, 15, 15,0.62)";
  const border =
    variant === "primary" ? "none"
      : variant === "danger" ? "1px solid rgba(179, 38, 30,0.35)"
        : "1px solid rgba(16, 15, 15,0.14)";

  return (
    <button
      onClick={onClick}
      disabled={off}
      style={{
        padding: "9px 16px", borderRadius: 9, border,
        background: bg, color: fg,
        fontSize: 13, fontWeight: 700, fontFamily: C.mono,
        textTransform: "uppercase", letterSpacing: "0.05em",
        cursor: off ? "default" : "pointer",
        opacity: off ? 0.45 : 1,
        transition: "opacity 0.2s, transform 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {busy ? "RUNNING…" : children}
    </button>
  );
};

export const ButtonRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 14 }}>{children}</div>
);

// ── Log console ──────────────────────────────────────────────────────────────

export interface LogLine {
  text: string;
  tone?: "ok" | "bad" | "warn" | "dim";
  ts?: string;
}

const toneColor = (t?: LogLine["tone"]): string =>
  t === "ok" ? OK : t === "bad" ? BAD : t === "warn" ? WARN : "rgba(16, 15, 15,0.55)";

/** Terminal-style output so the jury can read exactly what happened, in order. */
export const LogConsole: React.FC<{ lines: LogLine[]; empty?: string; height?: number }> = ({
  lines, empty = "Awaiting run…", height = 150,
}) => (
  <div
    style={{
      background: "rgba(255, 255, 255,0.42)",
      border: "1px solid #EAE4E1",
      borderRadius: 10, padding: "11px 13px",
      height, overflowY: "auto",
      fontFamily: C.mono, fontSize: 12.5, lineHeight: 1.75,
    }}
  >
    {lines.length === 0 ? (
      <div style={{ color: MUTED }}>{empty}</div>
    ) : (
      lines.map((l, i) => (
        <div key={i} style={{ color: toneColor(l.tone), wordBreak: "break-all" }}>
          {l.ts && <span style={{ color: "rgba(16, 15, 15,0.25)" }}>{l.ts} </span>}
          {l.text}
        </div>
      ))
    )}
  </div>
);

/** Timestamp helper for log lines. */
export const now = (): string => new Date().toLocaleTimeString("en-GB", { hour12: false });

// ── Integration strip (ML fusion · DB · blockchain) ──────────────────────────

/**
 * Shows that a security verdict is wired into the rest of the engine rather
 * than being an isolated score: the behavioural ML risk it was fused with, the
 * persisted session row, and the Hyperledger anchor.
 *
 * `onChain === false` is displayed honestly (Fabric is a documented graceful-
 * degradation path) rather than being hidden or faked.
 */
export const IntegrationStrip: React.FC<{
  behavioralRisk?: number | null;
  securityRisk?: number | null;
  fusedRisk?: number | null;
  fusedDecision?: string | null;
  persistedSessionId?: string | null;
  anchor?: { on_chain: boolean; digest?: string; latency_ms?: number | null; reason?: string | null } | null;
}> = ({ behavioralRisk, securityRisk, fusedRisk, fusedDecision, persistedSessionId, anchor }) => (
  <div
    style={{
      marginTop: 14, padding: "13px 15px", borderRadius: 10,
      background: "rgba(91, 91, 168,0.05)",
      border: "1px solid rgba(91, 91, 168,0.22)",
    }}
  >
    <div
      style={{
        fontSize: 11.5, color: MUTED, letterSpacing: "0.1em",
        textTransform: "uppercase", marginBottom: 9, fontFamily: "'Inter', sans-serif",
      }}
    >
      Engine integration
    </div>

    <StatRow
      label="Behavioural ML risk"
      value={behavioralRisk == null ? "not supplied" : String(behavioralRisk)}
      color={behavioralRisk == null ? MUTED : "rgba(16, 15, 15,0.75)"}
    />
    <StatRow label="Security gate risk" value={securityRisk == null ? "—" : String(securityRisk)} color="rgba(16, 15, 15,0.75)" />
    <StatRow
      label="Fused → decision"
      value={
        fusedRisk == null
          ? "—"
          : `${fusedRisk} → ${fusedDecision ?? "—"}`
      }
      color={fusedDecision === "HARD_BLOCK" ? BAD : fusedDecision === "STEP_UP" ? WARN : OK}
    />
    <StatRow
      label="Persisted session"
      value={persistedSessionId ? `${persistedSessionId.slice(0, 8)}… ✓` : "not persisted"}
      color={persistedSessionId ? OK : MUTED}
    />
    <StatRow
      label="Hyperledger anchor"
      value={
        <VerdictBadge
          state={anchor?.on_chain ? "pass" : "neutral"}
          text={
            anchor?.on_chain
              ? `ON-CHAIN${anchor.latency_ms ? ` · ${anchor.latency_ms}ms` : ""}`
              : (anchor?.reason === "not_a_block" ? "N/A (not a block)" : "OFF-CHAIN")
          }
        />
      }
    />
    {anchor?.on_chain && anchor.digest && (
      <div style={{ marginTop: 7, fontFamily: C.mono, fontSize: 11.5, color: MUTED, wordBreak: "break-all", lineHeight: 1.6 }}>
        verdict digest {anchor.digest}
      </div>
    )}
  </div>
);

// ── Split compare (attack vs defence) ────────────────────────────────────────

export const SplitCompare: React.FC<{
  left: { title: string; state: StepState; children: React.ReactNode };
  right: { title: string; state: StepState; children: React.ReactNode };
}> = ({ left, right }) => (
  <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 12, marginBottom: 14 }}>
    {[left, right].map((side, i) => (
      <div
        key={i}
        style={{
          borderRadius: 10, padding: "13px 15px",
          background: "#FFFFFF",
          border: `1px solid color-mix(in oklch, ${stateColor(side.state)} 26%, transparent)`,
          borderLeft: `3px solid ${stateColor(side.state)}`,
        }}
      >
        <div
          style={{
            fontFamily: C.mono, fontSize: 12, fontWeight: 700,
            color: stateColor(side.state), letterSpacing: "0.07em",
            textTransform: "uppercase", marginBottom: 9,
          }}
        >
          {side.title}
        </div>
        {side.children}
      </div>
    ))}
  </div>
);
