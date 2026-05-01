-- Seed portfolios
insert into portfolios (name) values
  ('Culture'),
  ('Welfare'),
  ('Sports'),
  ('Social'),
  ('VPI'),
  ('RHMP'),
  ('Media'),
  ('HGS'),
  ('VPE'),
  ('N/A')
on conflict do nothing;

-- Seed CCAs for Culture portfolio
with p as (select id from portfolios where name = 'Culture')
insert into ccas (portfolio_id, name)
select p.id, cca_name from p, (values
  ('Culture'),
  ('RHockerfellas'),
  ('RH Unplugged'),
  ('RH Dance'),
  ('RHebels'),
  ('RHythm'),
  ('RH Voices'),
  ('Culture Comm')
) as ccas(cca_name)
on conflict do nothing;

-- Seed CCAs for Welfare portfolio
with p as (select id from portfolios where name = 'Welfare')
insert into ccas (portfolio_id, name)
select p.id, cca_name from p, (values
  ('Welfare'),
  ('Welfare Comm'),
  ('RVC SP'),
  ('RVC Children'),
  ('RVC Pioneers'),
  ('RVC Special Needs'),
  ('HeaRHtfelt'),
  ('Green Comm')
) as ccas(cca_name)
on conflict do nothing;

-- Seed CCAs for Sports portfolio
with p as (select id from portfolios where name = 'Sports')
insert into ccas (portfolio_id, name)
select p.id, cca_name from p, (values
  ('Sports'),
  ('Badminton M'),
  ('Basketball M'),
  ('Floorball M'),
  ('Handball M'),
  ('Soccer M'),
  ('Swimming M'),
  ('Squash M'),
  ('Sepak Takraw M'),
  ('Tennis M'),
  ('Touch Rugby M'),
  ('Table Tennis M'),
  ('Volleyball M'),
  ('SMC'),
  ('Softball'),
  ('Track'),
  ('Road Relay'),
  ('Frisbee'),
  ('Netball F'),
  ('Badminton F'),
  ('Basketball F'),
  ('Floorball F'),
  ('Handball F'),
  ('Soccer F'),
  ('Swimming F'),
  ('Squash F'),
  ('Tennis F'),
  ('Touch Rugby F'),
  ('Table Tennis F'),
  ('Volleyball F')
) as ccas(cca_name)
on conflict do nothing;

-- Seed CCAs for Social portfolio
with p as (select id from portfolios where name = 'Social')
insert into ccas (portfolio_id, name)
select p.id, cca_name from p, (values
  ('Social'),
  ('Block 2 Comm'),
  ('Block 3 Comm'),
  ('Block 4 Comm'),
  ('Block 5 Comm'),
  ('Block 6 Comm'),
  ('Block 7 Comm'),
  ('Block 8 Comm'),
  ('Social Comm'),
  ('RHSafe')
) as ccas(cca_name)
on conflict do nothing;

-- Seed CCAs for VPI portfolio
with p as (select id from portfolios where name = 'VPI')
insert into ccas (portfolio_id, name)
select p.id, cca_name from p, (values
  ('VPI'),
  ('Bash'),
  ('DND'),
  ('AEAC')
) as ccas(cca_name)
on conflict do nothing;

-- Seed CCAs for RHMP portfolio
with p as (select id from portfolios where name = 'RHMP')
insert into ccas (portfolio_id, name)
select p.id, cca_name from p, (values
  ('RHMP'),
  ('RHMP Producers'),
  ('RHMP Directors'),
  ('RHMP Ensemble'),
  ('RHMP Stage Managers'),
  ('RHMP Sets'),
  ('RHMP Costumes'),
  ('RHMP Relations'),
  ('RHMP Publicity'),
  ('RHMP EM'),
  ('RHMP Graphic Design'),
  ('RHMP Musicians'),
  ('RHMP Composers')
) as ccas(cca_name)
on conflict do nothing;

-- Seed CCAs for Media portfolio
with p as (select id from portfolios where name = 'Media')
insert into ccas (portfolio_id, name)
select p.id, cca_name from p, (values
  ('Media'),
  ('BOP'),
  ('Phoenix Studios'),
  ('Phoenix Press'),
  ('AnG'),
  ('Tech Crew'),
  ('ComMotion'),
  ('RH Devs')
) as ccas(cca_name)
on conflict do nothing;

-- Seed CCAs for HGS portfolio
with p as (select id from portfolios where name = 'HGS')
insert into ccas (portfolio_id, name)
select p.id, cca_name from p, (values
  ('HGS'),
  ('JCRC'),
  ('Vacation Storage'),
  ('Auditor'),
  ('Finance'),
  ('Secretariat')
) as ccas(cca_name)
on conflict do nothing;

-- Seed CCAs for VPE portfolio
with p as (select id from portfolios where name = 'VPE')
insert into ccas (portfolio_id, name)
select p.id, cca_name from p, (values
  ('VPE'),
  ('HPB'),
  ('RHOC'),
  ('RHAG'),
  ('RFLAG')
) as ccas(cca_name)
on conflict do nothing;

-- Seed CCAs for N/A portfolio
with p as (select id from portfolios where name = 'N/A')
insert into ccas (portfolio_id, name)
select p.id, cca_name from p, (values
  ('N/A')
) as ccas(cca_name)
on conflict do nothing;

-- Seed initial document counter
insert into document_counters (academic_year, counter) values ('2526', 0) on conflict do nothing;
