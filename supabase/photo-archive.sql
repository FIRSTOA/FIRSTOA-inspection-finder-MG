-- 사진 드라이브 아카이브 — 매핑 컬럼 + 앨범 뷰어 폴백
-- (photo-drive-archive 엣지 함수가 채운다. 원본 컬럼은 건드리지 않고 추가만.)
alter table photo_assets add column if not exists drive_file_id text;

-- 앨범 조회: 이관된 사진은 드라이브 썸네일 링크로 대체 — 프론트 무변경 폴백
create or replace function public.get_photo_album(p_id uuid)
returns table(vendor text, urls jsonb, created_at timestamptz)
language sql security definer set search_path to 'public' as $$
  select a.vendor,
         coalesce((
           select jsonb_agg(
             coalesce(
               (select 'https://drive.google.com/thumbnail?id=' || p.drive_file_id || '&sz=w1600'
                from photo_assets p
                where p.album_id = a.id and p.public_url = u.url and p.drive_file_id is not null),
               u.url)
             order by u.ord)
           from jsonb_array_elements_text(a.urls) with ordinality u(url, ord)
         ), a.urls) as urls,
         a.created_at
  from photo_albums a
  where a.id = p_id;
$$;
notify pgrst, 'reload schema';
