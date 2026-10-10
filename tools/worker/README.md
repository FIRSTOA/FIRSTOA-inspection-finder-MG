# FIRSTOA 작업 실행기 (노트북 · 24시간)

업무폰(메신저봇R)이 카톡을 읽고 쓰고, Supabase 크론·엣지 함수가 자동 작업의 심장이라면,
이 실행기는 **사무실 기계가 있어야 하는 일**과 **밤에 몰아서 하는 처리**를 맡는다.

| 일 | 언제 | 어떻게 |
|---|---|---|
| 심박 | 1분마다 | `worker_heartbeat` 에 살아 있음 기록. 15분 끊기면 DB 파수꾼이 담당자에게 웹푸시 |
| 전체 표 백업 | 매일 02:30 KST | `backup_tables.py` — 60여 표를 `구글 드라이브\FIRSTOA-백업\<날짜>\` 에 jsonl.gz, 14회차 보관 |
| 카톡 PC 발송 중계 | 5분마다 | 봇이 3분 넘게 못 가져간 outbox 를 카톡 PC 방 창에 붙여 넣어 대신 보냄(`tools/kakao-pc/outbox_relay.py`) |
| 월요 키맨 포스터 | 월 08시 | `tools/kakao-pc/poster_send.py --weekly` |
| 일감 처리 | 들어올 때 | `worker_jobs` 의 queued 행을 잡아 실행 — `ping` `backup` `relay` `poster` (음성·OCR 은 자리만) |

## 처음부터 (아무것도 안 깔린 새 노트북) — 한 줄

노트북에서 24시간 로그인해 둘 계정으로 로그인한 뒤, **일반 PowerShell**(관리자 아님)을 열고 아래 한 줄을 붙여 넣는다.

```
[Net.ServicePointManager]::SecurityProtocol='Tls12'; irm https://raw.githubusercontent.com/FIRSTOA/FIRSTOA-inspection-finder-MG/main/tools/worker/bootstrap.ps1 | iex
```

`bootstrap.ps1` 이 순서대로 한다 — ① winget 으로 Git·Python 3.12 설치(없을 때만) ② 저장소를 `사용자 폴더\FIRSTOA-inspection-finder-MG` 에 받음(있으면 pull)
③ 전원: 전원 연결 시 절전 안 함·덮개 닫아도 유지 ④ `install.ps1`(pip 패키지 · 한 바퀴 시험 · 로그온 시 자동 시작 작업 'FIRSTOA Worker').
끝나면 1분 안에 `worker_heartbeat` 에 심박이 찍히고, FIELD 카운터 문자 탭의 카운터 전송이 "카톡 PC가 직접 전송" 으로 바뀐다.
**다시 실행하면 업데이트**(pull + 재등록)다. `winget` 이 없다는 말이 나오면 Microsoft Store 에서 "앱 설치 관리자"를 설치하고 다시.

그 다음 손으로 할 것 세 가지:
1. **카톡 PC** 설치 → 업무폰(봇) 계정으로 로그인(폰에서 인증번호) → 자동 로그인 체크. 로그인 뒤 **마감방·지역 운영방을 더블클릭해 별도 창으로 열어 둔다**(실행기는 열린 창에만 붙여 넣는다). 창은 최소화해도 되지만 닫으면 안 된다.
2. **윈도우 자동 로그인**: `netplwiz` → "사용자 이름과 암호를 입력해야…" 체크 해제. 정전 뒤 재부팅돼도 로그온 작업이 다시 뜨게.
3. **백업 위치 = 구글 드라이브**: [구글 드라이브 데스크톱](https://www.google.com/drive/download/)을 설치해 회사 구글 계정으로 로그인하면 `내 드라이브\FIRSTOA-백업` 에 쌓인다(스트리밍 `G:\내 드라이브` 든 미러 `사용자 폴더\내 드라이브` 든 알아서 찾는다. 실행 중에 설치해도 다음 백업부터 적용). 구글 드라이브가 없으면 OneDrive 바탕화면, 그것도 없으면 `사용자 폴더\FIRSTOA-백업` 에 PC 안에만 남고 로그에 경고가 찍힌다. 환경 변수 `FIRSTOA_BACKUP_ROOT` 로 아무 폴더나 지정할 수도 있다.

## 설치 (손으로 할 때)

1. 노트북 설정: 덮개 닫아도 동작 · 절전 끄기 · 자동 로그인 · 업데이트 사용 시간 지정 · 원격 접속 켜기.
2. Python 3.11 이상 설치(python.org, "Add to PATH" 체크).
3. 이 저장소를 노트북에 둔다 — `git clone https://github.com/FIRSTOA/FIRSTOA-inspection-finder-MG.git`(bootstrap.ps1 이 하는 일).
4. Supabase SQL Editor 에서 `supabase/worker-heartbeat.sql` 을 한 번 실행(심박·일감 표 + 파수꾼 크론).
5. PowerShell(일반 사용자):
   ```
   powershell -ExecutionPolicy Bypass -File <저장소>\tools\worker\install.ps1
   ```
   한 바퀴 시험 → 로그온 시 자동 시작·자동 재시작 작업 등록 → 바로 시작.
6. 카톡 PC 에 봇 계정으로 로그인하고, 마감방·지역 운영방을 더블클릭해 **별도 창으로 열어 둔다**(중계·포스터·카운터 사진은 열린 창에만 붙여 넣는다).
   마감방 이름은 FIELD 관리 탭 → 카톡방 매핑 → 업무 종류 "마감" 에 등록한 것을 쓴다(앱·봇·실행기 모두 같은 곳을 읽는다).

## 확인·운영

```
python worker.py --once          # 한 바퀴(심박·일감·시계)
python worker.py --job ping      # 바로 실행
python worker.py --backup        # 지금 전체 백업
Get-ScheduledTask 'FIRSTOA Worker' | Select State     # 작업 상태
Stop-ScheduledTask / Start-ScheduledTask -TaskName 'FIRSTOA Worker'
```
- 로그: `tools/worker/logs/worker-<날짜>.txt`, 백업 로그 `backup-<날짜>.txt`, 중계·포스터 로그 `tools/kakao-pc/poster_log.txt`.
- 상태 파일: `state.json`(마지막 백업 날짜·결과, 중계 시각, 포스터 주차).
- 일감 넣기(SQL Editor): `insert into worker_jobs(kind, payload, created_by) values ('ping', '{"note":"test"}', '이름');` → 1분 안에 `status=done`, `result` 에 응답.
- 끄기: `FIRSTOA_RELAY=0`(중계) · `FIRSTOA_POSTER=0`(포스터) 환경 변수. 백업 폴더: `FIRSTOA_BACKUP_ROOT`.

## 설계 메모
- anon 키만 쓴다(웹앱과 같은 신뢰 모델). service_role 키는 이 폴더에 두지 않는다.
- 일감 잡기는 `status=queued` 조건부 갱신이라 실행기가 둘이어도 한쪽만 가져간다.
- 백업은 2026-10-10 마감 목록 실수 삭제 뒤 "매일·노트북·넓은 범위"로 바꾼 것. 데스크톱 WSL 주간 백업(8/18 한 번 성공 뒤 실패)은 이것으로 대체한다.
- 백업 파일에는 고객 정보가 있다. git 에 올리지 말 것(`logs/`·`state.json` 도 .gitignore).
