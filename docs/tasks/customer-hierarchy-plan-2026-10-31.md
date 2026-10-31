# 거래처 표준 이름 체계 실행 계획 (업체 › 지점 › 기기) — 2026-10-31

작성: 기획실 한설계 (조사·설계만, 코드 0 · DB 쓰기 0). 앞선 구상: `docs/tasks/customer-hierarchy.md`(2026-10-21 보류 → 이 문서로 실행 전환).
사용자(팀장 이민구) 2026-10-31 요지: "누가 적든, 검색하든, 저장하든 똑같은 이름이 나오는 시스템 = 우리 회사 데이터 통합의 주요 목표이자 어려움."

## 0. 한 줄 목표와 쓰는 사람

**업체(10자리 거래처 코드) › 지점(사람이 정한 지점 목록) › 기기(임대리스트 순)를 한 사전으로 만들고, 모든 입력은 사전에서 고르고, 모든 기록은 코드로 묶어 정식 이름으로 보여 준다.**

| 쓰는 사람 | 기기 | 하는 일 |
|---|---|---|
| 현장 기사(CS A~E) | **폰** | 필드 탭 점검·AS·청정기 양식에서 업체 › 지점 › 기기 고르기 (가장 많이 쓰는 곳, 속도가 생명) |
| 접수·지원 부서 | PC | 서비스접수·부서 접수·미수·불만·재계약 양식에서 고르기 |
| 관리자(팀장·운영지원) | PC | 정식 이름·지점 정리, "새 표기 등록 요청"·미매칭 확인 큐 처리 |
| 고객 | — | 직접 안 씀. 카톡 양식 글·리포트에 정식 이름이 찍혀 나감 |

## 1. 실측

### 1.1 이번 세션 실측 상태 (정직하게)

- 기획실 세션에 **Supabase MCP 도구가 연결되지 않았다**(도구 목록에 없음). anon REST 로 표마다 1행·행 수만 확인했고, 업체명 칸 전량을 내려받아 묶는 방식은 "MCP 조회만" 지시에 어긋나 중단했다(권한 판정기도 거절).
- 그래서 **업체별 표기 수·청오에스떠블유 전수·미매칭 비율 숫자는 아직 비어 있다.** 아래 1.3 의 읽기 전용 SQL(M0~M6)을 팀장 클로드가 MCP `execute_sql` 로 그대로 돌려 1.2 표를 채운다. (쓰기 없음, temp 표 없음. 시간 초과 나면 `where t='jeomgeom'` 처럼 표 하나씩.)
- 이미 확보된 숫자는 2026-10-21~23 MCP 실측(`customer-hierarchy.md` 2·5·6절)을 그대로 가져왔다.

### 1.2 표 (실측 칸은 M 번호 SQL 결과로 채움)

**표 크기 (2026-10-31 anon REST `count=exact` 1행 조회)**

| 표 | 행 | 업체명 칸 | 기기 칸 | 코드 칸(이미 있음) |
|---|---|---|---|---|
| jeomgeom (점검) | 35,106 | `_업체명`(파서가 뽑은 값)·`업체명` | `시리얼넘버`·`자산기번`·`_기번목록` | 없음 |
| as_records (AS) | 21,531 | `_업체명`·`업체명` | `시리얼넘버`·`자산기번` | 없음 |
| as_tickets (일정) | 1,841 | `vendor` | `serial`·`asset` | **`vendor_code`**(insert 트리거, ticket-vendor-code.sql) |
| service_receptions (접수) | 1,258 | `vendor` | `serial`·`asset_no` | **`lease_no`**(임대리스트 순) |
| bulman (불만) | 2,456 | `_업체명`·`업체명` | `기종`(글) | 없음 |
| misu (미수, 매일 0시 시트 전체 교체) | 11,580 | `_업체명`·`업체명` | — | **`거래처코드`** |
| misu_visits (미수 방문) | 1 | `vendor` | — | **`company_code`·`site_code`·`lease_seq`**(이미 3단 키 자리 있음) |
| recontract (재계약) | 1,906 | `_업체명`·`업체명` | `기종` | 없음 |
| supply_requests (부품·자가) | 2,343 | `vendor`·`used_vendor` | `serial`·`asset` | 없음 |
| vendor_master (업체 사전 후보) | 5,704 | `name`(임대리스트 거래처명 최다 표기)·`aliases` | — | `code` 10자리 |
| vendor_match_alias (이름 키→코드) | 13,242 | `akey` | — | `code` |

**이미 아는 것 (2026-10-21~23 MCP 실측)**

| 항목 | 값 | 이 계획에서의 뜻 |
|---|---|---|
| vendor_info 행 / 순(A열) 고유 | 23,288 / 22,937 (+351행은 `100-a` 꼴 글자 순) | 기기 키 = `_raw 순` 글자 그대로 |
| 10자리가 행에 직접 있음 | 20,932행 (10자리로 읽힘 20,558) | 기기 → 업체는 이미 거의 이어짐 |
| 10자리 → vendor_master 존재 | 98.3% (4,797/4,881) | 업체 사전은 vendor_master 로 시작 가능 |
| U열 5자리 "코드" | 업체가 섞임(예 22082), 주소 2개+ 847~1,055곳 | **지점 기준으로 쓰지 않는다**(10-23 정정 확정) |
| 지점 후보 = Q열 "부서명/현장명" | 같은 5자리에 부서·현장명 2개+ 1,154곳 | 지점 자동 시드 재료. 표기가 들쭉날쭉해 사람 정리 필요 |
| 임대중 / 종료 / 소송 | 10,881 / 12,071 / 336대 | 고르기 목록 기본 = 임대중만 |
| 개인 고객(코드 칸 주민번호) | 약 110~129곳 | 업체 키로 안 씀, 화면 마스킹(privacy.maskCode) |
| lease_ident_code | 17,602행(다시 만들면 18,042) — 크론 없음 | 백필 전에 다시 만들어야 함(DELETE 후 INSERT → sql-review) |

