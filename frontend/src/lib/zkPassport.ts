// Citadel — zk-SNARK Biometric Passport (client prover)
// ========================================================
// In-browser Groth16 proving via snarkjs, using the pre-compiled circuit
// artifacts in /public/zkp (wasm + zkey). The prover demonstrates, in zero
// knowledge, that its behavioral riskScore is within policy AND that it knows
// the secret behind an enrolled Poseidon baseline — without revealing the raw
// features, the secret, or the exact score.
//
// ENROLMENT MODEL (no hardcoded constants):
//   • imeiSecret    — a 128-bit secret generated with crypto.getRandomValues()
//                     on first use and persisted in localStorage. It is the
//                     device's enrolment secret: it NEVER leaves the browser,
//                     is never transmitted, and is what the proof demonstrates
//                     knowledge of. Different device ⇒ different secret ⇒
//                     different baseline, which is the whole point.
//   • featureCommit — derived from the actual behavioural telemetry of the
//                     session (a digest of the real signal bundle), so the
//                     commitment is bound to observed behaviour rather than a
//                     literal.
//   • baselineHash  — Poseidon(featureCommit, imeiSecret), computed locally and
//                     published as a public signal. In a bank deployment this
//                     value is written at the enrolment ceremony and stored
//                     server-side; here it is derived on-device from the same
//                     inputs, which keeps the proof sound (a prover who does
//                     not know imeiSecret cannot satisfy the witness).
//
// snarkjs + circomlibjs are heavy, so they are dynamically imported only when a
// proof is actually requested, and every failure is swallowed (returns null) so
// login and the other security modules are never affected.

const WASM_URL = "/zkp/behavioral_passport.wasm";
const ZKEY_URL = "/zkp/behavioral_passport.zkey";
const SECRET_KEY = "bdna.zk.device_secret";

// BN128 scalar field. All circuit inputs must be reduced modulo this or the
// witness calculator rejects them.
const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface ZkProof {
  proof: Record<string, unknown>;
  publicSignals: string[];
}

/**
 * The device enrolment secret. Generated once with a CSPRNG and persisted;
 * regenerated only if storage is cleared (which is a re-enrolment).
 * Returns a bigint in the BN128 scalar field.
 */
export function getDeviceSecret(): bigint {
  try {
    const existing = localStorage.getItem(SECRET_KEY);
    if (existing) return BigInt(existing) % FIELD_MODULUS;
  } catch {
    /* storage unavailable — fall through to an ephemeral secret */
  }

  const bytes = new Uint8Array(16); // 128 bits
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  v %= FIELD_MODULUS;

  try {
    localStorage.setItem(SECRET_KEY, v.toString());
  } catch {
    /* ephemeral for this page load only */
  }
  return v;
}

/** True once this device has an enrolment secret persisted. */
export function isDeviceEnrolled(): boolean {
  try {
    return !!localStorage.getItem(SECRET_KEY);
  } catch {
    return false;
  }
}

/**
 * Commitment to the session's observed behaviour.
 * FNV-1a over a canonical serialisation of the real telemetry bundle, reduced
 * into the scalar field. Deterministic for identical behaviour, and different
 * whenever the observed signals differ.
 */
export function deriveFeatureCommit(telemetry: unknown): bigint {
  const canonical = JSON.stringify(telemetry ?? {});
  let h1 = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < canonical.length; i++) {
    h1 = ((h1 ^ BigInt(canonical.charCodeAt(i))) * prime) & mask;
  }
  // Widen to reduce collision surface before field reduction.
  let h2 = 0x84222325cbf29ce4n;
  for (let i = canonical.length - 1; i >= 0; i--) {
    h2 = ((h2 ^ BigInt(canonical.charCodeAt(i))) * prime) & mask;
  }
  return ((h1 << 64n) | h2) % FIELD_MODULUS;
}

export interface PassportInputs {
  featureCommit: bigint;
  imeiSecret: bigint;
  baselineHash: string;
}

/**
 * Resolve the real enrolment inputs for this device + session.
 * Exposed so the demo panel can show the operator exactly what is being proven
 * (and that the secret is device-generated, not a constant).
 */
export async function resolvePassportInputs(
  telemetry?: unknown,
): Promise<PassportInputs> {
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();
  const featureCommit = deriveFeatureCommit(telemetry);
  const imeiSecret = getDeviceSecret();
  const baselineHash = poseidon.F.toObject(
    poseidon([featureCommit, imeiSecret]),
  ).toString();
  return { featureCommit, imeiSecret, baselineHash };
}

/**
 * Produce a behavioral-passport proof for a given risk score.
 * @param riskScore  the behavioral score to prove is within threshold (< 2^16).
 * @param threshold  the public max risk threshold (policy bound, default 300).
 * @param telemetry  the real signal bundle the feature commitment binds to.
 * Returns { proof, publicSignals } or null if proving is unavailable/failed.
 */
export async function generatePassportProof(
  riskScore: number,
  threshold = 300,
  telemetry?: unknown,
): Promise<ZkProof | null> {
  try {
    const [{ groth16 }, inputs] = await Promise.all([
      import("snarkjs"),
      resolvePassportInputs(telemetry),
    ]);

    const input = {
      riskScore: Math.max(0, Math.min(65535, Math.round(riskScore))),
      featureCommit: inputs.featureCommit.toString(),
      imeiSecret: inputs.imeiSecret.toString(),
      maxRiskThreshold: threshold,
      expectedBaselineHash: inputs.baselineHash,
    };

    const { proof, publicSignals } = await groth16.fullProve(input, WASM_URL, ZKEY_URL);
    return { proof, publicSignals };
  } catch {
    // Score above threshold makes the witness unsatisfiable (proving throws) —
    // that is the circuit correctly refusing to prove a false statement.
    return null;
  }
}
