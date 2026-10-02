/**
 * "업체명: ○○" 같은 라벨 줄에서 값을 읽는다 — 그 줄 안에서만.
 *  (2026-10-02) 예전 정규식 /업체명\s*[:：]\s*(.+)/ 은 \s* 가 줄바꿈까지 삼켜, 업체명 줄이 비어 있으면
 *  다음 줄("부서명:")을 업체명으로 집어 왔다 → 포토앨범 160건의 업체명이 "부서명:"으로 저장됐다.
 */
const H = "[^\\S\\n]*"; // 가로 공백만(줄바꿈 제외)

export function pickLabelValue(text: string, label: string): string {
  const m = String(text || "").match(new RegExp(`^${H}${label}${H}[:：]${H}(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

export function extractVendorFromText(text: string): string {
  return pickLabelValue(text, "업체명");
}