**채울 표 (M 번호)**

| # | 질문 | 결과 |
|---|---|---|
| M0 | SQL `vendor_match_key_` 가 TS `vendorMatchKey` 와 같은가 | (실측 대기) — 파일상 다름: TS 는 괄호 메모 제거·법인표기 위치 불문 제거, `supabase/vendor-master.sql` 의 SQL 은 둘 다 없음. 라이브가 고쳐졌는지 확인 |
| M1 | 표별 코드 찾음/못 찾음 비율(순번 → 시리얼 → 자산 → 이름 순) | (실측 대기) 표 6행: 전체·찾음·%·빈 이름 |
| M2 | "코드 1개에 표기 n개" 상위 20 업체 + 분포(1개/2개/3~5/6~10/11+) | (실측 대기) |
| M3 | 청오에스떠블유 표기 전수(표별·표기별 건수) + 임대리스트 지점(부서명·주소) | (실측 대기) |
| M4 | 표별 못 찾은 표기 상위 50 | (실측 대기) — 확인 큐 첫 화면 재료 |
| M5 | 발음·지점 꼬리 접기(2.3 규칙)로 M4 가 얼마나 줄어드나 | (실측 대기) |
| M6 | 지점 자동 시드: 업체별 부서명 고유 수 분포, 상위 기기 수 200곳의 부서명 표기 | (실측 대기) |

### 1.2-실측 결과 (팀장 MCP, 2026-10-31 오후)
- **M0 키 동일성**: 라이브 `vendor_match_key_` = '블루닷주식회사bluedotinc' / '청오에스떠블유본사' / '청오에스더블유' → TS vendorMatchKey 와 **다름**(SQL 은 괄호 메모·법인표기를 안 뗌). 백필·트리거는 SQL 함수를 TS 규칙에 맞춰 먼저 고쳐야 한다.
- **M1 이름만으로 코드 찾기(별칭 표 1:1)**: 점검 35,098 중 57.6% · AS 21,523 중 57.1% · 일정 1,841 중 69.9% · 접수 1,106 중 75.5% · 불만 2,452 중 55.0% · 미수 11,580 중 78.0%. 즉 **현장 기록의 40%+ 가 이름만으로는 업체를 못 찾는다**(시리얼·자산기번·순번 보조 매칭 전 수치).
- **M2b 표기 분포(찾은 코드 3,507개)**: 표기 1개 2,047 · 2개 943 · 3~5개 450 · 6~10개 49 · 11개+ 18 → **42% 업체가 둘 이상의 이름**으로 적혀 있고, 2개 이상인 업체의 기록이 21,671행.
- **M3 청오에스떠블유 전수**: 사업자 코드 1개(5908603391), 임대리스트 7행 — 부서명/현장명 칸이 '13층'·'13층 -> 15층'·'15층'·'15층 / 전 써브웨이인터내셔날비브이'·'15층->12층 / 전 써브웨이…'·'써브웨이 답십리역점'(2대) 로 **층 이동 메모·옛 상호가 지점명 칸에 그대로**, 주소는 2곳(강남대로 535 = 본사 건물, 용답동 98-2 = 답십리). 기록 표에는 '청오에스떠블유' / '…주식회사15층전 써브웨이인터내셔날비브이(영업소)' / '…13층 -> 15층무조건 2-3일 전 연락하여 방문안내분기마감' 등 7가지 표기. **지점은 주소(건물)로 묶는 게 맞다**(한설계 1번 판단 확인) — 강남대로 535 지점 1개 + 답십리 지점 1개.

### 1.3 실측 SQL (읽기 전용 — MCP execute_sql)

공통 CTE `src`·`alias1`·`r` 를 M1·M2·M4·M5 앞에 붙인다.

