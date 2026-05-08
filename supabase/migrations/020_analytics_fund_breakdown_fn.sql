CREATE OR REPLACE FUNCTION analytics_fund_breakdown(
  p_group_by  text,    -- 'portfolio' | 'cca'
  p_statuses  text[],  -- NULL or empty = all statuses
  p_date_from date,    -- NULL = no lower bound
  p_date_to   date     -- NULL = no upper bound
)
RETURNS TABLE(name text, portfolio text, sa_total numeric, mf_total numeric)
LANGUAGE plpgsql
AS $$
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
        AND (
          p_statuses IS NULL
          OR array_length(p_statuses, 1) IS NULL
          OR c.status = ANY(p_statuses)
        )
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
        AND (
          p_statuses IS NULL
          OR array_length(p_statuses, 1) IS NULL
          OR c.status = ANY(p_statuses)
        )
        AND (p_date_from IS NULL OR c.date >= p_date_from)
        AND (p_date_to   IS NULL OR c.date <= p_date_to)
      GROUP BY ccas.name, portfolios.name
      ORDER BY portfolios.name ASC, ccas.name ASC;

  ELSE
    RAISE EXCEPTION 'Invalid group_by value: %. Must be portfolio or cca.', p_group_by;
  END IF;
END;
$$;
