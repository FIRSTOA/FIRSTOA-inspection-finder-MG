-- 데이터 찌꺼기 정리 (2026-10-19) — Supabase SQL Editor 에서 통째로 1회 실행
-- 2026-10-19 MCP 실측 감사에서 남아 있던 찌꺼기 7종을 한 번에 정리한다. 표·컬럼·권한은 바꾸지 않는다.
-- 되돌리기: 바꾸기 전 행을 _backup_cleanup_20261019 에 통째로(jsonb) 담아 둔다.
--   예) select row from public._backup_cleanup_20261019 where tbl='photo_albums' and id='<uuid>';
--   복원 예(필요한 것만 골라 실행):
--     update public.photo_albums p set vendor = b.row->>'vendor', urls = b.row->'urls'
--       from public._backup_cleanup_20261019 b where b.tbl='photo_albums' and b.id = p.id::text;
--     update public.visit_logs v set status='active', cancelled_at=null, cancelled_by=null
--       from public._backup_cleanup_20261019 b where b.tbl='visit_logs' and b.id = v.id::text;
--     update public.jeomgeom j set "지역" = b.row->>'지역', "_출처" = b.row->>'_출처'
--       from public._backup_cleanup_20261019 b where b.tbl='jeomgeom' and b.id = j.id::text;
--     insert into public.contact_changes select (jsonb_populate_record(null::public.contact_changes, b.row)).*
--       from public._backup_cleanup_20261019 b where b.tbl='contact_changes' on conflict do nothing;
--   백업 표는 RLS 켜고 정책 없음 → anon 은 못 읽는다. 한 달쯤 뒤 drop table 해도 된다.
-- 검사(권한나 2026-10-19): 조건부 → 조건 확인 완료. 출처 글자 깨짐은 라이브에 3356 한 건, 지역 빈칸은 정확히 이 14건.
--   트리거는 jeomgeom_collect_ids_trg(기번 목록 재계산, 부작용 없음)뿐이고 photo_albums·visit_logs·contact_changes 엔 트리거 없음.
--   visit_logs 취소는 앱의 오전송 처리(src/visits.ts setVisitsCancelled*)와 같은 세 컬럼만 바꾼다. activity_events 와는 연결 없음.
-- 두 번 실행해도 안전: 모든 문장이 "아직 안 고쳐진 행"만 고르고, 백업은 같은 행을 두 번 넣지 않는다.

begin;

create table if not exists public._backup_cleanup_20261019 (
  tbl text not null,
  id text not null,
  row jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (tbl, id)
);
alter table public._backup_cleanup_20261019 enable row level security;
revoke all on public._backup_cleanup_20261019 from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) contact_changes: 키맨체크 시트의 깨진 행(작성자 '프로', 구분 칸에 사람 이름)이 날마다 1건씩 들어온다 → 삭제
--    ※ 시트의 그 행(청현세무회계컨설팅 / 프로 / 남주현 대리님)을 영업이 고치기 전까지는 다음 날 또 1건 생긴다.
insert into public._backup_cleanup_20261019 (tbl, id, row)
select 'contact_changes', id::text, to_jsonb(c) from public.contact_changes c
 where source_text = '시트: 키맨체크' and author = '프로' and company = '청현세무회계컨설팅'
on conflict do nothing;
delete from public.contact_changes
 where source_text = '시트: 키맨체크' and author = '프로' and company = '청현세무회계컨설팅';

-- ---------------------------------------------------------------------------
-- 2) jeomgeom 3356: 출처 글자 깨짐 '카톡:��검(C)' → '카톡:점검(C)'
insert into public._backup_cleanup_20261019 (tbl, id, row)
select 'jeomgeom', id::text, to_jsonb(j) from public.jeomgeom j where id = 3356 and "_출처" <> '카톡:점검(C)'
on conflict do nothing;
update public.jeomgeom set "_출처" = '카톡:점검(C)' where id = 3356 and "_출처" <> '카톡:점검(C)';