```sql
-- M0 키 동일성 (TS 기대값: '블루닷', '청오에스떠블유본사', '청오에스더블유')
select vendor_match_key_('블루닷 주식회사(bluedot Inc.)') k1,
       vendor_match_key_('(주)청오에스떠블유 본사') k2,
       vendor_match_key_('청오 에스더블유') k3;

-- 공통 CTE
with src as (
  select 'jeomgeom'::text t, "_dupKey" sk, coalesce(nullif(btrim("_업체명"),''), btrim("업체명")) nm,
         "시리얼넘버" ser, "자산기번" ast, null::text seq, null::text dc
    from jeomgeom where "_hidden" is not true
  union all select 'as_records', "_dupKey", coalesce(nullif(btrim("_업체명"),''), btrim("업체명")), "시리얼넘버", "자산기번", null, null
    from as_records where "_hidden" is not true
  union all select 'as_tickets', id, btrim(vendor), serial, asset, null, nullif(btrim(vendor_code),'') from as_tickets
  union all select 'service_receptions', id::text, btrim(vendor), serial, asset_no, nullif(btrim(lease_no),''), null
    from service_receptions where deleted is not true
  union all select 'bulman', "_dupKey", coalesce(nullif(btrim("_업체명"),''), btrim("업체명")), null, null, null, null
    from bulman where "_hidden" is not true
  union all select 'misu', "_dupKey", coalesce(nullif(btrim("_업체명"),''), btrim("업체명")), null, null, null,
         nullif(left(regexp_replace(coalesce("거래처코드",''),'[^0-9]','','g'),10),'')
    from misu where "_hidden" is not true
),
alias1 as (select akey, min(code) code from vendor_match_alias group by akey having count(distinct code) = 1),
r as (
  select s.*,
    coalesce(
      case when length(s.dc) = 10 then s.dc end,
      (select nullif(btrim(v._raw->>'거래처 코드'),'') from vendor_info v
        where s.seq is not null and btrim(v._raw->>'순') = s.seq limit 1),
      (select l.code from lease_ident_code l
        where length(regexp_replace(lower(coalesce(s.ser,'')),'[^0-9a-z]','','g')) >= 6
          and l.ident = regexp_replace(lower(s.ser),'[^0-9a-z]','','g')),
      (select l.code from lease_ident_code l
        where regexp_replace(lower(coalesce(s.ast,'')),'[^0-9a-z]','','g') ~ '^[a-z][0-9]{4}$'
          and l.ident = regexp_replace(lower(s.ast),'[^0-9a-z]','','g')),
      (select a.code from alias1 a where a.akey = vendor_match_key_(s.nm))
    ) code
  from src s
)
-- M1 표별 비율
select t, count(*) total, count(code) found, round(100.0*count(code)/count(*),1) pct,
       count(*) filter (where coalesce(nm,'') = '') blank_name
from r group by t order by t;

-- M2a 표기 많은 업체 상위 20 (공통 CTE 뒤)
select r.code, vm.name, count(distinct r.nm) spellings, count(*) rows_, (array_agg(distinct r.nm))[1:10] sample
from r join vendor_master vm on vm.code = r.code where coalesce(r.nm,'') <> ''
group by 1,2 order by 3 desc limit 20;
-- M2b 분포 (공통 CTE 뒤)
select case when n=1 then '1' when n=2 then '2' when n<=5 then '3-5' when n<=10 then '6-10' else '11+' end bucket, count(*) codes
from (select code, count(distinct nm) n from r where code is not null and coalesce(nm,'')<>'' group by code) x
group by 1 order by 1;

-- M3 청오 전수 (src CTE 만 붙임)
select t, nm, count(*) from src where nm ~ '청오' group by 1,2 order by 3 desc;
select code, name, aliases, device_count from vendor_master where name ~ '청오' or aliases::text ~ '청오';
select btrim(_raw->>'거래처 코드') code, btrim(_raw->>'거래처명') trader, _raw->>'부서명/현장명' dept,
       _raw->>'주소' addr, _raw->>'임대여부' st, count(*)
from vendor_info where _raw->>'거래처명' ~ '청오' or "_업체명" ~ '청오'
group by 1,2,3,4,5 order by 1,3;

-- M4 못 찾은 표기 상위 50 (공통 CTE 뒤)
select t, nm, count(*) from r where code is null and coalesce(nm,'')<>'' group by 1,2 order by 3 desc limit 50;

-- M5 접기 효과 (공통 CTE 에 fold·fold1 을 더해서)
--   fold  as (select a.code, regexp_replace(regexp_replace(a.akey,'(떠블유|더블류|떠블류|따블유)','더블유','g'),
--                            '(본사|본점|지점|지사|센터|사옥|[0-9]+층)$','') fk from alias1 a),
--   fold1 as (select fk, min(code) code from fold group by fk having count(distinct code)=1)
select r.t, count(*) still_missing, count(*) filter (where f.code is not null) rescued
from r left join fold1 f
  on f.fk = regexp_replace(regexp_replace(vendor_match_key_(r.nm),'(떠블유|더블류|떠블류|따블유)','더블유','g'),
                           '(본사|본점|지점|지사|센터|사옥|[0-9]+층)$','')
where r.code is null and coalesce(r.nm,'')<>'' group by 1;

-- M6 지점 시드 재료 (임대중, 업체별 부서명 고유 수 분포)
select n_dept, count(*) companies from (
  select btrim(_raw->>'거래처 코드') code, count(distinct nullif(btrim(_raw->>'부서명/현장명'),'')) n_dept
  from vendor_info where _raw->>'임대여부' = '임대중' and coalesce(btrim(_raw->>'거래처 코드'),'')<>'' group by 1) x
group by 1 order by 1;
```

## 2. 표준 명칭 사전

### 2.1 세 층의 키와 표시명

| 층 | 키(저장) | 표시명(화면·카톡) | 재료 |
|---|---|---|---|
| 업체 | `company_code` = 거래처 코드 숫자 10자리(공백·하이픈 제거) | `display_name` 1개 | vendor_master + 새 표 vendor_display |
| 지점 | `site_id` (새 번호, 예 `S000123`) — **U열 5자리 아님** | `site_name` (본사·송파·강남…) | Q열 부서명/현장명 + 주소로 자동 시드 → 사람이 이름 정리 |
| 기기 | `lease_seq` = 임대리스트 A열 순(글자 그대로, `100-a` 포함) | 자산기번(크게) · 모델 · 위치 | vendor_info |

- 지점이 하나뿐인 업체는 지점 "기본" 하나를 자동으로 둔다 → 고르기에서 지점 단계를 건너뜀.
- 개인 고객(코드 칸 주민번호)은 company_code 를 `P` + 순 으로 따로 만들어 원 코드를 쓰지 않는다(주민번호 화면 노출 차단 규칙 유지).
- 임대리스트에 아직 없는 신규 업체는 `T` + 날짜순번 임시 코드 → 임대리스트에 올라오면 사람이 [합치기]로 진짜 10자리에 붙인다.

