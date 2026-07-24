-- 사진 앨범 링크(?album=<uuid>)를 누구나 열 수 있도록 하는 최소 권한입니다.
-- 사진 파일은 Storage photos 버킷에 있고, 이 테이블은 파일 목록/업체명만 보관합니다.
alter table public.photo_albums enable row level security;

drop policy if exists "photo albums anon read" on public.photo_albums;
drop policy if exists "photo albums anon insert" on public.photo_albums;

create policy "photo albums anon read"
on public.photo_albums for select to anon
using (true);

create policy "photo albums anon insert"
on public.photo_albums for insert to anon
with check (true);

-- 새 구조의 사진 색인도 FIELD 웹앱에서 저장할 수 있게 합니다.
alter table public.photo_assets enable row level security;

drop policy if exists "photo assets anon read" on public.photo_assets;
drop policy if exists "photo assets anon insert" on public.photo_assets;

create policy "photo assets anon read"
on public.photo_assets for select to anon
using (true);

create policy "photo assets anon insert"
on public.photo_assets for insert to anon
with check (true);
