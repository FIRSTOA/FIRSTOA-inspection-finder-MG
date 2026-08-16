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
const HISTORY_STOPWORD = /^(여분요청|자가요청|자가|여분|접수|방문|방문전|방문후|요청|요청사항|요망|바람|점검|정기점검|교체|교체건|철수|납품|배송|전달|설치|회수|수거|확인|문의|내용|증상|제목|전화|연락|도착|완료|처리|일정|변경|취소|보류|긴급|급함|이전셋팅만?|셋팅|종료일|지역|수도권[A-E]?|분기마감|매월마감|마감|오전|오후|레벨\d*|브라더|삼성|캐논|엡손|제록스|신도리코|신도|교세라|후지제록스|후지|토너|드럼|현상기|정착기|폐토너)$/;
const CORP_PREFIX = /^(주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인|의료법인|학교법인|㈜)/;
export function historyCoreName(raw: string) {
  // 네이버 미러 제목("한왕주 - 전자계약서 …")의 배정자 접두를 먼저 벗긴다 — 사람 이름이 검색어가 되면 안 된다
  const noAssignee = String(raw || "").replace(/^[가-힣]{2,4}\s*[-–—]\s+/, "");
  const cleaned = workinVendorName(noAssignee) || noAssignee.trim();
  const tokens = cleaned.split(/[\s|·,~()/\-]+/);
  // 1순위: "30S제이드자산운용"처럼 순번+등급 접두가 붙은 토큰 — 임대리스트 표기라 업체명일 확률이 가장 높다
  for (let i = 0; i < tokens.length; i += 1) {
    const match = tokens[i].match(/^\d{1,4}(?:SS|NN|S|N|V)([가-힣㈜].*)$/);
    if (!match) continue;
    const stripped = match[1].replace(CORP_PREFIX, "").replace(/^㈜/, "");
    if (stripped.length >= 2 && !HISTORY_STOPWORD.test(stripped)) return stripped.replace(/(본사|지사|지점|공장|창고|사옥)$/, "") || stripped;
    // "11V사단법인"처럼 법인 접두만 남으면 업체명은 다음 토큰이다
    const following = (tokens[i + 1] || "").replace(CORP_PREFIX, "");
    if (following.length >= 2 && /[가-힣]/.test(following) && !HISTORY_STOPWORD.test(following)) return following;
  }
  // 2순위: 일반 토큰 스캔 (접수 키워드·수량·제조사·"~요청/전달" 꼬리 제외)
  for (const token of tokens) {
    if (!/[가-힣]/.test(token)) continue; // 영문·숫자만인 토큰은 모델명·시리얼일 가능성이 높다
    if (HISTORY_STOPWORD.test(token)) continue;
    if (/^[A-Za-z0-9]*\d+(개|대|매|장|세트|셋트|통|권|박스)$/.test(token)) continue; // "K3개" 같은 수량 표기
    if (token.length <= 5 && /(요청|전달|문의|신청|배정)$/.test(token)) continue; // "셋팅요청"·"여분전달" 같은 행위어
    const core = token
      .replace(/^\d+[A-Za-z]*(?=[가-힣])/, "") // "14N주식회사" → "주식회사"
      .replace(CORP_PREFIX, "");
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
