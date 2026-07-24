-- Creates and reads photo albums through RPC while keeping Storage uploads separate.
alter table public.photo_albums
  add column if not exists category text not null default 'field',
  add column if not exists author text,
  add column if not exists region text,
  add column if not exists source_type text not null default 'field';

create or replace function public.create_photo_album(
  p_urls text[],
  p_vendor text,
  p_category text default 'field',
  p_author text default '',
  p_region text default '',
  p_source_type text default 'field'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.photo_albums (urls, vendor, category, author, region, source_type)
  values (to_jsonb(p_urls), p_vendor, p_category, p_author, p_region, p_source_type)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.get_photo_album(p_id uuid)
returns table (vendor text, urls jsonb, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select a.vendor, a.urls, a.created_at
  from public.photo_albums a
  where a.id = p_id;
$$;

grant execute on function public.create_photo_album(text[], text, text, text, text, text) to anon;
grant execute on function public.get_photo_album(uuid) to anon;
