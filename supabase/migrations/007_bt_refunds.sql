-- add amount to bank_transactions (default 0 so existing rows migrate safely; app always sets explicitly)
alter table bank_transactions add column if not exists amount decimal(10,2) not null default 0;

-- refunds table (each refund has its own amount + bank screenshot image)
create table if not exists bank_transaction_refunds (
  id uuid primary key default uuid_generate_v4(),
  bank_transaction_id uuid not null references bank_transactions(id) on delete cascade,
  amount decimal(10,2) not null check (amount > 0),
  drive_file_id text not null,
  created_at timestamptz default now()
);
create index if not exists idx_bt_refunds_bt_id on bank_transaction_refunds(bank_transaction_id);
