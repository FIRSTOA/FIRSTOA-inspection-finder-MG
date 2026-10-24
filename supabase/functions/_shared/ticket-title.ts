/**
 * 일정 제목 파서 — 웹앱(src/ids.ts 가 다시 내보냄)과 엣지 함수(naver-calendar-sync)가 같은 규칙을 쓴다(2026-10-24 이사).
 * 엣지가 네이버 수입 일정의 업체명 칸에 제목 앞 80자를 통째로 넣던 것(as_tickets naver 739건 중 80자 274건)을 고치려고 공용으로 뺐다.
 * Deno·Vite 둘 다 읽으므로 외부 import 없이 순수 함수만 둔다.
 */

// 일정리스트→FIELD 변환용: 네이버 미러 제목("이민구 셋팅요청 S D450 30S업체명…분기마감 종료일 …")에서
// 업체명부(슬래시·공백 보존)와 구분을 꺼낸다 — 접수원본 변환(A양식)과 같은 모양이 되도록.
// "유상A/S" — 유상 수리 접수 제목("유상A/S\t \t\t북마을")이 업체명에 행위어째 남던 것(2026-10-24 실측 2건)
const FIELD_TITLE_ACTION = /^(이전)?(셋팅|세팅)(요청)?$|^(여분|자가|점검|방문|철수|납품|교체|AS|A\/S)요청$|^요청$|^(유상)?(as|a\/s)$/i;

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
/**
 * 물류 일정 본문(as_tickets.note)의 "상호(명) :" 줄 — 일정 제목보다 정확하다. 없으면 "".
 *   "7. 상호(사업자등록증 유/무) : 유디임팩트-새싹 영등포캠퍼스 (순 21944)" → "유디임팩트-새싹 영등포캠퍼스"
 * 떼는 것(2026-10-24 naver 681건 재계산 실측): 순번 표기 "(순 n)"·"( n )"·"(n)"·"( n,n )"·"/ 순: n", "(사유: …)" 꼬리,
 * 임대리스트 등급 접두("28V(주) …"·"12N서원인테리어"), 끝 콜론. 상호 칸에 주소를 적은 줄("경기 김포시 사우중로 77 …")은 버린다 → 제목 고객사로.
 */
const NOTE_ADDRESS_RX = /\S(?:시|군|구)\s+\S*(?:로|길)\s*\d/;
export function noteCompanyName(note: string): string {
  const m = String(note || "").replace(/_x000d_|\r/g, "").match(/상호(?:명)?[^:：\n]{0,20}[:：][ \t]*([^\n]+)/);
  const name = (m?.[1] || "")
    .replace(/\(\s*순\s*[:：]?\s*[\d,\s]+\)/g, " ")
    .replace(/\(\s*\d{3,}(?:\s*,\s*\d{3,})*\s*\)/g, " ") // 순번만 든 괄호 — 3자리 이상만(층·호수 "(2)"는 남긴다)
    .replace(/[\s/]*순\s*[:：]?\s*\d[\d,\s]*$/, "")
    .replace(/\(\s*사유\s*[:：][^)]*\)?\s*$/, "")
    .replace(/^\d{1,4}#?(?:SS|NN|S|N|V)(?=[가-힣㈜(])/, "")
    .replace(/[:：]\s*$/, "").replace(/\s+/g, " ").trim();
  return NOTE_ADDRESS_RX.test(name) ? "" : name;
}

/** 네이버 캘린더 물류 일정 제목은 80자에서 잘려 저장된다(2026-10-24 as_tickets 실측: 80자 107건) */
export const TICKET_TITLE_CUT = 80;

/**
 * note(일정 본문)를 함께 주면 "상호명 :" 줄을 거래처명으로 먼저 쓴다(2026-10-24).
 * 제목에서 고객사 칸(품목 칸 바로 앞)을 못 찾았는데 제목이 잘린 길이면 거래처명을 비운다 — 예전엔 제목 전체가 거래처명으로 들어가
 * (디지털자산 거래소 10/23 납품: "⭐오후 4시반 이후 … -납품(일반)/퍼스트/운영") 업체 검색·이력에 안 걸렸다. 비면 사용자가 직접 적는다.
 */
