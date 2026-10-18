# 작업 C · 노트북 실행기에서 카운터 메일 수집 (Claude Code 또는 Codex, 작업 A 끝난 뒤)

워크트리 이름 제안: `email-counter-worker`
건드리는 범위: `tools/worker/email_counter.py`(신규), `tools/worker/worker.py`(잡 종류 1개 추가), `tools/worker/config.py`(설정 키 추가), `tools/worker/README.md`, `AGENTS.md`.
**선행:** 작업 A의 `email_counters` 테이블이 있어야 한다. 없으면 `supabase/email-counters.sql`을 먼저 적용.

## 배경
지금은 어사이드(브라우저)가 네이버 메일 세션으로 읽는데, 네이버는 브라우저당 1계정만 로그인되고 세션이 풀린다. 노트북 실행기가 **IMAP**으로 hee2gwang·hee3gwang 둘 다 읽어 `email_counters`에 넣고, 매일 10시에 카톡 요약을 `outbox`에 넣으면 로그인 문제가 사라진다.

**주의:** 네이버 IMAP은 계정 설정에서 "IMAP/SMTP 사용"을 켜고 2단계 인증 계정은 **애플리케이션 비밀번호**가 필요하다. 회사 계정이라 **대표 승인 후** 켠다. 코드는 먼저 만들고, 자격증명은 `config.py`가 아니라 **환경변수 또는 `secrets.local.json`(.gitignore)** 에서 읽게 한다. 승인 전에는 `--dry-run`으로 로컬 .eml 샘플 파싱만 테스트.

## 1. `email_counter.py`
- `fetch_new(account) -> list[RawMail]`: IMAP SSL `imap.naver.com:993`. 폴더 `INBOX`, `카운터메일`(존재하면), `ms`. 마지막 처리 UID를 `worker_state` 테이블(없으면 로컬 json)에 저장해 증분 수집. 읽음 상태 바꾸지 않기(`BODY.PEEK`).
- `parse(raw) -> Counter | None`: 아래 양식 7종. 첨부(txt/rtf) 포함. 오류 알림(용지걸림 등)은 `None`.
- `lookup_vendor(serial)`: Supabase REST로 `vendor_info` → `jeomgeom`/`as_records` 순. (`docs/tasks/email-counter.md` 조회 순서와 동일)
- `store(counters)`: `email_counters` upsert (`mail_source, mail_id` 유니크).
- `daily_summary(from_ts, to_ts) -> str`: 카톡 양식 문자열. 평일 10:00 KST에만. 주말·공휴일 제외(`https://date.nager.at/api/v3/PublicHolidays/{년}/KR`, 실패 시 평일만). 범위는 직전 영업일 10:00 ~ 오늘 10:00.
- `send_kakao(text)`: `outbox` insert `{room: '테스트 전용방', text}`.

## 2. 양식 7종
| fmt | 식별 | 흑 | 컬 | 합 | 비고 |
|---|---|---|---|---|---|
| Apeos | `청구 내용 현황[1]` / `사용매수[1]` | [1] | [2] | [4] | [3]=큰컬(컬에 포함). `<주의>` 제목이면 `[소모품]` 블록을 note로 |
| CounterList | `[Total Counter]` | `[Total Black Counter]` | `[Total Color Counter]` | `[Total Counter]` | `[Model Name]`이 비어 있을 수 있음 |
| Kyocera | `MeterDate:` | `Black & White:` 블록 숫자 합 | `Full Color:` 블록 숫자 합 | `Printed Pages:` 아래 `Total:` | 제목이 업체명으로 바뀐 경우 많음(예: '티오더 카운터') → 제목을 location 힌트로 |
| Brother | `총 페이지 카운트` | `단색 페이지 카운트` | `컬러 페이지 카운트` | `총 페이지 카운트` | 위치 줄에 업체명 있을 수 있음 |
| Samsung txt | 제목 `Device Status` + 첨부 `Counter Information.txt` | `Mono Total` 행 마지막 수 | `Color Total` 행 마지막 수 | `Total Impressions` 마지막 수 | 첨부 여러 개면 이름에 Counter/Usage 포함된 것 |
| Samsung rtf | 첨부 `*_UsageCounter_Report.rtf` | `Total Usage` 블록 Total | Color 블록 없으면 0 | 같음 | RTF 제어어 제거 후 줄 단위 파싱 |
| 비카운터 | `걸린 용지`, `Status Message`, 팩스 오류 | 무시 | | | |
시리얼: Apeos `일련번호`, Kyocera `Serial Number:`, Brother `일련 번호:`, Samsung `(Machine )?Serial Number`, CounterList `[Serial Number]`.

## 3. 실행기 연결
- `worker.py` 잡 종류에 `email_counter` 추가: `{"kind":"email_counter","mode":"fetch"|"summary"}`.
- 스케줄: fetch 30분마다, summary 평일 10:00 KST. 기존 스케줄 방식(`register_task.ps1` 또는 worker 내부 타이머) 따르기.
- 로그는 기존 `log()` 사용. 실패 시 `worker_jobs.error`에 남기고 다음 주기 재시도.

## 4. 테스트
- `tools/worker/tests/email_counter_samples/` 에 7종 .eml 샘플(본문만, 개인정보 제거) 넣고 `pytest`로 파싱 값 검증.
- `python email_counter.py --dry-run --since 2026-10-15` 로 DB 쓰기 없이 콘솔 출력.

## 완료 조건
- 샘플 7종 파싱 테스트 통과. `--dry-run` 출력 확인.
- README에 "이메일 카운터" 섹션(설정 키, 애플리케이션 비밀번호 발급 절차, 승인 필요 표시).
- `AGENTS.md` 작업 기록 추가.
