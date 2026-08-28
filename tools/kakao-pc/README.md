# 카톡 PC 자동 사진 전송 (주간 키맨 포스터)

메신저봇은 안드로이드 **알림 답장** 통로를 쓰기 때문에 규격상 글자만 보낼 수 있다.
그래서 "사진으로" 보내려면 카톡을 직접 조작해야 하고, 그 일을 사무실 PC가 한다.

## 설치 (한 번)
1. 이 폴더의 파일을 PC의 `C:\firstoa\` 에 둔다 (`poster_send.py`, `register_task.ps1`).
2. 파이썬 패키지: `pywin32 pillow pyautogui` (이미 깔려 있음 — 2026-08-28 확인).
3. `register_task.ps1` 을 PowerShell로 실행 → 매주 월요일 08:00 작업 등록.
4. 카톡에서 **지역 점검방을 각각 더블클릭해 별도 창으로 열어 둔다.** 카톡을 끄지 않으면 창은 유지된다.

## 확인·시험
```
python C:\firstoa\poster_send.py --check     # 열려 있는 방 창과 이번 주 대상
python C:\firstoa\poster_send.py --weekly --plan
python C:\firstoa\poster_send.py --room "나와의 채팅" --test
```
기록은 `C:\firstoa\poster_log.txt`.

## 왜 이런 설계인가
- 카톡 PC의 채팅 목록은 프로그램으로 읽히지 않는다(UIA에 이름이 안 나옴). 단축키도 버전마다 다르다 —
  이 버전은 **Ctrl+F가 '친구 추가'** 였다(실측). 그래서 눈먼 UI 조작은 하지 않고,
  **이미 열려 있는 방 창만 제목으로 찾아** 붙여넣는다. 붙여넣기 직전에 맨 앞 창 제목을 다시 확인한다.
- 창이 없는 방은 봇이 문구+링크를 보낸다(빠지는 방 없음). PC가 꺼져 있던 주는 서버가 10시에 링크로 보낸다.
- 두 갈래가 겹치지 않게 `app_config.KEYMAN_POSTER_SENT` 에 발송한 주를 적고 서로 확인한다.