### 2.2 정식 이름(display_name) 정하는 규칙 — 권장안

1. 사람이 정한 값이 있으면 그것(vendor_display.display_name, 관리 화면에서만 바꿈).
2. 없으면 vendor_master.name(임대리스트 거래처명 최다 표기)에서 **법인 표기만 벗긴 것**: `㈜·(주)·주식회사·유한회사` 앞뒤 제거, 앞 등급 접두(`30S` 등) 제거, 공백 하나로. 예 `㈜청오에스떠블유` → `청오에스떠블유`.
3. 발음 변형은 정식 이름을 바꾸지 않는다(정식은 하나, 변형은 별칭).
- 사업자등록명은 FIELD 에 들어온 적이 없다(재료 없음). 임대리스트 거래처명이 계약·청구 기준이라 사실상 등록명에 가깝다 → 2번을 기본으로 하고, 다르게 부르고 싶은 곳만 1번으로 덮는다. (질문 Q1)
- 표시 한 줄 = `정식 업체명 지점명` (예 `청오에스떠블유 송파`). 지점이 "기본"이면 업체명만.

### 2.3 별칭 표 + 자동 제안

- **기존 `vendor_match_alias` 는 그대로 둔다** — `refresh_vendor_master()`(supabase/vendor-master.sql)가 통째로 지우고 다시 만들기 때문에 사람이 넣은 별칭을 여기 두면 사라진다. 사람 별칭은 새 표 `vendor_alias_manual` 에 두고, 찾을 때 **사람 별칭 → 자동 별칭** 순으로 본다.
- 비교 키 2단:
  - `vendorMatchKey`(기존, `src/ids.ts` 가 `supabase/functions/_shared/counter-sms/vendorKey.ts` 를 재수출) — 기호·법인표기·등급 접두 제거.
  - 새 **접는 키** `vendorFoldKey` = vendorMatchKey 뒤에 ① 발음 변형 표(`vendor_fold_rule`: 떠블유·더블류·떠블류·따블유→더블유, 씨엔씨→씨앤씨, 엔드·&→앤, E&C·이엔씨→이앤씨 … 사람이 행 추가) ② 끝 지점 꼬리 분리(본사·본점·지점·지사·센터·사옥·N층·`[가-힣]{1,4}점`) — 떼어 낸 꼬리는 **지점 힌트**로 따로 돌려준다.
  - 예: `청오에스떠블유 본사` → 업체 키 `청오에스더블유` + 지점 힌트 `본사`.
  - 띄어쓰기·(주) 위치는 기존 vendorMatchKey 가 이미 흡수(공백·기호 제거, 법인표기 위치 불문 제거). 단 **SQL 판은 파일상 이것이 빠져 있다**(M0).
- 접는 키로만 맞은 것은 **자동 확정하지 않는다** — 고르기 화면에서는 "혹시 이 업체?" 맨 위 제안, 백필에서는 확인 큐로.
- TS·SQL 두 벌은 지금처럼 거울로 두고 `supabase/tests/judgments.sql` 동일성 케이스에 접는 키 사례를 더한다(M0 결과가 다르면 SQL 을 TS 에 맞추는 것이 P0 첫 일).

## 3. 데이터 설계 (db-schema 가 SQL 로 씀, 실행은 /sql-handoff)

원칙: vendor_info·vendor_master·vendor_match_alias·lease_ident_code(자동 갱신 표)는 **읽기만**. 사람 손이 닿는 값은 전부 새 표. 기존 기록 표의 `_업체명`·`업체명`·`_원문`은 **고치지 않는다**(원문 보존, 표시만 코드로).

| 새 표 | 칸 | RLS·권한 |
|---|---|---|
| `vendor_display` | code PK(vendor_master.code 또는 T·P 코드), display_name, status active·closed·merged, merged_into, note, updated_by, updated_at | anon select. 쓰기는 관리 화면(변경 기록 트리거, app_config_log 방식) |
| `vendor_site` | site_id PK, company_code, site_name, address, dept_raw text[](부서명 원 표기들), method auto·manual, status, sort, updated_at | anon select, 쓰기는 관리 화면 |
| `vendor_site_member` | lease_seq PK, site_id, method auto·manual, since date, updated_at | anon select. 자동 시드는 SQL 함수, 사람 이동은 관리 화면 |
| `vendor_alias_manual` | id, alias_text, akey(접는 키), company_code, site_id null, status pending·approved·rejected, requested_by, source(field·reception·misu…), approved_by, created_at | anon select + **insert(status=pending 만)**. 승인·거절은 관리 화면 |
| `vendor_fold_rule` | pattern, replace, sort | anon select, 쓰기는 SQL Editor |
| `record_vendor_link` | (src_table, src_key) PK, company_code, site_id, lease_seq, method(direct·seq·serial·asset·alias_manual·alias·fold·manual·none·conflict), candidates jsonb, raw_name, resolved_at, confirmed_by | anon select. 쓰기는 트리거·백필 함수(security definer)·확인 큐 rpc 만 |

