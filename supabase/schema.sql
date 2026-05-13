-- Finance Claims Bot — Full Database Schema
-- Run this once on a fresh Supabase project via SQL Editor.

-- ─── Extensions ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE portfolios (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE ccas (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  name         text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  UNIQUE(portfolio_id, name)
);

CREATE TABLE finance_team (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  telegram_id       bigint NOT NULL UNIQUE,
  telegram_username text,
  name              text NOT NULL,
  email             text,
  matric_number     text,
  phone_number      text,
  role              text NOT NULL DEFAULT 'member'
    CHECK (role IN ('director', 'member', 'treasurer')),
  status            text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending')),
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE treasurer_ccas (
  finance_team_id uuid NOT NULL REFERENCES finance_team(id) ON DELETE CASCADE,
  cca_id          uuid NOT NULL REFERENCES ccas(id) ON DELETE CASCADE,
  PRIMARY KEY (finance_team_id, cca_id)
);

CREATE TABLE treasurer_payers (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_treasurer_id uuid NOT NULL REFERENCES finance_team(id) ON DELETE CASCADE,
  name               text NOT NULL,
  email              text NOT NULL,
  deleted_at         timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE TABLE document_counters (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  academic_year text NOT NULL,
  counter       integer NOT NULL DEFAULT 0,
  UNIQUE(academic_year)
);

CREATE TABLE claims (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference_code    text UNIQUE,
  claim_number      integer,
  -- Either claimer_id (registered treasurer) OR one_off_* fields must be set
  claimer_id        uuid REFERENCES finance_team(id) ON DELETE RESTRICT,
  cca_id            uuid REFERENCES ccas(id) ON DELETE RESTRICT,
  one_off_name      text,
  one_off_matric_no text,
  one_off_phone     text,
  one_off_email     text,
  filled_by         uuid REFERENCES finance_team(id) ON DELETE SET NULL,
  processed_by      uuid REFERENCES finance_team(id) ON DELETE SET NULL,
  claim_description text NOT NULL,
  total_amount      numeric(10,2) DEFAULT 0,
  is_partial        boolean NOT NULL DEFAULT false,
  partial_amount    numeric(10,2),
  date              date NOT NULL DEFAULT CURRENT_DATE,
  wbs_account       text NOT NULL CHECK (wbs_account IN ('SA', 'MBH', 'MF', 'OTHERS')),
  wbs_no            text GENERATED ALWAYS AS (
    CASE wbs_account
      WHEN 'SA'  THEN 'H-404-00-000003'
      WHEN 'MBH' THEN 'H-404-00-000004'
      WHEN 'MF'  THEN 'E-404-10-0001-01'
    END
  ) STORED,
  mf_approval_drive_id text,
  mf_approval_drive_ids text[] DEFAULT '{}',
  internal_notes    text,
  treasurer_notes   text,
  remarks           text,
  rejection_comment text,
  transport_data    jsonb,
  transport_form_needed boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'pending_review', 'email_sent', 'screenshot_pending',
      'screenshot_uploaded', 'docs_generated', 'compiled',
      'submitted', 'attachment_requested', 'attachment_uploaded',
      'reimbursed', 'error'
    )),
  error_message     text,
  deleted_at        timestamptz,
  submitted_at      timestamptz,
  reimbursed_at     timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  CONSTRAINT claims_claimer_check
    CHECK (claimer_id IS NOT NULL OR one_off_name IS NOT NULL)
);

CREATE TABLE claim_line_items (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id             uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  line_item_index      integer NOT NULL CHECK (line_item_index >= 1),
  category             text NOT NULL,
  category_code        text,
  gst_code             text NOT NULL DEFAULT 'IE' CHECK (gst_code IN ('IE','I9','L9')),
  dr_cr                text NOT NULL DEFAULT 'DR' CHECK (dr_cr IN ('DR','CR')),
  combined_description text,
  total_amount         numeric(10,2) DEFAULT 0,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  UNIQUE(claim_id, line_item_index),
  UNIQUE(claim_id, category)
);

-- bank_transactions must precede receipts (receipts FK → bank_transactions)
CREATE TABLE bank_transactions (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id   uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  amount     decimal(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE receipts (
  id                              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id                        uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  line_item_id                    uuid REFERENCES claim_line_items(id) ON DELETE SET NULL,
  bank_transaction_id             uuid REFERENCES bank_transactions(id) ON DELETE SET NULL,
  receipt_no                      text,
  description                     text NOT NULL,
  company                         text,
  date                            date,
  amount                          numeric(10,2) NOT NULL,
  claimed_amount                  numeric(10,2),
  payer_id                        uuid REFERENCES treasurer_payers(id) ON DELETE SET NULL,
  payer_name                      text,
  payer_email                     text,
  is_foreign_currency             boolean NOT NULL DEFAULT false,
  exchange_rate_screenshot_drive_id text,
  exchange_rate_screenshot_drive_ids text[] DEFAULT '{}',
  receipt_image_drive_id          text,
  bank_screenshot_drive_id        text,
  created_at                      timestamptz DEFAULT now(),
  updated_at                      timestamptz DEFAULT now()
);

CREATE TABLE receipt_images (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id    uuid NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  drive_file_id text NOT NULL,
  file_size_bytes integer,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE bank_transaction_images (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_transaction_id uuid NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  drive_file_id       text NOT NULL,
  file_size_bytes     integer,
  created_at          timestamptz DEFAULT now()
);

CREATE TABLE bank_transaction_refunds (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_transaction_id uuid NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  amount              decimal(10,2) NOT NULL CHECK (amount > 0),
  drive_file_id       text NOT NULL,
  extra_drive_file_ids text[] DEFAULT '{}',
  file_size_bytes     integer,
  created_at          timestamptz DEFAULT now()
);

CREATE TABLE claim_documents (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id      uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN (
    'loa', 'loa_a', 'loa_b', 'loa_c',
    'summary', 'summary_a', 'summary_b', 'summary_c',
    'rfp', 'rfp_a', 'rfp_b', 'rfp_c',
    'transport', 'email_screenshot', 'compiled'
  )),
  drive_file_id text NOT NULL,
  is_current    boolean NOT NULL DEFAULT true,
  file_size_bytes integer,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE manual_rfp_documents (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by          uuid NOT NULL REFERENCES finance_team(id) ON DELETE CASCADE,
  title               text NOT NULL,
  reference_code      text NOT NULL,
  payee_name          text NOT NULL,
  payee_matric_no     text NOT NULL,
  wbs_no              text NOT NULL,
  total_amount        numeric(12,2) NOT NULL,
  line_items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  drive_file_id       text NOT NULL,
  file_size_bytes     integer,
  sent_to_telegram_at timestamptz,
  created_at          timestamptz DEFAULT now()
);

CREATE TABLE claim_attachment_requests (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id        uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  director_id     uuid NOT NULL REFERENCES finance_team(id) ON DELETE CASCADE,
  request_message text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'accepted', 'rejected')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE claim_attachment_files (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id        uuid NOT NULL REFERENCES claim_attachment_requests(id) ON DELETE CASCADE,
  file_url          text NOT NULL,
  original_filename text NOT NULL,
  file_size_bytes   integer,
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE claim_events (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id   uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES finance_team(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  message    text NOT NULL,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE help_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asker_id      uuid NOT NULL REFERENCES finance_team(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  image_urls    text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE help_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid NOT NULL REFERENCES help_questions(id) ON DELETE CASCADE,
  answerer_id  uuid NOT NULL REFERENCES finance_team(id) ON DELETE CASCADE,
  answer_text  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_claims_status       ON claims(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_claims_claimer      ON claims(claimer_id);
CREATE INDEX idx_claims_filled_by    ON claims(filled_by);
CREATE INDEX idx_claims_deleted      ON claims(deleted_at);
CREATE INDEX idx_receipts_claim      ON receipts(claim_id);
CREATE INDEX idx_receipts_line_item  ON receipts(line_item_id);
CREATE INDEX idx_receipts_bt         ON receipts(bank_transaction_id);
CREATE INDEX idx_receipts_payer      ON receipts(payer_id);
CREATE INDEX idx_treasurer_payers_owner ON treasurer_payers(owner_treasurer_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_treasurer_payers_owner_email_active ON treasurer_payers(owner_treasurer_id, lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX idx_line_items_claim    ON claim_line_items(claim_id);
CREATE INDEX idx_documents_claim     ON claim_documents(claim_id);
CREATE INDEX idx_documents_current   ON claim_documents(claim_id, type) WHERE is_current = true;
CREATE INDEX idx_manual_rfps_created ON manual_rfp_documents(created_at DESC);
CREATE INDEX idx_ccas_portfolio      ON ccas(portfolio_id);
CREATE INDEX idx_finance_team_telegram ON finance_team(telegram_id);
CREATE INDEX idx_receipt_images_receipt  ON receipt_images(receipt_id);
CREATE INDEX idx_bt_images_bt        ON bank_transaction_images(bank_transaction_id);
CREATE INDEX idx_bt_refunds_bt       ON bank_transaction_refunds(bank_transaction_id);
CREATE INDEX idx_bt_claim            ON bank_transactions(claim_id);
CREATE INDEX idx_attachment_requests_claim ON claim_attachment_requests(claim_id);
CREATE INDEX idx_attachment_files_request  ON claim_attachment_files(request_id);
CREATE INDEX idx_claim_events_claim_created ON claim_events(claim_id, created_at);
CREATE INDEX idx_claim_events_type          ON claim_events(event_type);
CREATE INDEX idx_help_questions_asker  ON help_questions(asker_id);
CREATE INDEX idx_help_questions_status ON help_questions(status);
CREATE INDEX idx_help_answers_question ON help_answers(question_id);

-- ─── Functions & Triggers ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_claims_updated_at
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_line_items_updated_at
  BEFORE UPDATE ON claim_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_treasurer_payers_updated_at
  BEFORE UPDATE ON treasurer_payers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_receipts_updated_at
  BEFORE UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Set submitted_at / reimbursed_at when status transitions
CREATE OR REPLACE FUNCTION set_claim_status_dates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted' AND NEW.submitted_at IS NULL THEN
    NEW.submitted_at = now();
  END IF;
  IF NEW.status = 'reimbursed' AND OLD.status IS DISTINCT FROM 'reimbursed' AND NEW.reimbursed_at IS NULL THEN
    NEW.reimbursed_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_claim_status_dates
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION set_claim_status_dates();

-- Recalculate claim.total_amount when receipts change
CREATE OR REPLACE FUNCTION recalculate_claim_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE claims
  SET total_amount = (
    SELECT COALESCE(SUM(COALESCE(claimed_amount, amount)), 0)
    FROM receipts
    WHERE claim_id = COALESCE(NEW.claim_id, OLD.claim_id)
  )
  WHERE id = COALESCE(NEW.claim_id, OLD.claim_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_receipts_recalculate_total
  AFTER INSERT OR UPDATE OR DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION recalculate_claim_total();

-- Recalculate claim_line_item.total_amount when receipts change
CREATE OR REPLACE FUNCTION recalculate_line_item_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.line_item_id, OLD.line_item_id) IS NOT NULL THEN
    UPDATE claim_line_items
    SET total_amount = (
      SELECT COALESCE(SUM(COALESCE(claimed_amount, amount)), 0)
      FROM receipts
      WHERE line_item_id = COALESCE(NEW.line_item_id, OLD.line_item_id)
    )
    WHERE id = COALESCE(NEW.line_item_id, OLD.line_item_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_receipts_recalculate_line_item
  AFTER INSERT OR UPDATE OR DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION recalculate_line_item_total();

-- Atomic document counter (avoids Python read-modify-write race)
CREATE OR REPLACE FUNCTION increment_document_counter(p_year text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_counter integer;
BEGIN
  INSERT INTO document_counters (academic_year, counter)
  VALUES (p_year, 1)
  ON CONFLICT (academic_year)
  DO UPDATE SET counter = document_counters.counter + 1
  RETURNING counter INTO v_counter;
  RETURN v_counter;
END;
$$;

-- Atomic doc-generation lock (prevents duplicate runs; auto-expires after 10 min)
CREATE OR REPLACE FUNCTION claim_start_generation(p_claim_id uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE claims
  SET error_message = '__generating__'
  WHERE id = p_claim_id
    AND (
      error_message IS NULL
      OR error_message != '__generating__'
      OR updated_at < now() - INTERVAL '10 minutes'
    );
  RETURN FOUND;
END;
$$;

-- Analytics: grouped totals
CREATE OR REPLACE FUNCTION analytics_summary(
  p_group_by  text,    -- 'cca' | 'portfolio' | 'fund'
  p_statuses  text[],
  p_date_from date,
  p_date_to   date
)
RETURNS TABLE(name text, portfolio text, total numeric)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_group_by = 'cca' THEN
    RETURN QUERY
      SELECT
        ccas.name::text                AS name,
        portfolios.name::text          AS portfolio,
        SUM(c.total_amount)::numeric   AS total
      FROM claims c
      JOIN ccas       ON ccas.id       = c.cca_id
      JOIN portfolios ON portfolios.id = ccas.portfolio_id
      WHERE c.deleted_at IS NULL
        AND (p_statuses IS NULL OR array_length(p_statuses,1) IS NULL OR c.status = ANY(p_statuses))
        AND (p_date_from IS NULL OR c.date >= p_date_from)
        AND (p_date_to   IS NULL OR c.date <= p_date_to)
      GROUP BY ccas.name, portfolios.name
      ORDER BY portfolios.name ASC, ccas.name ASC;

  ELSIF p_group_by = 'portfolio' THEN
    RETURN QUERY
      SELECT
        portfolios.name::text          AS name,
        NULL::text                     AS portfolio,
        SUM(c.total_amount)::numeric   AS total
      FROM claims c
      JOIN ccas       ON ccas.id       = c.cca_id
      JOIN portfolios ON portfolios.id = ccas.portfolio_id
      WHERE c.deleted_at IS NULL
        AND (p_statuses IS NULL OR array_length(p_statuses,1) IS NULL OR c.status = ANY(p_statuses))
        AND (p_date_from IS NULL OR c.date >= p_date_from)
        AND (p_date_to   IS NULL OR c.date <= p_date_to)
      GROUP BY portfolios.name
      ORDER BY portfolios.name ASC;

  ELSIF p_group_by = 'fund' THEN
    RETURN QUERY
      SELECT
        c.wbs_account::text            AS name,
        NULL::text                     AS portfolio,
        SUM(c.total_amount)::numeric   AS total
      FROM claims c
      WHERE c.deleted_at IS NULL
        AND (p_statuses IS NULL OR array_length(p_statuses,1) IS NULL OR c.status = ANY(p_statuses))
        AND (p_date_from IS NULL OR c.date >= p_date_from)
        AND (p_date_to   IS NULL OR c.date <= p_date_to)
      GROUP BY c.wbs_account
      ORDER BY c.wbs_account ASC;

  ELSE
    RAISE EXCEPTION 'Invalid group_by: %. Must be cca, portfolio, or fund.', p_group_by;
  END IF;
END;
$$;

-- Analytics: SA vs MF breakdown
CREATE OR REPLACE FUNCTION analytics_fund_breakdown(
  p_group_by  text,    -- 'portfolio' | 'cca'
  p_statuses  text[],
  p_date_from date,
  p_date_to   date
)
RETURNS TABLE(name text, portfolio text, sa_total numeric, mf_total numeric)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_group_by = 'portfolio' THEN
    RETURN QUERY
      SELECT
        portfolios.name::text                                                              AS name,
        NULL::text                                                                         AS portfolio,
        COALESCE(SUM(CASE WHEN c.wbs_account = 'SA' THEN c.total_amount END), 0)::numeric AS sa_total,
        COALESCE(SUM(CASE WHEN c.wbs_account = 'MF' THEN c.total_amount END), 0)::numeric AS mf_total
      FROM claims c
      JOIN ccas       ON ccas.id       = c.cca_id
      JOIN portfolios ON portfolios.id = ccas.portfolio_id
      WHERE c.deleted_at IS NULL
        AND (p_statuses IS NULL OR array_length(p_statuses,1) IS NULL OR c.status = ANY(p_statuses))
        AND (p_date_from IS NULL OR c.date >= p_date_from)
        AND (p_date_to   IS NULL OR c.date <= p_date_to)
      GROUP BY portfolios.name
      ORDER BY portfolios.name ASC;

  ELSIF p_group_by = 'cca' THEN
    RETURN QUERY
      SELECT
        ccas.name::text                                                                    AS name,
        portfolios.name::text                                                              AS portfolio,
        COALESCE(SUM(CASE WHEN c.wbs_account = 'SA' THEN c.total_amount END), 0)::numeric AS sa_total,
        COALESCE(SUM(CASE WHEN c.wbs_account = 'MF' THEN c.total_amount END), 0)::numeric AS mf_total
      FROM claims c
      JOIN ccas       ON ccas.id       = c.cca_id
      JOIN portfolios ON portfolios.id = ccas.portfolio_id
      WHERE c.deleted_at IS NULL
        AND (p_statuses IS NULL OR array_length(p_statuses,1) IS NULL OR c.status = ANY(p_statuses))
        AND (p_date_from IS NULL OR c.date >= p_date_from)
        AND (p_date_to   IS NULL OR c.date <= p_date_to)
      GROUP BY ccas.name, portfolios.name
      ORDER BY portfolios.name ASC, ccas.name ASC;

  ELSE
    RAISE EXCEPTION 'Invalid group_by: %. Must be portfolio or cca.', p_group_by;
  END IF;
END;
$$;

-- ─── Seed Data ───────────────────────────────────────────────────────────────

INSERT INTO portfolios (name) VALUES
  ('Culture'), ('Welfare'), ('Sports'), ('Social'),
  ('VPI'), ('RHMP'), ('Media'), ('HGS'), ('VPE'), ('N/A')
ON CONFLICT DO NOTHING;

WITH p AS (SELECT id FROM portfolios WHERE name = 'Culture')
INSERT INTO ccas (portfolio_id, name) SELECT p.id, n FROM p, (VALUES
  ('Culture'), ('RHockerfellas'), ('RH Unplugged'), ('RH Dance'),
  ('RHebels'), ('RHythm'), ('RH Voices'), ('Culture Comm')
) v(n) ON CONFLICT DO NOTHING;

WITH p AS (SELECT id FROM portfolios WHERE name = 'Welfare')
INSERT INTO ccas (portfolio_id, name) SELECT p.id, n FROM p, (VALUES
  ('Welfare'), ('Welfare Comm'), ('RVC SP'), ('RVC Children'),
  ('RVC Pioneers'), ('RVC Special Needs'), ('HeaRHtfelt'), ('Green Comm'), ('B&C')
) v(n) ON CONFLICT DO NOTHING;

WITH p AS (SELECT id FROM portfolios WHERE name = 'Sports')
INSERT INTO ccas (portfolio_id, name) SELECT p.id, n FROM p, (VALUES
  ('Sports'), ('Badminton M'), ('Basketball M'), ('Floorball M'),
  ('Handball M'), ('Soccer M'), ('Swimming M'), ('Squash M'),
  ('Sepak Takraw M'), ('Tennis M'), ('Touch Rugby M'), ('Table Tennis M'),
  ('Volleyball M'), ('SMC'), ('Softball'), ('Track'), ('Road Relay'),
  ('Frisbee'), ('Netball F'), ('Badminton F'), ('Basketball F'),
  ('Floorball F'), ('Handball F'), ('Soccer F'), ('Swimming F'),
  ('Squash F'), ('Tennis F'), ('Touch Rugby F'), ('Table Tennis F'), ('Volleyball F')
) v(n) ON CONFLICT DO NOTHING;

WITH p AS (SELECT id FROM portfolios WHERE name = 'Social')
INSERT INTO ccas (portfolio_id, name) SELECT p.id, n FROM p, (VALUES
  ('Social'), ('Block 2 Comm'), ('Block 3 Comm'), ('Block 4 Comm'),
  ('Block 5 Comm'), ('Block 6 Comm'), ('Block 7 Comm'), ('Block 8 Comm'),
  ('Social Comm'), ('RHSafe')
) v(n) ON CONFLICT DO NOTHING;

WITH p AS (SELECT id FROM portfolios WHERE name = 'VPI')
INSERT INTO ccas (portfolio_id, name) SELECT p.id, n FROM p, (VALUES
  ('VPI'), ('Bash'), ('DND'), ('AEAC')
) v(n) ON CONFLICT DO NOTHING;

WITH p AS (SELECT id FROM portfolios WHERE name = 'RHMP')
INSERT INTO ccas (portfolio_id, name) SELECT p.id, n FROM p, (VALUES
  ('RHMP'), ('RHMP Producers'), ('RHMP Directors'), ('RHMP Ensemble'),
  ('RHMP Stage Managers'), ('RHMP Sets'), ('RHMP Costumes'), ('RHMP Relations'),
  ('RHMP Publicity'), ('RHMP EM'), ('RHMP Graphic Design'),
  ('RHMP Musicians'), ('RHMP Composers')
) v(n) ON CONFLICT DO NOTHING;

WITH p AS (SELECT id FROM portfolios WHERE name = 'Media')
INSERT INTO ccas (portfolio_id, name) SELECT p.id, n FROM p, (VALUES
  ('Media'), ('BOP'), ('Phoenix Studios'), ('Phoenix Press'),
  ('AnG'), ('Tech Crew'), ('ComMotion'), ('RH Devs')
) v(n) ON CONFLICT DO NOTHING;

WITH p AS (SELECT id FROM portfolios WHERE name = 'HGS')
INSERT INTO ccas (portfolio_id, name) SELECT p.id, n FROM p, (VALUES
  ('HGS'), ('JCRC'), ('Vacation Storage'), ('Auditor'),
  ('Finance'), ('Secretariat')
) v(n) ON CONFLICT DO NOTHING;

WITH p AS (SELECT id FROM portfolios WHERE name = 'VPE')
INSERT INTO ccas (portfolio_id, name) SELECT p.id, n FROM p, (VALUES
  ('VPE'), ('HPB'), ('RHOC'), ('RHAG'), ('RFLAG')
) v(n) ON CONFLICT DO NOTHING;

WITH p AS (SELECT id FROM portfolios WHERE name = 'N/A')
INSERT INTO ccas (portfolio_id, name) SELECT p.id, 'N/A' FROM p
ON CONFLICT DO NOTHING;

INSERT INTO document_counters (academic_year, counter) VALUES ('2526', 0)
ON CONFLICT DO NOTHING;

INSERT INTO app_settings (key, value) VALUES
  ('academic_year', '2526'),
  ('claim_submission_to_email', 'rh.finance@u.nus.edu'),
  ('claim_submission_cc_email', '68findirector.rh@gmail.com'),
  ('document_fd_name', ''),
  ('document_fd_salutation', ''),
  ('document_fd_email', ''),
  ('testing_mode_enabled', 'false'),
  ('testing_mode_message', 'The finance claims app is temporarily down for testing. Please check back later.')
ON CONFLICT DO NOTHING;
