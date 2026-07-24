-- 사진 앨범 링크(?album=<uuid>)를 누구나 열 수 있도록 하는 최소 권한입니다.
-- 사진 파일은 Storage photos 버킷에 있고, 이 테이블은 파일 목록/업체명만 보관합니다.
-- 이 SQL은 photo_assets 테이블이 아직 없어도 반드시 실행됩니다.
alter table public.photo_albums enable row level security;

drop policy if exists "photo albums anon read" on public.photo_albums;
drop policy if exists "photo albums anon insert" on public.photo_albums;

create policy "photo albums anon read"
on public.photo_albums for select to anon
using (true);

create policy "photo albums anon insert"
on public.photo_albums for insert to anon
with check (true);