- **기록 표에 칸을 더하지 않고 `record_vendor_link` 옆 표를 둔다.** 이유: AGENTS 규칙 2(기존 표 안 바꿈), 35k·21k 행 표 잠금 없음, GAS 미러(`apps-script/first-data/src/Supabase.gs`)·misu 매일 전체 교체와 충돌 없음, 다시 해석하기 쉬움. 키는 `_dupKey`(내용 md5 — 전체 교체 뒤에도 같은 행이면 같은 값). `_dupKey` 없는 표는 id(as_tickets·service_receptions·misu_visits·supply_requests).
- as_tickets.vendor_code · misu_visits.company_code/site_code/lease_seq · service_receptions.lease_no 는 이미 있으니 그대로 쓰고, 지점(site_id)만 link 표로 보탠다.
- 함수
  - `resolve_vendor(p_name, p_serial, p_asset, p_lease_seq, p_reception)` → company_code·site_id·lease_seq·method·candidates. 순서 = 기존 `resolve_ticket_vendor_code`(supabase/ticket-vendor-code.sql) 그대로(접수 순번 → 시리얼 6자+ → 자산 영1숫4 → 이름)에 **사람 별칭을 이름보다 앞에**, 맨 끝에 접는 키(후보만, 확정 안 함). 기존 함수는 이 함수를 부르는 얇은 껍데기로 바꿔 as_tickets 트리거·visitAdviceData RPC 가 그대로 돈다.
  - 지점 정하기: lease_seq 가 있으면 vendor_site_member → 없으면 지점 힌트(접는 키 꼬리·양식 부서명 줄) ↔ vendor_site.site_name·dept_raw → 업체 지점이 1개면 그것 → 아니면 비움.
  - 트리거 `record_vendor_link_fill` AFTER INSERT on jeomgeom·as_records·bulman·misu·recontract·logistics_records·service_receptions·supply_requests: link 1행 upsert(이미 manual 이면 안 덮음). **예외는 삼킨다**(링크 실패로 기록 저장이 실패하면 안 됨). misu 는 매일 전체 교체라 같은 `_dupKey` 면 on conflict do nothing.
  - `seed_vendor_sites()` 지점 자동 시드(업체별 부서명 정규화 묶음 + 주소), manual 은 안 덮음.
  - `backfill_record_vendor_link(p_table text, p_limit int default 2000)` 한 번에 2천 행, 다시 돌리면 이어서.
- 속도: anon statement_timeout 3초 → 화면은 사전 전체를 하루 1번 받아 폰에 캐시(업체 약 5.7천 + 지점 수천 행 예상)하고 검색은 폰 안에서. 서버 RPC 는 저장 때 1번만.

## 4. 입력 지점 통일

### 4.1 지금 자유 입력 경로 전수 (2026-10-31 코드 기준 — 작업 중인 파일이 있어 줄 번호는 ±, 함수 이름이 기준)

| # | 화면 | 위치 | 지금 | 저장 표 |
|---|---|---|---|---|
| 1 | **필드 점검·AS·청정기·삼성노트** 양식 | `src/App.tsx` 5797 붙여넣기 칸·5661 미리보기 블록 편집 → 4468 `sendForm` 호출 → `src/api.ts:943 sendForm` → `src/inspectParser.ts:103 buildRow`(`_업체명` = 글에서 뽑은 값) | "업체명:" 줄을 사람이 씀. 🔍 시트(`src/field/FieldSearchSheet.tsx` → `src/VendorSearch.tsx`)는 **지난 기록 원문을 불러와** 앞사람의 표기가 그대로 복제됨. `onVendor=setCurrentVendor`(App.tsx 5959)는 화면 상태만 | jeomgeom·as_records(+supply_requests) |
| 2 | 일정리스트 → 필드 | App.tsx 2958 부근(네이버 제목 전체가 업체명 칸에) | historyCoreName 으로 검색어만 벗김, 저장은 원문 | jeomgeom·as_records |
| 3 | 미수·불만·재계약·초과 양식 | `src/categoryForms.ts` 34·50·73·99 `T("업체명", …, "company")` → `src/CategoryForm.tsx` → `src/api.ts:1055 sendCategoryForm` | 자유 입력 + [점검/AS 불러오기] | misu·bulman·recontract·overage_adjust |
| 4 | 물류 | `src/LogisticsForm.tsx:30` "거래처명 (지점/현장명 필수)" → `api.ts:1025 sendLogisticsForm` | 자유 입력(지점까지 한 칸) | logistics_records |
| 5 | PC 양식 | `src/PcForm.tsx:229` → `api.ts:1126 sendPcForm` | 자유 입력 | IT 통합 표 |
| 6 | 복합기 확장성 | `src/CopierExpansionForm.tsx` 상호명 → `api.ts:1352 sendCopierExpansionForm` | 자유 입력 | mfp_expansion |
| 7 | 연락처 변경 | `src/ContactChangeForm.tsx:60` "업체명(본사/지점 등)" | 자유 입력 | contact_changes |
| 8 | 내 일정 직접 추가 | `src/CsAsWorkspace.tsx:1084 addManualSchedules`(e.vendor) | 원문 붙여넣기에서 뽑음 | as_tickets(vendor_code 트리거) |
| 9 | 캘린더 간소 추가 | `src/CsAsWorkspace.tsx:1106 submitSimpleAdd` — **제목이 곧 vendor** | 자유 입력 | as_tickets |
| 10 | 자동일정 직접 추가 | `src/AutoSchedule.tsx:501` | 자유 입력 | as_tickets |
| 11 | 서비스접수 | `src/ServiceReception.tsx` 임대리스트 검색(순번 고르기 = 이미 사전 고르기) + "신규 거래처 업체명" 자유 칸 | 반쯤 됨 | service_receptions(lease_no) |
| 12 | 부서 접수 | `src/DeptReceptionForm.view.tsx:142·146` 같은 구조 | 반쯤 됨 | service_receptions |
| 13 | 미수 방문 | `src/MisuVisitForm.view.tsx:494·508` 미수 목록/거래처 검색에서 고름 | **이미 고르기**(company_code·site_code·lease_seq 저장) | misu_visits |
| 14 | 부서 요청 | `src/DeptRequests.tsx:382` | 자유 입력 | dept_requests |
| 15 | 부품·자가 지급 업체 | `src/SupplyBoard.tsx:426·430` | 자유 입력 | supply_requests |
| 16 | 마감 카운터 업로드 블록 | `src/CounterSms.tsx:815` | 파서 값 수정 | counter_sms_* |
| 17 | 점검 리포트 업체명 | `src/InspectionReport.tsx:387` | 표시용 자유 입력(저장 아님) | — |
| 외1 | **카톡 수집**(메신저봇 → GAS) | `apps-script/first-data/src/Supabase.gs` | 카톡 글 그대로 | jeomgeom·as_records·bulman·misu·recontract |
| 외2 | 네이버 캘린더 수입 | `supabase/functions/naver-calendar-sync` + `_shared/ticket-title.ts importedTicketVendor` | 제목에서 뽑음 | as_tickets |
| 외3 | 기록 고치기 | `supabase/functions/record-edit` | 사람이 업체명 수정 | 각 표 |

