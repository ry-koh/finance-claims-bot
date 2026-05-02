-- Add amount to bank_transactions
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS amount DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Refunds table (each refund has its own amount + bank screenshot image)
CREATE TABLE IF NOT EXISTS bank_transaction_refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_transaction_id UUID NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  drive_file_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bt_refunds_bt_id ON bank_transaction_refunds(bank_transaction_id);
