-- 기기/부품 재고현황 (1회 실행)
-- 관리부가 수량을 관리하고 CS팀은 현장에서 즉시 확인하는 용도.
create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  kind text not null default '기기' check (kind in ('기기', '부품')),
  brand text not null default '',
  name text not null,                -- 기종명 또는 부품명
  condition text not null default '' check (condition in ('', '새기기', '리퍼')),
  qty integer not null default 0,
  note text not null default ''
);
create index if not exists stock_items_kind_idx on public.stock_items(kind, brand, name);

create or replace function public.stock_items_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists stock_items_touch on public.stock_items;
create trigger stock_items_touch before update on public.stock_items
  for each row execute function public.stock_items_touch();

alter table public.stock_items enable row level security;
drop policy if exists "stock_items anon all" on public.stock_items;
create policy "stock_items anon all" on public.stock_items for all to anon using (true) with check (true);
grant select, insert, update, delete on public.stock_items to anon;

notify pgrst, 'reload schema';
