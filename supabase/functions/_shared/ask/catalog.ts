/**
 * 통합검색 "무엇이든 묻기" — 모델이 볼 수 있는 표·칸 목록 (2026-10-29, 설계 docs/tasks/search-ask-everything-2026-10-29.md 3장·4장)
 *
 * data-ask/index.ts 에 있던 CATALOG(23표)를 옮기고 3-2 표(OKR·시트 보관·미수 방문·활동·사진·메모·회고·재고·카톡 발송 기록·게시판 …)를 더했다.
 * - 3-4 금지 표(설정·토큰·푸시 구독·발송 원문·백업 사본·kakao_messages 직접)는 넣지 않는다 → FORBIDDEN_TABLES, 테스트가 검사.
 * - 칸: html·memoHtml·urls·raw·storage_path·client_ip·token·key·전화 칸은 넣지 않는다(FORBIDDEN_COL). JSON 칸 안의 html 키는 stripHiddenKeys 가 지운다.
 * - desc 는 모델에게 주는 설명(값 형식·주의). desc 에 쓴 snake_case 칸 이름은 그 표 cols 에 있어야 한다(tests/askCatalog.test.ts).
 * - scope(설계 결정 Q1): 주간 회고·분기 계획·골든카드·자기 목표 = 같은 팀 사람 것만, 팀 캘린더 = 묻는 사람 부서만. 팀장·임원은 전체.
 * 브라우저·Deno·Node 공용(순수 TS, import 없음).
 */

export type Cat = {
  desc: string;
  cols: string[];
  /** 늘 붙는 조건(숨김·삭제 행 빼기) — PostgREST 쿼리 조각 그대로 */
  hidden?: string;
  date?: string;
  team?: string;
  grade?: string;
  /** 업체(또는 이름) 칸 — 없으면 "" */
  vendor: string;
  /** 작성자 칸 — tally 의 _author_team(명단 팀) 묶음·사람별 집계에 쓴다 */
  author?: string;
  /** 페이지 넘김 정렬 키(없으면 id, 그것도 없으면 cols[0]) */
  pk?: string;
  /** 글이 긴 지식 표 — 행은 적게(최대 40), 글은 길게(1,600자) */
  long?: boolean;
  /** 칸별 글자 상한(기본 140, long 1,600) — JSON 칸(OKR)·원문 칸 */
  caps?: Record<string, number>;
  /** 값 대신 개수만 주는 배열 칸(사진 urls → urls_count). 원본은 모델·앱에 안 간다 */
  countCols?: string[];
  /** 설계 Q1 — author: 같은 팀 사람 것만 / team: 묻는 사람 부서 것만 */
  scope?: "author" | "team";
  /** 날짜 칸이 글자이고 형식이 섞임(2026-10-29 실측) — tally 는 그 칸의 날짜 조건을 서버 글자 비교 대신 ymdOf 로 거른다 */
  dateText?: boolean;
};

// 3-4 넣으면 안 되는 표 — 이름이 CATALOG 에 있으면 테스트가 실패한다
export const FORBIDDEN_TABLES = [
  "app_config", "app_config_lock", "app_config_log", "naver_oauth", "push_subscriptions", "worker_jobs", "worker_heartbeat", "outbox",
  "counter_sms_batches", "counter_sms_inbox", "kakao_import_log", "mirror_hidden", "field_sheet_sync_jobs", "kakao_messages",
  "ai_usage", "photo_assets", "vendor_master", "vendor_match_alias", "vendor_alias_key", "lease_ident_code", "workin_vendor_code",
];
/** 금지 표 이름 꼴(백업 사본·ops·cron) */
export const FORBIDDEN_TABLE_RE = /^_backup|_bak_|^ops\.|^cron\./i;
/** 넣으면 안 되는 칸 이름 — html·urls·raw 원문·저장 경로·IP·토큰·키·비밀·전화 */
export const FORBIDDEN_COL = /html|^urls$|^raw$|_raw$|storage_path|client_ip|token|secret|password|(^|_)key$|^key_|phone|^tel$|전화|휴대폰|핸드폰|^recipient$|vendor_code|company_code/i;
/** JSON 칸 안에서 지울 키(OKR rows/goals/feedback 의 html·memoHtml 등) */
export const HIDDEN_JSON_KEY = /html|token|secret|password|^urls$|storage_path|phone/i;

