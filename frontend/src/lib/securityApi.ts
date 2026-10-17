// Citadel — Advanced Security API client
// ===========================================
// Thin wrappers over the /api/security/* backend (the four advanced modules).
// Every call is best-effort: a failure here must never block the login flow,
// so callers should treat rejections as "module unavailable", not "denied".

import { apiUrl } from "./auth";
import { pqcEncapsulate } from "./pqcKem";
import { generatePassportProof } from "./zkPassport";

export interface HoneypotResult {
  status: string;
  decision: "HARD_BLOCK" | string;
  risk_score: number;
  blacklisted: boolean;
}

/** Report that an invisible honeypot form field was filled (bot signal). */
export async function reportHoneypot(
  sessionId: string | null,
  trapName: string,
  valueLen: number,
): Promise<HoneypotResult | null> {
  try {
    const res = await fetch(apiUrl("/api/security/honeypot/report"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, trap_name: trapName, value_len: valueLen }),
    });
    if (!res.ok) return null;
    return (await res.json()) as HoneypotResult;
  } catch {
    return null;
  }
}

/** URL for the live deception SSE stream (consumed by the FIU panel). */
export function threatStreamUrl(): string {
  return apiUrl("/api/security/threat-stream");
}

export interface DeceptionStatus {
  recent_traps: Array<Record<string, unknown>>;
  your_ip_blacklisted: boolean;
  decoy_endpoints_armed: boolean;
}

export async function getDeceptionStatus(): Promise<DeceptionStatus | null> {
  try {
    const res = await fetch(apiUrl("/api/security/status"));
    if (!res.ok) return null;
    // A blacklisted caller gets 403 with {detail: "..."} rather than a status
    // body — surface that as "blacklisted" instead of a generic failure so the
    // demo panel can tell the operator exactly why everything went quiet.
    return (await res.json()) as DeceptionStatus;
  } catch {
    return null;
  }
}

/** The decoy paths armed server-side (app/services/deception.py DECOY_PATHS). */
export const DECOY_PATHS = [
  "/api/v1/debug/dump_keys",
  "/api/v1/admin/export_users",
  "/api/v1/internal/config",
  "/.env",
  "/api/v1/admin/backup.sql",
] as const;

export interface DecoyProbeResult {
  path: string;
  httpStatus: number;
  trapped: boolean;
}

/**
 * Probe a decoy endpoint exactly as an attacker's scanner would.
 * A 403 here is SUCCESS for the demo — it means the trap sprang and this host
 * is now blacklisted (call resetDeception() to recover).
 */
export async function probeDecoy(path: string): Promise<DecoyProbeResult> {
  try {
    const res = await fetch(apiUrl(path), { method: "GET" });
    return { path, httpStatus: res.status, trapped: res.status === 403 };
  } catch {
    return { path, httpStatus: 0, trapped: false };
  }
}

/**
 * Clear the deception blacklist so the demo can be re-run.
 * Exempt from the blacklist middleware server-side, so it still works while
 * blocked — this is the failsafe that prevents an on-stage self-lockout.
 */