→ 외1~외3 에는 고르기 화면을 붙일 수 없다. **저장 시 트리거(3절 record_vendor_link_fill)가 같은 사전으로 해석**하는 것이 이 경로의 통일 방법이다. 카톡에 사람이 직접 쓰는 글이 남는 한 "고르기"만으로는 100%가 안 된다 — 고르기는 새 변형이 생기는 것을 줄이고, 트리거 + 확인 큐가 나머지를 묶는다. 외3(record-edit)은 업체명을 고치면 link 를 다시 해석하도록 같은 rpc 를 부른다.

### 4.2 공용 고르기 부품 `VendorPicker` (새 파일)

- 검색칸 하나: 업체명 일부·자산기번·시리얼·순번 무엇이든. 폰 안 캐시에서 찾음(접는 키 덕에 "떠블유"를 쳐도 "청오에스떠블유"가 나옴).
- 결과 3단: 업체(정식명 · 지점 수 · 임대중 n대) → 지점 칩(본사·송파·강남 · "지점 모름") → 기기 목록(자산기번 크게, 모델·위치, 점검은 여러 대 체크).
- 맨 위 "최근 고른 업체 5"(이 폰 localStorage). 일정에서 들어오면 그 일정의 vendor_code·순번으로 **미리 골라진 상태**(누를 것 0번).
- 사전에 없으면 [새 표기로 그냥 쓰기] — 그대로 저장되고 `vendor_alias_manual(status=pending)` 1행 + link `none` → 관리 큐. **P1 에서는 막지 않는다.**
- 돌려주는 값: `{ company_code, site_id, lease_seqs[], display }`. 양식 글에는 `업체명: <정식명 지점명>`, 기기 블록에는 임대리스트 모델·시리얼·자산기번을 채움. 카톡 양식 줄 순서·라벨은 그대로.
- 필드 탭은 글 양식 기반이라, 고른 뒤 사람이 "업체명:" 줄을 손으로 바꾸면 고른 값을 버리고 저장 때 트리거 해석으로 넘어간다(어긋난 코드를 붙이는 것보다 안전).
- 네트워크 끊김: 캐시가 있으면 고르기 그대로 됨. 캐시가 없으면(첫 사용) 자유 입력으로 자동 전환 + 안내 한 줄. 저장 뒤 link rpc 실패는 트리거가 이미 해석했으므로 무시.

### 4.3 화면 흐름 (필드 탭, 폰)

1. 점검 탭 → 업체 칸(또는 🔍) 누름 → VendorPicker 시트가 아래서 올라옴(최근 5 위).
2. "청오" 입력 → `청오에스떠블유 · 지점 3 · 임대중 7대` 한 줄.
3. 누르면 지점 칩 `본사 · 송파 · 강남` → `송파`.
4. 기기 목록(자산기번 크게) → 오늘 볼 기기 체크 → [양식에 넣기].
5. 양식에 `업체명: 청오에스떠블유 송파` + 기기 블록 채워짐 → 평소대로 내용 쓰고 전송.
6. 저장 = 기존 그대로 + link(manual, 고른 코드·지점·순번).
7. (없을 때) 3단계에서 [새 표기로 그냥 쓰기] → 관리자가 큐에서 업체·지점 한 번 고르면 같은 표기의 과거·미래 기록이 모두 묶임.

## 5. 표시 통일 — 코드로 묶고 정식 이름으로 보이기

