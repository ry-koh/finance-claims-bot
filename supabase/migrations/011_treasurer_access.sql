-- Migration 011: CCA Treasurer Access
-- Adds treasurer role support, pending registration flow, and pending_review claim status.

-- 1. Add status and email columns to finance_team
ALTER TABLE finance_team
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending')),
  ADD COLUMN IF NOT EXISTS email text;

-- 2. Extend the role check to include treasurer
ALTER TABLE finance_team
  DROP CONSTRAINT IF EXISTS finance_team_role_check;
ALTER TABLE finance_team
  ADD CONSTRAINT finance_team_role_check
    CHECK (role IN ('director', 'member', 'treasurer'));

-- 3. Junction table linking treasurers to their CCAs
CREATE TABLE IF NOT EXISTS treasurer_ccas (
  finance_team_id uuid NOT NULL REFERENCES finance_team(id) ON DELETE CASCADE,
  cca_id          uuid NOT NULL REFERENCES ccas(id) ON DELETE CASCADE,
  PRIMARY KEY (finance_team_id, cca_id)
);

-- 4. Add rejection_comment to claims (populated when finance team rejects a submitted claim)
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS rejection_comment text;

-- 5. Extend the claims status check to include pending_review
ALTER TABLE claims
  DROP CONSTRAINT IF EXISTS claims_status_check;
ALTER TABLE claims
  ADD CONSTRAINT claims_status_check
    CHECK (status IN (
      'draft', 'pending_review', 'email_sent', 'screenshot_pending',
      'screenshot_uploaded', 'docs_generated', 'compiled',
      'submitted', 'reimbursed', 'error'
    ));
