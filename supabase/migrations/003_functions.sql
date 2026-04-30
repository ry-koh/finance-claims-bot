-- Auto-update updated_at on row changes
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_claimers_updated_at
  before update on claimers
  for each row execute function update_updated_at();

create trigger trg_claims_updated_at
  before update on claims
  for each row execute function update_updated_at();

create trigger trg_line_items_updated_at
  before update on claim_line_items
  for each row execute function update_updated_at();

create trigger trg_receipts_updated_at
  before update on receipts
  for each row execute function update_updated_at();

-- Recalculate claim total_amount when receipts change
create or replace function recalculate_claim_total()
returns trigger language plpgsql as $$
begin
  update claims
  set total_amount = (
    select coalesce(sum(amount), 0)
    from receipts
    where claim_id = coalesce(new.claim_id, old.claim_id)
  )
  where id = coalesce(new.claim_id, old.claim_id);
  return coalesce(new, old);
end;
$$;

create trigger trg_receipts_recalculate_total
  after insert or update or delete on receipts
  for each row execute function recalculate_claim_total();

-- Recalculate line_item total_amount when receipts change
create or replace function recalculate_line_item_total()
returns trigger language plpgsql as $$
begin
  if coalesce(new.line_item_id, old.line_item_id) is not null then
    update claim_line_items
    set total_amount = (
      select coalesce(sum(amount), 0)
      from receipts
      where line_item_id = coalesce(new.line_item_id, old.line_item_id)
    )
    where id = coalesce(new.line_item_id, old.line_item_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_receipts_recalculate_line_item
  after insert or update or delete on receipts
  for each row execute function recalculate_line_item_total();
