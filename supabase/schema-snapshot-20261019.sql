-- =====================================================================
-- schema-snapshot-20261019.sql
-- 날짜: 2026-10-19
-- 목적: 저장소에 CREATE 문이 없던 라이브 DB 객체의 정의를 기록한다.
--       DB 재구축·복구 참고용. 실행 대상 아님.
-- 생성 방법: Supabase MCP(읽기 전용) SELECT 조회 결과를 옮겨 적음
--       (pg_attribute/pg_attrdef, pg_get_constraintdef, pg_indexes, pg_policies,
--        pg_get_triggerdef, pg_get_functiondef, pg_get_viewdef, cron.job,
--        has_table_privilege).
-- 안전장치: 실수로 전체를 실행해도 기존 객체를 바꾸지 않도록
--   - 표: create table if not exists
--   - 인덱스: pg_indexes.indexdef 에 if not exists 만 덧붙임
--   - 정책·트리거: 같은 이름이 없을 때만 만드는 do 블록
--   - 함수: create or replace function (라이브 본문 그대로)
--   - 뷰: create or replace view (라이브 정의 그대로). records_all 은 주석 처리(아래 설명)
--   - 컬럼: alter table ... add column if not exists
--   - cron: 주석 처리(<ANON_KEY> 자리표시자 때문에 그대로 실행하면 안 됨)
-- 주의:
--   - generated column(vendor_info 품목/모델명/제조사/키맨)과 identity(id) 는
--     복원 시 데이터 적재 방식(overriding system value 등)에 따라 손봐야 할 수 있다.
--   - 트리거 함수 jeomgeom_collect_ids / vendor_info_sync_search / log_outbox_delivery 는
--     저장소에 있다(jeomgeom-serial-index.sql, vendor-info-search.sql·reception-sync.sql,
--     room-activity-quiet-heartbeat.sql). 표보다 먼저 함수가 있어야 트리거가 만들어진다.
--   - 인덱스 중 gin_trgm_ops 는 pg_trgm 확장이 필요하다.
--   - 함수 본문의 줄바꿈은 라이브에서 CRLF 였던 것을 LF 로 적었다(내용 동일).
--   - cron 명령 안의 anon JWT 는 <ANON_KEY> 로 바꿨다. 다른 *-cron.sql 과 같은 anon 키.
-- =====================================================================


-- ===== 1. 표 13개 (컬럼·제약·인덱스·RLS·정책·트리거) =====

-- ----- jeomgeom -----
create table if not exists public.jeomgeom (
  id bigint generated always as identity not null,
  "작성일" text,
  "작성자" text,
  "구분" text,
  "레벨" text,
  "등급" text,
  "업체명" text,
  "부서명" text,
  "지역" text,
  "키맨/접수자" text,
  "모델명" text,
  "시리얼넘버" text,
  "자산기번" text,
  "내용" text,
  "처리내용" text,
  "매수" text,
  "토너잔량" text,
  "폐통" text,
  "여분" text,
  "한틴이카유무" text,
  "주차비지원유무" text,
  "특이사항" text,
  "_업체명" text,
  "_출처" text,
  "_원문" text,
  "_등록시각" text,
  "_dupKey" text,
  created_at timestamp with time zone default now() not null,
  "_기번목록" text[],
  _hidden boolean default false not null,
  _hidden_by text default ''::text not null,
  _hidden_at timestamp with time zone,
  _edit_log jsonb default '[]'::jsonb not null,
  constraint jeomgeom_pkey PRIMARY KEY (id)
);
create index if not exists jeomgeom_asset_idx ON public.jeomgeom USING btree ("자산기번");
create index if not exists jeomgeom_asset_trgm ON public.jeomgeom USING gin ("자산기번" gin_trgm_ops);
create unique index if not exists jeomgeom_dupkey_uniq ON public.jeomgeom USING btree ("_dupKey");
create index if not exists jeomgeom_raw_trgm ON public.jeomgeom USING gin ("_원문" gin_trgm_ops);
create index if not exists jeomgeom_region_idx ON public.jeomgeom USING btree ("지역");
create index if not exists jeomgeom_serial_idx ON public.jeomgeom USING btree ("시리얼넘버");
create index if not exists jeomgeom_serial_trgm ON public.jeomgeom USING gin ("시리얼넘버" gin_trgm_ops);
create index if not exists jeomgeom_vendor2_trgm ON public.jeomgeom USING gin ("업체명" gin_trgm_ops);
create index if not exists jeomgeom_vendor_idx ON public.jeomgeom USING btree ("_업체명");
create index if not exists jeomgeom_vendor_trgm ON public.jeomgeom USING gin ("_업체명" gin_trgm_ops);
alter table public.jeomgeom enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jeomgeom' and policyname='anon read') then
    create policy "anon read" on public.jeomgeom as permissive for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jeomgeom' and policyname='anon write') then
    create policy "anon write" on public.jeomgeom as permissive for insert to anon with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jeomgeom' and policyname='jeomgeom anon update hidden') then
    create policy "jeomgeom anon update hidden" on public.jeomgeom as permissive for update to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.jeomgeom'::regclass and tgname='jeomgeom_collect_ids_trg') then
    CREATE TRIGGER jeomgeom_collect_ids_trg BEFORE INSERT OR UPDATE ON public.jeomgeom FOR EACH ROW EXECUTE FUNCTION jeomgeom_collect_ids();
  end if;