export const CATALOG: Record<string, Cat> = {
  // ── 지식(복합기 기술) — 2026-10-12: "X3220 세로줄 원인", "묻어남 어떻게 처리" 같은 질문의 근거 ──
  knowledge_docs: { desc: "복합기 가이드(기술 문서 450편 — 교체법·체크 순서·설정법·에러 해결, 노션에서 옮긴 것과 웹앱에서 쓴 것). category(실무/시스템 설정 에러…), brand(삼성/제록스/신도/교세라…), title '[브랜드]제목', content 본문(마크다운·순서 글), summary 한 줄, models(쓰는 기종 약칭 글, 예 \"['MX3','MX4']\"), parts(부품 글), symptoms(증상 분류 글), difficulty 쉬움/보통/어려움, author 작성자, updated_at. models·parts·symptoms 는 JSON 이라 조건(ilike)에 못 쓴다 — 조건은 title·content·brand·category 로만. '교체 방법'·'교체법'·'체크 순서'·'셋팅'·'설정'·'어떻게 하나' 질문은 이 표를 가장 먼저 — title 과 content 를 ilike(예: title=ilike.*ACR*, content=ilike.*CTD*)로 찾아 본문 순서를 그대로 근거로 답하고 제목·작성자를 밝힌다. 없을 때만 플레이북·처리이력으로.", vendor: "title", date: "updated_at", author: "author", long: true,
    cols: ["id", "category", "brand", "title", "summary", "content", "models", "parts", "symptoms", "difficulty", "author", "updated_at"] },
  copier_playbook: { desc: "복합기 증상별 원인·점검 순서·부품 플레이북(브랜드·시리즈·증상 단위 145편, 처리이력에서 뽑은 초안). series 값은 기종이 아니라 계열 약칭이다 — 삼성: MX3(SL-X3220·X3280 계열), MX4(X4220·X4250·X4300), MX7(X7400·X7500·X7600), 9201(CLX-9201·9251), 흑백기(SL-K·SL-M) / 신도: 320·410·420·450·600·N501·bizhub / 제록스: 305·5005·APEOS·마블(DocuCentre-V C2263)·베니(ApeosPort-VI C2271)·보탄(ApeosPort-VII C2273·C3373·C4473·C5573)·세이토(ApeosPort-V C2275·C3375·C5575)·키슈·헤라(ApeosPort-IV C5580) / 교세라: 2100·5521·5526 / 오키: 5473 / HP: 8710·8730·9010 / 브라더: 5700. symptom 값은 '토너·드럼'·'급지·걸림'·'줄·화질'·'에러코드'·'스캔·팩스'·'정착기·롤러'·'네트워크·드라이버'·'소음' 8가지뿐이다(세로줄·묻어남은 '줄·화질' 또는 '토너·드럼'). title '시리즈 · 증상', summary 한 줄 결론, causes JSON[{cause, parts, share(높음/중간/낮음), steps[]}], tips, case_count 근거 사례 수, status 초안/확정. 기종을 series 로 바꿔 series=eq.MX3 처럼 찾고 symptom 은 위 8가지로.", vendor: "title", date: "updated_at", long: true,
    cols: ["id", "brand", "series", "symptom", "title", "summary", "causes", "tips", "case_count", "status", "updated_at"] },
  copier_notes: { desc: "복합기 처리이력·학습 노트(기종별 실제 처리 사례 13,000건). 칸은 brand, model 기종(ilike), kind '처리이력'|'학습', title 증상 한 줄, content '증상/처리/지역/레벨/업체' 글, author 처리자, created_at 처리 날짜 — 이 이름 그대로 쓴다(date·handler 같은 칸은 없다; 날짜는 created_at, 처리자는 author). 증상 낱말로 title·content 를 ilike(예: content=ilike.*세로줄*), 기종으로 model=ilike.*3220*. 최신순 20~40건만 읽고 공통 처리법을 뽑고, 사례에는 created_at 날짜와 author 를 적는다.", vendor: "model", date: "created_at", author: "author", long: true,
    cols: ["id", "brand", "model", "kind", "title", "content", "author", "created_at"] },
  vendor_notes: { desc: "업체 특이사항(현장 메모). work_start 출근시간은 '9시'·'9시반'·'11시 이후' 같은 글, lunch_time 점심시간도 글('12~1시'), note 는 주차·방문 요령 메모. 글이라 ilike 로 찾고(예: 9시대는 work_start=ilike.*9시* 뒤 사람이 읽어 거른다), 팀은 vendor_team 으로. '출근 시간이 X인 곳'·'점심시간'·'특이사항' 질문은 이 표.", vendor: "vendor", date: "updated_at", author: "author",
    cols: ["id", "vendor", "work_start", "lunch_time", "note", "author", "pinned", "created_at", "updated_at"] },
  supply_requests: { desc: "부품 신청·자가(여분) 신청 — 점검·AS 양식의 신청 칸을 품목 단위로. kind '부품'|'자가', item 적은 그대로, item_std 표준 품목(토너 K·폐토너통·드럼 K·현상제 C…), qty 수량, stage 신청/지급/반납/불량, issued_at 출고 시각(운영지원), status 출고여부 글, model/serial/asset 기기, team A~E, author 작성자, request_date 'YYYY-MM-DD'. '여분 몇 개'·'부품 뭐 신청'·'드럼 자주 들어간 기기'·'출고 안 된 것' 질문은 이 표. 취소된 행은 빠져 있다.", vendor: "vendor", date: "request_date", team: "team", author: "author", hidden: "stage=neq.%EC%B7%A8%EC%86%8C",
    cols: ["id", "request_date", "kind", "vendor", "team", "author", "model", "serial", "asset", "item", "item_std", "qty", "stage", "issued_at", "issued_by", "status", "warranty", "counter", "expected", "returned_at", "return_note"] },
  misu: { desc: "미수(밀린 임대료). 입력일은 글자 칸 — 대부분 'YYYY-MM-DD 00:00:00' 이지만 '2026.9.8' 같은 점 표기·잘못 들어간 글이 섞여 있다(날짜 조건은 tally 가 날짜로 읽어 거른다). 지역 칸은 대부분 비어 있어 팀은 vendor_team 으로 찾는다. 등급 칸도 비거나 섞여 있다. 같은 업체가 입력일마다 여러 행 — 업체별 최신 행으로 말한다. 휴대폰 번호는 여기서 주지 않는다(업체 검색 카드에서 본다).", vendor: "_업체명", date: "입력일", dateText: true, team: "지역", grade: "등급", author: "관리담당자", hidden: "_hidden=not.is.true",
    cols: ["id", "입력일", "_업체명", "등급", "지역", "미수개월", "미수잔액", "실제 개월수", "실제 잔액", "관리담당자", "업체담당자", "입금약속일", "방문내용", "고객반응", "약속일", "후속담당자", "특이사항", "임대여부", "작성자"] },
  overage: { desc: "초과료(기본 매수 초과 청구). 날짜 'YYYY-MM-DD'. 팀 칸이 없다 → vendor_team. 등급 N/NN/S/SS/V. 마감방식 분기/매월/단순마감/반기/1년누적.", vendor: "_업체명", date: "날짜", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "날짜", "_업체명", "등급", "접수내용", "컬러초과료", "흑백초과료", "합계", "마감방식", "자산번호", "모델명", "기본금액", "기본매수", "초과장당금액", "미수개월수", "미수금액", "특이사항"] },
  overage_adjust: { desc: "초과료 조정 협의. 방문일은 글자 칸('2026년 6월 10일' 꼴도 있음). 지역 칸 A~E.", vendor: "_업체명", date: "방문일", dateText: true, team: "지역", author: "작성자", hidden: "_hidden=not.is.true",
    cols: ["id", "방문일", "_업체명", "지역", "기종", "현재조건", "제안", "고객반응", "진행상태", "작성자"] },
  recontract: { desc: "재계약. 날짜 'YYYY-MM-DD'. 담당팀 칸은 'C'·'cs강서'·'영업팀' 등 섞임, 지역은 비어 있음 → vendor_team 권장. 계약종료일·갱신상태·갱신위험도·최종상태.", vendor: "_업체명", date: "날짜", team: "담당팀", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "날짜", "_업체명", "담당팀", "등급", "기종", "계약종료일", "진행상황", "갱신상태", "갱신위험도", "내용", "결과", "제안일자", "제안조건", "후속담당자", "기한", "다음확인일", "최종상태"] },
  bulman: { desc: "불만. 날짜는 글자 칸 — 대부분 'YYYY-MM-DD', 옛 행에 '2024. 5. 23'·'Fri Mar 20 2026 …' 섞임. 지역 A~D(비어 있는 행 많음). 불만내용·조치내용·최종상태.", vendor: "_업체명", date: "날짜", dateText: true, team: "지역", grade: "등급", author: "처리자", hidden: "_hidden=not.is.true",
    cols: ["id", "날짜", "_업체명", "지역", "등급", "불만내용", "불만유형", "불만정도", "조치내용", "처리자", "후속담당자", "다음확인일", "최종상태"] },
  jeomgeom: { desc: "점검 보고(기기 1대=1행). 작성일 'YYYY-MM-DD'. 지역 칸은 대부분 'A' 로 들어가 있어 믿지 않는다 — 팀별 건수는 작성자의 명단 팀(tally group_by _author_team, KPI 와 같은 기준)으로 센다. 같은 날 같은 업체는 한 번 방문(KPI 점검 대수는 기기 행). 매수·토너잔량·폐통·여분.", vendor: "_업체명", date: "작성일", team: "지역", author: "작성자", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "작성일", "작성자", "_업체명", "지역", "등급", "모델명", "자산기번", "시리얼넘버", "매수", "토너잔량", "폐통", "여분", "처리내용", "특이사항"] },
  as_records: { desc: "AS 보고. 작성일 'YYYY-MM-DD'. 지역 A~E(팀별 집계는 작성자 명단 팀 _author_team 이 KPI 와 같다). 일정리스트에서 간단처리한 AS 는 여기 없고 as_tickets.note 에만 있다.", vendor: "_업체명", date: "작성일", team: "지역", author: "작성자", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "작성일", "작성자", "_업체명", "지역", "등급", "모델명", "자산기번", "내용", "처리내용", "특이사항"] },
  service_receptions: { desc: "서비스 접수. receipt_date 'YYYY-MM-DD'. region 은 '수도권A'~'수도권D'·'지방'(= E). type 복합기 AS/IT/원격이관. status 접수/진행중/완료.", vendor: "vendor", date: "receipt_date", team: "region", grade: "grade", author: "author", hidden: "deleted=is.false",
    cols: ["id", "receipt_date", "author", "vendor", "region", "type", "title", "symptom", "status", "asset_no", "model", "address", "receiver_name", "field", "paid", "grade", "completed_at", "completed_by"] },
  as_tickets: { desc: "일정(방문 계획). date 'YYYY-MM-DD'. team A~E. scheduleType 매월점검/AS/납품철수교체휴가교육/익일AS. status 완료 등. assignee 담당자. note = 처리 블록(일정리스트 간단처리 AS 의 유일한 기록 — as_records 에 없다), calendarTitle = 캘린더에 나간 제목, receptionId = 연결된 접수 id. 지난 날짜인데 status 가 완료가 아니면 '지난 일정 미처리'.", vendor: "vendor", date: "date", team: "team", author: "assignee",
    cols: ["id", "date", "time", "team", "vendor", "scheduleType", "issue", "assignee", "status", "address", "model", "grade", "note", "calendarTitle", "receptionId", "serial", "asset", "source"], caps: { note: 500 } },
  visit_logs: { desc: "방문기록(직원 방문 일지). work_date 'YYYY-MM-DD'. work_kinds 배열(inspection·as·delivery…).", vendor: "vendor", date: "work_date", author: "author", hidden: "status=neq.cancelled",
    cols: ["id", "work_date", "author", "vendor", "visited", "work_kinds", "machine_count", "note", "grade"] },
  contact_changes: { desc: "담당자·주소 변경. change_date 'YYYY-MM-DD'. region. category 자유 글(주소변경·담당자 변경…). greeting_done 인사 여부.", vendor: "company", date: "change_date", team: "region", author: "author", hidden: "_hidden=not.is.true",
    cols: ["id", "change_date", "company", "region", "category", "before_text", "after_text", "reason", "author", "greeting_done"] },
  vendor_info: { desc: "임대리스트(기기 1대=1행). 등급 N/NN/S/SS/V, 임대여부 임대중/임대종료/소송, 계약일·종료일·기본금액·모델명·자산번호·기번·키맨·시/구. 팀 칸 없음. 전화번호는 주지 않는다(업체 검색 카드).", vendor: "_업체명", date: "계약일", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "코드", "_업체명", "등급", "임대여부", "모델명", "자산번호", "기번", "계약일", "종료일", "남은개월", "기본금액", "연평균", "시/구", "주소상세주소", "키맨", "미수금액"] },
  lease_status: { desc: "납품·교체·철수 현황. 납품일·년월·구분·지역·기종·수량·담당자.", vendor: "_업체명", date: "납품일", team: "지역", author: "담당자", hidden: "_hidden=not.is.true",
    cols: ["id", "납품일", "년월", "구분", "분류", "지역", "_업체명", "기종", "수량", "담당자", "납품여부", "교체전기종"] },
  pc_expansion: { desc: "PC 확장성(영업 기회, 직원이 올린 건). 날짜는 ISO 타임스탬프('2026-10-08T06:23…') — gte/lt 'YYYY-MM-DD' 로 자르면 된다. 지역 A~E = 팀, 작성자 = 올린 직원. 사람별 건수는 작성자로 센다.", vendor: "_업체명", date: "날짜", team: "지역", grade: "등급", author: "작성자", hidden: "_hidden=not.is.true",
    cols: ["id", "날짜", "작성자", "_업체명", "지역", "등급", "세부사양", "렌탈or구매or유지보수", "수량", "금액", "시기", "어필 OR 추가영업"] },
  mfp_expansion: { desc: "복합기 확장성(영업 기회). 등록일·미팅지역·거래처등급·영업진행상황·예상 발주금액.", vendor: "_업체명", date: "등록일", team: "미팅지역", grade: "거래처등급", author: "등록자", hidden: "_hidden=not.is.true",
    cols: ["id", "등록일", "등록자", "_업체명", "미팅지역", "거래처등급", "품목(원문)", "영업진행상황", "예상 발주금액(만원)", "예상 발주시기(YYYY-MM)", "최종결과(대기 등)", "체크일"] },
  counter_sms_targets: { desc: "마감(카운터) 문자 대상. team A~E. sent_at 보낸 시각, done_at 완료. list_kind '' 일반/'CMS'.", vendor: "vendor", date: "added_at", team: "team",
    cols: ["id", "team", "vendor", "grade_group", "sent_at", "sent_by", "done_at", "done_by", "list_kind", "cms_day", "added_at"] },
  workin_map_places: { desc: "워킨맵(분기 점검 대상). team A~E, quarter 1~4, kind quarter(분기 점검)/monthly(매월 점검)/renewal(재계약), label G1~G12 — 재계약(renewal)은 G5 완료·G6 진행·G7 제외(K35 재계약 진행 기준). name 은 '30S업체명…' 꼴.", vendor: "name", team: "team",
    cols: ["id", "team", "quarter", "kind", "label", "name", "address", "comment", "visible"] },
  logistics_records: { desc: "물류(납품·교체·철수·여분). 작성일 'YYYY-MM-DD'. 구분·품목·수량.", vendor: "_업체명", date: "작성일", author: "작성자", hidden: "_hidden=not.is.true",
    cols: ["id", "작성일", "작성자", "구분", "_업체명", "품목", "수량", "특이사항"] },

  // ── 3-2 (2026-10-29) OKR — 주로 okr 도구가 읽고, 표로 직접 볼 때는 cycle_id·team·member 로 좁힌다 ──
  okr_cycles: { desc: "OKR 기간 한 벌(분기·월·주차). id 는 '2026-Q4'(kind quarter)·'2026-10'(kind month)·'2026-10-W3'(kind week). parent_id = 위 층 id. goals = 목표 JSON[{no, pillar, bottleneck, objective, criteria, scope?, hidden?}](주차는 비어 있고 월·분기 목표를 쓴다), feedback = 팀장 피드백 JSON{목표 no: {memo, judgment}}, direction = 팀장 핵심방향, goals_origin = leader/copy/import/manual. 구조는 아래 'OKR 구조' 설명을 따른다.", vendor: "", date: "start_date", long: true,
    cols: ["id", "kind", "title", "year", "month", "week_no", "start_date", "end_date", "parent_id", "direction", "goals_origin", "goals", "feedback", "updated_at"], caps: { goals: 6000, feedback: 4000, direction: 1500 } },
  okr_reports: { desc: "OKR 기록 — 기간(cycle_id = okr_cycles.id) × 파트(team A~D) × 사람(member). member 가 빈 글이면 파트 종합, 이름이면 팀원 개인 기록. rows = JSON[{no, actual 실제결과, judgment 종합판정, reason 사유, plan 개선계획, evidence 근거자료}], header = JSON{leader, author, submitted, goals(쪼갠 달성기준), feedback(파트장 피드백)}. 사람 분석은 okr 도구를 먼저 쓴다(달성률 규칙이 화면과 같다).", vendor: "", date: "updated_at", team: "team", author: "member", pk: "cycle_id", long: true,
    cols: ["cycle_id", "team", "member", "header", "rows", "updated_at"], caps: { header: 3000, rows: 6000 } },
  // ── 시트 보관(서비스접수 시트에만 적힌 줄) ──
  reception_sheet_rows: { desc: "접수 시트 보관 줄 — 앱이 아니라 시트에만 적힌 접수·처리. source sales/mgmt/remote/copier(시트 종류), month 'YYYY-MM', kind 접수 종류, receipt_date 'YYYY-MM-DD', author 접수자, handler 처리자, state 시트 상태 글, cls open(미처리)/hold(보류)/done(완료)/record(기록), vendor, field, region, summary 한 줄, content 본문(길이 제한), reception_id = 앱 접수와 연결된 경우, gone_at 이 있으면 시트에서 사라진 줄. 미처리 = cls open·hold 이고 gone_at 비어 있음.", vendor: "vendor", date: "receipt_date", team: "region", author: "author",
    cols: ["id", "source", "month", "seq", "kind", "receipt_date", "author", "handler", "state", "cls", "vendor", "field", "region", "summary", "content", "reception_id", "first_seen_at", "last_seen_at", "gone_at"], caps: { content: 300 } },
  team_calendar_events: { desc: "부서 달력(회식·교육·휴무·부서 일정). team 은 부서 이름(경영지원/영업팀/운영지원 …), date 'YYYY-MM-DD', time, title, memo, author. 묻는 사람 부서 것만 보인다(팀장·임원은 전체).", vendor: "", date: "date", team: "team", author: "author", scope: "team",
    cols: ["id", "team", "date", "time", "title", "memo", "author", "reception_id"] },
  // ── 미수 방문 ──
  misu_visits: { desc: "미수 방문이력(미수 업체를 직접 찾아간 기록). visited_at 방문 시각, visit_round 몇 차, author·author_team 방문자·팀, vendor, misu_months·misu_balance 방문 때 미수, open_status 영업 여부, dun_methods 독촉 방법, dun_reply 고객 답, promise_date 입금 약속일, return_requested 회수 요청, judgment·judgment_reason 판정, missing 빠진 항목, text_body 보고 글(가림), album_id 사진 앨범. 담당자 연락처·사진 원본은 주지 않는다.", vendor: "vendor", date: "visited_at", team: "author_team", author: "author", hidden: "_hidden=not.is.true",
    cols: ["id", "visited_at", "visit_round", "author", "author_team", "vendor", "region", "misu_months", "misu_balance", "open_status", "dun_methods", "dun_reply", "promise_date", "return_requested", "judgment", "judgment_reason", "missing", "text_body", "album_id"], caps: { text_body: 400 } },
  misu_cs_checks: { desc: "미수 CS 체크(관리부 시트에서 동기화). team, vendor, checked 체크 여부, cs_manager·cs1·cs2 CS 담당·메모, synced_at.", vendor: "vendor", team: "team", pk: "vendor",
    cols: ["team", "vendor", "checked", "cs_manager", "cs1", "cs2", "synced_at"] },
  // ── 활동·사진·메모 ──
  activity_events: { desc: "활동 원본(물류·교체 K24·K28 등 사람 활동). activity_date 'YYYY-MM-DD', author, team, category 활동 종류, vendor, quantity 수량, machine_count 기기 수, status(취소면 cancelled), source_text 원문 앞부분.", vendor: "vendor", date: "activity_date", team: "team", author: "author",
    cols: ["id", "activity_date", "author", "team", "category", "vendor", "quantity", "machine_count", "status", "source_text"], caps: { source_text: 200 } },
  photo_albums: { desc: "사진 앨범(올린 사진 묶음). vendor, category 분류, author 올린 사람, region, source_type 어느 화면에서, created_at, urls_count 장수. 사진 주소는 주지 않는다 — 앨범 id 로 앱에서 연다.", vendor: "vendor", date: "created_at", team: "region", author: "author", countCols: ["urls"],
    cols: ["id", "vendor", "category", "author", "region", "source_type", "created_at"] },
  plan_memos: { desc: "일정 메모(as_tickets 일정 한 건에 붙인 개인 메모). ticket_id = as_tickets.id. ticket_id 가 '__order__:YYYY-MM-DD' 인 행은 그 사람이 정한 그날 내 일정 순서(memo 에 일정 id 목록).", vendor: "", date: "updated_at", author: "author", pk: "ticket_id",
    cols: ["author", "ticket_id", "memo", "updated_at"], caps: { memo: 400 } },
  // ── 사람 기록(설계 Q1: 같은 팀 사람 것만) ──
  weekly_notes: { desc: "주간 회고(성장노트). author, week_start 그 주 월요일, this_week_goal 이번 주 목표, this_week_result 결과, next_week_goal 다음 주 목표, bottlenecks 병목, learning 배운 점, growth, challenge. 같은 팀 사람 것만 보인다(팀장·임원은 전체).", vendor: "", date: "week_start", author: "author", scope: "author",
    cols: ["id", "author", "week_start", "this_week_goal", "this_week_result", "next_week_goal", "bottlenecks", "learning", "growth", "challenge", "updated_at"], caps: { this_week_goal: 400, this_week_result: 400, next_week_goal: 400, bottlenecks: 400, learning: 400 } },
  quarterly_plans: { desc: "분기 계획(개인). author, year, quarter, goals JSON. 같은 팀 사람 것만.", vendor: "", date: "updated_at", author: "author", scope: "author",
    cols: ["id", "author", "year", "quarter", "goals", "updated_at"], caps: { goals: 2000 } },
  golden_cards: { desc: "골든카드(분기 자기 점검 답). author, year, quarter, answers JSON. 같은 팀 사람 것만.", vendor: "", date: "updated_at", author: "author", scope: "author",
    cols: ["id", "author", "year", "quarter", "answers", "updated_at"], caps: { answers: 2000 } },
  self_goals: { desc: "자기 목표(개인). author, title, memo, category, start_date, target_date, done 완료 여부. 같은 팀 사람 것만.", vendor: "", date: "created_at", author: "author", scope: "author",
    cols: ["id", "author", "title", "memo", "category", "start_date", "target_date", "done", "created_at"] },
  praise_posts: { desc: "칭찬 글(K30·K31). from_author 쓴 사람, to_name 받은 사람, content, created_at.", vendor: "", date: "created_at", author: "from_author",
    cols: ["id", "created_at", "from_author", "to_name", "content"] },
  it_quiz_attempts: { desc: "IT 퀴즈 응시(K34). author, kst_date 'YYYY-MM-DD', level, total 문항 수, score 점수.", vendor: "", date: "kst_date", author: "author",
    cols: ["id", "author", "kst_date", "level", "total", "score", "created_at"] },
  it_practice_logs: { desc: "IT 실습 기록(K21). author, kst_date 'YYYY-MM-DD', title, memo.", vendor: "", date: "kst_date", author: "author", pk: "kst_date",
    cols: ["author", "kst_date", "title", "memo"] },
  // ── 재고·카톡 방·발송 기록 ──
  stock_items: { desc: "재고(토너·드럼·부품·기기). kind 종류, brand, name 품목명, condition 새것/중고 등, qty 수량, unit, category, color, models 맞는 기종 글, aliases 다른 이름, note. '○○ 드럼 몇 개' 는 name·models·aliases 를 ilike.", vendor: "name", date: "updated_at", hidden: "_hidden=not.is.true",
    cols: ["id", "kind", "brand", "name", "condition", "qty", "unit", "category", "color", "models", "aliases", "note", "updated_at"] },
  kakao_collect_rooms: { desc: "카톡 수집 대상 방. room 방 이름, kinds 방 종류 배열, region, enabled 수집 켬, export 저장, structured, note.", vendor: "room", pk: "room",
    cols: ["room", "kinds", "region", "enabled", "export", "structured", "sort_order", "note", "updated_at"] },
  room_map: { desc: "카톡 발송 방 매핑 — category 양식 종류(점검·AS·물류 …) × region 팀 → room 보낼 방 이름. '어느 방으로 가?' 질문.", vendor: "room", team: "region", pk: "room",
    cols: ["category", "region", "room"] },
  kakao_delivery_log: { desc: "카톡 발송 기록(본문 없음). sent_at 보낸 시각, sender, room 방, kind 양식, vendor, queued_at 대기열에 들어간 시각.", vendor: "vendor", date: "sent_at", author: "sender",
    cols: ["id", "sent_at", "sender", "room", "kind", "vendor", "queued_at"] },
  message_jobs: { desc: "예약 문자·알림 작업. source_type 어디서(해피콜·마감 등), channel, status 대기/보냄/실패, scheduled_at, sent_at, error, created_by, message 앞부분(가림). 받는 번호는 주지 않는다.", vendor: "", date: "created_at", author: "created_by",
    cols: ["id", "source_type", "source_id", "channel", "status", "scheduled_at", "sent_at", "error", "created_by", "created_at", "message"], caps: { message: 120, error: 200 } },
  happycall_messages: { desc: "해피콜 문자. visit_id 방문 id, author, keyman, status, scheduled_at, sent_at, error, message 앞부분(가림).", vendor: "", date: "created_at", author: "author",
    cols: ["id", "visit_id", "author", "keyman", "status", "scheduled_at", "sent_at", "error", "created_at", "message"], caps: { message: 120 } },
  // ── 게시판·안내 ──
  notices: { desc: "공지. title, body, category, pinned 고정, target_type·target 대상, author, created_at.", vendor: "", date: "created_at", author: "author",
    cols: ["id", "created_at", "author", "title", "body", "category", "pinned", "target_type", "target"], caps: { body: 600 } },
  food_places: { desc: "맛집(직원 추천). name, gu 구, address, category, menu, price, rating, tags, parking, memo, hours, author, team, likes.", vendor: "name", author: "author", team: "team",
    cols: ["id", "name", "gu", "address", "category", "menu", "price", "rating", "tags", "parking", "memo", "hours", "author", "team", "likes"] },
  promo_materials: { desc: "홍보물(제안서·안내 자료). title, category, description, file_type, active.", vendor: "title", date: "created_at",
    cols: ["id", "title", "category", "description", "file_type", "active", "created_at"] },
  message_templates: { desc: "문구 틀(문자·안내 템플릿). context 쓰는 곳, title, body, active.", vendor: "title", date: "created_at",
    cols: ["id", "context", "title", "body", "active", "created_at"], caps: { body: 600 } },
  copier_learning_posts: { desc: "복합기 학습자료 게시판. title, category(구동원리·급지·반송·화상·화질·정착·전장·보드·네트워크·설정·교육자료·기타), brand, summary, content, author, pinned.", vendor: "title", date: "created_at", author: "author", long: true,
    cols: ["id", "created_at", "author", "title", "category", "brand", "summary", "content", "pinned"] },
  reading_posts: { desc: "독서·읽기 게시판. title, content, kind, author, created_at.", vendor: "title", date: "created_at", author: "author",
    cols: ["id", "created_at", "author", "title", "content", "kind"], caps: { content: 600 } },
  feedback_items: { desc: "앱 개선 요청(직원 피드백). category, screen 화면, content, status, result_note 처리 결과, done_at, author.", vendor: "screen", date: "created_at", author: "author", hidden: "deleted_at=is.null",
    cols: ["id", "created_at", "author", "category", "screen", "content", "status", "result_note", "done_at"], caps: { content: 400 } },
  // ── 연락 규칙·리포트 ──
  counter_sms_contact_rules: { desc: "마감 문자 연락 규칙(연락금지·담당자 지정). vendor, kind 규칙 종류, name 담당자 이름, memo, serial 기기. 번호는 주지 않는다.", vendor: "vendor", date: "updated_at",
    cols: ["id", "vendor", "kind", "name", "memo", "serial", "updated_at"] },
  report_recipients: { desc: "점검리포트 받는 사람. vendor, name, memo, active. 번호는 주지 않는다.", vendor: "vendor", date: "created_at",
    cols: ["id", "vendor", "name", "memo", "active", "created_at"] },
  report_send_log: { desc: "점검리포트 보낸 기록. vendor, period 기간, channel, recipient_name, status, error, sender, created_at.", vendor: "vendor", date: "created_at", author: "sender",
    cols: ["id", "vendor", "period", "channel", "recipient_name", "status", "error", "sender", "created_at"] },
  supply_events: { desc: "부품 신청 단계 이력(supply_requests 한 건의 출고·반납·불량 기록). request_id = supply_requests.id, type 단계, qty, note, author, dept, detail.", vendor: "", date: "created_at", author: "author",
    cols: ["id", "created_at", "request_id", "type", "qty", "note", "author", "dept", "detail"] },
};

