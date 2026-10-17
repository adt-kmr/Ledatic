-- Add SECURITY_GATE to sessions.pathway CHECK constraint.
--
-- The four advanced-security modules (deception, replay/anti-spoof, PQC shield,
-- zk passport) now persist their verdicts as first-class sessions so they are
-- visible in the FIU fraud worklist and the blockchain ledger feed.
--
-- SECURITY_GATE is deliberately a DISTINCT pathway rather than being folded
-- into ML_FULL: the ledger feed and analytics queries filter on
-- pathway = 'ML_FULL' to identify behavioural blocks, and reusing that value
-- would misattribute security-gate blocks as ML detections.
--
-- Safe to run on existing databases (idempotent).

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_pathway_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_pathway_check
  CHECK (pathway IN ('SMART_CONTRACT', 'COERCION_ENRICHMENT', 'ML_FULL', 'FALLBACK', 'ADMIN_BLOCK', 'SECURITY_GATE'));
