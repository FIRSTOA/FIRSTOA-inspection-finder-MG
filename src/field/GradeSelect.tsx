/**
 * 점검·AS 양식 윗줄 [등급] — N·NN·S·SS·V + "직접 입력…"(고르면 아래 글 칸이 열린다, 예: 유지보수).
 * 값은 결과 글의 "등급:" 줄(gradeField.ts) — 미리보기에서 고쳐도 여기 같이 보인다.
 * 글 칸은 머리 줄 아래 한 줄 전체로 그린다(폰 4.5rem 칸 안에는 글자가 안 들어간다) — 그래서 칸과 글 칸을 따로 내보낸다.
 */
import { useEffect, useRef } from "react";
import { UI } from "../ui/card";
import { NumSelect } from "./NumSelect";
import { GRADE_SELECT_LABELS, GRADE_SELECT_OPTIONS, gradeChoice, gradeFromSelect } from "./gradeField";

export function GradeSelect({ value, onChange, onCustom, accent }: { value: string; onChange: (v: string) => void; onCustom: () => void; accent: string }) {
  const choice = gradeChoice(value);
  return (
    <NumSelect
      value={choice.select}
      onChange={(opt) => { const g = gradeFromSelect(opt); if (g === null) onCustom(); else onChange(g); }}
      options={GRADE_SELECT_OPTIONS}
      labels={GRADE_SELECT_LABELS}
      placeholder="-"
      accent={accent}
    />
  );
}

export function GradeCustomInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="등급 직접 입력 (예: 유지보수)"
      aria-label="등급 직접 입력"
      className={UI.input}
    />
  );
}
