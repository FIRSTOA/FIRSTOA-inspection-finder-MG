/**
 * 점검·AS 양식 윗줄 [등급] 드롭다운(2026-10-25 사용자 "지역/등급/구분/레벨 — 직접 입력까지 드롭다운").
 * 등급은 따로 상태가 없고 결과 글(textOutput·listOutput·손으로 고친 블록)의 "등급:" 줄이 곧 값이다 —
 * 미리보기에서 고쳐도, 드롭다운에서 골라도, 거래처검색·탭 검색으로 불러와도 같은 줄을 읽고 쓴다(저장 칸 동일).
 */
import { GRADE_OPTIONS } from "../formOptions";

export { GRADE_OPTIONS };
/** 드롭다운의 "직접 입력…" 항목 값(실제 등급으로는 저장되지 않는다) */
export const GRADE_CUSTOM = "__custom__";
export const GRADE_SELECT_OPTIONS = [...GRADE_OPTIONS, GRADE_CUSTOM];
export const GRADE_SELECT_LABELS = [...GRADE_OPTIONS, "직접 입력…"];

// 같은 줄만 본다 — \s* 는 줄바꿈을 넘어 다음 줄("업체명: …")을 값으로 먹는다(작성자 칸 실사고 8/13 과 같은 함정)
const GRADE_LINE = /^(등급[^\S\n]*[:：][^\S\n]*)(.*)$/m;

/** 글에서 첫 "등급:" 줄의 값. 줄이 없으면 "" */
export function readGradeLine(text: string): string {
  return (text || "").match(GRADE_LINE)?.[2]?.trim() || "";
}

/** 글에 "등급:" 줄이 있는가 */
export function hasGradeLine(text: string): boolean {
  return GRADE_LINE.test(text || "");
}

/** 첫 "등급:" 줄의 값만 바꾼다(라벨 뒤 띄어쓰기는 원래 모양 그대로). 줄이 없으면 글을 그대로 돌려준다 */
export function replaceGradeLine(text: string, grade: string): string {
  if (!text) return text;
  return text.replace(GRADE_LINE, (_m, head: string) => `${head}${grade.trim()}`);
}

/** 드롭다운 표시 상태 — 목록 값이면 그 항목, 목록 밖 값(예: 유지보수)이면 직접 입력 모드로 그 값을 글 칸에 */
export function gradeChoice(value: string): { select: string; custom: boolean; text: string } {
  const v = (value || "").trim();
  if (!v) return { select: "", custom: false, text: "" };
  const known = GRADE_OPTIONS.find((o) => o.toUpperCase() === v.toUpperCase());
  return known ? { select: known, custom: false, text: "" } : { select: v, custom: true, text: v };
}

/** 드롭다운에서 고른 항목 → 저장할 등급. 직접 입력을 고르면 null(글 칸을 연다, 값은 그대로) */
export function gradeFromSelect(option: string): string | null {
  return option === GRADE_CUSTOM ? null : option;
}

/** 지금 결과 글의 등급(textOutput·listOutput 중 글이 있는 쪽). "등급:" 줄이 아직 없으면(원본 전) null — 드롭다운을 잠근다 */
export function gradeOfOutput(textOutput: string, listOutput: Array<{ content: string }>): string | null {
  const text = textOutput || listOutput[0]?.content || "";
  return hasGradeLine(text) ? readGradeLine(text) : null;
}

type SetState<T> = (fn: (prev: T) => T) => void;
/** App 의 결과 글 상태 setter 묶음 — 메서드 꼴이라 setListOutput(ResultItem[]) 도 그대로 받는다 */
export type GradeSetters = {
  text(fn: (prev: string) => string): void;
  list(fn: (prev: Array<{ content: string }>) => Array<{ content: string }>): void;
  blocks(fn: (prev: Record<number, string>) => Record<number, string>): void;
};
/**
 * 등급을 결과 글 전부에 반영 — textOutput·listOutput·손으로 고친 블록(editedBlocks)의 "등급:" 줄을 같이 바꾼다.
 * 고친 블록을 통째로 지우지 않는다(GradeCheck 의 setEditedBlocks({}) 는 다른 칸 손수정까지 날린다).
 */
export function applyGradeEverywhere<T extends { content: string }>(
  grade: string,
  setTextOutput: SetState<string>,
  setListOutput: SetState<T[]>,
  setEditedBlocks: SetState<Record<number, string>>,
): void {
  setTextOutput((t) => replaceGradeLine(t, grade));
  setListOutput((list) => list.map((item) => (hasGradeLine(item.content) ? { ...item, content: replaceGradeLine(item.content, grade) } : item)));
  setEditedBlocks((blocks) => {
    const next: Record<number, string> = {};
    for (const [k, v] of Object.entries(blocks)) next[Number(k)] = replaceGradeLine(v, grade);
    return next;
  });
}