/** desc 에 나오는 표 밖 낱말(도구 이름·가상 칸·다른 표 칸 참조) — 테스트가 desc 의 snake_case 낱말을 검사할 때 허용 */
export const DESC_EXTRA_WORDS = ["vendor_team", "team_members", "query_rows", "_author_team", "urls_count", "group_by"];

/** OKR 구조 설명(설계 5-2) — 지시문에 그대로 붙는다 */
export const OKR_GUIDE = `OKR 구조(화면과 같은 규칙):
- 3층: 분기(okr_cycles kind quarter, id '2026-Q4', 9목표 = Pillar 3 × 병목 3, 팀장 문서) → 월(kind month, id '2026-10', parent_id = 분기, direction = 팀장 핵심방향) → 주차(kind week, id '2026-10-W3', 그 주 월요일이 든 달·월~금, goals 는 비어 있고 월/분기 목표를 쓴다).
- 기록: okr_reports(cycle_id × team × member). member '' = 파트 종합, member '이름' = 팀원 개인. rows[] = 목표 번호(no)별 actual(실제결과)·judgment(종합판정)·reason(사유)·plan(개선계획)·evidence(근거자료). header.goals = 파트/개인이 쪼갠 달성기준, header.feedback = 파트장 피드백. 팀장 피드백 = okr_cycles.feedback[no].memo·judgment.
- 판정 5종과 작성 규칙(작성가이드 6번): 완료(100%, 숫자만) · 해당없음(대상 0건, 근거자료에 '대상 0건') · 부분달성(80~99%, 숫자+사유) · 미흡(1~79%, 숫자+사유+개선계획) · 미착수(0%, 사유). '미달성'은 미흡, '달성'은 완료로 읽는다.
- 달성률: 개인 = 판정 있는 목표 중 완료·해당없음 비율, 그 기간 판정 0개 = 미작성 = 0%. 팀 = 팀원(명단 ∪ 보고자, 팀장 제외) 평균. 전체 = A~D 전원 평균. 아무도 판정이 없으면 '미작성'(0%로 말하지 않는다). 8·9월은 옛 구조(파트 종합 판정 비율). E(CSS)팀은 OKR 대상이 아니다.
- 주차 단계: 계획→진행→점검→마무리. 월 종합 판정 제안은 마지막 기록 주차 기준(평균 아님).
- 목표 행의 hidden = 보관한 행(표에 안 보임), scope = 그 행의 주인 층(없음 공통 / team 파트 전용 / member 개인 전용).`;

