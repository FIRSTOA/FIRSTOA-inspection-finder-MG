// 기번/자산기번 등 식별자 비교용 정규화 — 프로젝트 공용.
// (api.ts normId / WalkingMap normalizeIdKey / spareAdvice normSerial 로 3벌 중복이던 것을 통합)
export function normalizeId(value: string) {
  return String(value || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}

// 워킨맵 지명("25#V보림토건(주) 3분기…")에서 접두 번호·등급·꼬리표를 벗겨 업체명 비교키를 만든다.
// 2026-10-10: 본문은 supabase/functions/_shared/counter-sms/vendorKey.ts (엣지 함수와 같은 규칙) — 여기선 다시 내보낸다
import { vendorMatchKey } from "../supabase/functions/_shared/counter-sms/vendorKey.ts";
export { vendorMatchKey };

// 업체명을 낱말로 — vendorMatchKey와 같은 정규화(법인표기·괄호·접두 등급 제거)를 낱말 단위로 한 것
export function vendorTokens(value: string): string[] {
  return String(value || "")
    .replace(/㈜|\(주\)|\(유\)/g, " ")
    .replace(/\([^)]*\)?/g, " ")
    .replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?(?=[가-힣])/i, "")
    .split(/[\s/,·\-–—]+/)
    .map((token) => token.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase().replace(/(주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인|의료법인|학교법인)/g, ""))
    .filter((token) => token.length >= 2);
}

/**
 * 점검기록 업체명의 낱말이 **모두** 워킨맵 비교키 안에 들어 있는가.
 * 워킨맵 지명이 "태인회계법인 화성 분사무소기존 가정집강남구 / 전 대치동가정집…"처럼 여러 칸이 이어 붙어
 * 완전일치도 부분포함도 빗나갈 때 "태인회계법인 대치동 가정집"(25-12-09 점검)을 같은 곳으로 잇는다(2026-09-16).
 * 낱말 합이 5자 미만("태인")이면 너무 헐거워 거절 — 태인시설·태인주안지사까지 붙어버린다.
 */
export function vendorTokensContained(vendor: string, targetKey: string): boolean {
  const tokens = vendorTokens(vendor);
  if (!tokens.length || tokens.join("").length < 5) return false;
  return tokens.every((token) => targetKey.includes(token));
}

// 워킨맵 지명 표시용 이름(workinVendorName)·통합이력 검색어(historyCoreName) — 2026-10-31: 본문은 supabase/functions/_shared/vendor-core.ts
// (엣지 schedule-report 의 중간보고 줄이 화면과 같은 업체명을 쓰게). 여기선 다시 내보낸다.
export { historyCoreName, workinVendorName } from "../supabase/functions/_shared/vendor-core.ts";

// 워킨맵 comment는 "모델 / 시리얼" 표기(공백 유무 혼재) — 첫 슬래시가 구분자.
// 자동일정 등록·내 일정 표시가 같은 규칙을 쓴다.
export function parseEquipComment(comment: string): { model: string; serial: string } {
  const t = String(comment || "").replace(/\s+/g, " ").trim();
  if (!t) return { model: "", serial: "" };
  const i = t.indexOf("/");
  if (i < 0) return { model: t, serial: "" };
  return { model: t.slice(0, i).trim(), serial: t.slice(i + 1).trim() };
}

