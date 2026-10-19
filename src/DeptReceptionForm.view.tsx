// 부서 접수 폼의 표시 틀(로직 없음). 값·핸들러는 모두 props 로 받는다.
// props: dept(경영/운영/영업팀) · mode(기기/업체) · 검색 입력 · 후보 슬롯 · 자동 채움 미리보기 · 사람 입력 값들 · required · onSave/saving/result.
// 처리자 select 와 사내 요청자 이름 고르기는 슬롯(ReactNode)으로 받아 로직 쪽에서 PortalSelect 등을 꽂는다.
import type { ReactNode } from "react";
import { AlertCircle, Loader2, Save, Search } from "lucide-react";
import { RECEPTION_TYPE_META, type ReceptionType } from "./ReceptionTypePicker";

export type DeptReceptionFormViewProps = {
  dept: Extract<ReceptionType, "경영지원" | "운영지원" | "영업팀">;
  mode: "device" | "vendor";
  onModeChange: (mode: "device" | "vendor") => void;
  // 거래처 검색
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  searching?: boolean;
  searchError?: string;
  candidates: ReactNode;
  // 자동 채움 미리보기: [라벨, 값] 목록. null 이면 아직 고른 거래처가 없음
  preview: Array<[string, string]> | null;
  // 사람 입력
  routeOptions: string[];
  route: string;
  onRoute: (v: string) => void;
  viaSlot?: ReactNode;
  fieldOptions: string[];
  field: string;
  onField: (v: string) => void;
  fieldCustom: string;
  onFieldCustom: (v: string) => void;
  receiverName: string;
  onReceiverName: (v: string) => void;
  receiverPhone: string;
  onReceiverPhone: (v: string) => void;
  symptom: string;
  onSymptom: (v: string) => void;
  notes: string;
  onNotes: (v: string) => void;
  handlerSlot: ReactNode;
  outside: boolean;
  onOutside: (v: boolean) => void;
  contractKind?: string; // 경영지원일 때만 칩이 보인다
  onContractKind?: (v: string) => void;
  scheduledDate: string;
  onScheduledDate: (v: string) => void;
  receiverLabel?: string; // 머리 오른쪽 위 작은 글씨(예: "접수자 이민구 · CS"). 없으면 안 보임
  // 필수 점검·저장
  required: Array<[string, boolean]>;
  onSave: () => void;
  saving?: boolean;
  result?: { tone?: "ok" | "warn" | "error"; text: string } | null; // warn = 저장은 됐지만 시트 미반영·카톡 방 미정 등
};

const chip = (on: boolean) => `min-h-11 rounded-full border px-3.5 py-1.5 text-[12px] font-black transition sm:min-h-9 ${on ? "border-blue-600 bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.3)]" : "border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700"}`;
const input = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-700";
const label = "text-[11px] font-black text-slate-500";

