import { useState, useEffect } from "react";
import { adminFetch } from "../../../admin/adminAuth";
import { Pill } from "../../ui/Pill";
import { C } from "../../../lib/theme";

interface Thresholds {
  stepup_threshold: number;
  block_threshold: number;
  coercion_stepup_threshold: number;
}

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 12,
  border: "1px solid #D7D2D0",
  background: "rgba(16, 15, 15,0.04)",
  color: "#100F0F",
  fontSize: 14,
  fontFamily: "'DM Mono', monospace",
  outline: "none",
};

const UI_LABEL: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: "#767270",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontFamily: "'Inter', sans-serif",
};

export function ThresholdSettings() {
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminFetch("/api/admin/config/thresholds")
      .then((r) => r.json())
      .then(setThresholds)
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!thresholds) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminFetch("/api/admin/config/thresholds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepup_threshold: +thresholds.stepup_threshold,
          block_threshold: +thresholds.block_threshold,
          coercion_stepup_threshold: +thresholds.coercion_stepup_threshold,
        }),
      });
      if (r.status === 422) {
        setMsg("Invalid: step-up must be < block.");
        return;
      }
      if (!r.ok) {
        setMsg("Update failed.");
        return;
      }
      setThresholds(await r.json());
      setMsg("Saved — live now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="glass-card"
      style={{
        padding: "22px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontFamily: "'Newsreader', Georgia, serif",
            fontSize: 21,
            fontWeight: 400,
            color: "#100F0F",
          }}
        >
          Risk Decision Thresholds
        </div>
        <Pill text="LIVE" color="#3D8B5A" />
      </div>

      {!thresholds && (
        <div style={{ fontSize: 13.5, color: "#767270" }}>
          Loading...
        </div>
      )}

      {thresholds && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={UI_LABEL}>Step-up at risk ≥</span>
              <input
                type="number"
                step="1"
                value={thresholds.stepup_threshold}
                onChange={(e) =>
                  setThresholds({
                    ...thresholds,
                    stepup_threshold: +e.target.value,
                  })
                }
                style={{ ...INPUT_STYLE, borderLeft: `2px solid ${C.amber}` }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={UI_LABEL}>Hard-block at risk ≥</span>
              <input
                type="number"
                step="1"
                value={thresholds.block_threshold}
                onChange={(e) =>
                  setThresholds({
                    ...thresholds,
                    block_threshold: +e.target.value,
                  })
                }
                style={{ ...INPUT_STYLE, borderLeft: `2px solid ${C.red}` }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={UI_LABEL}>Coercion step-up at prob ≥</span>
              <input
                type="number"
                step="0.01"
                value={thresholds.coercion_stepup_threshold}
                onChange={(e) =>
                  setThresholds({
                    ...thresholds,
                    coercion_stepup_threshold: +e.target.value,
                  })
                }
                style={{ ...INPUT_STYLE, borderLeft: `2px solid ${C.blue}` }}
              />
            </div>
          </div>

          <button
            onClick={save}
            disabled={busy}
            style={{
              padding: "11px 18px",
              borderRadius: 12,
              border: "none",
              background: "var(--color-primary)",
              color: "var(--color-on-primary)",
              fontWeight: 400,
              fontSize: 20,
              fontFamily: "'Newsreader', Georgia, serif",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
              boxShadow:
                "0 4px 16px color-mix(in oklch, var(--color-primary) 30%, transparent)",
              width: "100%",
            }}
          >
            {busy ? "Saving..." : "Apply Live"}
          </button>

          {msg && (
            <div
              style={{
                fontSize: 14,
                color: msg.startsWith("Saved") ? C.green : C.red,
              }}
            >
              {msg}
            </div>
          )}
        </>
      )}
    </div>
  );
}