// ── 점검·AS 원문 블록 파서 ──────────────────────────────────────────
// 한 방문 기록의 _원문에 기기 여러 대가 "ㅡㅡㅡ" 구분으로 들어 있다(푸드나무 5대).
// 구조화 컬럼에는 첫 기기만 남아 대수·기기별 매수가 틀리므로, 원문을 기기 단위로 되살린다.
export type InspBlock = { loc: string; model: string; serial: string; asset: string; content: string; handled: string; counts: string; toner: string; waste: string; spare: string; special: string };
const INSP_KEY: Record<string, keyof InspBlock> = {
  모델명: "model", 시리얼넘버: "serial", 시리얼: "serial", 자산기번: "asset", 내용: "content", 처리내용: "handled",
  매수: "counts", 토너잔량: "toner", 폐통: "waste", 여분: "spare", 특이사항: "special",
};
export function parseInspectionBlocks(raw: string): InspBlock[] {
  const lines = String(raw || "").replace(/\r/g, "").split("\n");
  const out: InspBlock[] = [];
  const fresh = (): InspBlock => ({ loc: "", model: "", serial: "", asset: "", content: "", handled: "", counts: "", toner: "", waste: "", spare: "", special: "" });
  let cur: InspBlock | null = null;
  let curField: keyof InspBlock | "" = "";
  let pendingLoc = "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^[ㅡ―—=_-]{3,}$/.test(line)) { if (cur) out.push(cur); cur = null; curField = ""; pendingLoc = ""; continue; }
    const labeled = line.match(/^([가-힣A-Za-z]{2,8})\s*[:：]\s*(.*)$/);
    const fieldKey = labeled ? INSP_KEY[labeled[1]] : undefined;
    if (labeled && (fieldKey || /유무$/.test(labeled[1]))) {
      // 구분선 없이 모델명이 또 나오면 새 기기 블록의 시작
      if (fieldKey === "model" && cur && cur.model) { out.push(cur); cur = null; }
      if (!cur) { cur = fresh(); cur.loc = pendingLoc; pendingLoc = ""; }
      if (fieldKey) { cur[fieldKey] = labeled[2].trim(); curField = fieldKey; }
      else curField = "";
      continue;
    }
    if (!line) continue;
    if (cur && curField) cur[curField] = cur[curField] ? `${cur[curField]}\n${line}` : line; // 처리내용·여분의 여러 줄 값
    else if (!cur && line.length <= 14 && !/^\d+[.]?$/.test(line) && !/[:：※]/.test(line)) pendingLoc = line.replace(/^\d+[.]\s*/, ""); // "4층"·"1.5층 화장실 앞" 같은 위치 머리글 (라벨 줄·※표식 제외, 번호 접두 제거)
  }
  if (cur) out.push(cur);
  return out.filter((block) => block.model || block.asset || block.serial);
}

