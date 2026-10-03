/** IT 상세 카드용 글 쪼개기 — 화살표·번호·줄바꿈을 단계로, 구분자를 칩으로, 설정경로를 조각으로 */

/** "A → B → C", "1. … 2. …", 줄바꿈 목록을 단계 배열로. 쪼갤 게 없으면 한 덩이 */
export function splitSteps(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.includes("→")) return t.split(/\s*→\s*/).map((s) => s.trim()).filter(Boolean);
  if (/\s\/\s/.test(t) && !t.includes("\n")) return t.split(/\s+\/\s+/).map((s) => s.trim()).filter(Boolean); // "A / B" (8/10처럼 붙은 빗금은 그대로)
  const lines = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (lines.length > 1 && lines.filter((l) => /^(\d+[.)]|[-•·])\s*/.test(l)).length >= Math.ceil(lines.length / 2)) return lines.map((l) => l.replace(/^(\d+[.)]|[-•·])\s*/, ""));
  const numbered = t.split(/\s(?=\d+[.)]\s)/).map((s) => s.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
  if (numbered.length > 1 && /^\d+[.)]\s/.test(t)) return numbered;
  return [t];
}

/** "a / b, c · d" → 칩 */
export function splitChips(text: string): string[] { return text.split(/\s*[/,·|]\s*/).map((s) => s.trim()).filter(Boolean); }

/** 설정경로 "제어판 > 시스템 > 고급" → 경로 조각 */
export function splitPath(text: string): string[] { return text.split(/\s*(?:>|→|›|＞)\s*/).map((s) => s.trim()).filter(Boolean); }
