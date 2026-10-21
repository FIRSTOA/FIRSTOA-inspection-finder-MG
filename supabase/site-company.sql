-- ============================================================================
-- 지점(5자리) → 업체(10자리) 연결표 site_company  (2026-10-23 초안 · 데이터실 표다빈)
-- 설계·실측: docs/tasks/customer-hierarchy.md "5. 1단계 실측(2026-10-23)"
-- 상태: **실행 대기 · sql-review 전.** 아직 사용자에게 건네지 않음(sql-review 통과 후 /sql-handoff).
-- 실행: Supabase SQL Editor 에서 1회 실행 (두 번 돌려도 안전: if not exists / or replace / drop policy if exists / on conflict).
--
-- 무엇을 하나
--   1. 표 site_company — 지점 하나에 업체 하나(사람이 정한 값 + 자동 연결 스냅샷). 기존 표 컬럼은 안 건드린다.
--   2. 뷰 site_company_candidates — vendor_info 에서 매번 계산하는 "지점별 10자리 후보"(데이터 복사 아님).
--      단계: ① 행의 _raw '거래처 코드'(direct) → 없으면 ② 기번·자산번호 → lease_ident_code(ident)
--            → 그것도 없으면 ③ 업체명 정규화(vendor_match_key_) ↔ vendor_master name·aliases(name, 키가 코드 하나로만 이어질 때)
--      지점 안에서 가장 앞 단계 하나만 쓴다(단계 섞으면 충돌만 늘어남, 실측 194→253).
--   3. 뷰 site_company_status — 지점 5,850곳 전부: 표 값 우선 → 없으면 후보 1개면 자동, 2개 이상 conflict, 0개 none.
--   4. 자동 연결분 넣기 — 후보 1개인 지점만 site_company 에 insert ... select (manual 은 덮지 않음).
--
-- 2026-10-22 라이브 실측(이 SQL 의 SELECT 부분을 MCP 로 그대로 돌린 결과): 연결 5,166 / 충돌 205 / 미연결 479.
--
-- 권한: 2026-10-22 라이브의 pg_default_acl 은 아직 anon 에 전권 자동 부여 상태
--       (anon-permissions-20261019.sql 미실행). 그래서 revoke all 후 select 만 다시 준다.
--       쓰기(insert/update/delete)는 anon 에 안 준다 — 사람 맞춤은 당분간 SQL Editor 에서.
--       맞춤 화면을 만들 때 insert/update 를 따로 grant 하는 SQL 을 낸다.
-- 비밀값 없음. 크론 없음.
--
-- 롤백(순서대로):
--   drop view if exists public.site_company_status;
--   drop view if exists public.site_company_candidates;
--   drop table if exists public.site_company;
--   (기존 표 vendor_info·lease_ident_code·vendor_master 는 읽기만 하므로 되돌릴 것 없음)
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. 표
-- ---------------------------------------------------------------------------
create table if not exists public.site_company (
  site_code    text primary key check (site_code ~ '^[0-9]{5}$'),          -- vendor_info."코드" 5자리
  company_code text not null   check (company_code ~ '^[0-9]{10}$'),       -- 사업자번호 10자리 (vendor_master.code)
  method       text not null default 'manual'
               check (method in ('auto_direct', 'auto_ident', 'auto_name', 'manual')),
  note         text,                                                      -- 사람이 맞춘 이유 등
  updated_at   timestamptz not null default now()
);

-- 업체 → 지점들 역조회용 (PK 가 site_code 라 정방향은 따로 필요 없음)
create index if not exists site_company_company_idx on public.site_company (company_code);

