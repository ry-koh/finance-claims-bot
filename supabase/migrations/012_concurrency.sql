-- Fix 1: Atomic document counter — replaces Python read-modify-write
CREATE OR REPLACE FUNCTION increment_document_counter(p_year text)
RETURNS integer
LANGUAGE plpgsql
AS $$
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

-- Fix 5: Atomic doc-generation lock — prevents duplicate runs
-- Returns TRUE if the lock was acquired, FALSE if already generating.
-- Lock auto-expires after 10 minutes to recover from crashed requests.
CREATE OR REPLACE FUNCTION claim_start_generation(p_claim_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE claims
  SET error_message = '__generating__'
  WHERE id = p_claim_id
    AND (
      error_message IS NULL
      OR error_message != '__generating__'
      OR updated_at < now() - interval '10 minutes'
    );
  RETURN FOUND;
END;
$$;
