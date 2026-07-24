-- FIELD 사진 공통 앨범 정리: 실제 파일은 photos 버킷, 업무별 목록은 photo_albums 테이블에 저장합니다.
alter table public.photo_albums
  add column if not exists category text not null default '현장',
  add column if not exists author text,
  add column if not exists region text,
  add column if not exists source_type text not null default 'field';

create index if not exists photo_albums_category_created_idx on public.photo_albums(category, created_at desc);
create index if not exists photo_albums_vendor_created_idx on public.photo_albums(vendor, created_at desc);
create index if not exists photo_albums_source_created_idx on public.photo_albums(source_type, created_at desc);
