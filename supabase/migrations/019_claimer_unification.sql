-- Migration 019: Claimer/CCA Treasurer Unification
-- Replaces claimers table with direct finance_team references on claims.

-- 1. Drop old FK from claims.claimer_id → claimers
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_claimer_id_fkey;

-- 2. Make claimer_id nullable (treasurer creates claim → server sets it to their own id;
--    one-off claimers have no claimer_id)
ALTER TABLE claims ALTER COLUMN claimer_id DROP NOT NULL;

-- 3. Add new FK: claims.claimer_id → finance_team(id)
ALTER TABLE claims
  ADD CONSTRAINT claims_claimer_id_fkey
    FOREIGN KEY (claimer_id) REFERENCES finance_team(id) ON DELETE RESTRICT;

-- 4. Add cca_id to claims (required for reference code generation and display)
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS cca_id uuid REFERENCES ccas(id) ON DELETE RESTRICT;

-- 5. Add inline one-off claimer fields
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS one_off_name        text,
  ADD COLUMN IF NOT EXISTS one_off_matric_no   text,
  ADD COLUMN IF NOT EXISTS one_off_phone       text,
  ADD COLUMN IF NOT EXISTS one_off_email       text;

-- 6. Ensure every claim has either a linked treasurer OR a one-off name
ALTER TABLE claims
  ADD CONSTRAINT claims_claimer_check
    CHECK (claimer_id IS NOT NULL OR one_off_name IS NOT NULL);

-- 7. Drop the claimers table (no longer used)
DROP TABLE IF EXISTS claimers;
