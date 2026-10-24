/**
 * KPI 목표 양식 ↔ KPI_TARGETS JSON 변환(순수 로직, 2026-10-24). 화면은 KpiTargetsEditor.tsx.
 * 직렬화는 기본값과 다른 칸만 적는다(기본값과 같으면 JSON 에서 뺀다 → 기본값이 나중에 바뀌어도 따라감).
 */
import { defaultKpiTargets, KPI_DEFS, parseKpiTargets, type KpiDef, type KpiTarget } from "./kpiDefs";

export type NumField = Exclude<keyof KpiTarget, "main">;
export const NUM_FIELD_LIST: NumField[] = ["value", "perPersonWeek", "perPersonBizDay", "perTeamMonth", "perPersonMonth", "monthTotal", "quarterTotal"];

export const FIELD_LABEL: Record<NumField, string> = {
  perPersonWeek: "인당 · 주",
  perPersonBizDay: "인당 · 영업일",
  perTeamMonth: "파트(팀)당 · 월",
  perPersonMonth: "인당 · 월",
  monthTotal: "전체 · 월",
  quarterTotal: "전체 · 분기",
  value: "비율 %",
};

export type KpiFormRow = { nums: Record<NumField, string>; main: boolean };
export type KpiForm = { rows: Record<string, KpiFormRow>; holidays: string[] };

function emptyNums(): Record<NumField, string> {
  return { value: "", perPersonWeek: "", perPersonBizDay: "", perTeamMonth: "", perPersonMonth: "", monthTotal: "", quarterTotal: "" };
}

/** 지표별로 화면에 보일 숫자 칸 — 목표 방식에 맞는 칸 + 지금 값이 이미 있는 칸 */
export function fieldsFor(def: KpiDef, row: KpiFormRow): NumField[] {
  const base: NumField[] =
    def.targetBasis === "perPersonWeek" ? ["perPersonWeek"]
    : def.targetBasis === "perPersonBizDay" ? ["perPersonBizDay"]
    : def.targetBasis === "perTeamMonth" ? ["perTeamMonth", "perPersonMonth", "monthTotal", "quarterTotal"]
    : def.targetBasis === "ratio" ? ["value"]
    : [];
  return NUM_FIELD_LIST.filter((f) => base.includes(f) || row.nums[f] !== "");
}

/** 저장된 JSON 문자열(비면 기본) → 양식 상태. 이상한 값은 parseKpiTargets 가 이미 걸러 기본값으로 둔다 */
export function formFromJson(raw: string | null | undefined): KpiForm {
  const s = parseKpiTargets(raw);
  const rows: Record<string, KpiFormRow> = {};
  for (const d of KPI_DEFS) {
    const t = s.targets[d.id];
    const nums = emptyNums();
    for (const f of NUM_FIELD_LIST) if (t[f] !== undefined) nums[f] = String(t[f]);
    rows[d.id] = { nums, main: !!t.main };
  }
  return { rows, holidays: [...new Set(s.holidays)].sort() };
}

export type SerializeResult = { json: string; errors: string[] };

/** 양식 → JSON. errors 는 "K7.perPersonBizDay"·"holidays.2026-1-1" 꼴(빨간 테두리 키). errors 가 있으면 저장하지 않는다 */
export function serializeForm(form: KpiForm): SerializeResult {
  const defaults = defaultKpiTargets();
  const errors: string[] = [];
  const out: Record<string, unknown> = {};
  for (const d of KPI_DEFS) {
    const row = form.rows[d.id];
    if (!row) continue;
    const def = defaults[d.id];
    const diff: Record<string, number | boolean> = {};
    for (const f of NUM_FIELD_LIST) {
      const s = row.nums[f].trim();
      if (s === "") continue; // 비움 = 기본값(기본값도 없으면 목표 없음)
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) { errors.push(`${d.id}.${f}`); continue; }
      if (n !== def[f]) diff[f] = n;
    }
    if (row.main !== !!def.main) diff.main = row.main;
    if (Object.keys(diff).length) out[d.id] = diff;
  }
  const hol: string[] = [];
  for (const h of form.holidays) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(h) && !Number.isNaN(Date.parse(h))) hol.push(h); else errors.push(`holidays.${h}`);
  }
  if (hol.length) out.holidays = [...new Set(hol)].sort();
  return { json: Object.keys(out).length ? JSON.stringify(out) : "", errors };
}
