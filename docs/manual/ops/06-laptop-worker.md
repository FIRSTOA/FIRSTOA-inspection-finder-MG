# 06. 노트북 실행기 (24시간 서버 노트북)

> 근거: `tools/worker/README.md`, `tools/worker/worker.py`(VERSION 2026-10-21a), `tools/kakao-pc/*`, `.claude/skills/laptop-update/SKILL.md`, `.claude/agents/kakao-pc-rules.md`.
> **[라이브]** 2026-10-22 `worker_heartbeat`: 1행 `worker@D6110`, host D6110, 버전 2026-10-21a, 마지막 심박 2026-10-22 12:22 UTC.

## 기기 역할
| 기기 | 역할 |
|---|---|
| 데스크톱(개발 PC) | 코드 작성·배포. **여기서 worker.py 를 돌리지 않는다**(`--once` 시험도) — 심박 표에 옛 행이 생겨 파수꾼이 2시간마다 오알림을 낸 사고(2026-10-19) |
| 노트북 D6110 (윈도우 사용자 Belldandy) | 24시간 실행기 + 카톡 PC(봇 계정) |
| 업무폰 | 메신저봇R(07 장) |

## 실행기가 하는 일
| 일 | 언제 | 어떻게 |
|---|---|---|
| 심박 | 1분마다 | `worker_heartbeat` upsert. 15분 끊기면 cron `worker-watchdog` 가 담당자에게 웹푸시(2시간 1회) |
| 전체 표 백업 | 매일 **02:30 KST** 이후 첫 바퀴 | `backup_tables.py` → `내 드라이브\FIRSTOA-백업\<YYYY-MM-DD>\<표>.jsonl.gz` + `manifest.json`, **14회차 보관**. 구글 드라이브가 없으면 OneDrive → `사용자 폴더\FIRSTOA-백업`(로그에 경고). `FIRSTOA_BACKUP_ROOT` 로 지정 가능 |
| 카톡 PC 발송 중계 | 1분마다 | 봇이 **2분 넘게** 못 가져간 `outbox` 를 카톡 PC 방 창에 붙여 넣어 대신 보냄(`tools/kakao-pc/outbox_relay.py`). 보낸 행은 삭제, `room_activity` 에 `pc_send` 기록 |
| 야간 발송 금지 | **22:00~08:00 KST** | 중계는 보내지 않고 들고 있다가 08:00 이후 첫 1분에 보냄(한 번에 3방 상한). **예외: 테스트 전용방 글은 밤에도 바로 보냄**(2026-10-27, 밤에 앱 테스트하려고) |
| 월요 키맨 포스터 | **월요일 10시대** (`POSTER_HOUR = 10`) | `poster_send.py --weekly` — 사진으로 보냄. 서버 안전망 cron 은 10:30 |
| 카톡 대화 내용 저장 | **스위치 켤 때만**(`FIRSTOA_KAKAO_EXPORT=1`, 기본 꺼짐) 매일 **04:30~06:50 KST** 첫 바퀴 1회(Apps Script 수집 트리거 07시보다 먼저 파일이 도착해야 하루 늦게 적재되지 않는다) | `tools/kakao-pc/export_rooms.py --export` — Supabase `kakao_collect_rooms` 의 `enabled`·`export`=true 방 중(표가 없거나 비면 `room_map` 의 점검·AS·물류·미수·불만·재계약 방만 — 마감·부품·자가 제외) **창이 열려 있는 방만, 한 방씩 천천히**(불러오기 30초 → Ctrl+S → 저장 창 최대 15초 → 파일 크기 15초 멈춤 = 내보내기 완료 신호(최대 300초, 파일이 늦게 생겨도, `FIRSTOA_KAKAO_EXPORT_DONE_WAIT` — 그때까지 완료창에 키 안 누름) → 그 뒤 완료창(제목 없는 방 창 소유 팝업)을 찾아 맨 앞일 때만 Enter=확인으로 닫음 → 방 사이 20초, 상한 120분 · 21방 약 49분) 저장 창에 `<방이름>_YYYYMMDD.txt` 경로 붙여넣기 → 구글 드라이브 `카톡 자동적재 수신함`. 실행기는 이걸 **별도 프로세스**로 띄워 심박은 계속 찍히고, 도는 동안 중계·포스터·카톡 사진 일감은 쉰다. 뒤는 Apps Script `Drive.gs` 가 적재(아래 절) |
| 일감 | 들어올 때 | `worker_jobs` 의 `status=queued` 행: `ping` `backup` `relay` `poster` `kakao_photo` (음성·OCR 은 자리만) |

