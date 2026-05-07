CREATE OR REPLACE FUNCTION analytics_summary(
  p_group_by  text,    -- 'cca' | 'portfolio' | 'fund'
  p_statuses  text[],  -- NULL or empty = all statuses
  p_date_from date,    -- NULL = no lower bound
  p_date_to   date     -- NULL = no upper bound
)
RETURNS TABLE(name text, portfolio text, total numeric)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_group_by = 'cca' THEN
    RETURN QUERY
      SELECT
        ccas.name::text                AS name,
        portfolios.name::text          AS portfolio,
        SUM(c.total_amount)::numeric   AS total
      FROM claims c
      JOIN claimers    cl  ON cl.id          = c.claimer_id
      JOIN ccas            ON ccas.id        = cl.cca_id
      JOIN portfolios      ON portfolios.id  = ccas.portfolio_id
      WHERE c.deleted_at IS NULL
        AND (
          p_statuses IS NULL
          OR array_length(p_statuses, 1) IS NULL
          OR c.status = ANY(p_statuses)
        )
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
      JOIN claimers    cl  ON cl.id          = c.claimer_id
      JOIN ccas            ON ccas.id        = cl.cca_id
      JOIN portfolios      ON portfolios.id  = ccas.portfolio_id
      WHERE c.deleted_at IS NULL
        AND (
          p_statuses IS NULL
          OR array_length(p_statuses, 1) IS NULL
          OR c.status = ANY(p_statuses)
        )
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
        AND (
          p_statuses IS NULL
          OR array_length(p_statuses, 1) IS NULL
          OR c.status = ANY(p_statuses)
        )
        AND (p_date_from IS NULL OR c.date >= p_date_from)
        AND (p_date_to   IS NULL OR c.date <= p_date_to)
      GROUP BY c.wbs_account
      ORDER BY c.wbs_account ASC;

  ELSE
    RAISE EXCEPTION 'Invalid group_by value: %. Must be cca, portfolio, or fund.', p_group_by;
  END IF;
END;
$$;
