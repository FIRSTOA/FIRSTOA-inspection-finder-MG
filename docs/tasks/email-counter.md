# 작업 A · 이메일 카운터 저장·조회 (Claude Code 담당)

워크트리 이름 제안: `email-counter-ui`
건드리는 범위: `supabase/email-counters.sql`(신규), `src/EmailCounters.tsx`(신규), `src/emailCounters.ts`(신규), 사이드바 진입점 1곳, `AGENTS.md`.
**건드리지 말 것:** `CounterSms*.tsx`(문자 카운터는 별도 기능), `jeomgeom`/`as_records`/`vendor_info` 스키마, `tools/`.

## 배경
복합기들이 `count@firstoa.co.kr` 발신으로 매일 카운터 메일을 보낸다(네이버 hee2gwang·hee3gwang 수신). 지금은 어사이드가 메일을 읽어 카톡으로만 보내고 DB에 남지 않는다. 이걸 FIELD에 저장하고 조회·추이를 볼 수 있게 한다.

## 1. 테이블 `supabase/email-counters.sql`
```sql
create table if not exists public.email_counters (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  received_at timestamptz not null,            -- 메일 수신 시각
  mail_source text not null default '',         -- 'naver:hee2gwang' | 'naver:hee3gwang' | 'gmail:admin'
  mail_id text not null,                        -- 메일함 내 고유 id (중복 방지)
  fmt text not null default '',                 -- Apeos | CounterList | Kyocera | Brother | Samsung
  vendor text not null default '',              -- 조회된 업체명 (없으면 '')
  vendor_src text not null default '',          -- '임대' | 'FIELD' | '임대+FIELD' | '본문' | ''
  model text not null default '',
  serial text not null default '',
  asset_no text not null default '',
  black int, color int, large_color int, total int,
  note text not null default '',                -- 소모품 경고 등
  raw_subject text not null default '',
  raw_body text not null default '',            -- 원문(파싱 재검증용, 8KB 이내로 자르기)
  unique (mail_source, mail_id)
);
create index if not exists email_counters_serial_idx on public.email_counters(serial, received_at desc);
create index if not exists email_counters_received_idx on public.email_counters(received_at desc);
-- RLS: anon select/insert 허용 (기존 service_receptions.sql 패턴 그대로), update/delete 불가
```
+ 뷰 `email_counters_latest` : 시리얼별 최신 1행.
+ 함수 `email_counter_delta(serial, received_at)` 또는 뷰로 **직전 값 대비 증가량**(흑/컬/합) 계산.

## 2. 화면 `src/EmailCounters.tsx`
- 사이드바 **기록·성과** 그룹 아래 "이메일 카운터" 메뉴 추가 (기존 그룹 추가 방식 그대로).
- 상단: 기간(기본 최근 7일), 검색(업체명/시리얼/모델), 메일함 필터(hee2/hee3/gmail), 업체명 없음만 보기 토글.
- 표 컬럼: 수신일시 · 업체명(없으면 빨간 "없음") · 모델 · 시리얼 · 흑 · 컬 · 합 · 증가(흑/컬/합, 직전 대비) · 비고(note) · 메일함.
- 행 클릭 → 우측/모달에 원문(raw_body)과 같은 시리얼 최근 10건 미니 추이(막대 or 숫자 나열).
- "업체명 없음" 행에 **업체명 직접 지정** 입력 → `email_counters.vendor` update는 RLS로 막혀 있으므로, 대신 `email_counter_vendor_overrides(serial, vendor, set_by, set_at)` 테이블을 두고 insert. 조회 시 override가 있으면 그걸 우선 표시.
- 복사 버튼: 현재 화면 표를 카톡용 텍스트로 (형식은 아래 "카톡 메시지 양식").

## 3. 데이터 접근 `src/emailCounters.ts`
`src/supabase.ts`의 `selectRows`/`upsertRows` 래퍼 사용. 직접 fetch 금지.

## 카톡 메시지 양식 (어사이드가 지금 보내는 것과 동일하게)
```
[이메일 카운터] 10/17(금) 10시 ~ 10/20(월) 10시 · 5건
(네이버 hee3gwang + Gmail)

1. 위앤유텍
   11:52 · ECOSYS MA2100cfx · WDM3500908
   흑 7,552 / 컬 5,557 / 합 13,109
2. ...
```

## 양식별 파싱 규칙 (참고용 — 저장 화면에서는 파싱 안 함. 작업 C가 씀)
| fmt | 식별 | 흑 | 컬 | 합 |
|---|---|---|---|---|
| Apeos(후지제록스) | 본문 `청구 내용 현황[1]` 또는 `사용매수[1]` | [1] | [2] | [4] ([3]=큰컬, [2]에 포함) |
| CounterList(신도) | `[Total Counter]` | `[Total Black Counter]` | `[Total Color Counter]` | `[Total Counter]` |
| Kyocera | `MeterDate:` | `Black & White` 용지별 합 | `Full Color` 용지별 합 | `Printed Pages → Total` |
| Brother | `총 페이지 카운트` | `단색 페이지 카운트` | `컬러 페이지 카운트` | `총 페이지 카운트` |
| Samsung txt | 제목 `Device Status` + 첨부 `Counter Information.txt` | `Mono Total` 마지막 열 | `Color Total` 마지막 열 | `Total Impressions` 마지막 열 |
| Samsung rtf | 첨부 `*_UsageCounter_Report.rtf` | `Total Usage` 블록 Total | Color 블록(없으면 0) | 같음 |
업체명 조회 순서: `vendor_info`(기번/시리얼번호(기번)/자산번호) → 여러 건이면 최근 점검·AS 업체명과 같은 것 → 계약일 최신 → `jeomgeom`/`as_records` → 본문 위치 → 없음.

## 완료 조건
- `npm run build` 통과.
- 샘플 데이터 10행 insert하는 `supabase/email-counters-seed.sql` 포함(위 양식 표의 값 활용).
- `AGENTS.md` 작업 기록에 추가. 화면 캡처 1장을 `docs/tasks/email-counter-done.png`로.
