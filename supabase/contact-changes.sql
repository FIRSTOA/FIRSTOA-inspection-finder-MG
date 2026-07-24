create extension if not exists pgcrypto;

create table if not exists public.contact_changes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  change_date date not null default current_date,
  author text not null default '',
  company text not null default '',
  region text not null default '',
  category text not null default '',
  reason text not null default '',
  grade text not null default '',
  before_text text not null default '',
  after_text text not null default '',
  notes text not null default '',
  source_text text not null default '',
  photo_link text not null default '',
  "_dupKey" text not null unique
);

create index if not exists contact_changes_date_idx on public.contact_changes(change_date desc, created_at desc);
create index if not exists contact_changes_company_idx on public.contact_changes(company);
create index if not exists contact_changes_region_idx on public.contact_changes(region, change_date desc);

alter table public.contact_changes enable row level security;
drop policy if exists "contact changes anon read" on public.contact_changes;
drop policy if exists "contact changes anon insert" on public.contact_changes;
create policy "contact changes anon read" on public.contact_changes for select to anon using (true);
create policy "contact changes anon insert" on public.contact_changes for insert to anon with check (true);
grant select, insert on public.contact_changes to anon;
