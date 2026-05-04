alter table claims add column if not exists is_partial boolean not null default false;
alter table claims add column if not exists partial_amount numeric(10,2);
alter table claims add column if not exists mf_approval_drive_id text;
