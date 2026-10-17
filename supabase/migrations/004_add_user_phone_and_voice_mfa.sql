-- Voice MFA at registration (Vapi outbound call).
--
-- 1. users.phone_number — the customer's OWN number. The existing
--    emergency_contact_*_phone columns hold OTHER people's numbers (next of kin
--    for the duress flow), so they cannot be used to call the customer.
--    Stored in E.164 (+911234567890) so it can be dialled without reformatting.
--
-- 2. voice_mfa_verification — one row per verification attempt. Keyed by the
--    Vapi call id so the webhook can find its row when the call ends.
--
-- Safe to run on existing databases (idempotent).

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR;

CREATE TABLE IF NOT EXISTS voice_mfa_verification (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
    customer_hash     VARCHAR NOT NULL,
    -- Vapi's call id. Nullable because the row is created BEFORE the call is
    -- placed, so a provider failure still leaves an auditable record.
    call_id           VARCHAR UNIQUE,
    phone_number      VARCHAR,

    -- PENDING → the call is in flight
    -- VERIFIED / FAILED / NO_ANSWER / ERROR → terminal
    status            VARCHAR NOT NULL DEFAULT 'PENDING',

    -- The three yes/no answers. NULL = not answered / not reached.
    -- TRUE is always the "safe" answer for all three.
    q1_registered     BOOLEAN,   -- did you just register?
    q2_not_coerced    BOOLEAN,   -- acting on your own, nobody instructing you?
    q3_location_match BOOLEAN,   -- are you in the city we registered you from?

    risk_score        INTEGER DEFAULT 0,     -- 0-1000, fused with the engine
    decision          VARCHAR,               -- APPROVE | STEP_UP | HARD_BLOCK
    failure_reason    VARCHAR,               -- which question failed, or why
    transcript        TEXT,
    recording_url     VARCHAR,
    structured_data   JSONB,                 -- raw extraction from Vapi
    expected_city     VARCHAR,               -- what Q3 was asked against

    created_at        TIMESTAMPTZ DEFAULT NOW(),
    completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_voice_mfa_customer_hash ON voice_mfa_verification (customer_hash);
CREATE INDEX IF NOT EXISTS idx_voice_mfa_created_at ON voice_mfa_verification (created_at DESC);