end $$;

-- ----- as_records -----
create table if not exists public.as_records (
  id bigint generated always as identity not null,
  "작성일" text,
  "작성자" text,
  "구분" text,
  "레벨" text,
  "등급" text,
  "업체명" text,
  "부서명" text,
  "지역" text,
  "키맨/접수자" text,
  "모델명" text,
  "시리얼넘버" text,
  "자산기번" text,
  "내용" text,
  "처리내용" text,
  "매수" text,
  "토너잔량" text,
  "폐통" text,
  "여분" text,
  "한틴이카유무" text,
  "주차비지원유무" text,
  "특이사항" text,
  "_업체명" text,
  "_출처" text,
  "_원문" text,
  "_등록시각" text,
  "_dupKey" text,
  created_at timestamp with time zone default now() not null,
  _hidden boolean default false not null,
  _hidden_by text default ''::text not null,
  _hidden_at timestamp with time zone,
  _edit_log jsonb default '[]'::jsonb not null,
  constraint as_records_pkey PRIMARY KEY (id)
);
create index if not exists as_records_asset_idx ON public.as_records USING btree ("자산기번");
create index if not exists as_records_asset_trgm ON public.as_records USING gin ("자산기번" gin_trgm_ops);
create unique index if not exists as_records_dupkey_uniq ON public.as_records USING btree ("_dupKey");
create index if not exists as_records_raw_trgm ON public.as_records USING gin ("_원문" gin_trgm_ops);
create index if not exists as_records_serial_idx ON public.as_records USING btree ("시리얼넘버");
create index if not exists as_records_serial_trgm ON public.as_records USING gin ("시리얼넘버" gin_trgm_ops);
create index if not exists as_records_vendor2_trgm ON public.as_records USING gin ("업체명" gin_trgm_ops);
create index if not exists as_records_vendor_idx ON public.as_records USING btree ("_업체명");
create index if not exists as_records_vendor_trgm ON public.as_records USING gin ("_업체명" gin_trgm_ops);
create index if not exists as_region_idx ON public.as_records USING btree ("지역");
create index if not exists as_vendor_idx ON public.as_records USING btree ("_업체명");  -- as_records_vendor_idx 와 중복(라이브 그대로 기록)
alter table public.as_records enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='as_records' and policyname='anon read') then
    create policy "anon read" on public.as_records as permissive for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='as_records' and policyname='anon write') then
    create policy "anon write" on public.as_records as permissive for insert to anon with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='as_records' and policyname='as_records anon update hidden') then
    create policy "as_records anon update hidden" on public.as_records as permissive for update to anon, authenticated using (true) with check (true);
  end if;
end $$;

-- ----- vendor_info -----
create table if not exists public.vendor_info (
  id bigint generated always as identity not null,
  "업태" text,
  "첫계약일" text,
  "계약일" text,
  "종료일" text,
  "남은개월" text,
  "계약기간" text,
  "기본금액" text,
  "연평균" text,
  "등급" text,
  "코드" text,
  "일반전화" text,
  "임대여부" text,
  "납품/교체일" text,
  "시리얼번호(기번)" text,
  "대수" text,
  "기종" text,
  "주소상세주소" text,
  "시/구" text,
  "추가(컬)" text,
  "추가(흑)" text,
  "추가조건" text,
  "누적방식 (월/분/반/년)" text,
  "미수금액" text,
  "_업체명" text,
  "_출처" text,
  "_원문" text,
  "_등록시각" text,
  "_dupKey" text,
  _raw jsonb,
  created_at timestamp with time zone default now() not null,
  "자산번호" text,
  "순번" integer,
  "기번" text,
  _hidden boolean default false not null,
  "품목" text generated always as ((_raw ->> '품목'::text)) stored,
  "모델명" text generated always as ((_raw ->> '모델명'::text)) stored,
  "제조사" text generated always as ((_raw ->> '제조사'::text)) stored,
  "키맨" text generated always as ((_raw ->> '키맨'::text)) stored,
  constraint vendor_info_pkey PRIMARY KEY (id)
);
create index if not exists vendor_info_asset_trgm ON public.vendor_info USING gin ("자산번호" gin_trgm_ops);
create index if not exists vendor_info_code_idx ON public.vendor_info USING btree ("코드");
create index if not exists vendor_info_seq_idx ON public.vendor_info USING btree ("순번");  -- vendor_info_seq_uidx 와 중복(라이브 그대로 기록)
create unique index if not exists vendor_info_seq_uidx ON public.vendor_info USING btree ("순번");
create index if not exists vendor_info_serial_trgm ON public.vendor_info USING gin ("기번" gin_trgm_ops);
create index if not exists vendor_info_synced_idx ON public.vendor_info USING btree ("_등록시각");
create index if not exists vendor_info_vendor_idx ON public.vendor_info USING btree ("_업체명");
create index if not exists vendor_info_vendor_trgm ON public.vendor_info USING gin ("_업체명" gin_trgm_ops);
alter table public.vendor_info enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='vendor_info' and policyname='anon all') then
    create policy "anon all" on public.vendor_info as permissive for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.vendor_info'::regclass and tgname='vendor_info_sync_search_trg') then
    CREATE TRIGGER vendor_info_sync_search_trg BEFORE INSERT OR UPDATE ON public.vendor_info FOR EACH ROW EXECUTE FUNCTION vendor_info_sync_search();
  end if;
