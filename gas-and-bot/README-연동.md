# 보내기(복사 → 전송) 연동 가이드

웹앱 **[📤 보내기]** → 통합시트 **`점검` 탭에 직접 적재** + 점검방에 양식 자동 게시.

```
[웹앱 보내기]
  → First-DATA-MG  doPost(action=save)  →  webappSaveInspection_()
       ① extractInspectForms_() → appendKakaoRecords_('점검', …)   ← 카톡 업로드와 동일 파서/동일 _dupKey
       ② 새 건이면 _kakao_outbox 에 적재
  → 메신저봇 doGet?action=pull (5초마다) → 점검방에 양식 게시
```

핵심: **기존 카톡 점검양식 파서를 그대로 재사용**한다. 그래서 카톡으로 올리던 것과
**100% 같은 26칸**(작성일~_dupKey)으로 쌓이고, `_dupKey` 덕분에 같은 양식이 나중에
카톡으로 다시 올라가 재수집돼도 **중복 저장되지 않는다.**

## 이미 적용된 것

### 프론트엔드 (inspection-finder-MG)
- `src/api.ts` : `sendForm()` 추가 (POST action=save) — 타입체크 통과
- `src/App.tsx` : 결과 영역에 **📤 보내기** 버튼 추가 (기존 📋 복사 유지)
- 전송 데이터: `{ text(완성 양식 전체), vendor, mode, author, ts }`

### 백엔드 (First-DATA-MG)
- `src/WebappSave.gs` : `webappSaveInspection_` / `webappEnqueueKakao_` / `webappPullKakao_` 추가
- `src/WebApp.gs` : `doPost`에 `save` 분기, `doGet`에 `pull` 분기 추가

## 해야 할 것 (당신)

### 1) First-DATA-MG 배포
- `src/WebappSave.gs` 의 `WEBAPP_BOT_TOKEN` 을 비밀값으로 변경 (예: `firstoa2026`)
- clasp로 푸시 후 **기존 웹앱 배포 편집 → 새 버전 → 배포** (URL 고정 유지)
  ```bash
  cd First-DATA-MG && clasp push
  ```
  (또는 Apps Script 편집기에서 직접 붙여넣고 배포)

### 2) 메신저봇R
`gas-and-bot/messengerbot-poller.js` 를 봇 스크립트로 등록:
- `WEBAPP_URL`  = inspection-finder `src/api.ts` 의 `GAS_GET_URL` 과 동일(…/exec)
- `BOT_TOKEN`   = ①의 `WEBAPP_BOT_TOKEN` 과 동일
- `TARGET_ROOM` = 점검방 이름(정확히)

### 3) 프론트 배포
```bash
cd inspection-finder-MG && npm run build   # dist/ → GitHub Pages 배포
```

### 4) 테스트
점검 탭 모드에서 양식 완성 → 📤 보내기 →
① 통합시트 `점검` 탭에 새 행 ② 몇 초 뒤 점검방에 양식 게시 확인.

---

## 참고 / 한계
- **현재는 "점검" 양식(구분:점검)만 시트 저장**됩니다. 미양식/청정기/삼성노트 모드로
  보내면 "점검 양식만 저장됩니다" 안내가 떠요. 다른 탭도 원하면 그 탭의 파서/카테고리를
  알려주시면 같은 방식으로 분기 추가합니다.
- 출처(_출처) 칸에는 `카톡:웹앱` 으로 기록됩니다(웹앱에서 들어온 건 구분용).
- 중복(이미 저장된 양식)으로 보내면 시트에 다시 안 쌓이고, 카톡에도 다시 안 올립니다.
- GAS 웹앱 배포 액세스 권한은 **모든 사용자**여야 봇이 로그인 없이 polling 가능.
- 폴링 방식이라 게시까지 최대 5초(POLL_INTERVAL) 지연.
- `bot.send` 가 안 되면: 봇이 그 방을 한 번이라도 인식했는지 확인, 구버전이면
  `Api.replyRoom(TARGET_ROOM, msg)` 로 교체.
