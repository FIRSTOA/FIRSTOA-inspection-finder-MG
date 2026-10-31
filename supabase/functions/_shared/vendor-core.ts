/**
 * 업체 핵심 이름 — 워킨맵 지명 표시용(workinVendorName)·통합이력 검색어(historyCoreName).
 * 2026-10-31: 본문은 src/ids.ts 에서 이사 — 엣지 schedule-report 의 중간보고 줄이 화면과 같은 업체명을 쓰게. src/ids.ts 가 다시 내보낸다.
 * Deno·Vite 둘 다 읽으므로 외부 import 없이 순수 함수만 둔다.
 */

// 워킨맵 지명에서 **표시용** 업체명을 꺼낸다 — vendorMatchKey(비교키)와 달리 공백·괄호를 살려
// 통합이력 검색어로 쓸 수 있는 형태. supabase/auto-schedule.sql의 workin_vendor_()와 거울.
export function workinVendorName(value: string) {
  const flat = String(value || "").replace(/_x000d_|\r|\n/g, " ").replace(/\s+/g, " ");
  const noPrefix = flat.replace(/^\s*[\d/\-#]*\s*(?:V|SS|S|NN|N)(?=[^A-Za-z])/, "").trim();
  const beforeSlash = noPrefix.split("/")[0];
  const noTail = beforeSlash.replace(/(매월마감|분기마감|매주마감|월말마감|단순마감|매년마감|매월방문|매주방문|격주방문|월말방문|마감|매년).*$/, "")
    .replace(/[\s\-·,()]+$/, "");
  // "블루닷 주식회사(bluedot Inc.)" — 영문 괄호 꼬리(닫힘 유실 포함)와 뒤에 붙은 법인표기를 벗겨야 이력 키가 맞는다
  const noParenTail = noTail.replace(/\s*\([A-Za-z0-9 .,&-]*\)?\s*$/, "");
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
  const tokens = flat.split(/[\s|·,~()/-]+/);
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
