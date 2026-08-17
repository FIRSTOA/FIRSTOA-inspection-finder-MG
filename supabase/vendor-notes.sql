-- 거래처 특이사항 (2026-08-18 도입) — "그 업체 고유"의 방문 규칙을 담는 층.
--
-- 왜 별도 테이블인가: 기존에 통합이력이 "특이"로 보여준 값은 점검 기록의 특이사항 칸,
-- 즉 그날 기기 상태 메모(드럼이 어땠다…)였다. 정작 필요한 건 방문 규칙 — 출입 방법·비번,
-- 카드키 수령, 인사할 담당자, 점검 제외 기기, 유·무상 범위 — 이건 방문마다 반복되는 정보다.
-- 노션 "거래처 특이사항" DB 54건을 이관(scratchpad/import-vendor-notes.mjs)하고, 이후는 웹앱에서 편집.
--
-- 표시: 통합이력 최상단 보라 블록(누구나 수정) + 일정리스트·내 일정 카드에 "📌 특이사항" 칩
--       (분기체크 ⚠ 개수와 섞지 않는다 — 방문 전 반드시 읽어야 하는 다른 층이라서)
-- 매칭: vendor_key = src/ids.ts vendorMatchKey (업체명 표기가 달라도 붙는다)
-- 주의: 출입 비번 같은 값이 들어온다 — anon 읽기 범위(웹앱 사용자 전원)임을 감안할 것.

CREATE TABLE IF NOT EXISTS public.vendor_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor text NOT NULL,
  vendor_key text NOT NULL,          -- vendorMatchKey 정규화 키 (조회 기준)
  grade text NOT NULL DEFAULT '',    -- 이관 시점 등급 스냅샷 (참고용 — 라이브 등급은 임대리스트)
  note text NOT NULL,
  author text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'notion', -- notion | webapp
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_notes_key_idx ON public.vendor_notes (vendor_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_notes TO anon, authenticated;
GRANT ALL ON public.vendor_notes TO service_role;
