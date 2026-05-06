-- Add foreign currency tracking to receipts
ALTER TABLE receipts
  ADD COLUMN is_foreign_currency boolean NOT NULL DEFAULT false,
  ADD COLUMN exchange_rate_screenshot_drive_id text;
