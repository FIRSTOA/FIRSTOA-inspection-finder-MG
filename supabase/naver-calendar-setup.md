# 네이버 캘린더 연동 설정 (등록 전용 미러)

웹앱 일정 등록 시 네이버 캘린더에도 같은 일정이 올라갑니다.
**네이버 API는 등록만 지원** — 조회·수정·삭제가 없으므로 원본은 항상 웹앱 일정리스트이고,
일정 변경·취소는 네이버에 반영되지 않습니다(팀에 공지 필요).

## 1. 네이버 개발자센터 앱 등록 (1회)
1. https://developers.naver.com/apps/#/register 에서 애플리케이션 등록
2. 사용 API에 **"캘린더"** 추가 (네이버 로그인 → 권한에 캘린더 체크)
3. 환경: PC 웹, 서비스 URL은 웹앱 주소, Callback URL은 아무 주소나(예: 웹앱 주소) — 토큰 발급 때만 사용
4. 발급된 **Client ID / Client Secret** 메모

## 2. 팀 공용 계정으로 refresh token 발급 (1회)
팀 캘린더의 주인(또는 정회원) 계정으로 브라우저에서:
```
https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={CALLBACK_URL}&state=firstoa
```
→ 로그인·동의 후 리다이렉트된 주소의 `code=` 값을 복사 → 아래 호출로 토큰 교환:
```
curl "https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&code={CODE}&state=firstoa"
```
응답의 **refresh_token**을 메모 (access_token은 1시간짜리라 저장 불필요 — 함수가 매번 갱신).

## 3. Supabase Secrets 등록
```
npx supabase secrets set NAVER_CLIENT_ID=... NAVER_CLIENT_SECRET=... NAVER_REFRESH_TOKEN=... --project-ref kkdiihazgzesbqxjytqv
# 팀 공용 캘린더를 쓰려면 (기본은 개인 기본 캘린더):
npx supabase secrets set NAVER_CALENDAR_ID=... --project-ref kkdiihazgzesbqxjytqv
```

## 4. 함수 배포 + 토글 ON
```
npx supabase functions deploy naver-calendar-push --project-ref kkdiihazgzesbqxjytqv
```
관리 탭(app_config)에서 `NAVER_CALENDAR_ENABLED` = `true` 로 설정하면 그때부터 동작.
(키가 없거나 토글이 꺼져 있으면 조용히 건너뛰므로 언제 켜도 안전)

---

## 운영 메모 (2026-08-02 연동 완료 후)

- 연동 완료: 토큰은 서버 테이블(naver_oauth)에 보관, 대상 캘린더 "익일통합as".
- 캘린더 변경: 관리 탭 → "네이버 캘린더 ID"에 그 캘린더의 공개 설정 URL(naver.me/…)을 붙여넣으면 자동 변환.
- **재연동이 필요할 때** (연동 계정 비밀번호 변경, 토큰 만료 ~1년, "네이버만 안 올라감" 증상):
  아래 주소로 브라우저에서 로그인·동의 한 번이면 끝 — "연동 완료 ✓" 알림 확인.
  https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id=V_m8cXZT2YjdGqAJyssK&redirect_uri=https%3A%2F%2Ffirstoa-inspection-finder-mg.vercel.app%2F&state=firstoa

---

## CalDAV — 네이버 일정 조회·수정·삭제 (실험적, 2026-08-02 추가)

등록 후의 일정 수정·삭제는 공식 API가 없어 CalDAV(캘린더 동기화 통로)로 처리합니다.
일정리스트 → 일정 수정 모달 → [네이버 일정] 버튼에서 조회·수정, 일정 삭제 시 미러도 함께 삭제 시도.

### 설정 (1회)
1. 연동 네이버 계정에 **2단계 인증**을 켠다 (네이버 내정보 → 보안설정)
2. 보안설정 → **애플리케이션 비밀번호** → "캘린더/기타"용으로 새로 발급
3. Secrets 등록:
```
npx supabase secrets set NAVER_CALDAV_ID={네이버아이디} NAVER_CALDAV_APP_PASSWORD={발급비밀번호} --project-ref kkdiihazgzesbqxjytqv
```

