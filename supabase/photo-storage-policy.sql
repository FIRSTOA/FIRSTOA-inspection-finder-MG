-- photos 버킷은 공개 URL로만 읽습니다. storage.objects SELECT 정책은 필요하지 않습니다.
-- 아래 정책은 photos 버킷에만 적용되며, 다른 Storage 버킷에는 영향을 주지 않습니다.
do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd = 'SELECT'
      and coalesce(qual, '') ilike '%photos%'
  loop
    execute format('drop policy if exists %I on storage.objects', policy_name);
  end loop;
end $$;

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

-- FIELD 웹앱은 anon 키로 업로드합니다. public 역할은 anon/로그인 사용자를 포함하지만
-- bucket_id = 'photos' 조건 때문에 photos 이외 파일에는 절대 적용되지 않습니다.
drop policy if exists "photos anon insert" on storage.objects;
drop policy if exists "photos anon update" on storage.objects;
drop policy if exists "photos public insert" on storage.objects;
drop policy if exists "photos public update" on storage.objects;

create policy "photos public insert"
on storage.objects for insert to public
with check (bucket_id = 'photos');

create policy "photos public update"
on storage.objects for update to public
using (bucket_id = 'photos')
with check (bucket_id = 'photos');