-- ---------------------------------------------------------------------------
-- 3) jeomgeom 지역 빈칸 14건 (2026-06~08 웹앱 입력). 근거: 임대리스트 "관리 담당자"(_raw) → 없으면 작성자 소속팀.
--    region-fill-blanks-20260826.sql 과 같은 목록이지만 그 파일은 실행된 적이 없고, 16273(에이징)은 '에이징스토리'(D)와
--    헷갈린 오류라 B 로 바로잡았다(임대리스트 관리담당자 "수도권B", 같은 업체의 다른 점검 기록도 전부 B).
insert into public._backup_cleanup_20261019 (tbl, id, row)
select 'jeomgeom', id::text, to_jsonb(j) from public.jeomgeom j
 where id in (16201,16233,16273,16360,16384,16408,16434,16748,16896,16938,16954,16998,17012,17030) and coalesce("지역",'') = ''
on conflict do nothing;
update public.jeomgeom set "지역" = v.r
  from (values
    (16201,'A'),  -- 이동화행정사무소 · 작성자 김정민 소속팀
    (16233,'C'),  -- 비티엔터테인먼트 · 관리담당자 수도권C
    (16273,'B'),  -- 주식회사 에이징(AZING) · 관리담당자 수도권B (영등포)
    (16360,'C'),  -- 법무법인 행복 · 작성자 박영현 소속팀
    (16384,'A'),  -- 서안안전컨설팅 · 작성자 심태현 소속팀
    (16408,'B'),  -- 제이앤솔루션 · 관리담당자 수도권B
    (16434,'A'),  -- 나는청소년 · 관리담당자 수도권A
    (16748,'A'),  -- 풀리오 · 관리담당자 수도권A
    (16896,'A'),  -- 얄라코리아 · 관리담당자 수도권A
    (16938,'B'),  -- 미디어와이즈엔터컴 · 관리담당자 수도권B
    (16954,'A'),  -- 미딕스코리아 · 관리담당자 수도권A
    (16998,'B'),  -- 테스토코리아(유) · 관리담당자 수도권B
    (17012,'B'),  -- 주식회사 픽스커뮤니케이션즈 · 관리담당자 수도권B
    (17030,'C')   -- 주식회사 무암 (Mooam) · 작성자 이민구 소속팀
  ) as v(id, r)
 where public.jeomgeom.id = v.id and coalesce(public.jeomgeom."지역",'') = '';

-- ---------------------------------------------------------------------------
-- 4) photo_albums 업체명 '부서명:' 126건 — 같은 작성자·같은 날 점검 기록 중 저장 시각이 30분 안에서 가장 가까운 것의 업체명으로.
--    못 짝지은 16건은 '미기재'. (원인 코드는 2026-10-02 에 고쳐져 새로 생기지 않는다.)
insert into public._backup_cleanup_20261019 (tbl, id, row)
select 'photo_albums', id::text, to_jsonb(p) from public.photo_albums p where vendor = '부서명:'
on conflict do nothing;
with a as (
  select id, author, created_at, (created_at at time zone 'Asia/Seoul')::date as d
    from public.photo_albums where vendor = '부서명:'
), m as (
  select distinct on (a.id) a.id, j."_업체명" as best,
         abs(extract(epoch from (j.created_at - a.created_at))) as gap
    from a join public.jeomgeom j
      on j."작성자" = a.author and j."작성일" = to_char(a.d, 'YYYY-MM-DD')
   order by a.id, gap
)
update public.photo_albums p
   set vendor = coalesce((select best from m where m.id = p.id and m.gap <= 1800), '미기재')
 where p.vendor = '부서명:';

-- ---------------------------------------------------------------------------
-- 5) photo_albums urls 에 섞인 null 1,219개 제거 (재시도 때 실패분을 구멍째 저장하던 옛 버그, 코드는 고쳐짐).
--    사진 자체가 없는 구멍이라 복구는 불가. 전부 null 이던 앨범 88개는 빈 목록([])으로 남는다(링크는 살아 있음).
insert into public._backup_cleanup_20261019 (tbl, id, row)
select 'photo_albums', id::text, to_jsonb(p) from public.photo_albums p
 where exists (select 1 from jsonb_array_elements(p.urls) e where e = 'null'::jsonb)
