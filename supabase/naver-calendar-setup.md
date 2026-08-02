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
