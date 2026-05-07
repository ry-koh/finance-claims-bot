create table app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

insert into app_settings (key, value) values ('academic_year', '2526')
  on conflict do nothing;
