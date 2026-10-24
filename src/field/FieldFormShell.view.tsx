/**
 * 필드 양식 겉틀(로직 없음) — "한 장의 종이": 카드 1장(UI.card) 안을 구분선(UI.section)과 글자 라벨(UI.label)로만 나눈다.
 * 2026-10-24 docs/tasks/field-form-tidy.md S6(감사 A1·A3·A5). 3중 상자·알약 라벨·칸마다 회색 바탕을 없앴다.
 * 모드 색은 카드 머리 왼쪽 띠 한 줄로만 보인다(Q3). 입력 높이는 UI.input(h-10), 매수·잔량 숫자칸만 예전 높이(Q2) — 그 칸은 패널이 직접 그린다.
 */
import type { ReactNode } from "react";
import { UI } from "../ui/card";

/** 카드 안 섹션 제목(구분선 바로 아래 작은 글자) */
export const FIELD_SECTION_TITLE = "mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400";
/** 여러 줄 입력 — UI.input 과 같은 테두리·글자·초점, 높이만 rows 로 */
export const FIELD_TEXTAREA = "w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

/** 양식 카드 1장 */
export function FieldFormCard({ label, children }: { label: string; children: ReactNode }) {
  return <section className={`mb-3 ${UI.card}`} aria-label={label}>{children}</section>;
}

/** 카드 머리(작성자·지역·구분·레벨 줄) — 왼쪽 띠 한 줄만 모드 색 */
export function FieldFormHead({ accent, className = "", children }: { accent: string; className?: string; children: ReactNode }) {
  return <div className={`border-l-4 px-4 pb-4 pt-4 lg:px-5 ${className}`} style={{ borderLeftColor: accent }}>{children}</div>;
}

/** 구분선 + (선택) 섹션 제목 */
export function FieldSection({ title, className = "", children }: { title?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`${UI.section} ${className}`}>
      {title && <div className={FIELD_SECTION_TITLE}>{title}</div>}
      {children}
    </div>
  );
}

/** 글자 라벨 + 입력 슬롯. aside 는 라벨 오른쪽에 붙는 작은 단추·설명 자리 */
export function Field({ label, aside, className = "", children }: { label: ReactNode; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-1 flex min-h-5 flex-wrap items-center gap-1.5">
        <span className={UI.label}>{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}