export async function resetDeception(all = false): Promise<boolean> {
  try {
    const res = await fetch(
      apiUrl(`/api/security/deception/reset${all ? "?all=true" : ""}`),
      { method: "POST" },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ── zk-SNARK passport verification ───────────────────────────────────────────

export interface ZkParams {
  available: boolean;
  protocol: string;
  curve: string;
  max_risk_threshold: number;
  public_signal_order: string[];
}

export async function getZkParams(): Promise<ZkParams | null> {
  try {
    const res = await fetch(apiUrl("/api/security/zkp/params"));
    if (!res.ok) return null;
    return (await res.json()) as ZkParams;
  } catch {
    return null;
  }
}

/** Standalone Groth16 verification — used to show valid vs tampered proofs. */
export async function verifyZkProof(
  proof: Record<string, unknown>,
  publicSignals: string[],
): Promise<{ verified: boolean; available: boolean } | null> {
  try {
    const res = await fetch(apiUrl("/api/security/zkp/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof, publicSignals }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { verified: boolean; available: boolean };
  } catch {
    return null;
  }
}

// ── Phase 2: Anti-Spoofing (replay-resistant signing + FFT motion) ────────────

export interface NonceResponse { nonce: string; session_key: string; ttl: number; }

/** Request a single-use nonce + ephemeral session key from the server. */
export async function getNonce(): Promise<NonceResponse | null> {
  try {
    const res = await fetch(apiUrl("/api/security/nonce"), { method: "POST" });
    if (!res.ok) return null;
    return (await res.json()) as NonceResponse;
  } catch {
    return null;
  }
}

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 hex of a stable JSON stringification of the bundle. */
export async function sha256Hex(bundle: unknown): Promise<string> {
  const data = enc.encode(JSON.stringify(bundle));
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

/** HMAC-SHA256(sessionKey, `${nonce}|${digest}`) — matches the server verifier. */
export async function hmacHex(sessionKey: string, nonce: string, digest: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(sessionKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${nonce}|${digest}`));
  return toHex(sig);
}

export interface BlockchainAnchor {
  on_chain: boolean;
  digest?: string;
  user_key?: string;
  latency_ms?: number | null;
  reason?: string | null;
}

export interface SecurityVerdict {
  status: string;
  decision: "APPROVE" | "STEP_UP" | "HARD_BLOCK" | string;
  security_risk_score: number;
  cyber_verdicts: Record<string, unknown>;
  notes: string[];
  pqc_algorithm: string | null;
  pqc_kem_confirm: string | null;
  dilithium_signature: string | null;
  /** Client-side check: did the server's KEM confirm match our own secret? */
  pqc_kem_verified?: boolean;
  // ── integration surface (see services/security_integration.py) ──
  /** The behavioural ML risk that was fused in, echoed back. */
  behavioral_risk?: number | null;
  /** max(behavioural ML risk, security gate risk) — the effective risk. */
  fused_risk_score?: number;
  /** Decision derived from the fused score. */
  fused_decision?: string;
  /** UUID of the persisted `sessions` row (visible in the FIU worklist). */
  persisted_session_id?: string | null;
  /** Hyperledger Fabric anchoring result for HARD_BLOCK verdicts. */
  blockchain_anchor?: BlockchainAnchor;
}

export interface SecurityEvaluateParams {
  sessionId: string;
  telemetryBundle: Record<string, unknown>;
  motionValues?: number[];
  motionTimestamps?: number[];
  honeypotInteracted?: boolean;
  /** Behavioral risk score to prove is within threshold via zk-SNARK. */
  riskScore?: number;
  /** Whether to attempt in-browser zk passport proving (default true). */
  proveZk?: boolean;
  /** Identity this verdict belongs to — enables DB attribution + on-chain anchoring. */
  customerHash?: string | null;
  /** Behavioural ML risk to fuse with the security-gate risk. */
  behavioralRisk?: number | null;
  /** Set false to evaluate without writing a session row / ledger anchor. */
  persist?: boolean;
}

/**
 * Low-level /evaluate call with a caller-supplied replay proof.
 * Used by the Anti-Spoofing demo panel to deliberately submit a REPLAYED nonce
 * or a TAMPERED digest and show the server rejecting each — the normal
 * securityEvaluate() below always builds a fresh, valid proof, so it cannot
 * demonstrate the failure modes.
 */
export async function securityEvaluateRaw(body: {
  sessionId: string;
  nonce?: string | null;
  bundleDigest?: string | null;
  signature?: string | null;
  telemetryBundle?: Record<string, unknown>;
  motionValues?: number[];
  motionTimestamps?: number[] | null;
}): Promise<SecurityVerdict | null> {
  try {
    const res = await fetch(apiUrl("/api/security/evaluate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: body.sessionId,
        honeypot_vector: { field_interacted: false },
        replay_proof: {
          nonce: body.nonce ?? null,
          bundle_digest: body.bundleDigest ?? null,
          signature: body.signature ?? null,
        },
        motion_signal: {
          values: body.motionValues ?? [],
          timestamps: body.motionTimestamps ?? null,
        },
        telemetry_bundle: body.telemetryBundle ?? {},
        pqc_ciphertext: null,
        zk_proof: null,
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as SecurityVerdict;
  } catch {
    return null;
  }
}

/**
 * Run the unified advanced-security evaluation:
 *   1. fetch a single-use nonce + session key
 *   2. sign (nonce || sha256(bundle)) with the session key (replay resistance)
 *   3. POST everything to /api/security/evaluate
 * Best-effort: returns null on any failure so it can never block real login.
 */
export async function securityEvaluate(p: SecurityEvaluateParams): Promise<SecurityVerdict | null> {
  try {
    const nres = await fetch(apiUrl("/api/security/nonce"), { method: "POST" });
    if (!nres.ok) return null;
    const { nonce, session_key } = (await nres.json()) as NonceResponse;

    const digest = await sha256Hex(p.telemetryBundle);
    const signature = await hmacHex(session_key, nonce, digest);

    // Post-quantum key exchange + zk passport proof, in parallel (both
    // best-effort; null if the module is unavailable or the score is out of
    // policy, in which case the server records a NEUTRAL verdict).
    const [kem, zk] = await Promise.all([
      pqcEncapsulate(),
      p.proveZk === false
        ? Promise.resolve(null)
        // Bind the passport commitment to the REAL telemetry of this session.
        : generatePassportProof(p.riskScore ?? 0, 300, p.telemetryBundle),
    ]);

    const res = await fetch(apiUrl("/api/security/evaluate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: p.sessionId,
        honeypot_vector: { field_interacted: !!p.honeypotInteracted },
        replay_proof: { nonce, bundle_digest: digest, signature },
        motion_signal: { values: p.motionValues ?? [], timestamps: p.motionTimestamps ?? null },
        telemetry_bundle: p.telemetryBundle,
        pqc_ciphertext: kem?.ciphertextB64 ?? null,
        zk_proof: zk,
        customer_hash: p.customerHash ?? null,
        behavioral_risk: p.behavioralRisk ?? null,
        persist: p.persist !== false,
      }),
    });
    if (!res.ok) return null;
    const verdict = (await res.json()) as SecurityVerdict;

    // Verify mutual PQC agreement: server's confirm tag must equal ours.
    if (kem && verdict.pqc_kem_confirm) {
      verdict.pqc_kem_verified = kem.expectedConfirmB64 === verdict.pqc_kem_confirm;
    }
    return verdict;
  } catch {
    return null;
  }
}
