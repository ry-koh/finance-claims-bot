-- Add matric_number and phone_number for CCA treasurers
alter table finance_team
  add column if not exists matric_number text,
  add column if not exists phone_number text;
