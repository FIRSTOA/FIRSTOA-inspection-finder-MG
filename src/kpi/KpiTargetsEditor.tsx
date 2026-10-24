/**
 * 관리 탭 — 홈 KPI 목표(app_config KPI_TARGETS) 양식형 편집기(2026-10-24).
 * 표에서 숫자·주요 목표·휴일을 고치면 kpiTargetsForm.serializeForm 이 같은 JSON 으로 바꿔 SystemAdmin 의 saveConfig 로 저장한다.
 * 저장 전 parseKpiTargets 로 한 번 더 검증. 아래 "고급: JSON 직접 편집"에 예전 글칸을 그대로 둔다.
 */
import { useMemo, useState } from "react";
import { askConfirm } from "../confirmModal";
import { notify } from "../toast";
import { invalidateConfigCaches } from "../supabase";
import { defaultKpiTargets, KPI_DEFS, KPI_TARGETS_CONFIG_KEY, parseKpiTargets } from "./kpiDefs";
import { fieldsFor, FIELD_LABEL, formFromJson, serializeForm, type KpiForm, type NumField } from "./kpiTargetsForm";

type Props = { value: string; busy: boolean; onSave: (key: string, value: string) => Promise<void> };

const inputCls = "min-h-11 w-24 rounded-lg border px-2 text-sm font-bold outline-none transition focus:ring-4";
const okBorder = "border-slate-300 focus:border-blue-500 focus:ring-blue-500/10";
const badBorder = "border-rose-400 bg-rose-50 focus:ring-rose-500/10";