export default function DeptReceptionFormView(p: DeptReceptionFormViewProps) {
  const meta = RECEPTION_TYPE_META[p.dept];
  const readyCount = p.required.filter(([, ok]) => ok).length;
  const isReady = readyCount === p.required.length;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label={`${p.dept} 접수`}>
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1E252F] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${meta.badge}`}>{p.dept}</span>
          <div className="text-sm font-black text-white lg:text-[15px]">접수 입력</div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <div className={`rounded-lg px-2.5 py-1 text-[11px] font-black ${isReady ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-slate-300"}`}>{readyCount}/{p.required.length} 필수 입력</div>
          {p.receiverLabel && <div className="max-w-56 truncate text-[11px] font-semibold text-slate-400">{p.receiverLabel}</div>}
        </div>
      </div>

      <div className="space-y-4 p-4 lg:p-5">
        {/* 1. 거래처 */}
        <div className="space-y-2">
          <div className="flex rounded-full bg-slate-100 p-1" role="group" aria-label="접수 방식">
            {([["device", "기기로 접수"], ["vendor", "업체로 접수"]] as const).map(([k, t]) => (
              <button key={k} type="button" aria-pressed={p.mode === k} onClick={() => p.onModeChange(k)} className={`min-h-11 flex-1 rounded-full px-3 text-[13px] font-black transition sm:min-h-9 ${p.mode === k ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"}`}>{t}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={p.query} onChange={(e) => p.onQueryChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") p.onSearch(); }}
              placeholder={p.mode === "device" ? "순 또는 자산번호·기번" : "순 또는 업체명"} aria-label="거래처 검색" className={input} />
            <button type="button" onClick={p.onSearch} disabled={p.searching} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40"><Search size={15} aria-hidden />{p.searching ? "검색 중" : "검색"}</button>
          </div>
          {p.searchError && <div role="alert" className="flex items-start gap-1.5 text-[12px] font-bold text-red-600"><AlertCircle size={14} className="mt-0.5 shrink-0" />검색하지 못했습니다. 잠시 뒤 다시 시도해 주세요. ({p.searchError})</div>}
          {p.searching && <div role="status" className="flex items-center gap-1.5 text-[12px] font-bold text-slate-500"><Loader2 size={14} className="animate-spin" />거래처를 찾는 중입니다.</div>}
          {p.candidates}
        </div>

        {/* 2. 자동 채움 미리보기 */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          {p.preview === null ? (
            <div className="text-[12px] font-bold text-slate-400">거래처를 고르시면 업체 정보가 여기에 자동으로 채워집니다.</div>
          ) : (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {p.preview.map(([k, v]) => (
                <div key={k} className="flex min-w-0 gap-2 text-[12px]">
                  <dt className="w-16 shrink-0 font-black text-slate-400">{k}</dt>
                  <dd className="min-w-0 wrap-break-word font-bold text-slate-700">{v || "-"}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-2 text-[11px] font-semibold text-slate-400">이 값은 시트에 자동으로 기입됩니다. 직접 고치지 않으셔도 됩니다.</div>
        </div>

        {/* 3. 사람 입력 */}
        <div className="space-y-3">
          <div>
            <div className={label}>접수유형 <span className="text-red-500">*</span></div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {p.routeOptions.map((r) => <button key={r} type="button" aria-pressed={p.route === r} onClick={() => p.onRoute(r)} className={chip(p.route === r)}>{r}</button>)}
            </div>
            {p.viaSlot && <div className="mt-2">{p.viaSlot}</div>}
          </div>

          <div>
            <div className={label}>접수분야 <span className="text-red-500">*</span></div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {p.fieldOptions.map((f) => <button key={f} type="button" aria-pressed={p.field === f} onClick={() => p.onField(f)} className={chip(p.field === f)}>{f}</button>)}
              <button type="button" aria-pressed={p.field === "직접입력"} onClick={() => p.onField("직접입력")} className={chip(p.field === "직접입력")}>직접 입력</button>
            </div>
            {p.field === "직접입력" && <input value={p.fieldCustom} onChange={(e) => p.onFieldCustom(e.target.value)} placeholder="접수분야를 입력해 주세요" aria-label="접수분야 직접 입력" className={`${input} mt-2`} />}
          </div>

          {p.contractKind !== undefined && p.onContractKind && (
            <div>
              <div className={label}>계약서구분</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {["전자", "수기"].map((c) => <button key={c} type="button" aria-pressed={p.contractKind === c} onClick={() => p.onContractKind?.(p.contractKind === c ? "" : c)} className={chip(p.contractKind === c)}>{c}</button>)}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={label}>업체담당자</span><input value={p.receiverName} onChange={(e) => p.onReceiverName(e.target.value)} className={`${input} mt-1`} /></label>
            <label className="block"><span className={label}>전화번호</span><input type="tel" inputMode="tel" value={p.receiverPhone} onChange={(e) => p.onReceiverPhone(e.target.value)} placeholder="010-0000-0000" className={`${input} mt-1`} /></label>
          </div>

          <label className="block"><span className={label}>접수내용 <span className="text-red-500">*</span></span>
            <textarea value={p.symptom} onChange={(e) => p.onSymptom(e.target.value)} rows={4} className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-700" />
          </label>
          <label className="block"><span className={label}>특이사항 (선택, 앱에만 저장됩니다)</span>
            <textarea value={p.notes} onChange={(e) => p.onNotes(e.target.value)} rows={2} className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-700" />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div><div className={label}>처리자</div><div className="mt-1">{p.handlerSlot}</div></div>
            <label className="block"><span className={label}>예정일 (넣으시면 부서 달력에 올라갑니다)</span><input type="date" value={p.scheduledDate} onChange={(e) => p.onScheduledDate(e.target.value)} className={`${input} mt-1`} /></label>
          </div>

          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] font-black text-slate-700">
            <input type="checkbox" checked={p.outside} onChange={(e) => p.onOutside(e.target.checked)} className="h-4 w-4" />외근 요청
          </label>
        </div>

        {/* 4. 필수 점검 + 저장 */}
        <div className="sticky bottom-2 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 pb-2 pt-3 backdrop-blur lg:mx-0">
          <div className="flex flex-wrap items-center gap-2">
            {p.required.map(([name, ok]) => (
              <span key={name} className={`rounded-full px-2.5 py-1 text-[10px] font-black ${ok ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>{ok ? "✓" : "•"} {name}</span>
            ))}
            <button type="button" onClick={p.onSave} disabled={p.saving || !isReady} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full bg-blue-600 px-5 text-sm font-black text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none">
              {p.saving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />}{p.saving ? "저장 중…" : "접수 저장"}
            </button>
          </div>
          {p.result && <div role={p.result.tone === "error" ? "alert" : "status"} className={`mt-2 text-[12px] font-black ${p.result.tone === "error" ? "text-red-600" : p.result.tone === "warn" ? "text-amber-700" : "text-emerald-600"}`}>{p.result.text}</div>}
        </div>
      </div>
    </section>
  );
}