> 파일 불일치: `tools/worker/README.md` 표에는 "월 08시"로 적혀 있지만 코드(`worker.py` POSTER_HOUR)는 10시다(2026-10-21 변경). 코드가 사실. `tools/kakao-pc/README.md` 의 `C:\firstoa\` 경로·"월요일 08:00 작업 등록"도 옛 설치 방식이다(지금은 실행기가 부른다).

## 새 노트북에 처음 설치 — 한 줄
24시간 로그인해 둘 계정으로 로그인 → **일반 PowerShell**(관리자 아님):
```
[Net.ServicePointManager]::SecurityProtocol='Tls12'; irm https://raw.githubusercontent.com/FIRSTOA/FIRSTOA-inspection-finder-MG/main/tools/worker/bootstrap.ps1 | iex
```
bootstrap.ps1 이 하는 일: ① winget 으로 Git·Python 3.12(없을 때만) ② 저장소를 `%USERPROFILE%\FIRSTOA-inspection-finder-MG` 에 clone/pull ③ 전원: 절전 안 함·덮개 닫아도 유지 ④ `install.ps1`(pip, 한 바퀴 시험, 로그온 시 자동 시작 작업 `FIRSTOA Worker`).
`winget` 이 없다고 나오면 Microsoft Store "앱 설치 관리자" 설치 후 다시.

그다음 손으로:
1. **카톡 PC** 설치 → 봇 계정으로 로그인(폰 인증) → 자동 로그인 체크.
2. **카톡 자동 로그인 백업**: `tools\kakao-pc\save_kakao_cred.ps1` 실행 → 봇 계정 아이디·비밀번호 입력 → 윈도우 자격 증명 `FIRSTOA_KAKAO` 에 암호화 저장. 카톡 PC 가 자동 업데이트로 로그아웃되면 `kakao_login.py` 가 이것으로 다시 로그인한다(10/21 20시간 발송 멈춤 사고 대응). **연속 3회 실패하면 멈춘다**(`kakao_login_state.json`) — save_kakao_cred.ps1 을 다시 실행하면 초기화.
3. 중계·포스터 대상 방(마감방·지역 운영방)을 **더블클릭해 별도 창으로 열어 둔다**. 최소화는 되지만 닫으면 안 된다. 창이 없는 방은 검색으로 열고 보낸 뒤 닫는다(10분 1회).
4. 윈도우 자동 로그인: `netplwiz` → "사용자 이름과 암호를 입력해야…" 체크 해제(정전 뒤 재부팅 대비).
5. 구글 드라이브 데스크톱 설치 + 회사 구글 계정 로그인(백업 위치).
6. Supabase 에 `supabase/worker-heartbeat.sql` 이 실행돼 있어야 한다(이미 됨).

## 코드를 바꾼 뒤 반영 (/laptop-update)
1. `tools/kakao-pc/*` 나 `gas-and-bot/*` 를 고쳤으면 카톡 규칙 검사(검사실 방지훈) 통과가 먼저. 실패면 푸시하지 않는다.
2. `origin/main` 에 푸시(02 장). 노트북은 GitHub 에서 받으므로 푸시 전엔 반영 안 된다.
3. 노트북 PowerShell 에서 **위 bootstrap 한 줄을 다시 실행** = pull + pip + 작업 재등록 + 재시작.
4. 확인(읽기 전용): `worker_heartbeat` 최신 행이 1분 안이고 host D6110·새 VERSION 인지, `outbox` 대기 0, `room_activity` 최근 `pc_send`/`bot_send`.
   ```sql
   select name, host, version, last_seen, note from worker_heartbeat order by last_seen desc;
   select count(*) from outbox;
   select room, source, last_at from room_activity order by last_at desc limit 10;
   ```
5. 2~3분 지나도 심박이 없으면 노트북 로그 꼬리 30줄을 본다.

## 확인·운영 명령 (노트북에서)
```
python worker.py --once          # 한 바퀴(심박·일감·시계)
python worker.py --job ping      # 바로 실행
python worker.py --backup        # 지금 전체 백업
Get-ScheduledTask 'FIRSTOA Worker' | Select State
Stop-ScheduledTask -TaskName 'FIRSTOA Worker' ; Start-ScheduledTask -TaskName 'FIRSTOA Worker'
python ..\kakao-pc\poster_send.py --check      # 열린 방 창과 이번 주 대상
```
- 로그: `tools\worker\logs\worker-<날짜>.txt`, 백업 `logs\backup-<날짜>.txt`, 중계·포스터 `tools\kakao-pc\poster_log.txt`
- 상태: `tools\worker\state.json`(마지막 백업 날짜·결과, 중계 시각, 포스터 주차)
- 일감 시험(SQL Editor): `insert into worker_jobs(kind, payload, created_by) values ('ping', '{"note":"test"}', '이름');` → 1분 안에 `status=done`
- 끄기 환경 변수: `FIRSTOA_RELAY=0`(중계), `FIRSTOA_POSTER=0`(포스터). 켜기(기본 꺼짐): `FIRSTOA_KAKAO_EXPORT=1`(카톡 대화 내용 저장)

## 카톡 대화 내용 매일 저장 (export_rooms.py, 2026-10-23 · 기본 꺼짐)
뒤쪽은 이미 있다: 구글 드라이브 `카톡 자동적재 수신함` 에 카톡 TXT 가 들어오면 Apps Script `apps-script/first-data/src/Drive.gs` 의 시간 트리거 `ingestFromDriveFolder` 가 파일 첫 줄의 방 이름으로 분류·증분 적재하고 `처리됨`/`확인필요` 로 옮긴다. 이 스크립트는 "저장 버튼을 누르는 손"만 한다.

안전 원칙: **메뉴·좌표 클릭 없음**(채팅방 메뉴에 "채팅방 나가기"가 있다 — `docs/tasks/tab-search-kakao-history.md` 5-1). 단축키 Ctrl+S 하나와 윈도 표준 저장 창만 쓴다. 검색으로 방을 열지 않는다(열린 창만). 키 누르기 전마다 맨 앞 창 확인, Esc 는 카톡이 새로 띄운 창이 맨 앞일 때만, 파일 이름은 클립보드 붙여넣기 뒤 클립보드 비움(WM_SETTEXT·Ctrl+A 없음), 같은 이름 파일은 덮어쓰지 않음, 실패 3번이면 그날 중단. **천천히 한 방씩**(2026-10-27 사용자 실측 "큰 방은 기다려야 전체 대화가 불러와지고, 여러 방을 한꺼번에 열면 튕긴다"): 불러오기 대기 30초(2026-10-28 사용자 "방 내용 기다리기 30초, 저장 1분 정도") + 카톡 응답 확인(없으면 5초 간격 최대 60초, 그래도 없으면 그 방 실패) → Ctrl+S → 저장 창 최대 15초 → **파일 크기 멈춤 = 완료 신호**: 저장 창이 닫힌 뒤 파일 크기가 15초 동안 안 변할 때까지 최대 300초(`FIRSTOA_KAKAO_EXPORT_DONE_WAIT`) 기다린다. 파일이 늦게 생겨도(2026-10-28 실측 3분+) 이 안에서 기다린다. 기대 이름(`방이름_YYYYMMDD.txt`) 파일이 없으면 수신함에서 Ctrl+S 뒤 생긴 .txt(0바이트 아님, 가장 최근 1개 — 붙여 넣은 이름이 안 먹고 카톡 기본 이름으로 저장된 경우)의 크기를 대신 재고, 멈추면 기대 이름으로 바꾼다(같은 이름이 있으면 덮지 않고 `.alt`). **파일이 멈추기 전에는 완료창에 어떤 키도 누르지 않는다**(진행 중 Enter/Esc 는 내보내기를 취소할 수 있다). 300초 안에 안 멈추면 그 방은 실패, 파일은 `.partial` 로 치우고 그 방 완료창은 이번 실행에서 건드리지 않는다. → **완료창**: 카톡 "100% 완료되었습니다 [폴더열기][확인]" 창은 2026-10-28 23:50 노트북 실측(`probe_windows.py`)으로 **제목이 비어 있고 자식 창이 0개**라 제목·글자로는 못 찾는다. 그래서 Ctrl+S 직전에 없던 카톡 창 중 ① 클래스 `EVA_Window_Dblclk` ② **소유 창 = 그 방 창**(같은 모양의 광고 창은 메인 창 소유라 제외 — 광고 창은 절대 건드리지 않는다) ③ 제목 '' ④ 자식 0개 ⑤ 너비 200~500·높이 120~400 인 창을 찾는다(없으면 0.5초 간격 최대 10초, 그래도 없으면 `완료창 없음` 로그만). 맨 앞이 그 창이면 Enter(기본 단추=확인), 아니면 앞으로 가져오기 한 번 뒤 재확인, 그래도 아니면 안 누르고 `완료창 남김(맨 앞 아님)`. Enter 직전에 그 파일의 크기·수정 시각을 다시 재서 확정 값과 다르면 누르지 않는다(`완료창 남김(파일이 아직 변함)`). Enter 뒤 3초 안에 사라졌는지 확인한다. 저장 창 단계에서 Esc 로 닫는 확인창(덮어쓰기·오류)은 표준 대화 상자(`#32770`)만 대상이다. → 방 사이 20초. 시작할 때와 방 사이마다, 열려 있는 대상 방 창 소유의 완료창이 남아 있으면(뮤텍스상 우리 내보내기는 돌고 있지 않으므로 완료된 잔여. 단 수신함에 오늘 날짜 `<방>_YYYYMMDD.txt.partial` 이 있는 방과 이번 실행에서 파일이 안 멈춘 방은 아직 내보내는 중일 수 있어 건드리지 않는다) 같은 규칙으로 맨 앞일 때만 Enter 로 닫는다. 못 닫으면 로그만 남기고 그 방도 진행한다(완료창은 방마다 따로라 겹치지 않음). 창은 새로 열지 않는다. 조정 환경 변수(초): `FIRSTOA_KAKAO_EXPORT_LOAD_WAIT`(30) · `FIRSTOA_KAKAO_EXPORT_DIALOG_WAIT`(15) · `FIRSTOA_KAKAO_EXPORT_DONE_WAIT`(300) · `FIRSTOA_KAKAO_EXPORT_GAP`(20) · `FIRSTOA_KAKAO_EXPORT_LIMIT`(7200). 예상: 21방 × (30+15+내보내기 약 60+멈춤 15) + 방 사이 20 × 20 ≈ 49분 → 05:30 시작이면 06:20 무렵(상한 120분 안). 방 하나가 3분 넘게 걸리면 120분 상한에 걸려 남은 방은 다음 날로 밀린다. 로그는 방마다 `불러오기 대기 n초 → Ctrl+S → 저장 창 n초 → 파일 n KB 확정(n초) → 완료창 Enter 닫음` 한 줄(끝 조각은 `완료창 없음` / `완료창 남김(맨 앞 아님)` 중 하나), 실패 줄에는 `파일 대기 n초 · 완료창 키 안 누름` 을 적는다. 창 모양을 다시 봐야 하면 완료창이 떠 있을 때 `python tools\kakao-pc\probe_windows.py`(읽기 전용). 끝에 소요 시간. 실행기 출력은 `tools\worker\logs\kakao-export-<날짜>.txt`.

켜는 순서 (노트북에서, **데스크톱에서 돌리지 않는다**):
1. 시험할 업무방 하나를 카톡 PC 에서 더블클릭해 창으로 열어 둔다.
2. **probe**(저장 안 함 — Ctrl+S 뒤 뜨는 창의 클래스·제목만 기록하고 Esc):
   ```
   python tools\kakao-pc\export_rooms.py --probe --room "방이름"
   ```
   - `✓ 저장 창이 맞음` → 3번으로. 스크린샷 `tools\kakao-pc\logs\export_probe.png` 로 눈으로도 확인.
   - `? 표준 대화 상자지만 제목 '…' 이 목록에 없음` → 저장 창이 맞으면 `setx FIRSTOA_KAKAO_SAVE_TITLE "그 제목"`.
   - `✗ 단축키 불가 · 수동 확인 필요` → **켜지 않는다**(이 카톡 버전은 Ctrl+S 가 저장이 아님). 팀장에게 로그 전달.
3. 한 방만 실제 저장: `python tools\kakao-pc\export_rooms.py --export --rooms "방이름"` → 수신함에 `방이름_YYYYMMDD.txt` 가 생기고, **첫 줄이 "○○ 님과 카카오톡 대화"** 인지 연다(Drive.gs 가 이 줄로 방을 고른다). 1시간 안에 `처리됨` 으로 옮겨지면 끝까지 동작.
4. 켜기: `setx FIRSTOA_KAKAO_EXPORT 1` → `Stop-ScheduledTask -TaskName 'FIRSTOA Worker' ; Start-ScheduledTask -TaskName 'FIRSTOA Worker'` → 로그 첫 줄에 `카톡 저장 켬`.
5. 끄기: `setx FIRSTOA_KAKAO_EXPORT 0` 후 작업 재시작.

기타: `--list`(대상 방·창 열림 여부만, 키 안 누름), `--category 점검,AS`(업무 종류만 — 수집 표는 kinds 와 겹치는 방), `--from-room-map`(비상용: 수집 표를 건너뛰고 옛 room_map 방식), `--dir "<폴더>"` 또는 `FIRSTOA_KAKAO_EXPORT_DIR`(기본 = 구글 드라이브\카톡 자동적재 수신함. 폴더가 없으면 **만들지 않고** 멈춘다 — 로컬에서 새로 만들면 Drive.gs 가 보는 폴더와 다른 폴더가 된다). 로그는 `poster_log.txt` 의 `[내보내기]` 줄, 결과는 `state.json` 의 `kakao_export_last`.
주의: PC 카톡 저장은 **그 PC 에 남은 대화만** 나온다. 봇 계정은 10/21 재로그인이라 그 전 대화는 없을 수 있다. Drive.gs 는 방 매핑(getRoomMap)으로 고르므로 거기 없는 방 파일은 `확인필요` 로 간다.

## 카톡 PC 자동화 금지 규칙 (실측 사고 기반, 코드 고칠 때 필수)
`.claude/agents/kakao-pc-rules.md` 가 원문. 요약:
- `Ctrl+A`, `Ctrl+F` 금지(이 카톡 버전에서 '친구 추가' 창), `Ctrl+E` 탭 전환 기대 금지, `WM_SETTEXT` 금지(카톡 힙 손상 크래시), 아래 화살표+Enter 로 방 열기 금지.
- 붙여넣기·Enter 직전 **맨 앞 창 제목 = 목표 방** 확인. 맨 앞이 카톡 메인 창이 아니면 키를 누르지 않는다.
- 창 연 뒤 2.5초, 방 사이 2초, 보낸 뒤 닫기 전 8초(바로 닫으면 카톡이 죽었다). 한 번에 3방 상한.
- 카톡 재시작은 정상 종료 요청 → 대기 → 강제, 1시간 1회. 연속 열기 실패 3회면 렉으로 보고 재시작.
- 새 좌표·단축키는 `probe_chat_tab.py` 스크린샷으로 눈으로 확인한 뒤에만.
- 노트북 기준: 카톡 PC 26.8.2.5324, 메인 창 490x1020, 배율 100%. 카톡이 자동 업데이트되면 좌표가 틀어질 수 있다.

## 설계 메모
- anon 키만 쓴다. service_role 키는 노트북에 두지 않는다.
- 일감 잡기는 `status=queued` 조건부 갱신이라 실행기가 둘이어도 한쪽만 가져간다(그래도 실행기는 1대만 돌린다).
- `backup` 일감 payload: `{"tables":"표1,표2","out":"archive-20261024"}` — `out` 이 폴더 이름만이면 백업 루트(구글 드라이브\FIRSTOA-백업) 아래 그 이름 폴더, 절대경로면 그대로. 날짜(YYYY-MM-DD)가 아닌 이름은 14회차 정리에서 안 지워진다. `out` 을 비우면 그날 02:30 백업 폴더에 덮어쓴다(2026-10-24a).
- 백업 파일에는 고객 정보가 있다 — git 에 올리지 말 것(`logs/`·`state.json` 도 .gitignore).