export default function KpiTargetsEditor({ value, busy, onSave }: Props) {
  const [form, setForm] = useState<KpiForm>(() => formFromJson(value));
  const [newHoliday, setNewHoliday] = useState("");
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  const defaults = useMemo(() => defaultKpiTargets(), []);
  const result = useMemo(() => serializeForm(form), [form]);
  const errSet = useMemo(() => new Set(result.errors), [result.errors]);
  const changed = result.json !== serializeForm(formFromJson(value)).json;

  const jsonCheck = useMemo(() => parseKpiTargets(draft), [draft]);
  const jsonBroken = /JSON 이 아닙니다|모양이어야/.test(jsonCheck.error);
  const jsonChanged = draft.trim() !== value.trim();

  const setNum = (id: string, f: NumField, v: string) =>
    setForm((p) => ({ ...p, rows: { ...p.rows, [id]: { ...p.rows[id], nums: { ...p.rows[id].nums, [f]: v } } } }));
  const setMain = (id: string, main: boolean) =>
    setForm((p) => ({ ...p, rows: { ...p.rows, [id]: { ...p.rows[id], main } } }));
  const addHoliday = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newHoliday)) { notify("날짜를 골라 주세요", "error"); return; }
    setForm((p) => ({ ...p, holidays: [...new Set([...p.holidays, newHoliday])].sort() }));
    setNewHoliday("");
  };

  const finishSave = async (text: string) => {
    await onSave(KPI_TARGETS_CONFIG_KEY, text);
    invalidateConfigCaches(); // 홈이 다음 갱신 때 새 목표를 읽게
    setSaved(true);
  };

  const saveForm = async () => {
    if (result.errors.length) { notify(`저장하지 않았습니다 — 빨간 칸을 고쳐 주세요 (${result.errors.join(", ")})`, "error"); return; }
    const check = parseKpiTargets(result.json);
    if (check.error) { notify(`저장하지 않았습니다 — ${check.error}`, "error"); return; }
    await finishSave(result.json);
  };

  const saveJson = async () => {
    if (jsonBroken) { notify(`저장하지 않았습니다 — ${jsonCheck.error}`, "error"); return; }
    if (jsonCheck.error && !(await askConfirm(`${jsonCheck.error}\n\n이 값들은 홈에서 무시됩니다. 그래도 저장할까요?`, { okLabel: "저장" }))) return;
    await finishSave(draft.trim());
  };

  return (
    <div className="px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-slate-900">홈 KPI 목표</span>
            <span className="font-mono text-[10px] font-bold text-slate-300">{KPI_TARGETS_CONFIG_KEY}</span>
          </div>
          <p className="mt-0.5 text-[11px] font-semibold leading-4 text-slate-400">
            숫자를 고치고 [저장]을 누르세요. 칸을 비우면 기본값입니다. 기본값과 같은 칸은 따로 저장하지 않습니다.
          </p>
        </div>
        <button type="button" onClick={() => void saveForm()} disabled={busy || !changed || result.errors.length > 0}
          className="min-h-11 shrink-0 rounded-full bg-blue-600 px-5 text-xs font-black text-white transition hover:bg-blue-500 disabled:opacity-40">
          {busy ? "저장 중…" : "저장"}
        </button>
      </div>
      {saved && !busy && <p role="status" className="mt-1 text-[11px] font-bold text-emerald-700">저장했습니다. 홈 달성표는 다음 갱신(최대 5분) 때 반영됩니다.</p>}
      {result.errors.length > 0 && <p role="alert" className="mt-1 text-[11px] font-bold text-rose-600">고쳐야 할 칸이 있습니다 — 0 이상의 숫자만 넣을 수 있습니다.</p>}

      <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {KPI_DEFS.map((d) => {
          const row = form.rows[d.id];
          const fields = fieldsFor(d, row);
          const def = defaults[d.id];
          return (
            <li key={d.id} className="px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-[10px] font-black text-slate-400">{d.id}</span>{" "}
                  <span className="text-[13px] font-black text-slate-900">{d.name}</span>
                  <span className="ml-1 text-[10px] font-semibold text-slate-400">{d.unit}</span>
                </div>
                <label className="flex min-h-11 items-center gap-1.5 text-[11px] font-black text-slate-600">
                  <input type="checkbox" checked={row.main} onChange={(e) => setMain(d.id, e.target.checked)} className="size-4" />
                  주요 목표{def.main ? " (기본 포함)" : ""}
                </label>
              </div>
              {fields.length === 0 ? (
                <p className="text-[10.5px] font-semibold text-slate-400">목표 숫자 없음(실적만 보여 줍니다)</p>
              ) : (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {fields.map((f) => (
                    <label key={f} className="flex flex-col text-[10.5px] font-bold text-slate-500">
                      {FIELD_LABEL[f]}
                      <input type="number" inputMode="decimal" min={0} step="any" value={row.nums[f]}
                        onChange={(e) => setNum(d.id, f, e.target.value)}
                        aria-invalid={errSet.has(`${d.id}.${f}`) || undefined}
                        placeholder={def[f] !== undefined ? String(def[f]) : "없음"}
                        className={`${inputCls} ${errSet.has(`${d.id}.${f}`) ? badBorder : okBorder}`} />
                      <span className="text-[10px] font-semibold text-slate-400">기본 {def[f] !== undefined ? def[f] : "없음"}</span>
                    </label>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3">
        <div className="text-[13px] font-black text-slate-900">추가 휴일 <span className="text-[10px] font-semibold text-slate-400">영업일 계산에서 뺄 회사 휴무일(공휴일은 자동)</span></div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {form.holidays.length === 0 && <span className="text-[11px] font-semibold text-slate-400">없음</span>}
          {form.holidays.map((h) => (
            <span key={h} className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-[11px] font-black ${errSet.has(`holidays.${h}`) ? "border-rose-400 bg-rose-50 text-rose-700" : "border-slate-300 bg-white text-slate-700"}`}>
              {h}
              <button type="button" aria-label={`${h} 삭제`} onClick={() => setForm((p) => ({ ...p, holidays: p.holidays.filter((x) => x !== h) }))}
                className="flex min-h-11 min-w-8 items-center justify-center text-slate-400 hover:text-rose-600">✕</button>
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} aria-label="추가할 휴일"
            className="min-h-11 rounded-lg border border-slate-300 px-2 text-sm font-bold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <button type="button" onClick={addHoliday}
            className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-[11px] font-black text-slate-600 hover:bg-slate-50">추가</button>
        </div>
      </div>

      <details className="mt-3 rounded-lg border border-slate-200 px-3 py-2">
        <summary className="min-h-11 cursor-pointer text-[12px] font-black text-slate-600">고급: JSON 직접 편집</summary>
        <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-400">
          {`예: {"K10":{"perTeamMonth":2},"K8":{"main":true},"holidays":["2026-12-31"]}`} · 여기서 저장하면 위 양식도 새로 불러옵니다.
        </p>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} rows={4} aria-label="KPI_TARGETS JSON"
          aria-invalid={jsonBroken || undefined}
          className={`mt-2 w-full rounded-lg border px-3 py-2 font-mono text-[12px] outline-none transition focus:ring-4 ${jsonBroken ? "border-rose-400 focus:ring-rose-500/10" : "border-slate-300 focus:border-blue-500 focus:ring-blue-500/10"}`} />
        {jsonCheck.error
          ? <p role="alert" className={`mt-1 text-[11px] font-bold ${jsonBroken ? "text-rose-600" : "text-amber-700"}`}>{jsonCheck.error}</p>
          : draft.trim() ? <p className="mt-1 text-[11px] font-bold text-emerald-700">형식 정상</p> : null}
        <button type="button" onClick={() => void saveJson()} disabled={busy || !jsonChanged}
          className="mt-2 min-h-11 rounded-full bg-slate-700 px-4 text-[11px] font-black text-white transition hover:bg-slate-600 disabled:opacity-40">
          {busy ? "저장 중…" : "JSON 저장"}
        </button>
      </details>
    </div>
  );
}
