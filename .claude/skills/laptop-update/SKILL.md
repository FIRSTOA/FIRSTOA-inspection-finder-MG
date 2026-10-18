---
name: laptop-update
description: 노트북 24시간 실행기(tools/worker·tools/kakao-pc) 코드를 바꾼 뒤 노트북에 반영하고 살아났는지 확인하는 절차. "노트북에 반영", "실행기 업데이트", "중계 패치 적용", /laptop-update 에 사용.
---
# /laptop-update — 노트북 실행기 반영·확인

기기: 서버 노트북 D6110(사용자 Belldandy), 작업 스케줄러 'FIRSTOA Worker', 저장소 `%USERPROFILE%\FIRSTOA-inspection-finder-MG`. 데스크톱은 개발용이라 여기서 worker.py 를 돌리면 심박 표에 옛 행이 생겨 파수꾼 오알림을 낸다(2026-10-19 사건) — 데스크톱에서는 `--once` 시험도 피한다.

## 순서
1. **코드 검사 먼저**: tools/kakao-pc/* 나 gas-and-bot/* 를 고쳤으면 kakao-pc-rules(검사실 방지훈)에게 전·후 검사. "실패"면 푸시하지 않는다(Ctrl+A/F 금지 등 실측 규칙).
2. **푸시**: /deploy 절차로 origin/main 에 올린다. 노트북은 GitHub 에서 받으므로 푸시 전엔 반영되지 않는다.
3. **노트북에서 한 줄 실행**(사용자가 노트북 PowerShell 에서, 일반 권한):
   ```
   [Net.ServicePointManager]::SecurityProtocol='Tls12'; irm https://raw.githubusercontent.com/FIRSTOA/FIRSTOA-inspection-finder-MG/main/tools/worker/bootstrap.ps1 | iex
   ```
   = pull + pip + 작업 재등록 + 재시작. (winget 없다는 말이 나오면 Microsoft Store "앱 설치 관리자" 설치 후 다시.)
4. **살아났는지 확인**(내가, 읽기 전용): ops-monitor(운영실 감시연)에게 — `worker_heartbeat` 최신 행이 1분 안이고 host 가 D6110 인지, note 의 backup 날짜, `outbox` 대기 0, `room_activity` 최근 source. 2~3분 지나도 심박이 안 찍히면 사용자에게 노트북 로그 `tools\worker\worker_log.txt`(또는 README 의 로그 위치) 꼬리 30줄을 부탁한다.
5. **카톡 PC 전제** 다시 확인: 봇 계정으로 로그인돼 있고, 중계 대상 방은 별도 창으로 열려 있어야 한다(검색으로 연 방은 보낸 뒤 자동으로 닫힌다 — open_room). 카톡이 렉 걸리면 중계가 3번 연속 실패 시 1시간 1회 자동 재시작한다.
6. **기록**: AGENTS.md 작업 기록. 노트북 실측으로 새로 확정된 규칙이 있으면 메모리 `firstoa-kakao-pc-automation.md` 와 `.claude/agents/kakao-pc-rules.md` 에 추가.
