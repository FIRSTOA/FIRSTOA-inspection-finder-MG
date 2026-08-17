-- 복합기 족보 (2026-08-17 도입) — 처리이력 12,580건을 "시리즈×증상" 카드로 정제한 층.
--
-- 흐름: ① 클러스터 분석(기록의 기종·증상 매칭 — CopierNotes MODEL_RULES/SYMPTOM_FILTERS와 동일 어휘)
--       ② playbook-draft Edge Function이 클러스터 표본(≤60건)을 종합해 초안 생성(OpenAI, 반검수 원칙)
--       ③ 웹앱 족보 탭에서 사람이 검토 → 게시. 수기 작성·수정도 가능(위키처럼).
-- 카드의 "사례 N건 보기"는 기록 탭 필터(브랜드·기종·증상)로 점프 — 별도 연결 테이블 없음.
-- 시리즈('') = 브랜드 공통 카드. UNIQUE(brand, series, symptom)가 카드 단위.

CREATE TABLE IF NOT EXISTS public.copier_playbook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  series text NOT NULL DEFAULT '',    -- 기종 시리즈 (MX3·450·헤라…) — 기록 탭 기종 칩과 같은 어휘
  symptom text NOT NULL,              -- 증상 그룹 (급지·걸림 / 줄·화질 / …) — 기록 탭 증상 필터와 동일
  title text NOT NULL,                -- 표시명 "MX3 · 토너·드럼"
  summary text NOT NULL DEFAULT '',
  causes jsonb NOT NULL DEFAULT '[]', -- [{cause, share(높음|보통|낮음), steps[], parts[]}] 빈도순
  tips text NOT NULL DEFAULT '',
  case_count int NOT NULL DEFAULT 0,  -- 근거 사례 수 (클러스터 시점 스냅샷)
  status text NOT NULL DEFAULT '초안', -- 초안(검토 전) | 게시
  author text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'ai',  -- ai | manual
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand, series, symptom)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.copier_playbook TO anon, authenticated;
GRANT ALL ON public.copier_playbook TO service_role;

-- 2026-08-18 추가: knowledge_docs.symptoms(jsonb) — 가이드에도 증상 축을 붙여 족보 카드와 연결한다.
--   ALTER TABLE public.knowledge_docs ADD COLUMN IF NOT EXISTS symptoms jsonb NOT NULL DEFAULT '[]';
-- 태깅은 2단: 규칙(scratchpad/tag-guides.mjs — 제목·본문의 기종·부품 어휘) → AI(guide-tag 함수)로 나머지.
-- copier_playbook.confirmed_by(jsonb): 확인한 사람 이름 누적("✓ N명 확인"). 게시/초안 이분법 대체.