// FIELD 미양식 변환기의 업체명 추출 — App.tsx에서 이사(2026-09-02, 테스트 가능하게).
// 임대리스트 등급 접두("12#V주식회사 디쉐어…")는 마감 꼬리가 없어도 접두 뒤가 업체명이다.
// 이 규칙이 없으면 아래 일반 규칙(…회사 꼬리)이 왼쪽부터 훑다 등급 글자를 이름에 붙인다
// ("V주식회사" 실사고 — A/S V SL-X7500LX 12#V주식회사 디쉐어분당점백업).
export function extractCompanyForTemplate(text: string): string {
  const compact = text.replace(/\s+/g, " ");
  const quotedMatch = compact.match(
    /"\s*\d*(주식회사[^"]*?|법무법인[^"]*?|세무법인[^"]*?|[^"]*?(?:의원|치과|회사|교회|법인|디자인|피앤씨|기획|팩토리|택스))\s*(?:분기마감|매월마감|매년마감)/
  );
  if (quotedMatch) return quotedMatch[1].trim().replace(/-\s*$/, "");

  const companyAfterGradeMatch = compact.match(
    /(?:^|\s)\d+(NN|SS|S|N|V)([^\n]*?)(분기마감|매월마감|매년마감|오픈\s*\d*시?반?분기마감|오픈\s*\d*시?반?|단순마감마감|단순마감)/
  );
  if (companyAfterGradeMatch) {
    return companyAfterGradeMatch[2]
      .replace(/^\s*"/, "")
      .replace(/"\s*$/, "")
      .trim()
      .replace(/-\s*$/, "");
  }

  // 마감 꼬리가 없는 등급 접두 — 접두 바로 뒤부터 줄 끝까지가 업체명부
  const gradedLease = compact.match(/(?:^|\s)\d{1,4}#?(?:NN|SS|S|N|V)((?:주식회사|㈜|\(주\)|법무법인|세무법인|[가-힣])[^\n]*)/);
  if (gradedLease) {
    return gradedLease[1].replace(/(분기마감|매월마감|매년마감|단순마감|마감).*$/, "").trim().replace(/-\s*$/, "");
  }

  const fallback = compact.match(
    /(법무법인\s*[가-힣A-Za-z0-9\s]+|세무법인\s*[가-힣A-Za-z0-9\s]+|주식회사\s*[가-힣A-Za-z0-9\s]+|㈜\s*[가-힣A-Za-z0-9\s]+|[가-힣A-Za-z0-9\s]+(?:의원|치과|회사|교회|법인|디자인|피앤씨|기획|팩토리|택스))/
  );
  return fallback ? fallback[1].trim().replace(/-\s*$/, "") : "";
}

// 2026-10-24: 제목 파서(fieldTicketVendor·noteCompanyName·logisticsTicketInfo 등) 본문은 supabase/functions/_shared/ticket-title.ts —
// 엣지 함수 naver-calendar-sync 가 수입 일정 업체명을 같은 규칙으로 뽑는다. 여기선 다시 내보낸다.
import { fieldTicketVendor } from "../supabase/functions/_shared/ticket-title.ts";
export { fieldTicketVendor, importedTicketVendor, logisticsTicketInfo, noteCompanyName, TICKET_TITLE_CUT } from "../supabase/functions/_shared/ticket-title.ts";

/**
 * "계약갱신제안 / SS급 / 한국농어민신문 / 조은유 차장" 꼴(네이버 수기 제목의 슬래시 열차)에서 업체 칸을 고른다 —
 * 등급 칸(SS급·S·V…) 바로 뒤가 업체다. 첫 칸(내용)으로 이력을 검색하면 엉뚱한 결과가 난다(실사고). 해당 꼴이 아니면 빈값.
 */
export function slashTrainVendor(raw: string): string {
  const parts = String(raw || "").split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return "";
  const gradeAt = parts.findIndex((part) => /^(SS|S|V|NN|N)\s*급?$/i.test(part));
  return gradeAt >= 0 && parts[gradeAt + 1] ? parts[gradeAt + 1] : "";
}

/**
 * 일정 제목에서 업체 이름만 — "법무법인 수헌 3년+유지보수혜택 계약성사 계약사인 체크" → "법무법인 수헌".
 * 뒤에 붙는 메모(숫자·행위어·사람 이름)는 뗀다. 내 일정 지도에서 임대리스트 주소를 못 찾아 "주소 없음"이 많던 원인(2026-10-12).
 */
export function vendorNameCore(raw: string): string {
  const base = fieldTicketVendor(raw).vendor.replace(/[()[\]【】]/g, " ").replace(/\s+/g, " ").trim();
  const STOP = /\d|체크|재계약|계약|점검|a\/?s|납품|철수|교체|확인|방문|설치|수리|회수|미팅|견적|상담|요청|유지보수|혜택|성사|사인|마감|분기|매월|완료|예정|오전|오후|첫|두번째|차$/i;
  const out: string[] = [];
  for (const tk of base.split(" ")) {
    if (!tk) continue;
    if (out.length && STOP.test(tk)) break;
    out.push(tk);
    if (out.length >= 3) break;
  }
  return out.join(" ") || base;
}

/**
 * 업체 검색어로 쓸 이름 — 법인표기를 빼고 첫 숫자·메모 앞까지. "주식회사 티나고ew725.3.7부터 1년씩 계약연장 …" → "티나고" (2026-10-13 워킨맵 F)
 */
export function vendorSearchName(raw: string): string {
  const base = String(raw || "").replace(/㈜|\(주\)|\(유\)|주식회사|유한회사|재단법인|사단법인/g, " ").replace(/\s+/g, " ").trim();
  // 숫자는 날짜·층·대수 꼬리일 때만 자른다 — "카페24"·"3M코리아"처럼 이름 속 숫자는 남긴다(2026-10-15 감사)
  const cut = base.split(/\s*\d+(?=[.\-/~:]|\s*(?:부터|까지|년|월|일|층|대|개|호))|[-–—/:|·]/)[0].replace(/([가-힣])[a-z]+$/i, "$1").replace(/[\s\-·,()[\]]+$/, "").trim();
  return vendorNameCore(cut || base) || base;
}
