-- 웹푸시 알림 (2026-08-17 도입) — 접수·공지·부서요청·일정배정을 브라우저 푸시로.
--
-- 흐름: 프론트(src/push.ts)가 push-sw.js 구독 → 이 테이블에 저장(사람 이름 연동)
--       → 발송은 push-send Edge Function(전체 또는 이름 목록 대상, VAPID 서명).
-- VAPID 키: Secrets VAPID_KEYS_JWK(비밀키 포함 — 재발급하면 전 구독 무효!) / VAPID_SUBJECT.
--           공개키는 src/push.ts PUSH_PUBLIC_KEY 상수.
-- 죽은 구독(FCM 404/410)은 push-send가 발송 중 자동 삭제한다.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  endpoint text PRIMARY KEY,          -- 브라우저 푸시 서비스가 준 주소 (기기·브라우저별 1행)
  person text NOT NULL DEFAULT '',    -- 작성자 이름 — 알림 대상 매칭 기준 (작성자 변경 시 갱신)
  team text NOT NULL DEFAULT '',
  p256dh text NOT NULL,               -- 페이로드 암호화 공개키 (구독 산물)
  auth text NOT NULL,                 -- 페이로드 암호화 인증 시크릿 (구독 산물)
  ua text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- anon: 자기 기기 구독의 등록·갱신·해지에 필요. 발송(전체 조회)은 service_role(edge)만 한다.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO anon, authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