// ── 조회 보조(순수) ───────────────────────────────────────────

/** 표가 금지 목록에 걸리나 */
export const isForbiddenTable = (t: string) => FORBIDDEN_TABLES.includes(t) || FORBIDDEN_TABLE_RE.test(t);

/** 페이지 넘김 정렬 칸 */
export const pkOf = (cat: Cat) => cat.pk || (cat.cols.includes("id") ? "id" : cat.cols[0]);

/** JSON 칸 안의 html·토큰 키를 지운다(새 값) */
export function stripHiddenKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripHiddenKeys(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!HIDDEN_JSON_KEY.test(k)) out[k] = stripHiddenKeys(v);
    return out as T;
  }
  return value;
}

/** 칸 하나를 내보낼 글로 — JSON 은 html 키를 빼고 글로, 길이 상한 */
export function trimCell(cat: Cat, key: string, v: unknown): string {
  const cap = cat.caps?.[key] ?? (cat.long ? 1600 : 140);
  const clean = v && typeof v === "object" ? stripHiddenKeys(v) : v;
  const s = clean == null ? "" : typeof clean === "object" ? JSON.stringify(clean) : String(clean);
  return s.length > cap ? s.slice(0, cap) + "…" : s;
}

/** 행 하나를 내보낼 꼴로 — countCols 는 개수로 바꾸고, 목록에 없는 칸·금지 칸은 버린다(가림은 부른 쪽이 askMask) */
export function shapeRow(cat: Cat, row: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(row)) {
    if (cat.countCols?.includes(k)) { out[`${k}_count`] = Array.isArray(v) ? v.length : 0; continue; }
    if (!cat.cols.includes(k) || FORBIDDEN_COL.test(k)) continue;
    out[k] = trimCell(cat, k, v);
  }
  return out;
}

