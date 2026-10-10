/**
 * 조회 화면 카테고리 정의.
 *
 * 테이블마다 컬럼 이름과 날짜 필드가 달라(한글 컬럼 + 시트 동기화 잔재) 화면을
 * 하나씩 만들면 17개 화면이 된다. 정의만 여기 모으고 화면은 하나로 돌린다.
 *
 * 주의: 시트에서 동기화된 표는 날짜 칸에 업체명 같은 값이 섞여 있는 행이 있다.
 * 그래서 정렬은 신뢰할 수 있는 필드(orderField)로 따로 지정한다.
 */
export type LookupColumn = {
  key: string;
  label: string;
  width?: string;               // grid 트랙 (예: "110px", "minmax(0,1fr)")
  align?: "left" | "right";
  mono?: boolean;               // 자산·기번 등 숫자 대조용 등폭
  strong?: boolean;             // 업체명 등 굵게
  hideBelow?: "sm" | "lg";      // 좁은 화면에서 감춤
};

/**
 * 묶음(2026-10-11 재편) — 사람이 찾는 질문 순서대로.
 *  현장 기록   : 점검·AS·물류·불만·방문기록·활동 — "그 업체에 언제 뭘 했나"
 *  고객 연락   : 마감 카운터 문자·해피콜·문자/메일 발송 이력·연락 규칙 — "누구에게 뭘 보냈나, 보내면 안 되는 곳"
 *  영업·계약   : 재계약·해지방어·관리지원·PC/복합기 확장성 — "계약·영업 진행"
 *  정산        : 미수·초과료·초과조정 — "돈"
 *  접수·거래처 : 접수·담당자/주소 변경·거래처 특이사항·부서 요청 — "거래처 기본 정보와 들어온 요청"
 *  자재        : 자가신청·부품신청·재고 — "물건"
 */
export type LookupGroup = "현장 기록" | "고객 연락" | "영업·계약" | "정산" | "접수·거래처" | "자재";

export type LookupCategory = {
  key: string;
  label: string;
  group: LookupGroup;
  table: string;
  dateField: string;            // 기간 필터에 쓰는 필드
  orderField: string;           // 정렬 필드 (날짜 칸이 지저분한 표는 created_at)
  vendorField: string;          // 업체명 필드
  searchFields: string[];       // 검색어 대상
  columns: LookupColumn[];
  filterQuery?: string;         // 항상 붙는 추가 조건 (예: 시트 원본만)
  note?: string;                // 화면에 띄우는 한 줄 안내
  teamField?: string;           // 팀(A~D) 필터에 쓸 컬럼 — 값에 팀 글자가 포함되면 매칭 (수도권C 등)
  teamSourceParen?: boolean;    // 출처 라벨의 괄호에서도 팀 매칭 ("카톡:재계약(A)") — 지역 칸이 빈 시트분 보완
  custom?: "misu" | "overage" | "stock" | "self" | "parts";  // 범용 표 대신 전용 보드를 렌더 (CS체크·정렬·수량조절 등 기능이 더 풍부). self/parts=자가신청·부품신청(2026-10-11)
  chipFilter?: { field: string; options: Array<[value: string, label: string]> }; // 카테고리 안 유형 칩 (접수: 복합기/IT/원격)
};

const VENDOR: LookupColumn = { key: "_업체명", label: "업체명", width: "minmax(0,1.4fr)", strong: true };