| 화면 | 지금 묶는 기준 | 상태 | 바꿀 것 |
|---|---|---|---|
| 통합검색 360 `src/entity360.ts` | 코드(별칭·기번) + 이름 승격 | **됨(부분)** | link 표 코드로 기록 직접 모으기(ilike 대신 eq → 시간 초과 줄어듦) |
| AS 방문 판단 `src/visitAdviceData.ts` | RPC resolve_ticket_vendor_code | 됨 | resolve_vendor 로 지점까지 |
| 일정 배지 `src/vendorFlags.ts`·`src/vendorCodes.ts` | 코드 우선, 이름 대체 | 됨 | 표시명만 정식 이름 |
| 워킨맵 `src/WalkingMap.tsx` | workin_vendor_code | 됨 | — |
| 미수 방문 `src/misuVisit.ts` | company_code | 됨 | — |
| 필드 🔍 최근 이력 `src/api.ts getInspForms`·`searchVendors` | `_업체명` ilike + coreVendorKey | **안 됨** | 고른 업체 code → link → 기록 |
| 조회 탭 `src/DataLookup.tsx` | 이름 ilike | 안 됨 | 업체 칸 = 정식 이름(원 표기는 작게), 업체로 걸러 보기 |
| 홈 KPI 거래처 수 `src/workCount.ts vendorKeyOf` | vendorMatchKey | 안 됨(변형이 따로 셈) | code 있으면 code |
| 중간보고·일정 제목 `src/CsAsWorkspace.tsx buildMidReport`·`_shared/vendor-core.ts historyCoreName` | 글자 벗기기 | 안 됨 | vendor_code 있으면 정식 이름 |
| 점검 리포트 `src/InspectionReport.tsx` | `_업체명` | 안 됨 | 정식 이름 기본값 |
| 무엇이든 묻기 `supabase/functions/_shared/ask/tools-field.ts` | vendor_match_alias | 부분 | link 표 도구 추가 |

## 6. 백필

1. `refresh_lease_ident_code()` 다시 만들기(17,602 → 약 18,042) — DELETE 후 INSERT 라 sql-review, 밤에.
2. `seed_vendor_sites()` → 관리자가 기기 많은 업체 상위 200곳 지점 이름 정리(나머지는 "기본" 지점 하나로 시작).
3. `backfill_record_vendor_link` 표마다 2천 행씩: 점검 35k·AS 21k(약 28회), 일정·접수·불만·미수·재계약은 1~6회. SQL Editor 반복 또는 노트북 실행기 일감. 밤 00:30·월 05:50(GAS 동기화) 피함.
4. 확인 큐: **기존 관리 탭 "미매칭 확정"(`src/VendorCodeAdmin.tsx`, 지금은 워킨맵 지점용)에 둘째 칸 "기록 표기"를 붙인다.** 행 단위가 아니라 **표기 단위**(예 `청오에스떠블유 본사` n건 → 업체·지점 한 번 고르면 n건 + 사람 별칭 1개 저장). 건수 많은 표기부터. 저장은 기존처럼 method='manual' 이라 재실행에도 보존.
5. conflict(후보 2개+)는 자동으로 안 고른다 — 큐에 후보 함께 표시.

## 7. 단계

| 단계 | 내용 | 효과 | 난이도 | 위험 |
|---|---|---|---|---|
| **P0 사전·별칭** | M0~M6 실측 → SQL 키를 TS 와 맞춤 → 새 표 6개·resolve_vendor·접는 키·지점 시드 → 관리 화면 "업체 사전"(정식 이름·지점 정리·별칭 승인) | 이름 하나의 기준이 생김. 사람 별칭이 refresh 에 안 지워짐 | 중 (DB 위주) | 지점 시드 품질(부서명 표기 들쭉날쭉) → 상위 200곳만 사람 정리 |
| **P1 필드 탭 고르기 + 저장 트리거** | VendorPicker, 필드 점검·AS·청정기 연결, 일정 → 필드 미리 고름, 트리거 8표 | 가장 많은 입력(현장 기록)에 코드·지점이 붙음, 카톡 수집분도 트리거로 | 중상 | **현장 속도**(폰 캐시·최근 5·일정 미리 고름·막지 않기로 대응) |
| **P2 나머지 입력** | 4.1 표 3~16 을 VendorPicker 로(접수 신규 거래처는 T 코드) | 사무 입력도 같은 이름 | 중 (파일 많음, 각각 작음) | 화면마다 흐름이 달라 회귀 → 한 화면 한 커밋 |
| **P3 백필·표시** | 6절 백필 + 확인 큐 + 5절 "안 됨" 화면 전환 | 과거 점검 35k·AS 21k 등이 업체로 묶임, 검색이 eq 로 빨라짐 | 중 | 오매칭 → 자동 확정은 기기·순번·사람 별칭·유일한 이름만, 접는 키는 확정 안 함 |

효과 숫자는 M1(지금 찾음 %)·M4(못 찾은 표기 수)를 기준값으로 두고, 단계마다 같은 SQL 을 다시 돌려 "코드 붙은 기록 %"와 "업체당 표기 수"를 잰다(4분기 평가 기록 재료).

운영 위험(모든 단계 공통)
- **신규 업체**: 임대리스트 등록 전 첫 방문·접수 → T 코드 → 등록되면 관리 화면 [합치기](T 코드의 link·별칭을 진짜 코드로 옮김).
- **지점 이동**: 기기가 다른 지점으로 → vendor_site_member 만 바뀜. 과거 link 는 **그때 지점을 유지**(이력 왜곡 방지).
- **이름 변경(상호 변경)**: display_name 만 바꾸면 과거 기록도 새 이름으로 보인다. 옛 이름은 자동으로 사람 별칭에 추가(검색 유지).
- **사업자 변경·합병**(10자리가 바뀜, 예 10011 뉴트리원→뉴원풀필먼트): vendor_display.status=merged·merged_into. 묶어 볼지 따로 볼지 화면에서 선택.
- **본사·지사가 사업자를 따로 가진 경우**(국민대학교·산학협력단, 공간코리아 두 사업자): 업체 2개로 둔다. "업체 그룹" 층은 이번 범위 밖.
- 주민번호: 개인 고객 코드는 P 코드로 대체, 원 값은 link·별칭·카톡 어디에도 안 씀.
- `refresh_vendor_master()`·`refresh_lease_ident_code()` 는 DELETE 후 INSERT — 돌리는 동안 resolve 가 비어 보일 수 있음(밤에). 장기적으로 upsert 방식으로 바꾸는 것은 별도 작업.
- 동시 작업: `src/ids.ts`·`src/CsAsWorkspace.tsx`·`src/ServiceReception.tsx` 등이 지금 다른 작업으로 수정 중(git status) — 구현 시작 전 커밋 정리 확인.

