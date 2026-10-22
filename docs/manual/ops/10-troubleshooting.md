# 10. 자주 난 사고와 해결

> 근거: AGENTS.md 작업 기록, 각 코드 머리 주석, supabase/*.sql 머리 주석. 날짜는 실제 사고 날짜.
> 첫 단계는 거의 항상 **읽기 전용 상태 조회**다(아래 "기본 점검 쿼리"). AI 팀에서는 운영실 감시연이 한다.

## 기본 점검 쿼리 (SQL Editor, 읽기만)
```sql
-- 노트북 실행기 살아 있나 (1분 안이어야 정상)
select name, host, version, last_seen, note from worker_heartbeat order by last_seen desc;
-- 카톡 대기 (평소 0, 낮에 수십 건이면 봇·중계 둘 다 멈춤)
select count(*), min(created_at) from outbox;
-- 최근 배달 경로 (bot_send = 폰 봇, pc_send = 노트북)
select room, source, last_at from room_activity order by last_at desc limit 15;
-- 시트 기입 실패
select category, vendor, sheet_status, attempts, last_error, created_at from field_sheet_sync_jobs where sheet_status = 'failed' order by created_at desc limit 10;
-- cron 실패
select j.jobname, d.status, d.return_message, d.start_time from cron.job_run_details d join cron.job j using (jobid)
where d.status <> 'succeeded' order by d.start_time desc limit 20;
```
(컬럼 이름은 [라이브] 2026-10-22 기준. `sheet_status` 값 이름 'failed' 는 코드 기준 확인 필요.)

---

## 1. 카톡이 안 간다 — 노트북 카톡 PC 로그인 풀림
- **사례**: 2026-10-21 카톡 PC 자동 업데이트로 로그아웃 → 노트북 중계가 약 20시간 멈춤.
- **증상**: `outbox` 대기가 쌓이고 `room_activity` 에 `pc_send` 가 끊김(봇도 멈췄으면 전체 미발송).
- **해결**:
  1. 노트북 원격 접속 → 카톡 PC 가 로그인 화면이면 로그인(봇 계정, 폰 인증이 필요할 수 있음).
  2. 재발 방지: `tools\kakao-pc\save_kakao_cred.ps1` 로 자격 증명 `FIRSTOA_KAKAO` 저장 → `kakao_login.py` 가 자동 로그인. **연속 3회 실패하면 멈춘다**(`tools\kakao-pc\kakao_login_state.json`) — 원인(비밀번호 변경·추가 인증)을 풀고 save_kakao_cred.ps1 을 다시 실행하면 초기화.
  3. 로그인 뒤 중계 대상 방을 다시 **별도 창으로** 열어 둔다.
- 카톡이 렉으로 멈춘 경우: 중계가 연속 열기 실패 3회면 1시간 1회 자동 재시작(2026-10-18 아침 ERP 방 8번 실패 사례).

## 2. 카톡이 안 간다 — 업무폰 봇 정지
- **사례**: 2026-09-23 17:56 이후 봇이 아무 방에도 배달 못 함(폰 앱 종료 추정). 2026-09-29 스레드 충돌로 봇이 저절로 꺼짐(코드로 수리).
- **증상**: `room_activity` 에 `bot_send` 가 끊기고, 노트북이 2분 뒤 대신 보내 `pc_send` 만 찍힘(또는 둘 다 멈춤).
- **해결**: 폰에서 메신저봇R 실행 여부·봇 "점검AS" 켜짐 확인 → 테스트 방에 "봇테스트" → "봇 살아있음 OK". 안 되면 스크립트 통짜 재붙여넣기·재컴파일(07 장). 배터리 최적화 제외 확인.
- 밤 22:00~08:00 에 대기가 쌓이는 것은 **정상**(야간 발송 금지, 08:00 이후 나감).

## 3. 특정 방에만 안 간다 / 딴 방으로 간다
- `room_map` 의 방 이름이 카톡방 이름과 한 글자라도 다르면 못 찾는다(띄어쓰기·괄호). `room_activity` 의 이름과 비교.
- 매핑이 없는 업무·지역(예: 미수|E)은 기능에 따라 안 보내거나 테스트방·지역 AS 방으로 샌다(2026-10-22 E 미수가 테스트방으로 가던 것 발견).
- 노트북 중계는 창이 열린 방에만 붙여 넣는다 → 카톡 PC 에서 그 방 창을 연다.

## 4. 배포했는데 라이브가 그대로 — Vercel 미배포
- `npx vercel ls` 로 최신 배포 상태 확인.
- Error: 대개 테스트 실패(빌드에 vitest 포함) → 고쳐서 다시 푸시. `git_info_fail`(Vercel 쪽 일시 오류) → `npx vercel redeploy <URL> --non-interactive --no-wait`.
- 배포가 아예 안 생김 → 대시보드 Redeploy 또는 빈 커밋 푸시. 급하면 `npx vercel build --prod && npx vercel deploy --prebuilt --prod --yes`.
- 브라우저 캐시: index.html 은 no-cache 지만 PWA·폰 브라우저가 붙잡고 있을 수 있다 → 새로고침/앱 재실행.
- 확인은 화면이 든 lazy 청크에서 고유 문구로(02 장).

## 5. 숨긴 기록이 다음 날 다시 보인다 (오발송 숨김 풀림)
- **원인**: `pc_expansion`·`mfp_expansion`·`misu`·`overage` 는 GAS 가 매일 00:30 경 **통째로 지우고 다시 넣는다**. 숨김(`_hidden`)이 사라진다.
- **해결(적용됨)**: `supabase/mirror-hidden-ledger-20261022.sql` — 숨김 장부 `mirror_hidden` + 트리거. [라이브] 4표 모두 트리거 있음.
- 그래도 풀리면: 시트에서 그 행 내용을 고쳐 `_dupKey` 가 바뀐 경우(의도된 동작) → 다시 숨긴다. 장부 확인 `select * from mirror_hidden;`(SQL Editor, anon 으로는 안 보임).
- `lease_status` 는 장부 대상이 아니다.
- 근본은 시트가 원본이라는 것. 시트에서 지우는 것이 정답인 경우가 많다.

## 6. 화면마다 숫자가 다르다 (숫자 불일치)
- **사례**: 2026-10-22 PC 확장성 — 조회 탭 48(pc_expansion 행 수) vs 팀 현황 45(activity_events). 서로 다른 표·셈법을 세고 있었다.
- **원칙**: 한 지표 = 한 원본 표 + 한 함수. 확장성은 `src/workCount.ts` `countableExpansion`(오발송 삭제·팀장 제외, 종류·작성자·KST 날짜·업체 1건)로 통일.
- 점검: 어느 표를 세는지(원장 vs activity_events vs visit_logs) · 날짜를 KST 로 자르는지(UTC 로 자르던 9곳을 `kstDate()` 로 고친 적 있음) · 1,000행에서 잘리지 않는지(`selectAllRows` 사용) · 숨김/취소/재전송 포함 여부.
- 남은 같은 패턴: 점검·AS 도 팀 현황(activity_events)과 조회(원장 표)가 다른 원본(AGENTS.md 2026-10-22).

## 7. 로그인 화면이 반복되거나 작성자가 바뀐다 — SSO 만료
- 구조: 그룹웨어 SSO, FIELD 세션은 **7일**(`src/sso.ts` SESSION_HOURS, localStorage `cs_sso_session_v1`). 관리 탭 `SSO_REQUIRED` 가 켜져 있으면 세션 없는 기기는 그룹웨어 로그인으로 바로 보낸다.
- **사례**: 2026-10-21 화면을 켜 둔 채 7일이 지나면 재확인을 안 해 작성자 고르기 창이 뜸 → 화면 복귀 때 재확인하도록 수정(`src/ssoBoot.ts`).
- 해결 순서: 그룹웨어에 직접 로그인되는지 → FIELD 새로고침. 계속 실패하면 콜백 주소(`/auth/callback`)가 그룹웨어 허용목록에 있는지 그룹웨어 담당자(경영지원팀)에게 확인. 11/1 부터 그룹웨어는 사번 로그인.
- 로그아웃해도 그룹웨어 세션이 살아 있으면 자동 재로그인된다(그룹웨어에 로그아웃 주소 없음) — 계정 전환은 그룹웨어 쪽에서 로그아웃.
- 비상: 관리 탭에서 `SSO_REQUIRED` 를 끄면 예전 작성자 선택 방식으로 돌아간다.

## 8. 노트북 실행기가 멈췄다는 알림
- 진짜인지 먼저: `worker_heartbeat` 최신 행이 D6110 이고 1분 안이면 오알림.
- 2026-10-19 오알림 원인은 데스크톱에서 시험한 옛 심박 행 → 파수꾼을 "가장 최근 실행기 1대만" 보게 고침. **데스크톱에서 worker.py 를 돌리지 말 것.**
- 진짜 멈춤: 노트북 전원·윈도우 업데이트 재부팅·자동 로그인 확인 → `Get-ScheduledTask 'FIRSTOA Worker'` → 안 되면 bootstrap 한 줄 재실행(06 장).

## 9. 시트에 안 들어간다 (홈 "시트 동기화 실패 N")
- `field_sheet_sync_jobs` 실패 행의 `last_error` 를 본다. "찾기 갱신 실패: 행 없음" = 시트에 그 순번 행이 없음(사람이 시트를 고침) → 시트 확인 후 관리 탭에서 재실행.
- 403 = 서비스 계정 공유 빠짐(08 장 4절). 머리 줄 바뀜 = 고정 열 매핑 확인.
- 7일 창이 지나면 알약은 저절로 초록이 된다(실패가 사라진 것은 아님).

## 10. 시트 미러가 조용히 멈췄다
- **사례**: 2026-08-17 RLS 강화 뒤 anon DELETE 가 막혀 미수·초과·확장성 미러가 8일간 멈춤. GAS 는 실패해도 throw 하지 않고 로그만 남긴다.
- 확인: 미러 표의 최신 `_등록시각`/행 수가 어제 밤 이후인지. GAS 실행 로그(Apps Script → 실행) 확인.
- 해결: GAS 스크립트 속성 `SUPABASE_SERVICE_KEY` 존재 확인, 권한 SQL 이 GAS 경로를 막지 않았는지.

## 11. 네이버 캘린더에만 안 올라간다
- 토큰 만료(~1년)·연동 계정 비밀번호 변경. `supabase/naver-calendar-setup.md` "재연동이 필요할 때"의 주소로 브라우저에서 로그인·동의 → "연동 완료" 알림.
- CalDAV(수정·삭제·회수)는 네이버 애플리케이션 비밀번호가 필요. 비공식 통로라 끊길 수 있다.

## 12. 출근 전·심야에 카톡이 나갔다
- 규칙: 자동 메시지는 KST 10시 이후, 야간 22:00~08:00 은 봇·노트북 모두 보류. 위반이면 어느 경로(cron 일정·엣지 가드·노트북 시계)인지 `room_activity.source` 와 cron 일정(UTC!)으로 찾는다. cron 은 UTC 라 `0 1 * * *` = KST 10:00.
