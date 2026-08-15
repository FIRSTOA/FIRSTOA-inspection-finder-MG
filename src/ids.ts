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
    // 접두 번호와 등급 사이에 #·/·- 가 끼는 형식("20#SS…", "2609/17#V…")이 워킨맵에 190곳 있다
    .replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?[A-Z]?(?=[가-힣㈜(])/i, "")
    .replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?/i, "")
    .replace(/(?:분기|매월|계약종료|재계약|점검|마감).*$/i, "")
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase()
    // 법인 접두어는 변별력이 없는데 앞부분 일치 매칭을 오폭시킨다 ("주식회사 무암" ↔ "주식회사 무천…")
    .replace(/^(주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인|의료법인|학교법인)/, "");
}

// 워킨맵 지명에서 **표시용** 업체명을 꺼낸다 — vendorMatchKey(비교키)와 달리 공백·괄호를 살려
// 통합이력 검색어로 쓸 수 있는 형태. supabase/auto-schedule.sql의 workin_vendor_()와 거울.
export function workinVendorName(value: string) {
  const flat = String(value || "").replace(/_x000d_|\r|\n/g, " ").replace(/\s+/g, " ");
  const noPrefix = flat.replace(/^\s*[\d/\-#]*\s*(?:V|SS|S|NN|N)(?=[^A-Za-z])/, "").trim();
  const beforeSlash = noPrefix.split("/")[0];
  const noTail = beforeSlash.replace(/(매월마감|분기마감|매주마감|월말마감|단순마감|매월방문|매주방문|격주방문|월말방문|마감).*$/, "");
  return noTail.replace(/[\s\-·,()]+$/, "").trim();
}

// 통합이력 검색어 뽑기 — 접수 제목("여분요청 N SL-X3220NR 14N주식회사 퍼뮤니티 …")이나 워킨맵 잡문이
// 통째로 들어오면 검색이 0건이라, 접수 키워드·모델명·숫자등급 접두를 건너뛰고 첫 업체명 토큰만 남긴다.
const HISTORY_STOPWORD = /^(여분요청|자가요청|자가|여분|접수|방문|요청|점검|정기점검|교체|철수|납품|이전셋팅만?|셋팅|종료일|지역|수도권[A-E]?|분기마감|매월마감|마감|오전|오후|긴급|급함|레벨\d*)$/;
export function historyCoreName(raw: string) {
  // 네이버 미러 제목("한왕주 - 전자계약서 …")의 배정자 접두를 먼저 벗긴다 — 사람 이름이 검색어가 되면 안 된다
  const noAssignee = String(raw || "").replace(/^[가-힣]{2,4}\s*[-–—]\s+/, "");
  const cleaned = workinVendorName(noAssignee) || noAssignee.trim();
  for (const token of cleaned.split(/[\s|·,~()/\-]+/)) {
    if (!/[가-힣]/.test(token)) continue; // 영문·숫자만인 토큰은 모델명·시리얼일 가능성이 높다
    if (HISTORY_STOPWORD.test(token)) continue;
    const core = token
      .replace(/^\d+[A-Za-z]*(?=[가-힣])/, "") // "14N주식회사" → "주식회사"
      .replace(/^(주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인|의료법인|학교법인|㈜)/, "");
    if (core.length < 2 || HISTORY_STOPWORD.test(core)) continue;
    // "넥스트라이프본사"로 찾으면 지점 표기 없는 기록을 놓친다 — 위치 접미사는 벗긴다
    const noBranch = core.replace(/(본사|지사|지점|공장|창고|사옥)$/, "");
    return noBranch.length >= 2 ? noBranch : core;
  }
  return cleaned;
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