end $$;

-- ----- misu -----
create table if not exists public.misu (
  id bigint generated always as identity not null,
  "입력일" text,
  "입력자" text,
  "거래처코드" text,
  "등급" text,
  "업체담당자" text,
  "임대여부" text,
  "관리담당자" text,
  "지역" text,
  "주소" text,
  "미수개월" text,
  "미수잔액" text,
  "실제 개월수" text,
  "실제 잔액" text,
  "휴대폰번호" text,
  "메일주소" text,
  "입금약속일" text,
  "원문" text,
  "_업체명" text,
  "_출처" text,
  "_원문" text,
  "_등록시각" text,
  "_dupKey" text,
  _raw jsonb,
  created_at timestamp with time zone default now() not null,
  "작성자" text,
  "업체명" text,
  "담당자" text,
  "미수금액" text,
  "보증금미입금" text,
  "방문내용" text,
  "고객반응" text,
  "약속일" text,
  "후속담당자" text,
  "특이사항" text,
  _hidden boolean default false not null,
  _hidden_by text default ''::text not null,
  _hidden_at timestamp with time zone,
  constraint misu_pkey PRIMARY KEY (id)
);
create unique index if not exists misu_dupkey_idx ON public.misu USING btree ("_dupKey");
create index if not exists misu_vendor_idx ON public.misu USING btree ("_업체명");
alter table public.misu enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='misu' and policyname='anon all') then
    create policy "anon all" on public.misu as permissive for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='misu' and policyname='misu anon insert') then
    create policy "misu anon insert" on public.misu as permissive for insert to anon with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='misu' and policyname='misu anon read') then
    create policy "misu anon read" on public.misu as permissive for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='misu' and policyname='misu anon update hidden') then
    create policy "misu anon update hidden" on public.misu as permissive for update to anon, authenticated using (true) with check (true);
  end if;
end $$;

-- ----- overage -----
create table if not exists public.overage (
  id bigint generated always as identity not null,
  "순번" text,
  "날짜" text,
  "특이사항" text,
  "임대여부" text,
  "등급" text,
  "접수내용" text,
  "컬러초과료" text,
  "흑백초과료" text,
  "합계" text,
  "마감방식" text,
  "자산번호" text,
  "모델명" text,
  "기본금액" text,
  "연평균" text,
  "계약일" text,
  "종료일" text,
  "남은개월" text,
  "기본매수" text,
  "초과장당금액" text,
  "미수개월수" text,
  "미수금액" text,
  "_업체명" text,
  "_출처" text,
  "_원문" text,
  "_등록시각" text,
  "_dupKey" text,
  _raw jsonb,
  created_at timestamp with time zone default now() not null,
  _hidden boolean default false not null,
  _hidden_by text default ''::text not null,
  _hidden_at timestamp with time zone,
  constraint overage_pkey PRIMARY KEY (id)
);
create index if not exists overage_raw_trgm ON public.overage USING gin ("_원문" gin_trgm_ops);
create index if not exists overage_vendor_idx ON public.overage USING btree ("_업체명");
alter table public.overage enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='overage' and policyname='anon all') then
    create policy "anon all" on public.overage as permissive for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='overage' and policyname='overage anon update hidden') then
    create policy "overage anon update hidden" on public.overage as permissive for update to anon, authenticated using (true) with check (true);
  end if;
end $$;

-- ----- lease_status -----
create table if not exists public.lease_status (
  id bigint generated always as identity not null,
  "순" text,
  "구분" text,
  "지역" text,
  "분류" text,
  "년월" text,
  "납품일" text,
  "납품담당" text,
  "납품여부" text,
  "통합리스트순" text,
  "계약서여부" text,
  "계약기간" text,
  "기본료" text,
  "품목" text,
  "유입경로" text,
  "유입경로 (자세히)" text,
  "매입가" text,
  "교체/철수사유 (자세히)" text,
  "유입담당자 (발굴관리)" text,
  "영업담당자" text,
  "요청담당자" text,
  "보증금" text,
  "보증금입금확인" text,
  "교체전기종" text,
  "기종" text,
  "수량" text,
  "담당자" text,
  "설치인원" text,
  "소요시간" text,
  "업종" text,
  "현황표" text,
  "유입발굴 담당팀" text,
  "영업 담당팀" text,
  "주차" text,
  "총금액" text,
  "금액" text,
  "해피콜 내용추가" text,
  "매입총액" text,
  "_업체명" text,
  "_출처" text,
  "_원문" text,
  "_등록시각" text,
  "_dupKey" text,
  _raw jsonb,
  created_at timestamp with time zone default now() not null,
  _hidden boolean default false not null,
  constraint lease_status_pkey PRIMARY KEY (id)
);
create index if not exists lease_status_vendor_idx ON public.lease_status USING btree ("_업체명");
alter table public.lease_status enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='lease_status' and policyname='anon all') then
    create policy "anon all" on public.lease_status as permissive for all to anon using (true) with check (true);
  end if;
