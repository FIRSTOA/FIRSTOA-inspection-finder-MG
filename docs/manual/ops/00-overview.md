# 00. 시스템 지도 — FIELD 가 어떻게 생겼나

> 운영·이관 매뉴얼 (넘겨받는 개발자/관리자용). 작성 2026-10-22, 데이터실 표다빈.
> 근거: AGENTS.md, CLAUDE.md, tools/worker/README.md, tools/kakao-pc/README.md, apps-script/README.md, supabase/*.sql 머리 주석, Supabase MCP 실측(2026-10-22).
> 표기: **[라이브]** = 2026-10-22 Supabase 에서 직접 조회한 값, **[파일]** = 저장소 파일에 적힌 값. 둘이 다르면 라이브가 사실이다.

## 한 줄
퍼스트전산 CS팀 내부 웹앱 **FIELD**. 현장 기사가 점검·AS·미수·재계약·접수 등을 폰으로 쓰면 → DB 에 저장 → 구글 시트에 기입 → 카톡 방에 자동 게시된다.

## 구성 요소 8개

| # | 구성 | 어디에 | 무엇을 | 사람이 관리할 것 |
|---|---|---|---|---|
| 1 | 웹앱(프런트) | 저장소 `src/` · Vite + React 19 + TypeScript + Tailwind v4 | 모든 화면. DB 는 anon 키로 REST 직접 호출(`src/supabase.ts` 래퍼) | 코드 |
| 2 | 호스팅 | Vercel 프로젝트 `firstoa-inspection-finder-mg` → https://firstoa-inspection-finder-mg.vercel.app | GitHub `main` 푸시마다 자동 빌드·배포. `api/` 폴더 = Vercel 서버리스(네이버 캘린더 연결·ICS) | 02-deploy.md |
| 3 | Supabase | 프로젝트 ref `kkdiihazgzesbqxjytqv` (Postgres + PostgREST + 엣지 함수 + pg_cron + Storage) | 모든 데이터의 중심. 표 약 90개, 엣지 함수 25개, cron 14개, 사진 버킷 3개 | 03·04·05 장 |
| 4 | 구글 시트 + GAS | 구글 드라이브(회사 계정). GAS 프로젝트 4종 + 시트 부착 1종 | 시트가 원본인 표(임대리스트·미수·초과·확장성)를 밤마다 Supabase 로 **미러**. FIELD → 시트 기입은 엣지 `field-sheet-sync`(서비스 계정) | 08 장 |
| 5 | 노트북 실행기 | 사무실 노트북 D6110, 작업 스케줄러 `FIRSTOA Worker`, 코드 `tools/worker/` | 1분 심박, 02:30 전체 표 백업(구글 드라이브), 카톡 PC 중계, 월 10시 키맨 포스터, `worker_jobs` 일감 | 06 장 |
| 6 | 카톡 PC 자동화 | 같은 노트북, 코드 `tools/kakao-pc/` | 봇이 2분 넘게 못 보낸 outbox 를 카톡 PC 창에 붙여 넣어 대신 보냄, 사진 포스터 | 06·07 장 |
| 7 | 업무폰 메신저봇R | 안드로이드 업무폰, 스크립트 기준본 `gas-and-bot/supabase-outbox-poller.js` | 7초마다 `outbox` 를 읽어 카톡 방에 게시, 마감방 목록 수집, 방 활동 보고 | 07 장 |
| 8 | 그룹웨어 SSO | 회사 그룹웨어 https://firstoa-groupware.vercel.app (경영지원팀 소유) | 로그인·작성자 이름 고정. FIELD 는 토큰 검증만, 비밀번호·서명키 없음 | 01·10 장 |

부가: 네이버 캘린더(CalDAV 양방향, 엣지 `naver-calendar-push`/`naver-calendar-sync`), 솔라피 문자(엣지 `customer-message-send`), OpenAI(AI 보조 엣지 함수 12개), 웹푸시(엣지 `push-send`).

## 데이터 흐름

```
 [현장 기사 폰/PC 브라우저]
        │  (그룹웨어 SSO 로그인 → 작성자 이름 고정)
        ▼
 ┌────────────────────────────┐     GitHub main push      ┌──────────────┐
 │ FIELD 웹앱 (Vercel)        │ ◀──────────────────────── │ 저장소        │
 │  src/supabase.ts (anon 키) │                            │ FIRSTOA/...-MG│
 └──────────┬─────────────────┘                            └──────────────┘
            │ REST insert/select (PostgREST)
            ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Supabase  kkdiihazgzesbqxjytqv                                        │
 │  표: jeomgeom · as_records · service_receptions · as_tickets · outbox │
 │      vendor_info(임대리스트 미러) · misu/overage/pc/mfp(시트 미러) …  │
 │  pg_cron ──net.http_post──▶ 엣지 함수(field-sheet-sync, naver-…, …)   │
 │  Storage: photos / reports / promo-materials (공개 버킷)              │
 └───┬─────────────────┬───────────────────────┬──────────────────────┘
     │ outbox 행        │ field-sheet-sync       │ 밤 00시대 전체 교체 /
     │ (room, text)     │ (서비스 계정)           │ 월 05시대 임대리스트 증분
     ▼                  ▼                        │ (GAS First-DATA → REST)
 ┌──────────────┐  ┌──────────────────┐          │
 │ 업무폰 봇     │  │ 구글 시트         │ ─────────┘
 │ 메신저봇R     │  │ (확장성·담당자변경 │
 │ 7초 폴링      │  │  ·불만·서비스접수) │
 └──────┬───────┘  └──────────────────┘
        │ 2분 넘게 못 가져가면
        ▼
 ┌─────────────────────────────┐
 │ 노트북 D6110                 │──▶ 02:30 백업 → 구글 드라이브\FIRSTOA-백업
 │  FIRSTOA Worker (1분 루프)   │──▶ worker_heartbeat (끊기면 cron 파수꾼 → 웹푸시)
 │  outbox_relay.py → 카톡 PC   │
 └──────────────┬──────────────┘
                ▼
          [카톡 업무 방들]  ← 방 이름은 room_map 과 글자 하나까지 같아야 함
```

## 원본(Source of Truth) 한눈에

| 데이터 | 원본 | Supabase 쪽 |
|---|---|---|
| 점검·AS 기록 | FIELD + 카톡 양식(GAS 파서) | `jeomgeom`, `as_records` 증분(`_dupKey` 중복 무시) |
| 임대리스트(거래처·기기) | 구글 시트 | `vendor_info` (월요일 05시대 GAS 증분, **읽기 전용**) |
| PC·복합기 확장성, 미수, 초과, 임대현황 | 구글 시트 | `pc_expansion`, `mfp_expansion`, `misu`, `overage`, `lease_status` (매일 00시대 **통째 교체**) |
| 서비스접수·일정·OKR·미수 방문이력 등 | FIELD | 각 표가 원본 |
| 서비스접수 시트 상태(처리완료 등) | 접수 시트 | 엣지 `reception-sheet-open` 이 읽기만(스위치) |

자세한 것은 03-database.md.

## 저장소 지도 (짧게)
- `src/` 프런트 · `api/` Vercel 서버리스 · `public/` 정적(설명서 등)
  - `src/field/` FIELD 탭 점검·AS·청정기 양식 부품(2026-10-24 App.tsx 에서 분리): `fieldFormModel.ts`(타입·옵션·여분 순수 함수) · `ProcessingFormPanel`·`AirPurifierFormPanel`(양식) · `DevicePicker`·`NumSelect`·`SpareQuickEditor`·`CounterOcrButton`·`AuthorPicker`(부품) · `*.view.tsx`(겉틀·안내 한 줄·단추 줄, 로직 없음). 상태·보내기 흐름은 App.tsx 에 그대로
- `supabase/*.sql` 표·RLS·cron (1파일 = 1기능, SQL Editor 에서 사람이 실행) · `supabase/functions/*` 엣지 함수(Deno)
- `apps-script/` GAS 소스(자동 반영 안 됨) · `gas-and-bot/` 메신저봇R 스크립트
- `tools/worker/` 노트북 실행기 · `tools/kakao-pc/` 카톡 PC 자동화
- `scripts/` 빌드 보조(패치노트·에이전트 작업 기록 생성)
- `.claude/` AI 에이전트 팀·스킬 (09 장) · `docs/tasks/` 설계안·지시서 · `AGENTS.md` 작업 기록(가장 중요한 이력)

## 이 매뉴얼의 장
| 파일 | 내용 |
|---|---|
| 01-accounts-and-secrets.md | 계정·키 위치(값 없음) |
| 02-deploy.md | 배포 |
| 03-database.md | 표·원본·권한·cron |
| 04-sql-handoff.md | SQL 실행 절차 |
| 05-edge-functions.md | 엣지 함수 |
| 06-laptop-worker.md | 노트북 실행기 |
| 07-kakao-bot.md | 업무폰 봇 |
| 08-google-sheets.md | 시트·GAS |
| 09-agent-team.md | Claude Code 에이전트 팀 |
| 10-troubleshooting.md | 자주 난 사고 |
| 11-handover-checklist.md | 첫날 체크리스트 |
