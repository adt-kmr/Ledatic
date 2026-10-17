-- Citadel — Initial Schema
-- Run order: this file is auto-executed by postgres container on first boot

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_id         TEXT        NOT NULL,
  customer_hash   TEXT        NOT NULL UNIQUE,  -- SHA-256(bank_id + customer_id), no PII
  customer_id     TEXT,
  password        TEXT,
  name            TEXT,
  face_image      TEXT,
  auth_provider   TEXT        DEFAULT 'local',
  email           TEXT,
  profile_pic     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── IMEI Registry (local mirror of blockchain) ───────────────────────
CREATE TABLE IF NOT EXISTS imei_registry (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  imei_hash       TEXT        NOT NULL,         -- HMAC-SHA-256(IMEI, salt), never raw
  salt            TEXT        NOT NULL,
  registered_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ── Behavioral Passport (cross-channel profile) ──────────────────────
CREATE TABLE IF NOT EXISTS behavioral_passport (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel          TEXT        NOT NULL CHECK (channel IN ('upi', 'mobile_banking', 'internet_banking')),
  embedding_vector FLOAT[]     NOT NULL DEFAULT '{}',  -- 128-dim BehaveFormer vector
  enrollment_shots INT         DEFAULT 0,
  is_enrolled      BOOLEAN     DEFAULT FALSE,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, channel)
);

-- ── Sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel              TEXT        NOT NULL CHECK (channel IN ('upi', 'mobile_banking', 'internet_banking')),
  signal_bundle_json   JSONB,
  risk_score           INT         CHECK (risk_score BETWEEN 0 AND 1000),
  decision             TEXT        CHECK (decision IN ('APPROVE', 'STEP_UP', 'HARD_BLOCK')),
  pathway              TEXT        CHECK (pathway IN ('SMART_CONTRACT', 'COERCION_ENRICHMENT', 'ML_FULL', 'FALLBACK', 'ADMIN_BLOCK')),
  coercion_probability FLOAT       DEFAULT 0.0 CHECK (coercion_probability BETWEEN 0.0 AND 1.0),
  latency_ms           INT,
  face_image           TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Risk Events (per-session decision audit trail) ───────────────────
CREATE TABLE IF NOT EXISTS risk_events (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id       UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  trigger_type     TEXT        NOT NULL,  -- e.g. 'IMEI_MISMATCH', 'COERCION_DETECTED', 'BEHAVIORAL_DRIFT'
  score            INT,
  pathway          TEXT,
  shap_explanation JSONB,
  timestamp        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Fraud Reports (LangChain agent output) ───────────────────────────
CREATE TABLE IF NOT EXISTS fraud_reports (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  report_text     TEXT,
  risk_score      INT,
  trigger_signals JSONB,
  analyst_action  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sessions_user_id     ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at  ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_session  ON risk_events(session_id);
CREATE INDEX IF NOT EXISTS idx_passport_user        ON behavioral_passport(user_id);
CREATE INDEX IF NOT EXISTS idx_fraud_reports_session ON fraud_reports(session_id);

-- ── QR Code Fraud Scans ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_scans (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID        REFERENCES users(id) ON DELETE SET NULL,
  customer_id         TEXT,
  customer_name       TEXT,
  upi_url             TEXT,
  vpa                 TEXT,
  vpa_handle          TEXT,
  vpa_domain          TEXT,
  payee_name          TEXT,
  amount              TEXT,
  verdict             TEXT        NOT NULL DEFAULT 'UNKNOWN',
  risk_score          INT         DEFAULT 0,
  flags               JSONB,
  scan_source         TEXT,
  vt_stats            JSONB,
  vt_scan_id          TEXT,
  vt_permalink        TEXT,
  qr_image_b64        TEXT,
  payment_attempted   BOOLEAN     DEFAULT FALSE,
  payment_blocked     BOOLEAN     DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_scans_created_at ON qr_scans(created_at DESC);

