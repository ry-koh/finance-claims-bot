-- Multiple images per receipt
create table receipt_images (
  id uuid primary key default uuid_generate_v4(),
  receipt_id uuid not null references receipts(id) on delete cascade,
  drive_file_id text not null,
  created_at timestamptz default now()
);

-- Bank transaction group: one bank debit/credit that may cover multiple receipts
create table bank_transactions (
  id uuid primary key default uuid_generate_v4(),
  claim_id uuid not null references claims(id) on delete cascade,
  created_at timestamptz default now()
);

-- Multiple images per bank transaction
create table bank_transaction_images (
  id uuid primary key default uuid_generate_v4(),
  bank_transaction_id uuid not null references bank_transactions(id) on delete cascade,
  drive_file_id text not null,
  created_at timestamptz default now()
);

-- Link receipts to their bank transaction (many receipts → one bank transaction)
alter table receipts
  add column bank_transaction_id uuid references bank_transactions(id) on delete set null;

-- Indexes
create index idx_receipt_images_receipt on receipt_images(receipt_id);
create index idx_bank_transaction_images_bt on bank_transaction_images(bank_transaction_id);
create index idx_bank_transactions_claim on bank_transactions(claim_id);
create index idx_receipts_bank_transaction on receipts(bank_transaction_id);