end $$;

-- ----- churn_defense -----
create table if not exists public.churn_defense (
  id bigint generated always as identity not null,
  "날짜" text,
  "담당팀" text,
  "해지사유" text,
  "방어전략" text,
  "진행상황" text,
  "결과" text,
  "내용" text,
  "원문" text,
  "_업체명" text,
  "_출처" text,
  "_원문" text,
  "_등록시각" text,
  "_dupKey" text,
  _raw jsonb,
  created_at timestamp with time zone default now() not null,
  _hidden boolean default false not null,
  _hidden_by text default ''::text not null,
  _hidden_at timestamp with time zone,
  constraint churn_defense_pkey PRIMARY KEY (id)
);
create unique index if not exists churn_defense_dupkey_uniq ON public.churn_defense USING btree ("_dupKey");
create index if not exists churn_defense_vendor_idx ON public.churn_defense USING btree ("_업체명");
alter table public.churn_defense enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='churn_defense' and policyname='anon all') then
    create policy "anon all" on public.churn_defense as permissive for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='churn_defense' and policyname='churn_defense anon update hidden') then
    create policy "churn_defense anon update hidden" on public.churn_defense as permissive for update to anon, authenticated using (true) with check (true);
  end if;
end $$;

-- ----- mgmt_support -----
create table if not exists public.mgmt_support (
  id bigint generated always as identity not null,
  "날짜" text,
  "담당팀" text,
  "요청유형" text,
  "내용" text,
  "처리결과" text,
  "원문" text,
  "_업체명" text,
  "_출처" text,
  "_원문" text,
  "_등록시각" text,
  "_dupKey" text,
  _raw jsonb,
  created_at timestamp with time zone default now() not null,
  _hidden boolean default false not null,
  _hidden_by text default ''::text not null,
  _hidden_at timestamp with time zone,
  constraint mgmt_support_pkey PRIMARY KEY (id)
);
create unique index if not exists mgmt_support_dupkey_uniq ON public.mgmt_support USING btree ("_dupKey");
create index if not exists mgmt_support_vendor_idx ON public.mgmt_support USING btree ("_업체명");
alter table public.mgmt_support enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='mgmt_support' and policyname='anon all') then
    create policy "anon all" on public.mgmt_support as permissive for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='mgmt_support' and policyname='mgmt_support anon update hidden') then
    create policy "mgmt_support anon update hidden" on public.mgmt_support as permissive for update to anon, authenticated using (true) with check (true);
  end if;
end $$;

-- ----- outbox -----
create table if not exists public.outbox (
  id uuid default gen_random_uuid() not null,
  room text not null,
  text text not null,
  created_at timestamp with time zone default now() not null,
  constraint outbox_pkey PRIMARY KEY (id)
);
create index if not exists outbox_created_idx ON public.outbox USING btree (created_at);
alter table public.outbox enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='outbox' and policyname='anon all') then
    create policy "anon all" on public.outbox as permissive for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.outbox'::regclass and tgname='outbox_delivery_log') then
    CREATE TRIGGER outbox_delivery_log AFTER DELETE ON public.outbox FOR EACH ROW EXECUTE FUNCTION log_outbox_delivery();
  end if;
end $$;

-- ----- app_config -----
create table if not exists public.app_config (
  key text not null,
  value text,
  constraint app_config_pkey PRIMARY KEY (key)
);
alter table public.app_config enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_config' and policyname='anon read') then
    create policy "anon read" on public.app_config as permissive for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_config' and policyname='app_config anon write') then
    create policy "app_config anon write" on public.app_config as permissive for all to anon using (true) with check (true);
  end if;
end $$;

-- ----- room_map -----
create table if not exists public.room_map (
  category text not null,
  region text not null,
  room text not null,
  constraint room_map_pkey PRIMARY KEY (category, region)
);
alter table public.room_map enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='room_map' and policyname='anon read') then
    create policy "anon read" on public.room_map as permissive for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='room_map' and policyname='room_map anon write') then
    create policy "room_map anon write" on public.room_map as permissive for all to anon using (true) with check (true);
  end if;
end $$;

