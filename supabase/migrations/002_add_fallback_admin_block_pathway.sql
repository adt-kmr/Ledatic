-- Add FALLBACK and ADMIN_BLOCK to sessions.pathway CHECK constraint.
-- Safe to run on existing databases (idempotent).

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_pathway_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_pathway_check
  CHECK (pathway IN ('SMART_CONTRACT', 'COERCION_ENRICHMENT', 'ML_FULL', 'FALLBACK', 'ADMIN_BLOCK'));
