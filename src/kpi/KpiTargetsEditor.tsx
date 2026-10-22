/**
 * 관리 탭 — 홈 KPI 목표(app_config KPI_TARGETS, JSON) 편집 칸(2026-10-23, 설계안 3절 7 · Q13).
 * 비워 두면 기본 목표(docs/okr/2026-Q4-okr.json·사용자 지시에서 옮긴 값). 형식은 kpiDefs.parseKpiTargets 가 읽는 그대로:
 *   {"K7":{"perPersonBizDay":1,"main":true},"K10":{"perTeamMonth":2},"holidays":["2026-12-31"]}
 * 저장 전 같은 함수로 검사해 "JSON 아님"은 막고, "무시될 값"은 확인을 받는다. 저장은 SystemAdmin 의 saveConfig(래퍼) 그대로.
 */
import { useMemo, useState } from "react";
import { askConfirm } from "../confirmModal";
import { notify } from "../toast";
import { invalidateConfigCaches } from "../supabase";
import { defaultKpiTargets, KPI_BY_ID, KPI_DEFS, KPI_TARGETS_CONFIG_KEY, parseKpiTargets } from "./kpiDefs";

type Props = { value: string; busy: boolean; onSave: (key: string, value: string) => Promise<void> };

/** 기본값 보기용 — 숫자 칸·main 이 있는 것만 */
function defaultsText(): string {
  const d = defaultKpiTargets();
  const out: Record<string, unknown> = {};
  for (const def of KPI_DEFS) {
    const t = d[def.id];
    if (Object.keys(t).some((k) => k !== "main") || t.main) out[def.id] = t;
  }
  return JSON.stringify(out, null, 1);
}

export default function KpiTargetsEditor({ value, busy, onSave }: Props) {
  const [draft, setDraft] = useState(value);
  const [showDefaults, setShowDefaults] = useState(false);
  const check = useMemo(() => parseKpiTargets(draft), [draft]);
  const jsonBroken = /JSON 이 아닙니다|모양이어야/.test(check.error);
  const changed = draft.trim() !== value.trim();

  const save = async () => {
    if (jsonBroken) { notify(`저장하지 않았습니다 — ${check.error}`, "error"); return; }
    if (check.error && !(await askConfirm(`${check.error}\n\n이 값들은 홈에서 무시됩니다. 그래도 저장할까요?`, { okLabel: "저장" }))) return;
    await onSave(KPI_TARGETS_CONFIG_KEY, draft.trim());
    invalidateConfigCaches(); // 홈이 다음 갱신 때 새 목표를 읽게
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
            홈 KPI 현황판의 목표·주요 목표를 바꿉니다. 비워 두면 기본 목표. 칸: perPersonWeek(인당 주) · perPersonBizDay(인당 영업일) · perTeamMonth(파트 월) · perPersonMonth(인당 월) · monthTotal · quarterTotal · value(비율 %) · main(주요 목표 보기에 넣기 true/false) · holidays(영업일에서 뺄 날 ["YYYY-MM-DD"]).
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => setShowDefaults((o) => !o)} aria-expanded={showDefaults}
            className="min-h-11 rounded-full border border-slate-300 bg-white px-3.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-50">
            {showDefaults ? "기본값 닫기" : "기본값 보기"}
          </button>
          <button type="button" onClick={() => void save()} disabled={busy || !changed}
            className="min-h-11 rounded-full bg-blue-600 px-4 text-[11px] font-black text-white transition hover:bg-blue-500 disabled:opacity-40">
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={4}
        placeholder='{"K10":{"perTeamMonth":2,"perPersonMonth":1},"K8":{"main":true},"holidays":["2026-12-31"]}'
        aria-label="KPI_TARGETS JSON"
        aria-invalid={jsonBroken || undefined}
        className={`mt-2 w-full rounded-lg border px-3 py-2 font-mono text-[12px] outline-none transition focus:ring-4 ${jsonBroken ? "border-rose-400 focus:ring-rose-500/10" : "border-slate-300 focus:border-blue-500 focus:ring-blue-500/10"}`}
      />
      {check.error
        ? <p role="alert" className={`mt-1 text-[11px] font-bold ${jsonBroken ? "text-rose-600" : "text-amber-700"}`}>{check.error}</p>
        : draft.trim() ? <p className="mt-1 text-[11px] font-bold text-emerald-700">형식 정상 · 주요 목표 {KPI_DEFS.filter((d) => check.targets[d.id]?.main).length}개{check.holidays.length ? ` · 추가 휴일 ${check.holidays.length}일` : ""}</p> : null}
      {showDefaults && (
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-2.5 font-mono text-[10.5px] leading-4 text-slate-700">{defaultsText()}</pre>
          <ul className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-2.5 text-[10.5px] font-semibold leading-4 text-slate-600">
            {KPI_DEFS.map((d) => <li key={d.id}><span className="font-mono font-black text-slate-800">{d.id}</span> {KPI_BY_ID[d.id].name} <span className="text-slate-400">({d.target?.from || "목표 없음 — 실적만"})</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
