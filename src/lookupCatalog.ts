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

export type LookupCategory = {
  key: string;
  label: string;
  group: "현장 기록" | "영업·관리" | "접수·자산";
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
  custom?: "misu" | "overage" | "stock";  // 범용 표 대신 전용 보드를 렌더 (CS체크·정렬·수량조절 등 기능이 더 풍부)
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
    key: "misu", label: "미수", group: "영업·관리", teamSourceParen: true, teamField: "지역", custom: "misu", table: "misu",
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
    key: "overage", label: "초과료", group: "영업·관리", custom: "overage", table: "overage",
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
    key: "overage_adjust", label: "초과조정", group: "영업·관리", teamSourceParen: true, teamField: "지역", table: "overage_adjust",
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
    key: "recontract", label: "재계약", group: "영업·관리", teamSourceParen: true, teamField: "지역", table: "recontract",
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
    key: "churn", label: "해지방어", group: "영업·관리", teamField: "담당팀", table: "churn_defense",
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
    key: "mgmt", label: "관리지원", group: "영업·관리", teamField: "담당팀", table: "mgmt_support",
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
    key: "pc", label: "PC 확장성", group: "영업·관리", teamField: "지역", table: "pc_expansion",
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
    key: "mfp", label: "복합기 확장성", group: "영업·관리", teamField: "미팅지역", table: "mfp_expansion",
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
    key: "reception", label: "서비스접수", group: "접수·자산", teamField: "region", table: "service_receptions",
    dateField: "receipt_date", orderField: "created_at", vendorField: "vendor",
    searchFields: ["vendor", "author", "title", "symptom", "serial", "asset_no", "address"],
    filterQuery: "deleted=is.false",
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
    key: "reception_copier", label: "접수 · 복합기", group: "접수·자산", teamField: "region", table: "service_receptions",
    dateField: "receipt_date", orderField: "created_at", vendorField: "vendor",
    searchFields: ["vendor", "author", "title", "symptom", "serial", "asset_no", "address"],
    filterQuery: "deleted=is.false&type=eq." + encodeURIComponent("복합기 AS"),
    columns: [
      { key: "receipt_date", label: "접수일", width: "96px", mono: true },
      { key: "vendor", label: "업체명", width: "minmax(0,1.3fr)", strong: true },
      { key: "author", label: "접수자", width: "80px" },
      { key: "status", label: "상태", width: "90px" },
      { key: "symptom", label: "증상", width: "minmax(0,1.6fr)" },
      { key: "address", label: "주소", width: "minmax(0,1.2fr)", hideBelow: "lg" },
    ],
  },
  {
    key: "reception_it", label: "접수 · IT", group: "접수·자산", teamField: "region", table: "service_receptions",
    dateField: "receipt_date", orderField: "created_at", vendorField: "vendor",
    searchFields: ["vendor", "author", "title", "symptom", "serial", "asset_no", "address"],
    filterQuery: "deleted=is.false&type=eq." + encodeURIComponent("IT"),
    columns: [
      { key: "receipt_date", label: "접수일", width: "96px", mono: true },
      { key: "vendor", label: "업체명", width: "minmax(0,1.3fr)", strong: true },
      { key: "author", label: "접수자", width: "80px" },
      { key: "status", label: "상태", width: "90px" },
      { key: "symptom", label: "증상", width: "minmax(0,1.6fr)" },
      { key: "address", label: "주소", width: "minmax(0,1.2fr)", hideBelow: "lg" },
    ],
  },
  {
    key: "reception_remote", label: "접수 · 원격", group: "접수·자산", teamField: "region", table: "service_receptions",
    dateField: "receipt_date", orderField: "created_at", vendorField: "vendor",
    searchFields: ["vendor", "author", "title", "symptom", "serial", "asset_no", "address"],
    filterQuery: "deleted=is.false&type=eq." + encodeURIComponent("원격이관"),
    columns: [
      { key: "receipt_date", label: "접수일", width: "96px", mono: true },
      { key: "vendor", label: "업체명", width: "minmax(0,1.3fr)", strong: true },
      { key: "author", label: "접수자", width: "80px" },
      { key: "status", label: "상태", width: "90px" },
      { key: "symptom", label: "증상", width: "minmax(0,1.6fr)" },
      { key: "address", label: "주소", width: "minmax(0,1.2fr)", hideBelow: "lg" },
    ],
  },
  {
    key: "contact", label: "담당자·주소 변경", group: "접수·자산", teamField: "region", table: "contact_changes",
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
    key: "stock", label: "기기·부품 재고", group: "접수·자산", custom: "stock", table: "stock_items",
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
];

export const LOOKUP_GROUPS = ["현장 기록", "영업·관리", "접수·자산"] as const;