export const LOOKUP_CATEGORIES: LookupCategory[] = [
  {
    key: "jeomgeom", label: "점검", group: "현장 기록", teamSourceParen: true, teamField: "지역", table: "jeomgeom",
    dateField: "작성일", orderField: "작성일", vendorField: "_업체명",
    searchFields: ["_업체명", "업체명", "작성자", "내용", "모델명", "시리얼넘버", "자산기번"],
    columns: [
      { key: "작성일", label: "작성일", width: "96px", mono: true },
      VENDOR,
      { key: "작성자", label: "작성자", width: "80px" },
      { key: "지역", label: "지역", width: "70px", hideBelow: "sm" },
      { key: "모델명", label: "모델", width: "minmax(0,0.9fr)", hideBelow: "lg" },
      { key: "자산기번", label: "자산기번", width: "120px", mono: true, hideBelow: "lg" },
      { key: "내용", label: "내용", width: "minmax(0,1.6fr)" },
    ],
  },
  {
    key: "as", label: "AS", group: "현장 기록", teamSourceParen: true, teamField: "지역", table: "as_records",
    dateField: "작성일", orderField: "작성일", vendorField: "_업체명",
    searchFields: ["_업체명", "업체명", "작성자", "내용", "처리내용", "모델명", "시리얼넘버", "자산기번"],
    columns: [
      { key: "작성일", label: "작성일", width: "96px", mono: true },
      VENDOR,
      { key: "작성자", label: "작성자", width: "80px" },
      { key: "지역", label: "지역", width: "70px", hideBelow: "sm" },
      { key: "모델명", label: "모델", width: "minmax(0,0.9fr)", hideBelow: "lg" },
      { key: "내용", label: "증상", width: "minmax(0,1.4fr)" },
      { key: "처리내용", label: "처리", width: "minmax(0,1.2fr)", hideBelow: "lg" },
    ],
  },
  {
    key: "logistics", label: "물류", group: "현장 기록", table: "logistics_records",
    dateField: "작성일", orderField: "작성일", vendorField: "_업체명",
    searchFields: ["_업체명", "거래처명", "작성자", "품목", "특이사항"],
    columns: [
      { key: "작성일", label: "작성일", width: "96px", mono: true },
      { key: "거래처명", label: "거래처", width: "minmax(0,1.4fr)", strong: true },
      { key: "작성자", label: "작성자", width: "80px" },
      { key: "구분", label: "구분", width: "90px", hideBelow: "sm" },
      { key: "품목", label: "품목", width: "minmax(0,1.2fr)" },
      { key: "수량", label: "수량", width: "70px", align: "right", mono: true },
      { key: "특이사항", label: "특이사항", width: "minmax(0,1.2fr)", hideBelow: "lg" },
    ],
  },
  {
    key: "bulman", label: "불만", group: "현장 기록", teamSourceParen: true, teamField: "지역", table: "bulman",
    dateField: "created_at", orderField: "created_at", vendorField: "_업체명",
    searchFields: ["_업체명", "업체명", "작성자", "불만내용", "불편내용", "조치내용"],
    columns: [
      { key: "날짜", label: "날짜", width: "96px", mono: true },
      VENDOR,
      { key: "작성자", label: "작성자", width: "80px" },
      { key: "등급", label: "등급", width: "60px", hideBelow: "sm" },
      { key: "불만유형", label: "유형", width: "110px", hideBelow: "sm" },
      { key: "불만내용", label: "내용", width: "minmax(0,1.8fr)" },
      { key: "최종상태", label: "상태", width: "90px", hideBelow: "lg" },
    ],
  },
  {
    key: "misu", label: "미수", group: "정산", teamSourceParen: true, teamField: "지역", custom: "misu", table: "misu",
    dateField: "입력일", orderField: "created_at", vendorField: "_업체명",
    searchFields: ["_업체명", "업체명", "관리담당자", "업체담당자", "지역"],
    note: "시트 동기화 표입니다. 입력일 칸에 값이 없는 행도 있어 최신 등록순으로 보여줍니다.",
    columns: [
      { key: "입력일", label: "입력일", width: "96px", mono: true },
      VENDOR,
      { key: "관리담당자", label: "관리담당", width: "100px", hideBelow: "sm" },
      { key: "지역", label: "지역", width: "80px", hideBelow: "sm" },
      { key: "미수개월", label: "개월", width: "70px", align: "right", mono: true },
      { key: "미수잔액", label: "잔액", width: "110px", align: "right", mono: true },
      { key: "등급", label: "등급", width: "60px", hideBelow: "lg" },
      { key: "임대여부", label: "임대", width: "80px", hideBelow: "lg" },
    ],
  },
  {
    key: "overage", label: "초과료", group: "정산", custom: "overage", table: "overage",
    dateField: "날짜", orderField: "created_at", vendorField: "_업체명",
    searchFields: ["_업체명", "접수내용", "모델명", "자산번호"],
    columns: [
      { key: "날짜", label: "날짜", width: "96px", mono: true },
      VENDOR,
      { key: "모델명", label: "모델", width: "minmax(0,0.9fr)", hideBelow: "sm" },
      { key: "컬러초과료", label: "컬러", width: "100px", align: "right", mono: true },
      { key: "흑백초과료", label: "흑백", width: "100px", align: "right", mono: true },
      { key: "합계", label: "합계", width: "110px", align: "right", mono: true, strong: true },
      { key: "마감방식", label: "마감", width: "90px", hideBelow: "lg" },
      { key: "접수내용", label: "접수내용", width: "minmax(0,1.2fr)", hideBelow: "lg" },
    ],
  },
  {
    key: "overage_adjust", label: "초과조정", group: "정산", teamSourceParen: true, teamField: "지역", table: "overage_adjust",
    dateField: "created_at", orderField: "created_at", vendorField: "_업체명",
    searchFields: ["_업체명", "업체명", "작성자", "제안", "고객반응"],
    columns: [
      { key: "방문일", label: "방문일", width: "96px", mono: true },
      VENDOR,
      { key: "작성자", label: "작성자", width: "80px" },
      { key: "현재조건", label: "현재조건", width: "minmax(0,1fr)", hideBelow: "sm" },
      { key: "제안", label: "제안", width: "minmax(0,1.2fr)" },
      { key: "고객반응", label: "고객반응", width: "minmax(0,1fr)", hideBelow: "lg" },
      { key: "진행상태", label: "상태", width: "90px" },
    ],
  },
  {
    key: "recontract", label: "재계약", group: "영업·계약", teamSourceParen: true, teamField: "지역", table: "recontract",
    dateField: "날짜", orderField: "created_at", vendorField: "_업체명",
    searchFields: ["_업체명", "업체명", "작성자", "내용", "갱신상태"],
    columns: [
      { key: "날짜", label: "날짜", width: "96px", mono: true },
      VENDOR,
      { key: "등급", label: "등급", width: "56px" },
      { key: "작성자", label: "작성자", width: "80px" },
      { key: "계약종료일", label: "종료일", width: "100px", mono: true, hideBelow: "sm" },
      { key: "갱신상태", label: "갱신상태", width: "90px" },
      { key: "갱신위험도", label: "위험도", width: "64px", hideBelow: "lg" },
      { key: "다음확인일", label: "다음확인일", width: "100px", mono: true, hideBelow: "lg" },
      { key: "최종상태", label: "최종상태", width: "90px", hideBelow: "sm" },
    ],
  },
  {
    key: "churn", label: "해지방어", group: "영업·계약", teamField: "담당팀", table: "churn_defense",
    dateField: "created_at", orderField: "created_at", vendorField: "_업체명",
    searchFields: ["_업체명", "해지사유", "방어전략", "내용"],
    columns: [
      { key: "날짜", label: "날짜", width: "96px", mono: true },
      VENDOR,
      { key: "담당팀", label: "담당팀", width: "80px" },
      { key: "해지사유", label: "해지사유", width: "minmax(0,1.2fr)" },
      { key: "방어전략", label: "방어전략", width: "minmax(0,1.2fr)", hideBelow: "sm" },
      { key: "진행상황", label: "진행", width: "100px" },
      { key: "결과", label: "결과", width: "100px", hideBelow: "lg" },
    ],
  },
  {
    key: "mgmt", label: "관리지원", group: "영업·계약", teamField: "담당팀", table: "mgmt_support",
    dateField: "created_at", orderField: "created_at", vendorField: "_업체명",
    searchFields: ["_업체명", "요청유형", "내용", "처리결과"],
    columns: [
      { key: "날짜", label: "날짜", width: "96px", mono: true },
      VENDOR,
      { key: "담당팀", label: "담당팀", width: "80px" },
      { key: "요청유형", label: "요청유형", width: "120px" },
      { key: "내용", label: "내용", width: "minmax(0,1.6fr)" },
      { key: "처리결과", label: "처리결과", width: "minmax(0,1.2fr)", hideBelow: "lg" },
    ],
  },
  {
    key: "pc", label: "PC 확장성", group: "영업·계약", teamField: "지역", table: "pc_expansion",
    dateField: "날짜", orderField: "created_at", vendorField: "_업체명",
    searchFields: ["_업체명", "작성자", "세부사양", "업체담당자", "IT담당자"],
    columns: [
      { key: "날짜", label: "날짜", width: "96px", mono: true },
      VENDOR,
      { key: "작성자", label: "작성자", width: "80px" },
      { key: "지역", label: "지역", width: "80px", hideBelow: "sm" },
      { key: "세부사양", label: "세부사양", width: "minmax(0,1.4fr)" },
      { key: "수량", label: "수량", width: "70px", align: "right", mono: true },
      { key: "금액", label: "금액", width: "110px", align: "right", mono: true },
      { key: "시기", label: "시기", width: "90px", hideBelow: "lg" },
    ],
  },
  {
    key: "mfp", label: "복합기 확장성", group: "영업·계약", teamField: "미팅지역", table: "mfp_expansion",
    dateField: "등록일", orderField: "created_at", vendorField: "_업체명",
    searchFields: ["_업체명", "상호", "등록자", "전략영업담당자", "프로젝트", "관심품목(세분화)"],
    columns: [
      { key: "등록일", label: "등록일", width: "96px", mono: true },
      { key: "상호", label: "상호", width: "minmax(0,1.4fr)", strong: true },
      { key: "등록자", label: "등록자", width: "80px" },
      { key: "미팅지역", label: "지역", width: "90px", hideBelow: "sm" },
      { key: "수주 가능성(A/B/C)", label: "가능성", width: "80px" },
      { key: "예상 발주금액(만원)", label: "예상금액", width: "100px", align: "right", mono: true, hideBelow: "sm" },
      { key: "예상 발주시기(YYYY-MM)", label: "발주시기", width: "100px", mono: true, hideBelow: "lg" },
      { key: "영업진행상황", label: "진행", width: "minmax(0,1fr)", hideBelow: "lg" },
    ],
  },
  {
    key: "reception", label: "접수", group: "접수·거래처", teamField: "region", table: "service_receptions",
    dateField: "receipt_date", orderField: "created_at", vendorField: "vendor",
    searchFields: ["vendor", "author", "title", "symptom", "serial", "asset_no", "address"],
    filterQuery: "deleted=is.false",
    chipFilter: { field: "type", options: [["복합기 AS", "복합기"], ["IT", "IT"], ["원격이관", "원격"]] },
    columns: [
      { key: "receipt_date", label: "접수일", width: "96px", mono: true },
      { key: "vendor", label: "업체명", width: "minmax(0,1.3fr)", strong: true },
      { key: "type", label: "구분", width: "90px" },
      { key: "author", label: "접수자", width: "80px" },
      { key: "status", label: "상태", width: "90px" },
      { key: "symptom", label: "증상", width: "minmax(0,1.6fr)" },
      { key: "address", label: "주소", width: "minmax(0,1.2fr)", hideBelow: "lg" },
    ],
  },
  {
    key: "contact", label: "담당자·주소 변경", group: "접수·거래처", teamField: "region", table: "contact_changes",
    dateField: "change_date", orderField: "created_at", vendorField: "company",
    searchFields: ["company", "author", "before_text", "after_text", "reason"],
    columns: [
      { key: "change_date", label: "변경일", width: "96px", mono: true },
      { key: "company", label: "업체명", width: "minmax(0,1.3fr)", strong: true },
      { key: "author", label: "작성자", width: "80px" },
      { key: "region", label: "지역", width: "70px", hideBelow: "sm" },
      { key: "category", label: "구분", width: "100px" },
      { key: "before_text", label: "변경 전", width: "minmax(0,1.2fr)" },
      { key: "after_text", label: "변경 후", width: "minmax(0,1.2fr)" },
    ],
  },
  {
    key: "self_request", label: "자가신청", group: "자재", custom: "self", table: "supply_requests",
    dateField: "request_date", orderField: "request_date", vendorField: "vendor", searchFields: ["vendor", "item", "item_std", "model", "author"],
    columns: [{ key: "item", label: "품목", width: "minmax(0,1fr)", strong: true }],
    note: "FIELD 양식을 자가방으로 보낸 건이 품목 단위로 쌓입니다. 출고는 운영지원, 반납·불량은 단추로. 지난 기록은 아래 [지난 기록 채우기]",
  },
  {
    key: "parts_request", label: "부품신청", group: "자재", custom: "parts", table: "supply_requests",
    dateField: "request_date", orderField: "request_date", vendorField: "vendor", searchFields: ["vendor", "item", "item_std", "model", "author"],
    columns: [{ key: "item", label: "품목", width: "minmax(0,1fr)", strong: true }],
    note: "FIELD 양식을 부품방으로 보낸 건이 품목 단위로 쌓입니다. 출고는 운영지원, 불량은 단추로.",
  },
  {
    key: "stock", label: "기기·부품·자가 재고", group: "자재", custom: "stock", table: "stock_items",
    dateField: "updated_at", orderField: "updated_at", vendorField: "name",
    searchFields: ["name", "brand", "note", "condition"],
    columns: [
      { key: "kind", label: "구분", width: "80px" },
      { key: "name", label: "품목", width: "minmax(0,1.4fr)", strong: true },
      { key: "brand", label: "브랜드", width: "110px", hideBelow: "sm" },
      { key: "condition", label: "상태", width: "90px", hideBelow: "sm" },
      { key: "qty", label: "수량", width: "80px", align: "right", mono: true, strong: true },
      { key: "updated_by", label: "수정자", width: "90px", hideBelow: "lg" },
      { key: "updated_at", label: "수정시각", width: "150px", mono: true, hideBelow: "lg" },
    ],
  },
  {
    // 거래처 특이사항 — 방문 규칙(출입·카드키·유무상 범위)과 출근·점심시간. 통합이력 보라 블록에서 기재하고
    // 여기서는 "어느 업체에 어떤 규칙이 있나"를 한 표로 훑는다(기간 필터는 마지막 기재일 기준).
    key: "vendorNotes", label: "거래처 특이사항", group: "접수·거래처", table: "vendor_notes",
    dateField: "updated_at", orderField: "updated_at", vendorField: "vendor",
    searchFields: ["vendor", "note", "work_start", "lunch_time", "author", "grade"],
    note: "출근·점심시간과 방문 규칙 — 통합이력에서 업체를 열면 같은 내용을 고칠 수 있습니다",
    columns: [
      { key: "vendor", label: "업체명", width: "minmax(0,1.2fr)", strong: true },
      { key: "grade", label: "등급", width: "64px", hideBelow: "sm" },
      { key: "work_start", label: "출근", width: "88px", mono: true },
      { key: "lunch_time", label: "점심", width: "96px", mono: true },
      { key: "note", label: "특이사항", width: "minmax(0,2.4fr)" },
      { key: "author", label: "기재자", width: "84px", hideBelow: "lg" },
      { key: "updated_at", label: "기재일", width: "150px", mono: true, hideBelow: "lg" },
    ],
  },

  // ── 2026-10-11 추가: 표는 있는데 기록 조회에 없던 것들 ──
  {
    // 방문기록 — 일일업무에서 올린 방문(도착 시간·대수·작업 종류). 해피콜 문자와 업무 현황판의 바탕
    key: "visits", label: "방문기록", group: "현장 기록", table: "visit_logs",
    dateField: "work_date", orderField: "work_date", vendorField: "vendor", filterQuery: "status=neq.cancelled",
    searchFields: ["vendor", "author", "note", "grade", "sales_it", "sales_copier"],
    note: "일일업무에서 올린 방문 기록 — 도착 시간·대수·작업 종류. 취소한 방문은 빠집니다",
    columns: [
      { key: "work_date", label: "방문일", width: "96px", mono: true },
      { key: "vendor", label: "업체명", width: "minmax(0,1.4fr)", strong: true },
      { key: "author", label: "작성자", width: "80px" },
      { key: "arrival_time", label: "도착", width: "72px", mono: true, hideBelow: "sm" },
      { key: "machine_count", label: "대수", width: "56px", align: "right", mono: true, hideBelow: "sm" },
      { key: "grade", label: "등급", width: "56px", hideBelow: "lg" },
      { key: "work_kinds", label: "작업", width: "minmax(0,1fr)" },
      { key: "note", label: "메모", width: "minmax(0,1.4fr)", hideBelow: "lg" },
    ],
  },
  {
    // 활동 — 업무 현황판이 세는 단위 기록(점검 몇 대·AS 몇 건…). 원문에서 자동으로 뽑힌다
    key: "activity", label: "활동", group: "현장 기록", teamField: "team", table: "activity_events",
    dateField: "activity_date", orderField: "activity_date", vendorField: "vendor", filterQuery: "status=neq.cancelled",
    searchFields: ["vendor", "author", "category", "source_text"],
    note: "업무 현황판이 세는 활동 단위 — 보고 원문에서 자동으로 뽑힙니다. 취소된 것은 빠집니다",
    columns: [
      { key: "activity_date", label: "날짜", width: "96px", mono: true },
      { key: "vendor", label: "업체명", width: "minmax(0,1.3fr)", strong: true },
      { key: "author", label: "작성자", width: "80px" },
      { key: "team", label: "팀", width: "56px", hideBelow: "sm" },
      { key: "category", label: "활동", width: "110px" },
      { key: "quantity", label: "수량", width: "56px", align: "right", mono: true },
      { key: "machine_count", label: "대수", width: "56px", align: "right", mono: true, hideBelow: "sm" },
      { key: "source_text", label: "원문", width: "minmax(0,1.6fr)", hideBelow: "lg" },
    ],
  },
  {
    // 마감 카운터 문자 — 운영지원 목록의 업체마다 언제 목록에 올랐고(added_at), 언제 누가 문자를 보냈고(sent_at), 완료(done_at)됐나
    key: "counterSms", label: "마감 카운터 문자", group: "고객 연락", teamField: "team", table: "counter_sms_targets",
    dateField: "added_at", orderField: "added_at", vendorField: "vendor",
    searchFields: ["vendor", "sent_by", "done_by", "lease_code", "sent_phone"],
    chipFilter: { field: "list_kind", options: [["CMS", "CMS 마감"]] },
    note: "현장 탭 마감 카운터의 기록 — 목록에 오른 날·문자 보낸 날·완료. 보내기는 현장 탭에서",
    columns: [
      { key: "added_at", label: "목록", width: "150px", mono: true },
      { key: "vendor", label: "업체명", width: "minmax(0,1.4fr)", strong: true },
      { key: "team", label: "팀", width: "48px" },
      { key: "list_kind", label: "종류", width: "64px", hideBelow: "sm" },
      { key: "lease_code", label: "임대코드", width: "88px", mono: true, hideBelow: "sm" },
      { key: "sent_at", label: "문자", width: "150px", mono: true },
      { key: "sent_by", label: "보낸이", width: "80px", hideBelow: "lg" },
      { key: "done_at", label: "완료", width: "150px", mono: true, hideBelow: "lg" },
    ],
  },
  {
    // 해피콜 — 방문 뒤 키맨에게 보낸 문자(예약·발송·실패)
    key: "happycall", label: "해피콜 문자", group: "고객 연락", table: "happycall_messages",
    dateField: "created_at", orderField: "created_at", vendorField: "keyman",
    searchFields: ["keyman", "recipient", "message", "author"],
    chipFilter: { field: "status", options: [["pending", "대기"], ["sent", "보냄"], ["failed", "실패"], ["skipped", "건너뜀"]] },
    note: "방문 뒤 키맨에게 보낸 해피콜 문자 — 대기·보냄·실패",
    columns: [
      { key: "created_at", label: "작성", width: "150px", mono: true },
      { key: "keyman", label: "키맨", width: "minmax(0,1fr)", strong: true },
      { key: "recipient", label: "번호", width: "120px", mono: true },
      { key: "author", label: "작성자", width: "80px" },
      { key: "status", label: "상태", width: "80px" },
      { key: "sent_at", label: "발송", width: "150px", mono: true, hideBelow: "sm" },
      { key: "message", label: "내용", width: "minmax(0,1.8fr)", hideBelow: "lg" },
    ],
  },
  {
    // 문자·메일 발송 이력 — 점검리포트·마감 카운터·고객 안내 등 모든 발송 큐와 결과. 솔라피에서 가져온 지난 발송도 여기
    key: "messages", label: "문자·메일 발송", group: "고객 연락", table: "message_jobs",
    dateField: "created_at", orderField: "created_at", vendorField: "recipient",
    searchFields: ["recipient", "message", "created_by", "source_type", "channel", "status"],
    chipFilter: { field: "channel", options: [["sms", "문자·알림톡"], ["email", "메일"]] },
    note: "모든 문자(SMS·알림톡)·메일 발송 큐와 결과 — 점검리포트·마감 카운터·고객 안내·솔라피에서 가져온 지난 발송",
    columns: [
      { key: "created_at", label: "작성", width: "150px", mono: true },
      { key: "recipient", label: "받는 곳", width: "minmax(0,1fr)", strong: true },
      { key: "channel", label: "채널", width: "60px" },
      { key: "source_type", label: "출처", width: "120px", hideBelow: "sm" },
      { key: "status", label: "상태", width: "90px" },
      { key: "sent_at", label: "발송", width: "150px", mono: true, hideBelow: "sm" },
      { key: "created_by", label: "보낸이", width: "80px", hideBelow: "lg" },
      { key: "message", label: "내용", width: "minmax(0,1.8fr)", hideBelow: "lg" },
    ],
  },
  {
    // 연락 규칙 — 🚫 보내지 말 것 / 우선 연락처. 마감 카운터 화면에서 등록, 통합검색 맨 위에도 뜬다
    key: "contactRules", label: "연락 규칙(금지·우선)", group: "고객 연락", table: "counter_sms_contact_rules",
    dateField: "updated_at", orderField: "updated_at", vendorField: "vendor",
    searchFields: ["vendor", "phone", "name", "memo", "updated_by"],
    chipFilter: { field: "kind", options: [["block", "🚫 보내지 말 것"], ["prefer", "우선 연락처"]] },
    note: "보내지 말 것(🚫)·우선 연락처 — 마감 카운터 문자 화면에서 등록하면 여기와 통합검색에 보입니다",
    columns: [
      { key: "updated_at", label: "기재", width: "150px", mono: true },
      { key: "vendor", label: "업체명", width: "minmax(0,1.3fr)", strong: true },
      { key: "kind", label: "종류", width: "80px" },
      { key: "phone", label: "번호", width: "120px", mono: true },
      { key: "name", label: "담당자", width: "100px", hideBelow: "sm" },
      { key: "memo", label: "사유", width: "minmax(0,1.6fr)" },
      { key: "updated_by", label: "기재자", width: "80px", hideBelow: "lg" },
    ],
  },
  {
    // 부서 요청 — 타부서가 CS팀에 남긴 요청(카운터확인·미수체크·방문요청…). 처리는 받은함에서
    key: "deptRequests", label: "부서 요청", group: "접수·거래처", table: "dept_requests",
    dateField: "created_at", orderField: "created_at", vendorField: "vendor",
    searchFields: ["requester", "vendor", "content", "kind", "handled_by", "memo"],
    chipFilter: { field: "status", options: [["대기", "대기"], ["처리중", "처리중"], ["완료", "완료"]] },
    note: "타부서가 CS팀에 남긴 요청 — 처리·완료는 받은함에서",
    columns: [
      { key: "created_at", label: "요청", width: "150px", mono: true },
      { key: "vendor", label: "업체명", width: "minmax(0,1.2fr)", strong: true },
      { key: "requester", label: "요청자", width: "110px" },
      { key: "kind", label: "종류", width: "100px" },
      { key: "content", label: "내용", width: "minmax(0,1.8fr)" },
      { key: "due_date", label: "기한", width: "96px", mono: true, hideBelow: "sm" },
      { key: "status", label: "상태", width: "72px" },
      { key: "handled_by", label: "처리자", width: "80px", hideBelow: "lg" },
    ],
  },
];

export const LOOKUP_GROUPS: LookupGroup[] = ["현장 기록", "고객 연락", "영업·계약", "정산", "접수·거래처", "자재"];