-- ----- photo_albums -----
create table if not exists public.photo_albums (
  id uuid default gen_random_uuid() not null,
  vendor text,
  urls jsonb not null,
  created_at timestamp with time zone default now() not null,
  category text default '현장'::text not null,
  author text,
  region text,
  source_type text default 'field'::text not null,
  constraint photo_albums_pkey PRIMARY KEY (id)
);
create index if not exists photo_albums_category_created_idx ON public.photo_albums USING btree (category, created_at DESC);
create index if not exists photo_albums_source_created_idx ON public.photo_albums USING btree (source_type, created_at DESC);
create index if not exists photo_albums_vendor_created_idx ON public.photo_albums USING btree (vendor, created_at DESC);
alter table public.photo_albums enable row level security;
-- 라이브에 같은 뜻의 정책이 이름만 다르게 두 벌 있다(그대로 기록).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='photo_albums' and policyname='anon insert albums') then
    create policy "anon insert albums" on public.photo_albums as permissive for insert to anon with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='photo_albums' and policyname='anon read albums') then
    create policy "anon read albums" on public.photo_albums as permissive for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='photo_albums' and policyname='photo albums anon insert') then
    create policy "photo albums anon insert" on public.photo_albums as permissive for insert to anon with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='photo_albums' and policyname='photo albums anon read') then
    create policy "photo albums anon read" on public.photo_albums as permissive for select to anon using (true);
  end if;
end $$;

-- ----- knowledge_docs -----
create table if not exists public.knowledge_docs (
  id uuid default gen_random_uuid() not null,
  category text default ''::text not null,
  brand text default ''::text not null,
  title text not null,
  content text default ''::text not null,
  source text default 'notion'::text not null,
  author text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  "_dupKey" text,
  summary text default ''::text not null,
  models jsonb default '[]'::jsonb not null,
  parts jsonb default '[]'::jsonb not null,
  difficulty text default ''::text not null,
  content_clean text default ''::text not null,
  symptoms jsonb default '[]'::jsonb not null,
  constraint "knowledge_docs__dupKey_key" UNIQUE ("_dupKey"),
  constraint knowledge_docs_pkey PRIMARY KEY (id)
);
alter table public.knowledge_docs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='knowledge_docs' and policyname='knowledge anon all') then
    create policy "knowledge anon all" on public.knowledge_docs as permissive for all to anon using (true) with check (true);
  end if;
end $$;


-- ===== 2. 함수 4개 (pg_get_functiondef 그대로) =====
-- strip_helpers_ 는 vendor_detail 이 쓰므로 먼저.
-- search_vendors 는 뷰 all_vendor_tabs 를 읽는다(language sql 은 만들 때 참조를 검사하므로
-- 새 DB 에선 3절 뷰를 먼저 만든 뒤 search_vendors 를 만들어야 한다).
-- vendor_detail 은 recontract·overage_adjust·pc_expansion·mfp_expansion·bulman 표가 있어야 한다.

