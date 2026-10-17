// Citadel — Advanced Security Verdict panel
// =============================================
// Renders the composite verdict from POST /api/security/evaluate: the four
// advanced-cybersecurity modules (deception, replay, micro-tremor, PQC/zk) plus
// the Dilithium-3 signature over the verdict. Purely presentational.

import React from "react";
import type { SecurityVerdict } from "../lib/securityApi";

const OK = "#3D8B5A";
const WARN = "#C7892B";
const BAD = "#B8352C";
const MUTED = "rgba(20, 19, 19,0.4)";

function statusColor(v: string): string {
  const s = v.toUpperCase();
  if (["CLEAN", "FRESH_SIGNED", "HUMAN_TREMOR_BAND"].some((k) => s.includes(k))) return OK;
  if (["TRAP", "BLACKLIST", "REPLAY", "BAD_SIGNATURE", "OUT_OF_HUMAN"].some((k) => s.includes(k))) return BAD;
  if (["UNSIGNED", "NEUTRAL", "NO_"].some((k) => s.includes(k))) return MUTED;
  return WARN;
}

interface RowProps { label: string; value: string; color?: string; }
const Row: React.FC<RowProps> = ({ label, value, color }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #EAE4E1" }}>
    <span style={{ fontSize: 11, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Inter', sans-serif" }}>{label}</span>
    <span style={{ fontSize: 12, fontWeight: 700, color: color ?? "#100F0F", fontFamily: "monospace" }}>{value}</span>
  </div>
);

export const SecurityVerdictPanel: React.FC<{ verdict: SecurityVerdict }> = ({ verdict }) => {
  const cv = verdict.cyber_verdicts || {};
  const dec = String(cv["deception_status"] ?? "—");
  const rep = String(cv["replay_status"] ?? "—");
  const pqc = String(cv["pqc_shield"] ?? "—");
  const fft = cv["micro_tremor_fft"] as { is_human: boolean | null; tremor_ratio?: number; reason?: string } | undefined;
  const zk = cv["zkp_passport_verified"];

  const fftText = !fft || fft.is_human === null
    ? "NEUTRAL"
    : fft.is_human ? `HUMAN (${fft.tremor_ratio})` : `SYNTHETIC (${fft.tremor_ratio})`;
  const zkText = zk === null || zk === undefined ? "NOT PROVIDED" : zk ? "VERIFIED" : "INVALID";

  return (
    <div style={{
      marginTop: 16, padding: "16px 18px", borderRadius: 16,
      background: "#FFFFFF", border: "1px solid #EAE4E1",
      backdropFilter: "blur(12px)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#100F0F", letterSpacing: "0.06em" }}>
          🛡️ Advanced Security
        </span>
        <span style={{ fontSize: 12, fontWeight: 800, color: statusColor(verdict.decision), fontFamily: "monospace" }}>
          {verdict.decision} · {verdict.security_risk_score}
        </span>
      </div>
      <Row label="Deception" value={dec} color={statusColor(dec)} />
      <Row label="Replay Guard" value={rep} color={statusColor(rep)} />
      <Row label="Micro-Tremor FFT" value={fftText} color={fft?.is_human === false ? BAD : fft?.is_human ? OK : MUTED} />
      <Row
        label="PQC Shield"
        value={pqc.includes("MLKEM") ? `${pqc}${verdict.pqc_kem_verified ? " ✓" : ""}` : pqc}
        color={pqc.includes("MLKEM") || pqc.includes("SIGNED") ? OK : pqc.includes("FAILED") ? BAD : WARN}
      />
      <Row label="zk-SNARK Passport" value={zkText} color={zk ? OK : MUTED} />
      {verdict.dilithium_signature && (
        <div style={{ marginTop: 10, fontSize: 10, color: MUTED, fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.5 }}>
          <span style={{ color: OK }}>{verdict.pqc_algorithm} sig:</span>{" "}
          {verdict.dilithium_signature.slice(0, 48)}…
        </div>
      )}
    </div>
  );
};

export default SecurityVerdictPanel;
