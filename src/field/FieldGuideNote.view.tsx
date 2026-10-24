/**
 * 필드 탭 모드 안내 한 줄(로직 없음) — UI.note("info") 한 줄, 자세한 설명은 [자세히]를 눌러 펼친다.
 * 2026-10-24 docs/tasks/field-form-tidy.md S7(감사 A2): 예전 큰 회색 상자(rounded-2xl bg-slate-50 p-4) 대신.
 */
import { UI } from "../ui/card";

export function FieldGuideNote({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <details className={`group ${UI.note("info")}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 text-[11px] font-semibold text-blue-500 group-open:hidden">자세히</span>
        <span className="hidden shrink-0 text-[11px] font-semibold text-blue-500 group-open:inline">접기</span>
      </summary>
      <div className="mt-1.5 text-[12px] font-semibold leading-5 text-blue-900/70">{description}</div>
    </details>
  );
}