alter table public.site_company enable row level security;
revoke all on public.site_company from anon, authenticated;
grant select on public.site_company to anon, authenticated;
drop policy if exists "site_company read" on public.site_company;
create policy "site_company read" on public.site_company
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. 후보 뷰 (vendor_info 에서 매번 계산 — 복사 아님)
--    security_invoker: 부르는 사람 권한으로 원본 표를 읽는다(원본 RLS·grant 그대로 적용).
-- ---------------------------------------------------------------------------
create or replace view public.site_company_candidates
with (security_invoker = true) as
with vi as (
  select btrim("코드") as site_code,
         "_업체명" as vendor_name,
         lower(regexp_replace(coalesce("기번", ''), '[^A-Za-z0-9]', '', 'g'))    as serial_key,
         lower(regexp_replace(coalesce("자산번호", ''), '[^A-Za-z0-9]', '', 'g')) as asset_key,
         -- 거래처 코드: 공백·하이픈 빼고 앞 10자리가 숫자이고 11번째가 숫자가 아닐 때만(1208117027A, 2068124900_유지보수 → 앞 10자리).
         -- 주민번호 모양(13자리)·5~6자리·11자리 오타는 버린다.
         case when regexp_replace(coalesce(_raw->>'거래처 코드', ''), '[\s-]', '', 'g') ~ '^[0-9]{10}([^0-9]|$)'
              then left(regexp_replace(_raw->>'거래처 코드', '[\s-]', '', 'g'), 10) end as direct_code
  from public.vendor_info
  where btrim("코드") ~ '^[0-9]{5}$'
),
ident as (
  select ident,
         case when regexp_replace(code, '[\s-]', '', 'g') ~ '^[0-9]{10}([^0-9]|$)'
              then left(regexp_replace(code, '[\s-]', '', 'g'), 10) end as code
  from public.lease_ident_code
),
name_key as (
  select k, min(code) as code
  from (
    select public.vendor_match_key_(name) as k, code
    from public.vendor_master where code ~ '^[0-9]{10}$'
    union all
    select public.vendor_match_key_(a.x), m.code
    from public.vendor_master m
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(m.aliases) = 'array' then m.aliases else '[]'::jsonb end) a(x)
    where m.code ~ '^[0-9]{10}$'
  ) t
  where length(k) >= 2
  group by k
  having count(distinct code) = 1
),
r as (
  select vi.site_code, vi.vendor_name, vi.direct_code,
         -- 자산번호는 정규 형식(영문1+숫자4)만 — resolve_ticket_vendor_code 와 같은 규칙
         coalesce(s.code, case when vi.asset_key ~ '^[a-z][0-9]{4}$' then a.code end) as ident_code,
         nk.code as name_code
  from vi
  left join ident s on s.ident = vi.serial_key and vi.serial_key <> ''
  left join ident a on a.ident = vi.asset_key
  left join name_key nk on nk.k = public.vendor_match_key_(vi.vendor_name)
),
tier as (
  select site_code,
         case when count(direct_code) > 0 then 'direct'
              when count(ident_code)  > 0 then 'ident'
              when count(name_code)   > 0 then 'name' end as method
  from r group by site_code
)
select r.site_code,
       case t.method when 'direct' then r.direct_code
                     when 'ident'  then r.ident_code
                     when 'name'   then r.name_code end as company_code,
       t.method,
       count(*)::int      as device_count,
       min(r.vendor_name) as sample_name
from r join tier t using (site_code)
where t.method is not null
  and case t.method when 'direct' then r.direct_code
                    when 'ident'  then r.ident_code
                    when 'name'   then r.name_code end is not null
group by 1, 2, 3;

grant select on public.site_company_candidates to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 상태 뷰 — 지점 전부. status: manual | auto_direct | auto_ident | auto_name | conflict | none
-- ---------------------------------------------------------------------------
create or replace view public.site_company_status
with (security_invoker = true) as
with auto as (
  select site_code, count(*)::int as candidate_count,
         min(company_code) as one_code, min(method) as method
  from public.site_company_candidates
  group by site_code
),
sites as (
  select distinct btrim("코드") as site_code
  from public.vendor_info
  where btrim("코드") ~ '^[0-9]{5}$'
)
select s.site_code,
       coalesce(m.company_code, case when a.candidate_count = 1 then a.one_code end) as company_code,
       case when m.site_code is not null then m.method
            when a.candidate_count = 1 then 'auto_' || a.method
            when a.candidate_count > 1 then 'conflict'
            else 'none' end as status,
       coalesce(a.candidate_count, 0) as candidate_count
from sites s
left join public.site_company m using (site_code)
left join auto a using (site_code);

grant select on public.site_company_status to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. 자동 연결분 넣기 (후보가 정확히 1개인 지점만). 다시 돌리면 자동분만 새 값으로, manual 은 그대로.
--    예상(2026-10-22 실측): 5,166행 = direct 4,911 + ident 203 + name 52.
-- ---------------------------------------------------------------------------
insert into public.site_company (site_code, company_code, method, note)
select site_code, min(company_code), 'auto_' || min(method), 'auto 2026-10-23'
from public.site_company_candidates
group by site_code
having count(*) = 1
on conflict (site_code) do update
  set company_code = excluded.company_code,
      method       = excluded.method,
      note         = excluded.note,
      updated_at   = now()
  where public.site_company.method <> 'manual';

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 실행 뒤 확인 (SELECT 만)
--   select status, count(*) from public.site_company_status group by 1 order by 1;
--     기대: auto_direct 4911 · auto_ident 203 · auto_name 52 · conflict 205 · none 479 (vendor_info 다시 받으면 조금 달라짐)
--   select * from public.site_company_candidates where site_code in
--     (select site_code from public.site_company_status where status = 'conflict') order by site_code, device_count desc;
--
-- 사람이 맞추기 (SQL Editor, 충돌·미연결 목록 보고 한 줄씩)
--   insert into public.site_company (site_code, company_code, method, note)
--   values ('10088', '1208117027', 'manual', '1372017835 는 1대뿐, 오타 추정')
--   on conflict (site_code) do update set company_code = excluded.company_code,
--     method = 'manual', note = excluded.note, updated_at = now();
--
-- 프런트(src/supabase.ts 래퍼만):
--   selectRows<{ site_code: string; company_code: string | null; status: string }>("site_company_status", `select=site_code,company_code,status&site_code=eq.${code5}`)
--   selectRows<{ site_code: string }>("site_company", `select=site_code,method&company_code=eq.${code10}`)
--   selectRows<{ site_code: string; company_code: string; device_count: number }>("site_company_candidates", "select=*&order=site_code.asc,device_count.desc&limit=1000")
-- ---------------------------------------------------------------------------
