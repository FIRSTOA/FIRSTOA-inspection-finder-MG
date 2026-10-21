-- 2026-10-22 (개발실 오류진) 시트 미러 표의 숨김(_hidden)이 매일 밤 풀리는 것 막기 — 초안, sql-review 전 실행 금지
--
-- 왜: pc_expansion·mfp_expansion·misu·overage 는 GAS supabaseReplaceAll_ 이 매일 00:30 경
--     "전 행 삭제 → 시트 행 전부 다시 넣기"를 한다(apps-script/first-data/src/Supabase.gs).
--     FIELD 조회 탭에서 숨긴 행도 다음 밤 새 id·_hidden=null 로 다시 들어와 숨김이 사라진다.
--     실측(2026-10-22): 4개 표 _hidden 행 = pc_expansion 107237 1건뿐(10/21 20:16 이민구 숨김, 오늘 밤 풀릴 예정),
--     misu·overage 는 숨긴 기록이 남아 있지 않다. 네 표 모두 _dupKey 가 행마다 고유(pc 1,296/1,296).
-- 무엇: 숨김 장부 표 mirror_hidden(표, _dupKey) + 두 트리거
--     · _hidden 이 바뀌면 장부에 적거나 지운다(AFTER UPDATE OF _hidden)
--     · 미러가 행을 다시 넣을 때 장부에 있으면 _hidden=true 로 넣는다(BEFORE INSERT)
--   기존 표의 컬럼·데이터는 바꾸지 않는다(트리거만 붙음). 시트에서 그 행 내용을 고치면 _dupKey 가 바뀌어 숨김은 풀린다(의도: 고친 행은 다시 보이게).
-- 되돌리기: 맨 아래 주석.

begin;

create table if not exists public.mirror_hidden (
  table_name text not null,
  dup_key    text not null,
  hidden_by  text not null default '',
  hidden_at  timestamptz not null default now(),
  primary key (table_name, dup_key)
);
comment on table public.mirror_hidden is '시트 미러 표(pc_expansion·mfp_expansion·misu·overage) 숨김 장부 — 밤마다 전체 교체돼도 숨김 유지. 2026-10-22';
alter table public.mirror_hidden enable row level security;
revoke all on public.mirror_hidden from anon, authenticated;
-- 정책 없음 = anon/authenticated 직접 접근 불가. 트리거(security definer)만 쓴다.

create or replace function public.mirror_hidden_track()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new."_dupKey", '') = '' then return new; end if;
  if coalesce(new._hidden, false) then
    insert into public.mirror_hidden (table_name, dup_key, hidden_by, hidden_at)
    values (tg_table_name, new."_dupKey", coalesce(new._hidden_by, ''), coalesce(new._hidden_at, now()))
    on conflict (table_name, dup_key) do update set hidden_by = excluded.hidden_by, hidden_at = excluded.hidden_at;
  else
    delete from public.mirror_hidden where table_name = tg_table_name and dup_key = new."_dupKey";
  end if;
  return new;
end $$;

create or replace function public.mirror_hidden_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare h record;
begin
  if coalesce(new."_dupKey", '') = '' then return new; end if;
  select hidden_by, hidden_at into h from public.mirror_hidden where table_name = tg_table_name and dup_key = new."_dupKey";
  if found then
    new._hidden := true; new._hidden_by := coalesce(h.hidden_by, ''); new._hidden_at := h.hidden_at;
  end if;
  return new;
end $$;
revoke all on function public.mirror_hidden_track() from public, anon, authenticated;
revoke all on function public.mirror_hidden_apply() from public, anon, authenticated;

drop trigger if exists mirror_hidden_track on public.pc_expansion;
create trigger mirror_hidden_track after update of _hidden on public.pc_expansion for each row execute function public.mirror_hidden_track();
drop trigger if exists mirror_hidden_apply on public.pc_expansion;
create trigger mirror_hidden_apply before insert on public.pc_expansion for each row execute function public.mirror_hidden_apply();

drop trigger if exists mirror_hidden_track on public.mfp_expansion;
create trigger mirror_hidden_track after update of _hidden on public.mfp_expansion for each row execute function public.mirror_hidden_track();
drop trigger if exists mirror_hidden_apply on public.mfp_expansion;
create trigger mirror_hidden_apply before insert on public.mfp_expansion for each row execute function public.mirror_hidden_apply();

drop trigger if exists mirror_hidden_track on public.misu;
create trigger mirror_hidden_track after update of _hidden on public.misu for each row execute function public.mirror_hidden_track();
drop trigger if exists mirror_hidden_apply on public.misu;
create trigger mirror_hidden_apply before insert on public.misu for each row execute function public.mirror_hidden_apply();

drop trigger if exists mirror_hidden_track on public.overage;
create trigger mirror_hidden_track after update of _hidden on public.overage for each row execute function public.mirror_hidden_track();
drop trigger if exists mirror_hidden_apply on public.overage;
create trigger mirror_hidden_apply before insert on public.overage for each row execute function public.mirror_hidden_apply();

-- 지금 숨겨져 있는 행을 장부에 옮긴다(실행 시점 기준, 2026-10-22 실측 1건: pc_expansion 107237)
insert into public.mirror_hidden (table_name, dup_key, hidden_by, hidden_at)
select 'pc_expansion', "_dupKey", _hidden_by, coalesce(_hidden_at, now()) from public.pc_expansion where _hidden and coalesce("_dupKey",'') <> ''
union all select 'mfp_expansion', "_dupKey", _hidden_by, coalesce(_hidden_at, now()) from public.mfp_expansion where _hidden and coalesce("_dupKey",'') <> ''
union all select 'misu', "_dupKey", _hidden_by, coalesce(_hidden_at, now()) from public.misu where _hidden and coalesce("_dupKey",'') <> ''
union all select 'overage', "_dupKey", _hidden_by, coalesce(_hidden_at, now()) from public.overage where _hidden and coalesce("_dupKey",'') <> ''
on conflict do nothing;

commit;

-- 확인: select * from public.mirror_hidden;   -- 실행 직후 1행(pc_expansion e0cb9fa4c34e4083b45ee72a8f21fe6a)
-- 다음 날 아침: select id, _hidden, _hidden_by from public.pc_expansion where "_dupKey" = 'e0cb9fa4c34e4083b45ee72a8f21fe6a';  -- _hidden = true 여야 함
--
-- 되돌리기:
-- drop trigger if exists mirror_hidden_track on public.pc_expansion;  drop trigger if exists mirror_hidden_apply on public.pc_expansion;
-- drop trigger if exists mirror_hidden_track on public.mfp_expansion; drop trigger if exists mirror_hidden_apply on public.mfp_expansion;
-- drop trigger if exists mirror_hidden_track on public.misu;          drop trigger if exists mirror_hidden_apply on public.misu;
-- drop trigger if exists mirror_hidden_track on public.overage;       drop trigger if exists mirror_hidden_apply on public.overage;
-- drop function if exists public.mirror_hidden_track(); drop function if exists public.mirror_hidden_apply();
-- drop table if exists public.mirror_hidden;
