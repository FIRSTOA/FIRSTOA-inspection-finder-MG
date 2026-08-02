-- 원격·IT 처리값 원자 병합 — 여러 CS가 같은 건을 동시에 저장해도 서로의 필드를 지우지 않는다.
-- (프론트가 remote_meta를 통째로 PATCH하면 마지막 저장이 상대 입력을 덮는다 → jsonb || 병합으로 교체)
create or replace function public.merge_reception_handling(p_id uuid, p_meta jsonb, p_status text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update service_receptions
  set remote_meta = coalesce(remote_meta, '{}'::jsonb) || coalesce(p_meta, '{}'::jsonb),
      status = coalesce(p_status, status)
  where id = p_id;
$$;
grant execute on function public.merge_reception_handling(uuid, jsonb, text) to anon, authenticated;
notify pgrst, 'reload schema';
