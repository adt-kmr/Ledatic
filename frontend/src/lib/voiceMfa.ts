// Citadel — Voice MFA (Vapi Web SDK) client
// =============================================
// Runs the verification agent IN THE BROWSER over WebRTC instead of placing a
// PSTN call. That removes the phone number entirely, which is what made the
// telephony route unusable here: a free Vapi number cannot dial internationally,
// and a Twilio trial number can only reach pre-verified destinations.
//
// SECURITY — read before changing:
// The browser never reports the ANSWERS. It reports only the Vapi call id.
// The server then fetches that call from Vapi itself and reads the structured
// extraction from the authoritative source. A tampered client can claim a call
// happened; it cannot claim what was said in it. Keep it that way.
//
// The assistant (greeting, the three questions, the extraction schema) is built
// server-side and handed down, so the questions cannot be edited from devtools.

import { apiUrl } from "./auth";

export interface WebStart {
  verification_id: string;
  public_key: string;
  assistant: Record<string, unknown>;
  expected_city: string | null;
}

export interface VoiceVerdict {
  verification_id: string;
  status: "PENDING" | "VERIFIED" | "FAILED" | "NO_ANSWER" | "ERROR" | string;
  decision: "APPROVE" | "STEP_UP" | "HARD_BLOCK" | null;
  risk_score: number;
  q1_registered: boolean | null;
  q2_not_coerced: boolean | null;
  q3_location_match: boolean | null;
  failure_reason: string | null;
  simulated?: boolean;
  /** What the verdict actually did, so the UI can prove a block really blocked. */
  account_blocked?: boolean;
  persisted_session_id?: string | null;
  blockchain_anchor?: {
    on_chain: boolean;
    digest?: string;
    latency_ms?: number | null;
    reason?: string | null;
  } | null;
}

export interface VoiceMfaConfig {
  web_ready: boolean;
  mode: string;
  phone_mode: string;
}

export async function getVoiceConfig(): Promise<VoiceMfaConfig | null> {
  try {
    const r = await fetch(apiUrl("/api/voice-mfa/config"));
    return r.ok ? ((await r.json()) as VoiceMfaConfig) : null;
  } catch {
    return null;
  }
}

/** Open a verification and get the server-built assistant to run in-browser. */
export async function startWebVerification(params: {
  customerId?: string;
  customerHash?: string;
  name?: string;
  /** 'registration' (default) or 'login' — selects the question set. */
  purpose?: "registration" | "login";
  /** Sensor truth: did the device fingerprint match? Cross-checked on login. */
  usualDevice?: boolean;
}): Promise<WebStart | null> {
  try {
    const r = await fetch(apiUrl("/api/voice-mfa/web/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: params.customerId ?? null,
        customer_hash: params.customerHash ?? null,
        name: params.name ?? null,
        purpose: params.purpose ?? "registration",
        usual_device: params.usualDevice ?? null,
      }),
    });
    return r.ok ? ((await r.json()) as WebStart) : null;
  } catch {
    return null;
  }
}

/**
 * Finalise the verification. Sends only the call id — the server re-reads the
 * conversation from Vapi and decides. Never send answers from here.
 */
export async function completeWebVerification(
  verificationId: string,
  callId: string | null,
): Promise<VoiceVerdict | null> {
  try {
    const r = await fetch(apiUrl("/api/voice-mfa/web/complete"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verification_id: verificationId, call_id: callId }),
    });
    return r.ok ? ((await r.json()) as VoiceVerdict) : null;
  } catch {
    return null;
  }
}

// ── Phone-call mode ──────────────────────────────────────────────────────────

export interface PhoneStart {
  verification_id: string;
  call_id: string | null;
  status: string;
  simulated: boolean;
  expected_city: string | null;
  message: string;
}

/**
 * Place a real outbound PSTN call. Needs a phone number on file (or passed in)
 * and a Vapi phone number configured server-side.
 */
export async function startPhoneVerification(params: {
  customerId?: string;
  customerHash?: string;
  name?: string;
  phoneNumber?: string;
}): Promise<{ ok: true; data: PhoneStart } | { ok: false; error: string }> {
  try {
    const r = await fetch(apiUrl("/api/voice-mfa/initiate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: params.customerId ?? null,
        customer_hash: params.customerHash ?? null,
        name: params.name ?? null,
        phone_number: params.phoneNumber || null,
      }),
    });
    if (!r.ok) {
      // Surface the server's reason (no number on file, bad E.164, …) rather
      // than a generic failure — the operator can act on it.
      let msg = `HTTP ${r.status}`;
      try {
        const b = await r.json();
        msg = typeof b?.detail === "string" ? b.detail
          : Array.isArray(b?.detail) ? b.detail[0]?.msg ?? msg : msg;
      } catch { /* keep the status */ }
      return { ok: false, error: msg };
    }
    return { ok: true, data: (await r.json()) as PhoneStart };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

/**
 * Poll a verification until it reaches a terminal state.
 *
 * Phone calls resolve through this rather than the webhook: Vapi cannot POST
 * to localhost, so without a public VAPI_SERVER_URL the webhook never lands.
 * The status endpoint re-reads the call from Vapi itself, so polling gets the
 * same authoritative answers.
 */
export async function pollVerification(
  verificationId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onTick?: (s: VoiceVerdict) => void } = {},
): Promise<VoiceVerdict | null> {
  const { intervalMs = 4000, timeoutMs = 180000, onTick } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(apiUrl(`/api/voice-mfa/status/${verificationId}`));
      if (r.ok) {
        const v = (await r.json()) as VoiceVerdict;
        onTick?.(v);
        if (v.status !== "PENDING") return v;
      }
    } catch { /* transient — keep polling until the deadline */ }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return null;
}

/** Demo control — resolve a verification without running a real call. */
export async function simulateVerification(
  verificationId: string,
  answers: { q1?: boolean | null; q2?: boolean | null; q3?: boolean | null },
): Promise<VoiceVerdict | null> {
  try {
    const r = await fetch(apiUrl(`/api/voice-mfa/simulate/${verificationId}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q1_registered: answers.q1 ?? null,
        q2_not_coerced: answers.q2 ?? null,
        q3_location_match: answers.q3 ?? null,
      }),
    });
    return r.ok ? ((await r.json()) as VoiceVerdict) : null;
  } catch {
    return null;
  }
}
