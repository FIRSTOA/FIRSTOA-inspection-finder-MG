-- 익명(anon) 키 권한 원칙 (2026-08-17 중간점검에서 축소 적용)
-- 앱은 로그인 없이 anon 키로 쓴다 — 돈·원장 데이터는 "숨김 3컬럼"만 허용한다.
-- 이미 적용된 테이블: jeomgeom, as_records(이전부터), misu, overage(2026-08-17 축소).
-- 새 원장 테이블을 만들면 같은 패턴을 따를 것:
--   revoke update, delete on public.<테이블> from anon;
--   grant update (_hidden, _hidden_by, _hidden_at) on public.<테이블> to anon;
-- 참고: DELETE는 정책 자체를 만들지 않는다(숨김으로 대체).
-- workin_vendor_code는 method='manual' 행만 anon 수정 허용(수동 확정 UI용).
-- service_receptions는 완료 처리 기능이 상태 컬럼을 고쳐야 해 전컬럼 유지 — 2순위 축소 후보.

-- 2026-08-17 감사 후속 확장: bulman, mfp_expansion, pc_expansion, overage_adjust, recontract,
--   churn_defense, mgmt_support(숨김 3컬럼), lease_status(_hidden만 — _hidden_by/_at 컬럼 없음),
--   vendor_info(_raw+_hidden — 주소 변경 기능이 _raw 갱신). 전부 DELETE 회수.
-- storage: photos 버킷의 public UPDATE 정책 제거(익명 덮어쓰기 차단 — 업로드는 유니크 경로 INSERT만으로 동작).
-- 남겨둔 예외(기능 필요): workin_map_places(주소·라벨 편집), app_config/room_map(관리 탭), outbox(봇 소비 경로 미확인), message_templates(공용 문구 수정).

-- 2026-08-17: Supabase linter "Security Definer View" 경고 해소 —
-- all_vendor_tabs(통합이력 검색 색인 뷰)에 security_invoker=true 적용.
-- 뷰가 소유자 권한으로 실행되며 RLS를 우회하던 잠재 뒷문 제거 (기반 13개 테이블은 어차피 익명 읽기 허용이라 동작 변화 없음 — 익명 RPC 실검색으로 확인).
--   alter view public.all_vendor_tabs set (security_invoker = true);

-- 2026-08-18: workin_vendor_code 정책에 'name-prefix' 추가.
-- 이름-접두 자동 매칭(스크립트)이 결과를 manual로 위장하지 않도록 — 출처가 남아야 사람 판단과 구분되고
-- 잘못 붙은 매칭만 골라 지울 수 있다. anon은 여전히 자동 계층(serial·name)을 손댈 수 없다.
--   INSERT/UPDATE CHECK: method IN ('manual','name-prefix') / DELETE USING: 같은 조건
