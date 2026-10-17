-- Voice MFA now runs at LOGIN as well as registration, and the login variant
-- cross-checks the caller's answer against the device fingerprint.
--
--   purpose       'registration' | 'login' — which question set was asked.
--   usual_device  what the SENSORS said at call time (device fingerprint
--                 matched the baseline). q3_location_match holds what the
--                 CALLER said. A caller claiming "usual device" while this is
--                 false is the contradiction that indicates a SIM-swap style
--                 takeover, so both sides must be stored to justify the verdict
--                 after the fact.
--
-- Safe to run on existing databases (idempotent).

ALTER TABLE voice_mfa_verification ADD COLUMN IF NOT EXISTS purpose VARCHAR DEFAULT 'registration';
ALTER TABLE voice_mfa_verification ADD COLUMN IF NOT EXISTS usual_device BOOLEAN;
