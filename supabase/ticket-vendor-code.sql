-- 거래처 코드 3단계 — 일정(as_tickets)이 저장될 때 서버가 거래처 코드를 자동 부착한다.
-- 프론트 4개 생성 경로(일정리스트 수동·자동일정·접수 연동·반복 클론)를 트리거 하나로 커버.
--
-- 결정 순서 (사용자 확정 키 서열):
--  ① 접수의 임대리스트 순번(lease_no) — 순번은 영구 유일 키라 가장 확실
--  ② 시리얼(6자+, 임대리스트에서 한 회사에만 등록된 것)
--  ③ 자산기번 — 영문1+숫자4 정규 형식만 (D420 같은 모델명 오염 차단), 역시 유일한 것만
--  ④ 업체명 번역(vendor_match_key_) — 코드 하나로만 이어질 때만
-- 어느 것도 확실치 않으면 비워 둔다 (추측 금지 — 뱃지는 이름 매칭 폴백이 있다).

alter table as_tickets add column if not exists vendor_code text;
create index if not exists vendor_info_seq_idx on vendor_info ((_raw->>'순'));

-- 기기 식별자 → 코드 (유일한 것만). refresh_lease_ident_code()로 재생성 —
-- refresh_vendor_master() 뒤에 함께 돌리면 된다.
create table if not exists lease_ident_code (
  ident text primary key,
  code text not null
);
alter table lease_ident_code enable row level security;
drop policy if exists "lease_ident_code anon read" on lease_ident_code;
create policy "lease_ident_code anon read" on lease_ident_code for select to anon using (true);
grant select on lease_ident_code to anon, authenticated;

create or replace function refresh_lease_ident_code() returns int language plpgsql as $$
declare n int;
begin
  delete from lease_ident_code;
  insert into lease_ident_code (ident, code)
  select ident, min(code)
  from (
    select regexp_replace(lower(coalesce(_raw->>'시리얼번호(기번)','')), '[^0-9a-z]', '', 'g') as ident,
           btrim(_raw->>'거래처 코드') as code
    from vendor_info where coalesce(btrim(_raw->>'거래처 코드'),'') <> ''
    union all
    select regexp_replace(lower(coalesce(_raw->>'자산번호','')), '[^0-9a-z]', '', 'g'),
           btrim(_raw->>'거래처 코드')
    from vendor_info where coalesce(btrim(_raw->>'거래처 코드'),'') <> ''
  ) t
  where length(ident) >= 4
  group by ident
  having count(distinct code) = 1;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function resolve_ticket_vendor_code(p_reception text, p_serial text, p_asset text, p_vendor text)
returns text language plpgsql stable as $$
declare c text; k text;
begin
  -- ① 접수 → 임대리스트 순번
  if coalesce(p_reception, '') <> '' then
    begin
      select nullif(btrim(v._raw->>'거래처 코드'), '') into c
      from service_receptions r
      join vendor_info v on btrim(v._raw->>'순') = btrim(r.lease_no)
      where r.id::text = p_reception and coalesce(btrim(r.lease_no), '') <> ''
      limit 1;
      if c is not null then return c; end if;
    exception when others then null; -- 접수 id 형식 오류 등은 다음 단계로
    end;
  end if;
  -- ② 시리얼 (6자 이상 — 짧은 값은 태그·모델과 혼동 위험)
  k := regexp_replace(lower(coalesce(p_serial, '')), '[^0-9a-z]', '', 'g');
  if length(k) >= 6 then
    select code into c from lease_ident_code where ident = k;
    if c is not null then return c; end if;
  end if;
  -- ③ 자산기번 — 정규 형식(영문1+숫자4)만
  k := regexp_replace(lower(coalesce(p_asset, '')), '[^0-9a-z]', '', 'g');
  if k ~ '^[a-z][0-9]{4}$' then
    select code into c from lease_ident_code where ident = k;
    if c is not null then return c; end if;
  end if;
  -- ④ 업체명 번역 — 코드 하나로만 이어질 때만
  k := vendor_match_key_(coalesce(p_vendor, ''));
  if length(k) >= 3 then
    select min(code) into c from vendor_match_alias where akey = k having count(distinct code) = 1;
    if c is not null then return c; end if;
  end if;
  return null;
end $$;
grant execute on function resolve_ticket_vendor_code(text, text, text, text) to anon, authenticated;

create or replace function ticket_vendor_code_fill() returns trigger language plpgsql as $$
begin
  if coalesce(new.vendor_code, '') <> '' then return new; end if;
  new.vendor_code := resolve_ticket_vendor_code(new."receptionId", new.serial, new.asset, new.vendor);
  return new;
end $$;

drop trigger if exists as_tickets_vendor_code on as_tickets;
create trigger as_tickets_vendor_code before insert on as_tickets
  for each row execute function ticket_vendor_code_fill();

-- 기존 티켓 일괄 부착 (비어 있는 것만 — 이미 값 있으면 존중)
create or replace function backfill_ticket_vendor_codes() returns json language plpgsql as $$
declare n int; total int;
begin
  update as_tickets t
  set vendor_code = resolve_ticket_vendor_code(t."receptionId", t.serial, t.asset, t.vendor)
  where coalesce(t.vendor_code, '') = ''
    and resolve_ticket_vendor_code(t."receptionId", t.serial, t.asset, t.vendor) is not null;
  get diagnostics n = row_count;
  select count(*) into total from as_tickets;
  return json_build_object('filled', n, 'total', total);
end $$;

notify pgrst, 'reload schema';
