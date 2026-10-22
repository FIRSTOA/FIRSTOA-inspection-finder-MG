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
| 야간 발송 금지 | **22:00~08:00 KST** | 중계는 보내지 않고 들고 있다가 08:00 이후 첫 1분에 보냄(한 번에 3방 상한) |
| 월요 키맨 포스터 | **월요일 10시대** (`POSTER_HOUR = 10`) | `poster_send.py --weekly` — 사진으로 보냄. 서버 안전망 cron 은 10:30 |
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
- 끄기 환경 변수: `FIRSTOA_RELAY=0`(중계), `FIRSTOA_POSTER=0`(포스터)

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
- 백업 파일에는 고객 정보가 있다 — git 에 올리지 말 것(`logs/`·`state.json` 도 .gitignore).