export function logisticsTicketInfo(raw: string, note = ""): { vendor: string; item: string; category: string } {
  const flat = String(raw || "").replace(/_x000d_|\r|\n|\t/g, " ").replace(/\s+/g, " ").trim();
  const category = /철수/.test(flat) ? "철수" : /교체/.test(flat) ? "교체" : "납품";
  const fromNote = noteCompanyName(note);
  // 괄호 안의 슬래시("AC4570(보탄2/리퍼)")는 칸 구분이 아니다 — 열린 괄호가 다음 칸에서 닫히면 다시 붙인다
  // (닫히지 않는 "65형(본체+옵션(스탠드)" 같은 표기는 그대로 둔다)
  const segments: string[] = [];
  for (const seg of flat.split("/").map((part) => part.trim()).filter(Boolean)) {
    const prev = segments[segments.length - 1];
    const open = prev ? (prev.match(/\(/g) || []).length - (prev.match(/\)/g) || []).length : 0;
    if (prev && open > 0 && seg.includes(")")) segments[segments.length - 1] = `${prev}/${seg}`;
    else segments.push(seg);
  }
  const PRODUCT_RX = /\d+\s*(대|개|형|세트|셋트|EA)\b|\d+(대|개|형)|리퍼|본체|노트북|데스크탑|모니터|소모품|전자칠판/i;
  // 수량 없이 모델명만 적힌 품목 칸("X3220", "ES5473", "SL-X3220NR", "K4305LX->K7600LX") — 이게 없으면 철수 제목 대부분이 품목을 못 찾아
  // 제목 통째가 거래처명으로 들어갔다(2026-10-24 logistics_records "/퍼스트/" 14건). 칸 머리가 영문+숫자 3~5자일 때만.
  const MODEL_RX = /^(?:[A-Z]{1,4}-)?[A-Z]{1,4}-?\d{3,5}(?![가-힣])|^태블릿/i;
  // 품목 칸 앞이 고객사가 아니라 내부 용어인 경우("…/ IT / 고인돌 방문 해서 데스크탑 5대 수령") — 고객사로 쓰지 않는다
  const INTERNAL_RX = /^(IT|CS|CSS|택배|퍼스트|운영팀|증설|온라인|개인영업|계약종료|현장종료|단기종료|일부반출|재계약|기기고장|기기상향|추심|소송|무상|유상)$/i;
  // 구분 칸("철수(일반)"·"이전납품만(일반)"·"납품(현장)"·"…-판매납품"·단독 "(일반)")이 있으면 그 다음(발주처) 뒤부터 품목을 찾는다 —
  // 글머리 메모의 "3개월"이 품목으로 오인돼 메모 첫 칸이 거래처명이 되던 것("고객이 일정잡고 다시 연락준다고 함", 2026-10-24 실측)
  const kindAt = segments.findIndex((seg) => /(납품|철수|교체|회수|이전|설치|세팅|셋팅)만?(\([가-힣/]{1,6}\))?$/.test(seg) || /^\([가-힣/]{1,6}\)$/.test(seg));
  const from = kindAt >= 0 ? kindAt + 2 : 1;
  for (let i = from; i < segments.length; i += 1) {
    if (PRODUCT_RX.test(segments[i]) || MODEL_RX.test(segments[i])) {
      const vendor = segments[i - 1];
      if (vendor && vendor.length >= 2 && !INTERNAL_RX.test(vendor)) return { vendor: fromNote || vendor, item: segments[i], category };
    }
  }
  // 품목 칸을 못 알아봐도(세단기·플로터·나스·가구) 끝의 비고 칸("확인서서명필수"·"전자"·"수기") 두 칸 앞이 고객사다
  if (kindAt >= 0) {
    const tailAt = segments.findIndex((seg, i) => i > kindAt && /^(확인서\s*서명\s*필수|전자|수기)$/.test(seg));
    const vendor = tailAt - 2 >= kindAt + 2 ? segments[tailAt - 2] : ""; // 구분 칸 + 발주처 칸 뒤여야 한다
    if (vendor && vendor.length >= 2 && !INTERNAL_RX.test(vendor)) return { vendor: fromNote || vendor, item: segments[tailAt - 1], category };
  }
  if (fromNote) return { vendor: fromNote, item: "", category };
  if (flat.length >= TICKET_TITLE_CUT && segments.length >= 2) return { vendor: "", item: "", category };
  return { vendor: fieldTicketVendor(flat).vendor, item: "", category };
}

/**
 * 네이버에서 수입한 일정(as_tickets.source="naver")의 업체명 칸 값 — 제목 전체가 아니라 고객사 부분만.
 * 전체 제목은 calendarTitle(200자)에 따로 남는다. 물류 캘린더는 슬래시 열차의 고객사 칸(본문 "상호 :" 줄 우선),
 * 그 외는 FIELD 변환과 같은 업체명부. 연차·휴가 일정은 회사가 아니라 화면 필터(/휴가|연차/)가 업체명 칸을 보므로 제목을 그대로 둔다.
 */
export function importedTicketVendor(title: string, description = "", delivery = false): string {
  const flat = String(title || "").replace(/_x000d_/g, " ").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  if (/휴가|연차|반차/.test(flat)) return flat.slice(0, 80);
  const vendor = (delivery ? logisticsTicketInfo(flat, description).vendor : "") || fieldTicketVendor(flat).vendor;
  return (vendor || flat).slice(0, 80);
}