## 8. 작업 분해 (겹치지 않게)

| 역할 | 할 일 | 건드릴 파일 |
|---|---|---|
| 팀장(MCP) | P0 시작 전 M0~M6 실행, 1.2 표 채움 | 이 문서 1.2 |
| ui-designer 윤화면 | VendorPicker 폰·PC 목업 이미지(검색 → 업체 → 지점 칩 → 기기 체크, 최근 5, [새 표기로 그냥 쓰기]), 관리 "업체 사전"·"기록 표기" 큐 목업. **목업 먼저 사용자 고르기**(디자인은 항상 목업 규칙) | 목업만, 코드 0 |
| db-schema 표다빈 | `supabase/vendor-dictionary-<날짜>.sql`(새 표 6·RLS·grant·접는 키·resolve_vendor·seed_vendor_sites), `supabase/record-vendor-link-<날짜>.sql`(트리거 8개·백필 함수), `vendor_match_key_` TS 일치 수정, `supabase/tests/judgments.sql` 사례 추가 → sql-review → /sql-handoff | supabase/*.sql 만 |
| developer A (P0 공용) | `src/vendorDictionary.ts`(사전 받기·폰 캐시·검색), `supabase/functions/_shared/counter-sms/vendorKey.ts` 에 vendorFoldKey 추가(SQL 과 거울), 테스트 | 위 2개 + tests/vendorDictionary.test.ts |
| developer B (P0 관리) | `src/VendorDictionaryAdmin.tsx`(정식 이름·지점·별칭 승인·합치기), `src/VendorCodeAdmin.tsx` 에 "기록 표기" 칸 | 이 2개 + SystemAdmin 진입 1줄 |
| developer C (P1) | `src/VendorPicker.tsx`, 필드 연결 `src/field/FieldSearchSheet.tsx`·`src/field/ProcessingFormPanel.tsx`·`src/field/AirPurifierFormPanel.tsx`, 고른 값 link 저장은 `src/api.ts sendForm` 뒤 rpc 1번. App.tsx 는 props 1~3줄만 | 나열한 파일만 |
| developer D (P2) | 4.1 표 3~16 화면별로 VendorPicker 끼우기(한 화면 = 한 커밋) | 각 화면 파일 |
| developer E (P3 표시) | 5절 "안 됨" 줄: api.ts getInspForms/searchVendors, DataLookup, workCount, InspectionReport, entity360 link 모으기, record-edit 재해석 | 나열 파일 |
| qa-checker 검수아 | 단계마다 빌드·테스트, 회귀 3가지: ① 필드 양식 글 모양이 그대로인가(카톡 수집 파서가 읽음) ② 고르기 없이 붙여넣기·카톡 수집 저장이 그대로 되는가 ③ link 실패가 저장을 막지 않는가. 폰 682px 뷰포트에서 고르기 3단이 한 화면 안에 | 테스트·검사만 |
| 매뉴얼 | docs/manual/user(필드·관리 장) + ops(사전·백필·큐 운영) 갱신 | docs/manual/ |

## 9. 사용자에게 물을 것 (3개)

- **Q1 정식 이름 규칙**: 임대리스트 거래처명(가장 많이 쓰인 표기)에서 (주)·주식회사만 뺀 것을 정식 이름으로 하고, 다르게 부르고 싶은 곳만 관리 화면에서 고치는 방식으로 괜찮을까요? (예 `㈜청오에스떠블유` → `청오에스떠블유`)
- **Q2 지점 = 사람이 정하는 목록**: 임대리스트 U열 5자리 코드는 한 코드에 다른 업체가 섞여 지점으로 못 씁니다. Q열 부서명/현장명·주소로 지점 후보를 자동으로 만들고 기기 많은 업체 200곳부터 사람이 이름을 정리하는 방식으로 할까요? 정리 담당은 누구로 할까요(운영지원 / 각 팀장)?
- **Q3 필드 탭 강제 수준**: 처음 한 달은 "고르기 권유(사전에 없어도 전송됨, 나중에 확인 큐)" → 미매칭이 충분히 줄면 "사전에 없으면 새 표기 요청 필수"로 올리는 순서로 괜찮을까요?

팀장(클로드)이 정할 것: 기록 표에 칸 대신 옆 표(record_vendor_link)를 쓰는 것(3절), 사전 쓰기 권한(SSO 2단계 전 anon 쓰기 허용 범위).

## 10. 하지 않을 것

- vendor_info(임대리스트 원본)·임대리스트 시트·vendor_master/vendor_match_alias 자동 갱신 로직 수정.
- 과거 기록의 `_업체명`·`업체명`·`_원문`·카톡 원문 덮어쓰기(표시만 코드로 바꾼다).
- U열 5자리 코드를 지점으로 쓰기, 업체 그룹(관계사) 층, 주소 마스터.
- 이름만으로·접는 키로 맞은 것, 후보 2개+ 를 사람 확인 없이 확정.
- 카톡방 글 양식 줄 순서·라벨 바꾸기(업체명 줄 값만 정식 이름이 됨).
- IT 시트 등 남의 데이터 옮기기.