CREATE OR REPLACE FUNCTION public.strip_helpers_(j jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select j - '{id,_업체명,_출처,_원문,_등록시각,_dupKey,_raw,created_at}'::text[];
$function$
;

CREATE OR REPLACE FUNCTION public.vendor_detail(v text)
 RETURNS TABLE(tab text, rows jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  select s.tab, s.rows from (
              select '점검' tab, jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) rows from public.jeomgeom t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select 'AS', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.as_records t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select '재계약', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.recontract t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select '초과업체조정', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.overage_adjust t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select '해지방어', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.churn_defense t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select '경영지원', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.mgmt_support t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select 'PC확장성', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.pc_expansion t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select '초과', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.overage t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select '복합기확장성', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.mfp_expansion t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select '업체정보', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.vendor_info t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select '임대현황표', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.lease_status t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select '불만', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.bulman t where t."_업체명"=v and coalesce(t."_hidden", false) = false
    union all select '미수', jsonb_agg(strip_helpers_(to_jsonb(t)) order by t.id desc) from public.misu t where t."_업체명"=v and coalesce(t."_hidden", false) = false
  ) s where s.rows is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.search_aircleaner(q text)
 RETURNS TABLE(vendor text, model text, dt text, region text, author text, n bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select t."_업체명" as vendor,
         (array_agg(t."모델명" order by t.id desc))[1] as model,
         max(t."작성일") as dt,
         (array_agg(t."지역" order by t.id desc))[1] as region,
         (array_agg(t."작성자" order by t.id desc))[1] as author,
         count(*)::bigint as n
  from public.jeomgeom t
  where t."_업체명" is not null and t."_업체명" <> ''
    and regexp_replace(t."_업체명",'[[:space:]·–—-]','','g')
        ilike '%'||regexp_replace(q,'[[:space:]·–—-]','','g')||'%'
    and (t."모델명" ~* '(블루스카이|샤오미|xiaomi|mi[ -]?air|blue ?sky)'
         or t."_원문" ~* '(블루스카이|샤오미|xiaomi|mi[ -]?air|blue ?sky)')
  group by t."_업체명"
  order by max(t."작성일") desc nulls last, t."_업체명"
  limit 50;
$function$
;


-- ===== 3. 뷰 2개 =====

-- ----- all_vendor_tabs (통합검색이 읽는 뷰, security_invoker=true) -----
CREATE OR REPLACE VIEW public.all_vendor_tabs AS
 SELECT jeomgeom."_업체명" AS vendor,
    '점검'::text AS tab,
    jeomgeom."작성일" AS dt,
    jeomgeom."지역" AS r,
    jeomgeom."작성자" AS au,
    jeomgeom."모델명" AS mdl,
    (char_length(COALESCE(jeomgeom."_원문", ''::text)) - char_length(replace(COALESCE(jeomgeom."_원문", ''::text), '모델명'::text, ''::text))) / 3 AS units
   FROM jeomgeom
  WHERE COALESCE(jeomgeom._hidden, false) = false
UNION ALL
 SELECT as_records."_업체명" AS vendor,
    'AS'::text AS tab,
    as_records."작성일" AS dt,
    as_records."지역" AS r,
    as_records."작성자" AS au,
    as_records."모델명" AS mdl,
    (char_length(COALESCE(as_records."_원문", ''::text)) - char_length(replace(COALESCE(as_records."_원문", ''::text), '모델명'::text, ''::text))) / 3 AS units
   FROM as_records
  WHERE COALESCE(as_records._hidden, false) = false
UNION ALL
 SELECT recontract."_업체명" AS vendor,
    '재계약'::text AS tab,
    COALESCE(NULLIF(recontract."계약종료일", ''::text), recontract."날짜") AS dt,
    COALESCE(recontract."지역", ''::text) AS r,
    COALESCE(NULLIF(recontract."작성자", ''::text), recontract."담당팀") AS au,
    ''::text AS mdl,
    NULL::integer AS units
   FROM recontract
  WHERE COALESCE(recontract._hidden, false) = false
UNION ALL
 SELECT overage_adjust."_업체명" AS vendor,
    '초과업체조정'::text AS tab,
    overage_adjust."방문일" AS dt,
    overage_adjust."지역" AS r,
    overage_adjust."작성자" AS au,
    overage_adjust."기종" AS mdl,
    NULL::integer AS units
   FROM overage_adjust
  WHERE COALESCE(overage_adjust._hidden, false) = false
UNION ALL
 SELECT churn_defense."_업체명" AS vendor,
    '해지방어'::text AS tab,
    churn_defense."날짜" AS dt,
    ''::text AS r,
    churn_defense."담당팀" AS au,
    ''::text AS mdl,
    NULL::integer AS units
   FROM churn_defense
  WHERE COALESCE(churn_defense._hidden, false) = false
UNION ALL
 SELECT mgmt_support."_업체명" AS vendor,
    '경영지원'::text AS tab,
    mgmt_support."날짜" AS dt,
    ''::text AS r,
    mgmt_support."담당팀" AS au,
    ''::text AS mdl,
    NULL::integer AS units
   FROM mgmt_support
  WHERE COALESCE(mgmt_support._hidden, false) = false
UNION ALL
 SELECT pc_expansion."_업체명" AS vendor,
    'PC확장성'::text AS tab,
    pc_expansion."날짜" AS dt,
    pc_expansion."지역" AS r,
    pc_expansion."작성자" AS au,
    ''::text AS mdl,
    NULL::integer AS units
   FROM pc_expansion
  WHERE COALESCE(pc_expansion._hidden, false) = false
UNION ALL
 SELECT overage."_업체명" AS vendor,
    '초과'::text AS tab,
    overage."날짜" AS dt,
    ''::text AS r,
    ''::text AS au,
    overage."모델명" AS mdl,
    NULL::integer AS units
   FROM overage
  WHERE COALESCE(overage._hidden, false) = false
UNION ALL
 SELECT mfp_expansion."_업체명" AS vendor,
    '복합기확장성'::text AS tab,
    mfp_expansion."등록일" AS dt,
    mfp_expansion."미팅지역" AS r,
    mfp_expansion."등록자" AS au,
    ''::text AS mdl,
    NULL::integer AS units
   FROM mfp_expansion
  WHERE COALESCE(mfp_expansion._hidden, false) = false
UNION ALL
 SELECT vendor_info."_업체명" AS vendor,
    '업체정보'::text AS tab,
    vendor_info."종료일" AS dt,
    vendor_info."시/구" AS r,
    ''::text AS au,
    vendor_info."기종" AS mdl,
    NULL::integer AS units
   FROM vendor_info
  WHERE COALESCE(vendor_info._hidden, false) = false
UNION ALL
 SELECT lease_status."_업체명" AS vendor,
    '임대현황표'::text AS tab,
    lease_status."납품일" AS dt,
    lease_status."지역" AS r,
    lease_status."납품담당" AS au,
    lease_status."기종" AS mdl,
    NULL::integer AS units
   FROM lease_status
  WHERE COALESCE(lease_status._hidden, false) = false
UNION ALL
 SELECT bulman."_업체명" AS vendor,
    '불만'::text AS tab,
    COALESCE(NULLIF(bulman."방문일", ''::text), bulman."날짜") AS dt,
    COALESCE(bulman."지역", ''::text) AS r,
    bulman."작성자" AS au,
    bulman."기종" AS mdl,
    NULL::integer AS units
   FROM bulman
  WHERE COALESCE(bulman._hidden, false) = false
UNION ALL
 SELECT misu."_업체명" AS vendor,
    '미수'::text AS tab,
    misu."입력일" AS dt,
    misu."지역" AS r,
    misu."입력자" AS au,
    ''::text AS mdl,
    NULL::integer AS units
   FROM misu
  WHERE COALESCE(misu._hidden, false) = false;
alter view public.all_vendor_tabs set (security_invoker = true);

-- search_vendors 는 all_vendor_tabs 를 읽으므로 뷰 다음에 둔다.
CREATE OR REPLACE FUNCTION public.search_vendors(q text)
 RETURNS TABLE(vendor text, counts jsonb, meta jsonb, total bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with hits as (
    select vendor,tab,dt,r,au,mdl,units from public.all_vendor_tabs
    where vendor is not null and vendor<>''
      and regexp_replace(vendor,'[[:space:]·–—-]','','g')
          ilike '%'||regexp_replace(q,'[[:space:]·–—-]','','g')||'%'
  ),
  cnt as (select vendor,tab,count(*)::int c from hits group by vendor,tab),
  latest as (select distinct on (vendor,tab) vendor,tab,dt,r,au,mdl,units
             from hits order by vendor,tab,dt desc nulls last)
  select c.vendor,
         jsonb_object_agg(c.tab,c.c),
         jsonb_object_agg(c.tab,jsonb_build_object('d',l.dt,'r',l.r,'author',l.au,'model',l.mdl,'count',l.units)),
         sum(c.c)::bigint
  from cnt c join latest l on l.vendor=c.vendor and l.tab=c.tab
  group by c.vendor order by sum(c.c) desc, c.vendor limit 50;
$function$
;

-- ----- records_all (security_invoker=on) -----
-- 주석 처리: supabase/db-maintenance-20261019.sql 이 이 뷰를 지운다(코드에서 안 쓰고,
-- _hidden 필터가 없어 숨긴 기록이 새는 통로). 이 파일을 실행해 되살리지 않도록 기록만 남긴다.
-- CREATE OR REPLACE VIEW public.records_all AS
--  SELECT '점검'::text AS tab,
--     jeomgeom.id,
--     jeomgeom."작성일",
--     jeomgeom."작성자",
--     jeomgeom."구분",
--     jeomgeom."레벨",
--     jeomgeom."등급",
--     jeomgeom."업체명",
--     jeomgeom."부서명",
--     jeomgeom."지역",
--     jeomgeom."키맨/접수자",
--     jeomgeom."모델명",
--     jeomgeom."시리얼넘버",
--     jeomgeom."자산기번",
--     jeomgeom."내용",
--     jeomgeom."처리내용",
--     jeomgeom."매수",
--     jeomgeom."토너잔량",
--     jeomgeom."폐통",
--     jeomgeom."여분",
--     jeomgeom."한틴이카유무",
--     jeomgeom."주차비지원유무",
--     jeomgeom."특이사항",
--     jeomgeom."_업체명",
--     jeomgeom."_출처",
--     jeomgeom."_원문",
--     jeomgeom."_등록시각",
--     jeomgeom."_dupKey",
--     jeomgeom.created_at
--    FROM jeomgeom
-- UNION ALL
--  SELECT 'AS'::text AS tab,
--     as_records.id,
--     as_records."작성일",
--     as_records."작성자",
--     as_records."구분",
--     as_records."레벨",
--     as_records."등급",
--     as_records."업체명",
--     as_records."부서명",
--     as_records."지역",
--     as_records."키맨/접수자",
--     as_records."모델명",
--     as_records."시리얼넘버",
--     as_records."자산기번",
--     as_records."내용",
--     as_records."처리내용",
--     as_records."매수",
--     as_records."토너잔량",
--     as_records."폐통",
--     as_records."여분",
--     as_records."한틴이카유무",
--     as_records."주차비지원유무",
--     as_records."특이사항",
--     as_records."_업체명",
--     as_records."_출처",
--     as_records."_원문",
--     as_records."_등록시각",
--     as_records."_dupKey",
--     as_records.created_at
--    FROM as_records;
-- alter view public.records_all set (security_invoker = true);


-- ===== 4. 저장소 파일에 없고 라이브에만 있는 컬럼 41개 =====

-- service_receptions (11)
alter table public.service_receptions add column if not exists remote_meta jsonb default '{}'::jsonb not null;
alter table public.service_receptions add column if not exists completed_at timestamp with time zone;
alter table public.service_receptions add column if not exists completed_by text default ''::text not null;
alter table public.service_receptions add column if not exists receiver_name text default ''::text not null;
alter table public.service_receptions add column if not exists receiver_phone text default ''::text not null;
alter table public.service_receptions add column if not exists keyman_info text default ''::text not null;
alter table public.service_receptions add column if not exists grade text default ''::text not null;
alter table public.service_receptions add column if not exists field text default ''::text not null;
alter table public.service_receptions add column if not exists first_no text default ''::text not null;
alter table public.service_receptions add column if not exists cust_kind text default ''::text not null;
alter table public.service_receptions add column if not exists sheet_row integer;

-- as_tickets (7)
alter table public.as_tickets add column if not exists asset text default ''::text not null;
alter table public.as_tickets add column if not exists grade text default ''::text not null;
alter table public.as_tickets add column if not exists keyman text default ''::text not null;
alter table public.as_tickets add column if not exists "naverPushedAt" timestamp with time zone;
alter table public.as_tickets add column if not exists "naverUid" text default ''::text not null;
alter table public.as_tickets add column if not exists "calendarTitle" text default ''::text not null;
alter table public.as_tickets add column if not exists source text default ''::text not null;

-- cs_members (2)
alter table public.cs_members add column if not exists dept text default 'CS팀'::text not null;
alter table public.cs_members add column if not exists title text default ''::text not null;

-- contact_changes (5)
alter table public.contact_changes add column if not exists shared_at timestamp with time zone;
alter table public.contact_changes add column if not exists shared_room text default ''::text not null;
alter table public.contact_changes add column if not exists _hidden boolean default false not null;
alter table public.contact_changes add column if not exists _hidden_by text default ''::text not null;
alter table public.contact_changes add column if not exists _hidden_at timestamp with time zone;

-- dept_requests (5)
alter table public.dept_requests add column if not exists target_type text default '전체'::text not null;
alter table public.dept_requests add column if not exists target text default ''::text not null;
alter table public.dept_requests add column if not exists started_at timestamp with time zone;
alter table public.dept_requests add column if not exists started_by text default ''::text not null;
alter table public.dept_requests add column if not exists requester_ack boolean default true not null;

-- vendor_notes (2)
alter table public.vendor_notes add column if not exists work_start text default ''::text not null;
alter table public.vendor_notes add column if not exists lunch_time text default ''::text not null;

-- notices (1)
alter table public.notices add column if not exists category text default '일반'::text not null;

-- reading_posts (2)
alter table public.reading_posts add column if not exists cover_url text default ''::text not null;
alter table public.reading_posts add column if not exists photo_url text default ''::text not null;

-- stock_items (3)
alter table public.stock_items add column if not exists _hidden boolean default false not null;
alter table public.stock_items add column if not exists _hidden_by text default ''::text not null;
alter table public.stock_items add column if not exists _hidden_at timestamp with time zone;

-- logistics_records (3)
alter table public.logistics_records add column if not exists _hidden boolean default false not null;
alter table public.logistics_records add column if not exists _hidden_by text default ''::text not null;
alter table public.logistics_records add column if not exists _hidden_at timestamp with time zone;


-- ===== 5. 문서 없던 cron 2개 (주석 처리 — 기록용) =====
-- 둘 다 2026-10-19 기준 active=true.
-- <ANON_KEY> = 다른 *-cron.sql 과 같은 anon 키(공개값). 복원 시 실제 키로 바꾸고 주석을 풀어 실행.
-- cron.schedule 은 같은 이름이 있으면 덮어쓰므로 라이브에서는 실행하지 말 것.

-- select cron.schedule('contact-sheet-share', '*/3 * * * *', $$
--   select net.http_post(
--     url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/contact-sheet-pull',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <ANON_KEY>'),
--     body := '{"days":21}'::jsonb,
--     timeout_milliseconds := 55000
--   )
-- $$);

-- select cron.schedule('solapi-import', '50 14 * * *', $$
--   select net.http_post(
--     url := 'https://kkdiihazgzesbqxjytqv.supabase.co/functions/v1/customer-message-send',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
--     body := '{"action":"import_history","days":3}'::jsonb,
--     timeout_milliseconds := 120000);
-- $$);
-- (solapi-import: 50 14 * * * UTC = KST 23:50)


-- ===== 6. anon 에 실제로 열린 권한 (참고용, 2026-10-19 조회) =====
-- has_table_privilege('anon', ...) = 표 수준 GRANT. 실제 행 접근은 RLS 정책이 다시 거른다.
--
-- 대상              | 종류 | RLS | SELECT | INSERT | UPDATE | DELETE
-- ------------------+------+-----+--------+--------+--------+-------
-- jeomgeom          | 표   | on  |   O    |   O    |   -    |   -
-- as_records        | 표   | on  |   O    |   O    |   -    |   -
-- vendor_info       | 표   | on  |   O    |   O    |   -    |   -
-- misu              | 표   | on  |   O    |   O    |   -    |   -
-- overage           | 표   | on  |   O    |   O    |   -    |   -
-- lease_status      | 표   | on  |   O    |   O    |   -    |   -
-- churn_defense     | 표   | on  |   O    |   O    |   -    |   -
-- mgmt_support      | 표   | on  |   O    |   O    |   -    |   -
-- outbox            | 표   | on  |   O    |   O    |   O    |   O
-- app_config        | 표   | on  |   O    |   O    |   O    |   O
-- room_map          | 표   | on  |   O    |   O    |   O    |   O
-- photo_albums      | 표   | on  |   O    |   O    |   O    |   O
-- knowledge_docs    | 표   | on  |   O    |   O    |   O    |   O
-- all_vendor_tabs   | 뷰   | -   |   O    |   O    |   O    |   O   (security_invoker: 밑 표 권한·RLS 를 따름)
-- records_all       | 뷰   | -   |   O    |   O    |   O    |   O   (security_invoker; UNION 뷰라 쓰기는 실제로 불가)
--
-- 메모: 위 8개 표(jeomgeom~mgmt_support)는 "anon all"/"update hidden" 정책이 있어도
--       표 GRANT 에 UPDATE·DELETE 가 없어 anon 은 실제로 수정·삭제할 수 없다.
