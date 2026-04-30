-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. portfolios
create table portfolios (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz default now()
);

-- 2. ccas
create table ccas (
  id uuid primary key default uuid_generate_v4(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  unique(portfolio_id, name)
);

-- 3. finance_team
create table finance_team (
  id uuid primary key default uuid_generate_v4(),
  telegram_id bigint not null unique,
  name text not null,
  email text,
  role text not null default 'member' check (role in ('director', 'member')),
  created_at timestamptz default now()
);

-- 4. claimers
create table claimers (
  id uuid primary key default uuid_generate_v4(),
  cca_id uuid not null references ccas(id) on delete restrict,
  name text not null,
  matric_no text,
  phone text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 5. document_counters
create table document_counters (
  id uuid primary key default uuid_generate_v4(),
  academic_year text not null,
  counter integer not null default 0,
  unique(academic_year)
);

-- 6. claims
create table claims (
  id uuid primary key default uuid_generate_v4(),
  reference_code text unique,
  claim_number integer,
  claimer_id uuid not null references claimers(id) on delete restrict,
  filled_by uuid references finance_team(id) on delete set null,
  processed_by uuid references finance_team(id) on delete set null,
  claim_description text not null,
  total_amount numeric(10,2) default 0,
  date date not null default current_date,
  wbs_account text not null check (wbs_account in ('SA', 'MBH', 'MF')),
  wbs_no text generated always as (
    case wbs_account
      when 'SA'  then 'H-404-00-000003'
      when 'MBH' then 'H-404-00-000004'
      when 'MF'  then 'E-404-10-0001-01'
    end
  ) stored,
  remarks text,
  other_emails text[] default '{}',
  status text not null default 'draft' check (status in (
    'draft','email_sent','screenshot_pending','screenshot_uploaded',
    'docs_generated','compiled','submitted','reimbursed','error'
  )),
  error_message text,
  transport_form_needed boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 7. claim_line_items
create table claim_line_items (
  id uuid primary key default uuid_generate_v4(),
  claim_id uuid not null references claims(id) on delete cascade,
  line_item_index integer not null check (line_item_index between 1 and 5),
  category text not null,
  category_code text,
  gst_code text not null default 'IE' check (gst_code in ('IE','I9','L9')),
  dr_cr text not null default 'DR' check (dr_cr in ('DR','CR')),
  combined_description text,
  total_amount numeric(10,2) default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(claim_id, line_item_index),
  unique(claim_id, category)
);

-- 8. receipts
create table receipts (
  id uuid primary key default uuid_generate_v4(),
  claim_id uuid not null references claims(id) on delete cascade,
  line_item_id uuid references claim_line_items(id) on delete set null,
  receipt_no text,
  description text not null,
  company text,
  date date,
  amount numeric(10,2) not null,
  receipt_image_drive_id text,
  bank_screenshot_drive_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 9. claim_documents
create table claim_documents (
  id uuid primary key default uuid_generate_v4(),
  claim_id uuid not null references claims(id) on delete cascade,
  type text not null check (type in (
    'loa','summary','rfp','transport','email_screenshot','compiled'
  )),
  drive_file_id text not null,
  is_current boolean not null default true,
  created_at timestamptz default now()
);