/** 묻는 사람 — cs_members 에서 이름으로 찾은 것(없으면 team·dept·title 빈 글) */
export type Asker = { name: string; team: string; dept: string; title: string };

/** CS 팀장·임원은 사람 기록 전체를 본다(설계 Q1). 파트장·부파트장은 자기 팀(부서) */
export const isLeadAsker = (a: Asker) => a.team === "팀장" || /임원|대표/.test(a.dept) || /대표|임원|이사/.test(a.title) || (a.title === "팀장" && /CS/.test(a.dept));

const deptCore = (s: string) => String(s || "").replace(/\(비정규\)|비정규직?|파트|팀/g, "").replace(/\s+/g, "").trim();

/** 부서 이름 두 개가 같은 부서인가 — '경영지원' ~ '경영지원파트', '운영지원' ~ 'CSS/운영지원파트', '영업팀' ~ '영업팀' */
export function sameDept(a: string, b: string): boolean {
  const x = deptCore(a); const y = deptCore(b);
  if (!x || !y) return false;
  return x === y || x.split("/").includes(y) || y.split("/").includes(x);
}

/**
 * scope 표 행을 묻는 사람에게 보여 줘도 되나(설계 Q1).
 * - team(부서 달력): 행 team 이 묻는 사람 team·dept 와 같은 부서
 * - author(회고·계획·골든카드·자기 목표): 본인, 또는 행 작성자가 묻는 사람과 같은 팀(명단 team, 없으면 dept)
 * 팀장·임원은 전부. 묻는 사람이 명단에 없으면 본인 것만.
 */
export function scopeAllows(cat: Cat, row: Record<string, unknown>, asker: Asker, groupOfName: (name: string) => string): boolean {
  if (!cat.scope) return true;
  if (isLeadAsker(asker)) return true;
  if (cat.scope === "team") {
    const t = String(row[cat.team || "team"] ?? "");
    return [asker.team, asker.dept].some((m) => !!m && (m === t || sameDept(m, t)));
  }
  const who = String(row[cat.author || "author"] ?? "").trim();
  if (!who) return false;
  if (asker.name && who === asker.name) return true;
  const mine = asker.team || asker.dept;
  return !!mine && groupOfName(who) === mine;
}

/** 모델에게 주는 표 설명 */
export function catalogText(): string {
  return Object.entries(CATALOG).map(([t, c]) => `- ${t}: ${c.desc}\n  칸: ${c.cols.join(", ")}${c.countCols ? ` (+ ${c.countCols.map((x) => `${x}_count`).join(", ")})` : ""}`).join("\n");
}
