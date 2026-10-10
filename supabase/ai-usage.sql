-- AI(OpenAI) 사용량 기록 — 통합검색의 "업체에 질문"·"전체 데이터 질문"이 질문마다 토큰·추정 비용을 남긴다 (2026-10-10)
-- Supabase SQL Editor 에서 1회 실행("Run without RLS"). 실행 전에는 답 아래에 토큰만 보이고 월 합계는 안 보인다.

create table if not exists public.ai_usage (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  fn text not null,                 -- entity-ask / data-ask
  model text not null default '',
  question text not null default '',
  author text not null default '',
  input_tokens int not null default 0,
  cached_tokens int not null default 0,
  output_tokens int not null default 0,
  reasoning_tokens int not null default 0,
  rounds int not null default 1,    -- 모델 왕복 횟수(전체 데이터 질문은 조회마다 1회)
  usd numeric(10,5),                -- 단가가 설정돼 있을 때만
  ms int not null default 0         -- 걸린 시간
);
create index if not exists ai_usage_created_idx on public.ai_usage(created_at desc);
grant select on public.ai_usage to anon;   -- 앱이 월 합계를 보여 준다(쓰기는 함수가 서비스 키로)

-- 단가(달러, 100만 토큰당) — OpenAI 가격표에서 쓰는 모델(기본 gpt-5.5)의 숫자를 넣는다. 넣기 전에는 토큰만 표시.
-- insert into public.app_config(key, value) values ('AI_PRICE_IN', '0'), ('AI_PRICE_OUT', '0'), ('AI_PRICE_CACHED', '0')
--   on conflict (key) do update set value = excluded.value;

-- 확인
select count(*) as rows from public.ai_usage;
