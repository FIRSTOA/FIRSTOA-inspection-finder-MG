/**
 * 워킨맵 엑셀 — 주민번호 가림 왕복 보호(2026-10-22).
 * 내보내기는 메모·코멘트를 가려서 내보낸다(직원이 가져가는 파일). 그 파일을 다시 가져오면 가린 글자("900101-1******")가
 * 원본을 덮어쓰게 되므로, 가림 표식이 있는 값은 같은 장소의 기존 값을 유지하고, 기존 값이 없으면 비운다.
 * 테스트: tests/privacyDisplay.test.ts
 */
import { maskRrn } from "./privacy";

/** 가림 표식 — 숫자 6(또는 8)자리-숫자 1자리 뒤 '******' */
export const hasMaskMark = (s: string): boolean => /\d{6}(?:\d{2})?-\d\*{6}/.test(String(s || ""));

type PlaceLike = { number: number; name: string; comment: string; memos: string[] };

/** 같은 장소 찾기 — 이름이 같고 번호도 같은 것, 없으면 이름이 같은 것이 하나뿐일 때 그것 */
function sameplace<T extends PlaceLike>(p: PlaceLike, existing: T[]): T | undefined {
  const name = p.name.trim();
  const byName = existing.filter((e) => e.name.trim() === name);
  return byName.find((e) => e.number === p.number) || (byName.length === 1 ? byName[0] : undefined);
}

/**
 * 가져온 장소들의 가린 값 되살리기. existing = 같은 팀·분기·업무의 기존 장소.
 * kept = 기존 값으로 되돌린 칸 수, cleared = 기존 값이 없어 비운 칸 수.
 */
export function restoreMaskedImport<T extends PlaceLike>(imported: T[], existing: PlaceLike[]): { places: T[]; kept: number; cleared: number } {
  let kept = 0, cleared = 0;
  const places = imported.map((p) => {
    const old = sameplace(p, existing);
    let comment = p.comment;
    if (hasMaskMark(comment)) {
      if (old) { comment = old.comment; kept += 1; }   // 칸 통째로 기존 값 유지
      else { comment = ""; cleared += 1; }
    }
    // 메모는 칸 순서가 바뀔 수 있어(빈 칸 당김) 가린 꼴이 같은 기존 메모를 찾는다
    const memos: string[] = [];
    for (const m of p.memos) {
      if (!hasMaskMark(m)) { memos.push(m); continue; }
      const hit = old?.memos.find((om) => maskRrn(om) === m);
      if (hit !== undefined) { memos.push(hit); kept += 1; } else cleared += 1;
    }
    return { ...p, comment, memos };
  });
  return { places, kept, cleared };
}
