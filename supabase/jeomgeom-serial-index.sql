-- 점검 원본(jeomgeom)의 모든 기기 기번/자산기번을 배열(_기번목록)로 추출 (1회 실행)
-- 양식 1건=1행이라 열에는 첫 기기 기번만 남던 문제 해결 — 다기기 업체의 워킨맵 이력 매칭용.
-- 트리거로 신규/수정 행에 자동 유지되고, 아래 백필로 기존 행을 채운다.

alter table public.jeomgeom add column if not exists "_기번목록" text[];

create or replace function public.jeomgeom_collect_ids() returns trigger as $$
declare ids text[];
begin
  ids := array(
    select distinct trim(m[1])
    from (select regexp_matches(coalesce(new."_원문", ''), '(?:시리얼넘버|자산기번)\s*[:：]\s*([^\n]+)', 'g') as m) t
    where trim(m[1]) <> ''
  );
  if coalesce(trim(new."시리얼넘버"), '') <> '' then ids := array_append(ids, trim(new."시리얼넘버")); end if;
  if coalesce(trim(new."자산기번"), '') <> '' then ids := array_append(ids, trim(new."자산기번")); end if;
  new."_기번목록" := ids;
  return new;
end $$ language plpgsql;

drop trigger if exists jeomgeom_collect_ids_trg on public.jeomgeom;
create trigger jeomgeom_collect_ids_trg
before insert or update on public.jeomgeom
for each row execute function public.jeomgeom_collect_ids();

-- 기존 행 백필 (트리거가 채우도록 무변경 업데이트 — 행이 많으면 수십 초 걸릴 수 있음)
update public.jeomgeom set "시리얼넘버" = "시리얼넘버";
