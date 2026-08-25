// 기번/자산기번 등 식별자 비교용 정규화 — 프로젝트 공용.
// (api.ts normId / WalkingMap normalizeIdKey / spareAdvice normSerial 로 3벌 중복이던 것을 통합)
export function normalizeId(value: string) {
  return String(value || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}

// 워킨맵 지명("25#V보림토건(주) 3분기…")에서 접두 번호·등급·꼬리표를 벗겨 업체명 비교키를 만든다.
// (WalkingMap 로컬 구현을 공용으로 승격 — vendorFlags·일정리스트 배지에서도 같은 기준 사용)
export function vendorMatchKey(value: string) {
  return String(value || "")
    // ㈜·(주)는 기호 제거를 거치면 맨 앞 "주"만 남아 "주식회사" 제거 규칙을 빠져나간다 — 먼저 지운다
    .replace(/㈜|\(주\)|\(유\)/g, "")
    // 괄호 메모("(bluedot Inc.)", "(비번 2580*")는 키를 오염시킨다 — SQL vendor_key_와 같은 규칙 (닫힘 유실 포함)
    .replace(/\([^)]*\)?/g, " ")
    // 접두 번호와 등급 사이에 #·/·- 가 끼는 형식("20#SS…", "2609/17#V…")이 워킨맵에 190곳 있다
    .replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?[A-Z]?(?=[가-힣㈜(])/i, "")
    .replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?/i, "")
    .replace(/(?:분기|매월|계약종료|재계약|점검|마감).*$/i, "")
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase()
    // 법인표기는 위치 불문 변별력이 없다 — "블루닷 주식회사" vs "블루닷"이 같은 키가 되도록 (SQL vendor_key_와 거울)
    .replace(/(주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인|의료법인|학교법인)/g, "");
}

