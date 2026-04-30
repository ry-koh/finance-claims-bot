-- Performance indexes
create index idx_claims_status on claims(status) where deleted_at is null;
create index idx_claims_claimer on claims(claimer_id);
create index idx_claims_filled_by on claims(filled_by);
create index idx_claims_deleted on claims(deleted_at);
create index idx_receipts_claim on receipts(claim_id);
create index idx_receipts_line_item on receipts(line_item_id);
create index idx_line_items_claim on claim_line_items(claim_id);
create index idx_documents_claim on claim_documents(claim_id);
create index idx_documents_current on claim_documents(claim_id, type) where is_current = true;
create index idx_claimers_cca on claimers(cca_id);
create index idx_ccas_portfolio on ccas(portfolio_id);
create index idx_finance_team_telegram on finance_team(telegram_id);
