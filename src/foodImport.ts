/**
 * 네이버지도 "저장" 목록을 화면에서 쭉 복사한 텍스트를 맛집 항목으로 해석한다 (내보내기 기능이 없어 이게 유일한 길).
 *
 * 복사본 모양(실측 2026-08-25):
 *   [내 메모줄]            예) "1,b1,b2 식당가 주차1시간", "가츠몽,주차자리 빡셈"
 *   [가게명+업종이 붙은 줄]  예) "가츠몽 교대점돈가스", "고양진 생갈비 김치찌개찌개,전골"
 *   [주소 1~2줄]           예) "서울 강남구 논현로163길 13-4" / "서울특별시 강남구 신사동 569-12"
 *   [메모…]                예) "메모은마상가 지하"
 * 항목 사이는 빈 줄(1개 이상). 줄 구성이 항목마다 달라서 "주소·메모가 아닌 줄"을 후보로 두고
 * 후보가 둘이면 앞이 내 메모, 뒤가 가게명이다. 업종 꼬리는 사전으로 떼어낸다.
 */
export type ImportedPlace = {
  name: string; address: string; parking: "가능" | "유료" | "발렛" | "노상" | "불가" | "모름"; parkingMemo: string; memo: string;
};

const ADDRESS_RE = /^(서울특별시|서울|경기도|경기|인천광역시|인천|부산광역시|부산|대구광역시|대구|대전광역시|대전|광주광역시|광주|울산광역시|울산|세종특별자치시|세종|강원특별자치도|강원도|강원|충청북도|충북|충청남도|충남|전라북도|전북|전라남도|전남|경상북도|경북|경상남도|경남|제주특별자치도|제주)\s/;
// 네이버 업종 꼬리 — 긴 것부터 대조해야 "육류,고기요리"가 "요리"만 떨어지지 않는다
const CATEGORY_TAILS = [
  "육류,고기요리", "장어,먹장어요리", "곰탕,설렁탕", "순대,순댓국", "족발,보쌈", "찌개,전골", "우동,소바", "곱창,막창,양",
  "소고기구이", "정육식당", "법률사무소", "기업,빌딩", "생선회", "활어회", "추어탕", "복어요리", "돈가스", "중식당", "일식당",
  "한정식", "양식", "한식", "분식", "카페", "주차장", "국밥", "냉면", "칼국수", "치킨", "피자", "베이커리",
];
const CATEGORY_RE = new RegExp(`(${CATEGORY_TAILS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);

export function stripCategory(nameLine: string): string {
  const trimmed = nameLine.trim();
  const stripped = trimmed.replace(CATEGORY_RE, "").trim();
  // 업종만 남은 줄("주차장"·"한식")은 이름이 없으니 원문 유지
  return stripped.length >= 2 ? stripped : trimmed;
}

/** 내 메모줄에서 주차 상태를 읽는다 — "주차가능"·"2시간무료"→가능, "10분에 천원"→유료, "빡셈·불가·어렵"→불가 */
export function parkingFromNote(note: string): ImportedPlace["parking"] {
  if (!/주차|무료|시간|천원|발렛|발레|주차장/.test(note)) return "모름";
  if (/불가|빡|어렵|힘들|없음|안됨|안 됨/.test(note)) return "불가";
  if (/발렛|발레/.test(note)) return "발렛";
  if (/유료|천원|만원|\d+원/.test(note) && !/무료/.test(note)) return "유료";
  if (/노상|골목|길가/.test(note)) return "노상";
  return "가능";
}

export function parseNaverSavedList(text: string): ImportedPlace[] {
  const blocks = String(text || "").replace(/\r/g, "").split(/\n\s*\n+/).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  const out: ImportedPlace[] = [];
  for (const lines of blocks) {
    const addresses = lines.filter((l) => ADDRESS_RE.test(l));
    const memoLines = lines.filter((l) => /^메모/.test(l)).map((l) => l.replace(/^메모\s*[:：]?\s*/, "").trim()).filter(Boolean);
    const candidates = lines.filter((l) => !ADDRESS_RE.test(l) && !/^메모/.test(l));
    if (!addresses.length && !candidates.length) continue;
    let note = "";
    let name = "";
    if (candidates.length >= 2) { note = candidates[0]; name = stripCategory(candidates[candidates.length - 1]); }
    else if (candidates.length === 1) {
      // 후보 하나: 주차·식당가 같은 메모성 문구면 메모로 두고 이름은 주소로, 아니면 가게명
      if (/주차|식당가|밥집|맛집|뷔페|먹자|쉴곳|지하/.test(candidates[0]) && addresses.length) { note = candidates[0]; name = ""; }
      else name = stripCategory(candidates[0]);
    }
    // 도로명 짧은 형식("서울 강남구 …")이 지오코딩에 가장 잘 맞는다 — 없으면 첫 주소
    const road = addresses.find((a) => /^(서울|경기|인천|부산|대구|대전|광주|울산|세종)\s/.test(a) && !/^(서울특별시|경기도|인천광역시)/.test(a));
    const address = road || addresses[0] || "";
    if (!name) name = address ? address.replace(/^(서울특별시|서울|경기도|경기|인천광역시|인천)\s*/, "").slice(0, 24) : note;
    if (!name) continue;
    const parking = parkingFromNote(note);
    out.push({
      name,
      address,
      parking,
      parkingMemo: parking !== "모름" ? note : "",
      memo: [parking === "모름" ? note : "", ...memoLines].filter(Boolean).join(" · "),
    });
  }
  return out;
}

/** 붙여넣은 텍스트가 네이버 저장목록 복사본인지(주소 줄이 여럿) 아니면 "이름 | 주소 | 메모" 한 줄 형식인지 */
export function looksLikeNaverSavedList(text: string): boolean {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.filter((l) => ADDRESS_RE.test(l)).length >= 2 && !lines.some((l) => /\|/.test(l));
}
