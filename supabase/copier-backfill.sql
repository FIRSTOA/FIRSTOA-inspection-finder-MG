-- 복합기 학습 이관·자동적재 + 목표 기간·진행률 + 칭찬 수정 (1회 실행)

-- ① copier_notes 출처 컬럼(중복 적재 방지 키)
alter table public.copier_notes add column if not exists source text not null default '';
create unique index if not exists copier_notes_source_key on public.copier_notes(source) where source <> '';

-- ② 목표: 시작일·진행률
alter table public.self_goals add column if not exists start_date date;
alter table public.self_goals add column if not exists progress integer not null default 0;

-- ③ 칭찬 수정 허용
grant update on public.praise_posts to anon;

-- ④ 기존 AS 기록(as_records) → 복합기 학습·처리이력 이관
--    처리내용이 있는 건만, 공청기·세단기 제외, 브랜드는 모델명으로 추정
insert into public.copier_notes (author, brand, model, kind, title, content, source, created_at)
select
  coalesce(a."작성자", ''),
  case
    when a."모델명" ~* 'BROTHER|브라더|MFC|HL-|5700|8900' then '브라더'
    when a."모델명" ~* 'OKI|오키|5473' then '오키'
    when a."모델명" ~* 'TASKALFA|ECOSYS|KYOCERA|교세라|2100|2101|5521|5526' then '교세라'
    when a."모델명" ~* 'XEROX|APEOS|DOCU|제록스|SC-? ?\d|C\d{4}|(^|\D)305(\D|$)|5005' then '제록스'
    when a."모델명" ~* 'BIZHUB|신도|SINDOH|^ *N ?-?\d|^ *D ?\d{3}' then '신도'
    when a."모델명" ~* 'SL|MX ?-?\d|CLX|CLP|삼성|K ?-?7\d{3}' then '삼성'
    else '기타'
  end,
  coalesce(a."모델명", ''),
  '처리이력',
  left(coalesce(nullif(trim(a."내용"), ''), a."모델명"), 80),
  concat_ws(E'\n',
    case when coalesce(trim(a."내용"), '') <> '' then '증상: ' || trim(a."내용") end,
    '처리: ' || trim(a."처리내용"),
    case when coalesce(trim(a."지역"), '') <> '' then '지역: ' || trim(a."지역") end,
    case when coalesce(trim(a."레벨"), '') <> '' then '레벨: ' || trim(a."레벨") end,
    case when coalesce(trim(a."업체명"), '') <> '' then '업체: ' || trim(a."업체명") end),
  'as_records:' || coalesce(nullif(a."_dupKey", ''), md5(concat(a."작성일", a."업체명", a."모델명", a."내용"))),
  case when a."작성일" ~ '^\d{4}-\d{2}-\d{2}' then (left(a."작성일", 10) || 'T12:00:00+09:00')::timestamptz else now() end
from public.as_records a
where coalesce(trim(a."처리내용"), '') <> ''
  and length(trim(a."처리내용")) >= 4
  and coalesce(a."모델명", '') <> ''
  and a."모델명" !~* '샤오미|블루스카이|공기청정|공청|세단기|세절기'
on conflict do nothing;

notify pgrst, 'reload schema';