### 주의
- 비공식 통로라 네이버 정책 변경 시 끊길 수 있음 — 끊겨도 등록(미러)은 영향 없음
- CalDAV 미설정 상태에서는 [네이버 일정] 버튼이 명확한 안내 오류를 띄움 (무해)
- 수정 대상 식별은 등록 때 저장한 UID(as_tickets.naverUid) — CalDAV 도입 전에 등록된 일정은 수정 불가

---

## 현재 구조 (2026-08-19 기준) — 양방향 완성

위쪽 "등록 전용 미러"·"CalDAV 실험적" 설명은 초기 단계 기록이다. 지금은 CalDAV로 양방향이 돌고 있다.

| 함수 | 언제 도는가 | 하는 일 |
|---|---|---|
| `naver-calendar-push` | 사람이 웹앱에서 조작할 때 | 등록·조회·수정·삭제·캘린더 간 이동·복제 (`caldav_*` 액션) |
| `naver-calendar-sync` | pg_cron 1분 × 내부 20초 3회 = 실효 20초 | 네이버에서 바뀐 것을 회수해 `as_tickets`·`naver_calendar_events`에 반영 |

동기화 기억은 `naver_caldav_state(href, etag, uid)`. 목록(REPORT)에서 받은 etag가 달라진 href만
본문을 내려받는다(회차당 최대 80건, 나머지는 backlog). 삭제 판정은 조회 오류가 있거나 backlog가
남은 회차에는 건너뛴다 — 캘린더 간 "이동"이 원본에서 사라지는 것과 구분이 안 되기 때문.

app_config 키: `NAVER_CALENDAR_ENABLED`, `NAVER_CALENDAR_ID`(주 캘린더), `NAVER_SYNC_CALENDARS`(콤마 구분),
`NAVER_TEAM_CALENDAR_A~E`(팀 완료 캘린더).

## 실시간화 — 지연은 네이버가 아니라 화면 쪽이다

| 구간 | 지금 | 원인 | 개선 후 |
|---|---|---|---|
| 웹앱 → 네이버 | 즉시 | 조작에 붙어 바로 PUT | 그대로 |
| 네이버 → Supabase | 0~20초 | 폴링 주기 | 0~5초 (ctag) |
| Supabase → 화면 | 0~60초 | 프론트 60초 재조회 | 0.1초 (Realtime) |
| **합계(최악)** | **~80초** | | **~5초** |

1. **화면을 Realtime 구독으로** (효과 최대, 반나절 작업)
   `alter publication supabase_realtime add table as_tickets;` 후 프론트에서 `postgres_changes` 구독.
   폴링은 지우지 말고 60초 → 5분 안전망으로 남긴다(웹소켓은 끊긴다). `visibilitychange`에 한 번 당기기 추가.
2. **폴링을 싸게** — REPORT 전에 `PROPFIND getctag`(Depth 0)로 컬렉션 변경 여부만 확인.
   안 바뀌면 즉시 종료(수백 바이트)라 5초 주기도 부담 없다.
3. **변경분만 받기** — `sync-collection` + `sync-token`(RFC 6578). 네이버 지원 여부를 빈 sync-token으로 먼저 확인.
4. **진짜 push는 네이버에 없다.** CalDAV에 webhook이 없어 ①~③은 모두 "싸고 빠르게 물어보기"다.
   Google Calendar(`events.watch`)·MS Graph(subscription)는 push가 있으니, 실시간이 절대 조건이면 플랫폼 문제다.

팀 공유용 매뉴얼(설정 7단계·CalDAV 요청 형태·트러블슈팅 포함):
https://claude.ai/code/artifact/916c20a5-1589-46d7-b326-88256b3d078d
