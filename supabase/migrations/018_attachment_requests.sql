-- Extend claims status CHECK to include attachment statuses
ALTER TABLE claims
  DROP CONSTRAINT IF EXISTS claims_status_check;
ALTER TABLE claims
  ADD CONSTRAINT claims_status_check
    CHECK (status IN (
      'draft', 'pending_review', 'email_sent', 'screenshot_pending',
      'screenshot_uploaded', 'docs_generated', 'compiled',
      'submitted', 'attachment_requested', 'attachment_uploaded',
      'reimbursed', 'error'
    ));

-- Request cycles: one row per round of director flagging
CREATE TABLE claim_attachment_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  director_id uuid NOT NULL REFERENCES finance_team(id) ON DELETE CASCADE,
  request_message text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Individual files uploaded per request cycle
CREATE TABLE claim_attachment_files (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id uuid NOT NULL REFERENCES claim_attachment_requests(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  original_filename text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_claim_attachment_requests_claim ON claim_attachment_requests(claim_id);
CREATE INDEX idx_claim_attachment_files_request ON claim_attachment_files(request_id);
