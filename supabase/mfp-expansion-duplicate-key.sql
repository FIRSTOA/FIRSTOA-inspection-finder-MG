-- 복합기 확장성 저장 시 on_conflict=_dupKey가 동작하도록 중복 방지 키에 고유 인덱스를 만듭니다.
-- 과거 데이터의 빈 키는 제외합니다.
create unique index if not exists mfp_expansion_dup_key_unique
on public.mfp_expansion ("_dupKey")
where "_dupKey" is not null and "_dupKey" <> '';
