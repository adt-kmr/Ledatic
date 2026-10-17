// Citadel — Post-Quantum Key Encapsulation (client)
// =====================================================
// Browser-side ML-KEM-768 (NIST FIPS 203) via the `mlkem` pure-TS library.
// Interop with the server's kyber-py is verified byte-for-byte.
//
// Flow: fetch the server's encapsulation key → encaps() → send the ciphertext to
// /evaluate. The server decapsulates to the same shared secret and returns a
// confirm tag we recompute locally to prove a working post-quantum key exchange.
//
// Best-effort: any failure returns null so login and the other modules proceed
// unaffected (the server then reports pqc_shield=SIGNING_ACTIVE via Dilithium).

import { MlKem768 } from "mlkem";
import { apiUrl } from "./auth";

const CONFIRM_DOMAIN = "citadel-pqc-kem-confirm-v1";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const enc = new TextEncoder();

/** HMAC-SHA256(sharedSecret, DOMAIN) as base64 — mirrors the server's confirm tag. */
async function confirmTag(sharedSecret: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer-backed view to satisfy the BufferSource type.
  const raw = new Uint8Array(sharedSecret);
  const key = await crypto.subtle.importKey(
    "raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(CONFIRM_DOMAIN));
  return bytesToB64(new Uint8Array(mac));
}

export interface KemHandshake {
  ciphertextB64: string;
  /** The tag the server should return if it derived the same secret. */
  expectedConfirmB64: string;
}

/** Verbose handshake for the demo panel — also exposes the derived material. */
export interface KemHandshakeVerbose extends KemHandshake {
  /** Server ML-KEM-768 encapsulation key length (FIPS 203: 1184 bytes). */
  encapsKeyBytes: number;
  ciphertextBytes: number;
  /** The 32-byte shared secret this browser derived, hex-encoded. */
  sharedSecretHex: string;
  sharedSecretBytes: number;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Same handshake as pqcEncapsulate(), but returns the derived key material so
 * the demo panel can display it and prove the browser and server independently
 * arrive at a byte-identical secret. Not used on the login path — the plain
 * pqcEncapsulate() is, so a secret is never surfaced during real auth.
 */
export async function pqcEncapsulateVerbose(): Promise<KemHandshakeVerbose | null> {
  try {
    const res = await fetch(apiUrl("/api/security/pqc/pubkey"));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.available || !data.public_key_b64) return null;

    const ek = b64ToBytes(data.public_key_b64);
    const kem = new MlKem768();
    const [ct, ss] = await kem.encap(ek);
    return {
      ciphertextB64: bytesToB64(ct),
      expectedConfirmB64: await confirmTag(ss),
      encapsKeyBytes: ek.length,
      ciphertextBytes: ct.length,
      sharedSecretHex: bytesToHex(ss),
      sharedSecretBytes: ss.length,
    };
  } catch {
    return null;
  }
}

/**
 * Perform the client half of the PQC handshake: fetch the server ML-KEM-768
 * public key and encapsulate a shared secret. Returns the ciphertext to send
 * plus the confirm tag to compare against the server's response, or null if the
 * KEM is unavailable / fails.
 */
export async function pqcEncapsulate(): Promise<KemHandshake | null> {
  try {
    const res = await fetch(apiUrl("/api/security/pqc/pubkey"));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.available || !data.public_key_b64) return null;

    const ek = b64ToBytes(data.public_key_b64);
    const kem = new MlKem768();
    const [ct, ss] = await kem.encap(ek);
    return {
      ciphertextB64: bytesToB64(ct),
      expectedConfirmB64: await confirmTag(ss),
    };
  } catch {
    return null;
  }
}