on conflict do nothing;
update public.photo_albums p
   set urls = coalesce((select jsonb_agg(e) from jsonb_array_elements(p.urls) e where e <> 'null'::jsonb), '[]'::jsonb)
 where exists (select 1 from jsonb_array_elements(p.urls) e where e = 'null'::jsonb);

-- ---------------------------------------------------------------------------
-- 6) visit_logs 재전송 중복 37행 → status='cancelled' (삭제 아님. 앱의 오전송 처리와 같은 방식).
--    판정: 같은 작성자·날짜·업체·작업종류·메모·대수가 30분 안에 2번 이상 → 첫 행만 두고 나머지 취소.
--    작업종류나 메모가 다르면(같은 날 두 번 방문) 건드리지 않는다.
with g as (
  select id, row_number() over (
           partition by author, work_date, vendor, work_kinds, coalesce(note,''), machine_count
           order by created_at, id) as rn,
         max(created_at) over (partition by author, work_date, vendor, work_kinds, coalesce(note,''), machine_count)
       - min(created_at) over (partition by author, work_date, vendor, work_kinds, coalesce(note,''), machine_count) as span
    from public.visit_logs where status = 'active'
), dup as (select id from g where rn > 1 and span <= interval '30 minutes')
insert into public._backup_cleanup_20261019 (tbl, id, row)
select 'visit_logs', v.id::text, to_jsonb(v) from public.visit_logs v join dup on dup.id = v.id
on conflict do nothing;
with g as (
  select id, row_number() over (
           partition by author, work_date, vendor, work_kinds, coalesce(note,''), machine_count
           order by created_at, id) as rn,
         max(created_at) over (partition by author, work_date, vendor, work_kinds, coalesce(note,''), machine_count)
       - min(created_at) over (partition by author, work_date, vendor, work_kinds, coalesce(note,''), machine_count) as span
    from public.visit_logs where status = 'active'
)
update public.visit_logs v
   set status = 'cancelled', cancelled_at = now(), cancelled_by = '정리SQL 2026-10-19(재전송 중복)'
  from g where g.id = v.id and g.rn > 1 and g.span <= interval '30 minutes';

commit;

-- ---------------------------------------------------------------------------
-- 7) 근거가 없어 손대지 않은 것 (원하면 주석을 풀어 숨김 처리 — 행은 남고 화면·통계에서만 빠진다)
--   · jeomgeom 10692, 10693, 10694: 작성일이 비어 있고 원문에도 날짜가 없다(2026-06-24 00:12 카톡 내보내기 적재분, 3~4월 기록 섞임).
--   · jeomgeom 33681: 2026-10-08 (주)레인컴퍼니 빈 정기점검 양식(점검 안 함).
-- update public.jeomgeom set "_hidden" = true, "_hidden_by" = '정리SQL', "_hidden_at" = now() where id in (10692, 10693, 10694);
-- update public.jeomgeom set "_hidden" = true, "_hidden_by" = '정리SQL', "_hidden_at" = now() where id = 33681;

-- ---------------------------------------------------------------------------
-- 확인: 아래 6줄이 전부 0 이면 성공. 백업 건수는 참고용.
select '키맨체크 쓰레기' as 항목, count(*) as 남은수 from public.contact_changes where source_text='시트: 키맨체크' and author='프로' and company='청현세무회계컨설팅'
union all select '출처 글자 깨짐', count(*) from public.jeomgeom where "_출처" like '%�%'
union all select '점검 지역 빈칸', count(*) from public.jeomgeom where coalesce("지역",'')=''
union all select '앨범 업체명 부서명:', count(*) from public.photo_albums where vendor='부서명:'
union all select '앨범 urls null', count(*) from public.photo_albums where exists (select 1 from jsonb_array_elements(urls) e where e='null'::jsonb)
union all select '방문기록 30분 내 중복', count(*) from (
  select 1 from public.visit_logs where status='active'
   group by author, work_date, vendor, work_kinds, coalesce(note,''), machine_count
  having count(*)>1 and max(created_at)-min(created_at) <= interval '30 minutes') x
union all select '백업에 담긴 행(참고)', count(*) from public._backup_cleanup_20261019;
