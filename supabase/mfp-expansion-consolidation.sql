-- 복합기 확장성 정식 원본을 mfp_expansion으로 통일합니다.
-- 실행 전에는 copier_expansion을 삭제하지 않습니다.

alter table public.mfp_expansion
  add column if not exists "_업체명" text,
  add column if not exists "_원문" text,
  add column if not exists "_출처" text,
  add column if not exists "_dupKey" text,
  add column if not exists "_raw" jsonb;

-- 웹앱이 임시로 쌓은 copier_expansion 기록을 기존 MFP 원본 형식으로 옮깁니다.
insert into public.mfp_expansion (
  "등록일", "등록자", "전략영업담당자", "상호", "업종", "매출액(억)", "인원수",
  "프로젝트주소", "미팅지역", "도로명주소", "세부주소", "키맨성함+직함", "키맨전화번호",
  "키맨 성향", "영업 접근 전략", "의사결정 파급력", "개인 히스토리", "프로젝트", "품목(원문)",
  "연계영업", "관심품목(세분화)", "수주 가능성(A/B/C)", "예상 발주금액(만원)",
  "예상 발주시기(YYYY-MM)", "현재 경쟁사/장비", "경쟁사 불만(PainPoint)", "계약 종료(예정)일",
  "진행상황(원문)", "최종결과(대기 등)", "영업진행상황", "첫등록내용", "특이사항",
  "거래처등급", "영업등급", "체크일", "[신규통합] 현재 관리등급", "[AI 자동완성 개입 여부",
  "_업체명", "_원문", "_출처", "_dupKey", "_raw"
)
select
  c."등록일", c."등록자", c."전략영업담당자", c."상호명", c."업종및인원매출", '미기재', '미기재',
  c."실제미팅주소", '미기재', c."실제미팅주소", '미기재', c."성함및직함", c."연락처",
  '미기재', '미기재', c."의사결정파급력", c."개인히스토리", c."프로젝트진행상황", c."품목원문",
  '미기재', '미기재', '미기재', c."예상발주금액만원", c."예상발주시기", '미기재', '미기재', c."계약종료예정일",
  c."프로젝트진행상황", '대기', c."프로젝트진행상황", c."특이사항미팅내용", c."특이사항미팅내용",
  c."관리등급", '미기재', '미기재', c."관리등급", '웹앱 직접입력',
  coalesce(c."_업체명", c."상호명"), c."_원문", coalesce(c."_출처", '웹앱:복합기확장성'), c."_dupKey", null
from public.copier_expansion c
where not exists (
  select 1 from public.mfp_expansion m where m."_dupKey" = c."_dupKey"
);

alter table public.mfp_expansion enable row level security;
drop policy if exists "mfp expansion anon read" on public.mfp_expansion;
drop policy if exists "mfp expansion anon insert" on public.mfp_expansion;
create policy "mfp expansion anon read" on public.mfp_expansion for select to anon using (true);
create policy "mfp expansion anon insert" on public.mfp_expansion for insert to anon with check (true);
grant select, insert on public.mfp_expansion to anon;

-- 이관 결과를 확인한 다음에만 마지막 줄의 주석을 풀어 실행하세요.
-- drop table public.copier_expansion;