// 워킨맵 지명에서 **표시용** 업체명을 꺼낸다 — vendorMatchKey(비교키)와 달리 공백·괄호를 살려
// 통합이력 검색어로 쓸 수 있는 형태. supabase/auto-schedule.sql의 workin_vendor_()와 거울.
export function workinVendorName(value: string) {
  const flat = String(value || "").replace(/_x000d_|\r|\n/g, " ").replace(/\s+/g, " ");
  const noPrefix = flat.replace(/^\s*[\d/\-#]*\s*(?:V|SS|S|NN|N)(?=[^A-Za-z])/, "").trim();
  const beforeSlash = noPrefix.split("/")[0];
  const noTail = beforeSlash.replace(/(매월마감|분기마감|매주마감|월말마감|단순마감|매년마감|매월방문|매주방문|격주방문|월말방문|마감|매년).*$/, "")
    .replace(/[\s\-·,()]+$/, "");
  // "블루닷 주식회사(bluedot Inc.)" — 영문 괄호 꼬리(닫힘 유실 포함)와 뒤에 붙은 법인표기를 벗겨야 이력 키가 맞는다
  const noParenTail = noTail.replace(/\s*\([A-Za-z0-9 .,&\-]*\)?\s*$/, "");
  const noCorpTail = noParenTail.replace(/\s*(주식회사|유한회사|\(주\)|㈜)\s*$/, "");
  return noCorpTail.replace(/[\s\-·,()]+$/, "").trim();
}

// 통합이력 검색어 뽑기 — 접수 제목("여분요청 N SL-X3220NR 14N주식회사 퍼뮤니티 …")이나 워킨맵 잡문이
// 통째로 들어오면 검색이 0건이라, 접수 키워드·모델명·숫자등급 접두를 건너뛰고 첫 업체명 토큰만 남긴다.
const HISTORY_STOPWORD = /^(여분요청|자가요청|자가|여분|접수|방문|방문전|방문후|요청|요청사항|요망|바람|점검|정기점검|교체|교체건|철수|납품|배송|전달|설치|회수|수거|확인|문의|내용|증상|제목|전화|연락|도착|완료|처리|일정|변경|취소|보류|긴급|급함|이전셋팅만?|셋팅|종료일|지역|수도권[A-E]?|분기마감|매월마감|마감|오전|오후|레벨\d*|브라더|삼성|캐논|엡손|제록스|신도리코|신도|교세라|후지제록스|후지|토너|드럼|현상기|정착기|폐토너)$/;
const CORP_PREFIX = /^(주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인|의료법인|학교법인|㈜)/;
// "한불엠앤에스㈜1층"처럼 업체명 뒤에 ㈜·위치가 붙은 토큰에서 앞부분만 (lookbehind는 구형 iOS 미지원이라 회피)
function beforeCorpMark(value: string) {
  const match = value.match(/^(.{2,}?)(?:㈜|\(주\))/);
  return match ? match[1] : value;
}
export function historyCoreName(raw: string) {
  // 네이버 미러 제목("한왕주 - 전자계약서 …")의 배정자 접두를 먼저 벗긴다 — 사람 이름이 검색어가 되면 안 된다
  const noAssignee = String(raw || "").replace(/^[가-힣]{2,4}\s*[-–—]\s+/, "");
  // 주의: workinVendorName은 첫 "/"에서 자른다 — "제목/캘린더제목 …" 같은 접수 제목이 "제목"으로 뭉개지므로
  // 토큰 분해는 슬래시를 구분자로만 쓰는 원문 기준으로 한다.
  // 임대리스트·시트 원문에는 엑셀 잔재로 큰따옴표가 섞인다("4N주식회사 …) — 그러면 등급 접두 규칙이
  // 깨져 그 토큰(`"4N주식회사`)이 그대로 검색어가 됐다(2026-08-19 사고). 따옴표류는 구분자로 취급한다.
  const flat = noAssignee.replace(/_x000d_|\r|\n/g, " ").replace(/["'“”„‟]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = flat.split(/[\s|·,~()/\-]+/);
  // 1순위: "30S제이드자산운용"·"20#SS한불엠앤에스"처럼 순번+등급 접두 토큰 — 임대리스트 표기라 업체명일 확률이 가장 높다
  for (let i = 0; i < tokens.length; i += 1) {
    const match = tokens[i].match(/^\d{1,4}[#]?(?:SS|NN|S|N|V)([가-힣㈜].*)$/);
    if (!match) continue;
    const stripped = beforeCorpMark(match[1].replace(CORP_PREFIX, "").replace(/^㈜/, ""));
    if (stripped.length >= 2 && !HISTORY_STOPWORD.test(stripped)) return stripped.replace(/(전|본사|지사|지점|공장|창고|사옥)$/, "") || stripped;
    // "11V사단법인"처럼 법인 접두만 남으면 업체명은 다음 토큰이다
    const following = beforeCorpMark((tokens[i + 1] || "").replace(CORP_PREFIX, ""));
    if (following.length >= 2 && /[가-힣]/.test(following) && !HISTORY_STOPWORD.test(following)) return following;
  }
  // 2순위: 일반 토큰 스캔 (접수 키워드·수량·제조사·"~요청/전달" 꼬리 제외)
  for (const token of tokens) {
    if (!/[가-힣]/.test(token)) continue; // 영문·숫자만인 토큰은 모델명·시리얼일 가능성이 높다
    if (HISTORY_STOPWORD.test(token)) continue;
    if (/^[A-Za-z0-9]*\d+(개|대|매|장|세트|셋트|통|권|박스)$/.test(token)) continue; // "K3개" 같은 수량 표기
    if (token.length <= 5 && /(요청|전달|문의|신청|배정)$/.test(token)) continue; // "셋팅요청"·"여분전달" 같은 행위어
    const core = beforeCorpMark(token
      .replace(/^\d+[#]?[A-Za-z]*(?=[가-힣])/, "") // "14N주식회사"·"20#SS한불…" 접두 제거
      .replace(CORP_PREFIX, ""));
    if (core.length < 2 || HISTORY_STOPWORD.test(core)) continue;
    // "넥스트라이프본사"로 찾으면 지점 표기 없는 기록을 놓친다 — 위치 접미사는 벗긴다
    const noBranch = core.replace(/(전|본사|지사|지점|공장|창고|사옥)$/, "");
    return noBranch.length >= 2 ? noBranch : core;
  }
  return workinVendorName(noAssignee) || flat;
}

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
    if (/^[ㅡ―—=_\-]{3,}$/.test(line)) { if (cur) out.push(cur); cur = null; curField = ""; pendingLoc = ""; continue; }
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

// 일정리스트→FIELD 변환용: 네이버 미러 제목("이민구 셋팅요청 S D450 30S업체명…분기마감 종료일 …")에서
// 업체명부(슬래시·공백 보존)와 구분을 꺼낸다 — 접수원본 변환(A양식)과 같은 모양이 되도록.
const FIELD_TITLE_ACTION = /^(이전)?(셋팅|세팅)(요청)?$|^(여분|자가|점검|방문|철수|납품|교체|AS|A\/S)요청$|^요청$|^(as|a\/s)$/i;
export function fieldTicketVendor(raw: string): { vendor: string; gubun: string } {
  const flat = String(raw || "").replace(/_x000d_|\r|\n|\t/g, " ").replace(/\s+/g, " ").trim();
  const tokens = flat.split(" ");
  const gubun = tokens.some((token) => /^(이전)?(셋팅|세팅)(요청)?$/.test(token)) ? "세팅"
    : tokens.some((token) => /^여분요청$/.test(token)) ? "여분"
    : "A/S";
  // 업체명 시작점 1순위: "30S업체명" 등급 접두 토큰 (임대리스트 표기)
  const graded = flat.match(/\d{1,4}#?(?:SS|NN|S|N|V)([가-힣㈜(].*)$/);
  let vendor = graded ? graded[1] : "";
  if (!vendor) {
    // 접두 정리: 직원 이름·행위어·단독 등급·영숫자(모델) 토큰을 걷어낸 나머지
    let start = 0;
    while (start < tokens.length) {
      const token = tokens[start];
      // 직원 이름 접두는 뒤에 행위어·구분 기호("-")·A/S가 올 때 벗긴다 — "이호준 - a/s NN …"이 통째로 업체명이 되던 실사고
      const nameThenMarker = /^[가-힣]{2,4}$/.test(token) && start === 0 && tokens.length > 2 && (FIELD_TITLE_ACTION.test(tokens[1] || "") || /^[-–—:]$/.test(tokens[1] || ""));
      if (FIELD_TITLE_ACTION.test(token) || /^[-–—:]$/.test(token) || /^(SS|NN|S|N|V)$/.test(token) || /^[A-Za-z0-9./-]+$/.test(token) || nameThenMarker) { start += 1; continue; }
      break;
    }
    vendor = tokens.slice(start).join(" ");
  }
  vendor = vendor.replace(/(매월마감|분기마감|매주마감|월말마감|매년마감|단순마감|마감|매년|종료일).*$/, "").replace(/[\s\-·,]+$/, "").trim();
  return { vendor: vendor || flat, gubun };
}

// 물류(납품·철수·교체) 네이버 제목 파서 — "머리말-구분/발주처/영업구분/고객사/품목/비고" 슬래시 열차에서
// 고객사와 품목을 꺼낸다. 규칙: 수량·모델이 든 세그먼트(품목) 바로 앞이 고객사다.
//   "네오정보 직송-판매납품/네오정보/개인영업/디스페이스코리아/안드로이드전자칠판 65형(…)/확인서서명필수" → 디스페이스코리아
export function logisticsTicketInfo(raw: string): { vendor: string; item: string; category: string } {
  const flat = String(raw || "").replace(/_x000d_|\r|\n|\t/g, " ").replace(/\s+/g, " ").trim();
  const category = /철수/.test(flat) ? "철수" : /교체/.test(flat) ? "교체" : "납품";
  const segments = flat.split("/").map((seg) => seg.trim()).filter(Boolean);
  const PRODUCT_RX = /\d+\s*(대|개|형|세트|셋트|EA)\b|\d+(대|개|형)|리퍼|본체|노트북|데스크탑|모니터|소모품|전자칠판/i;
  for (let i = 1; i < segments.length; i += 1) {
    if (PRODUCT_RX.test(segments[i])) {
      const vendor = segments[i - 1];
      // 앞 세그먼트가 영업구분(운영팀·개인영업 등) 같은 짧은 내부 용어면 그 앞을 본다? — 실데이터상 품목 앞은 항상 고객사
      if (vendor && vendor.length >= 2) return { vendor, item: segments[i], category };
    }
  }
  return { vendor: fieldTicketVendor(flat).vendor, item: "", category };
}
