-- photos는 공개 버킷이므로 파일 URL 열람에는 storage.objects SELECT 정책이 필요 없습니다.
-- 아래 블록은 photos 버킷을 대상으로 한 SELECT 정책만 제거합니다.
-- 업로드(INSERT) 정책은 건드리지 않습니다.
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

update storage.buckets set public = true where id = 'photos';
