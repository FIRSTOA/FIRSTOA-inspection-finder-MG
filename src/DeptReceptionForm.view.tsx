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

// 공통 토큰: 컨트롤 rounded-lg · 테두리 slate-200 한 겹 · 입력 40px · 라벨 11px. 선택지는 칩 대신 한 줄 분할 막대(h-9).
const seg = (on: boolean) => `whitespace-nowrap px-3 text-[12px] font-bold transition ${on ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-blue-700"}`;
const segBar = "flex h-9 w-max divide-x divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white";
const segScroll = "mt-1 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const input = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";
const area = "mt-1 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";
const label = "text-[11px] font-semibold text-slate-500";
const section = "text-[11px] font-bold uppercase tracking-wider text-slate-400";

export default function DeptReceptionFormView(p: DeptReceptionFormViewProps) {
  const meta = RECEPTION_TYPE_META[p.dept];
  const readyCount = p.required.filter(([, ok]) => ok).length;
  const isReady = readyCount === p.required.length;
  return (
    // 한 장의 종이: 거래처 선택 + 접수 내용 입력 — 어두운 머리띠 없이 작은 섹션 라벨과 구분선으로만 나눈다
    <section className="rounded-xl border border-slate-200 bg-white" aria-label={`${p.dept} 접수`}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 lg:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.badge}`}><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{p.dept}</span>
          <span className={section}>거래처 선택</span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <div className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${isReady ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{readyCount}/{p.required.length} 필수 입력</div>
          {p.receiverLabel && <div className="max-w-56 truncate text-[11px] font-medium text-slate-400">{p.receiverLabel}</div>}
        </div>
      </div>

      {/* 1. 거래처: 큰 검색창 하나 + 오른쪽 끝 접수 방식 토글, 검색 단추는 창 안에 */}
      <div className="space-y-2 px-4 pb-4 pt-2.5 lg:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <input value={p.query} onChange={(e) => p.onQueryChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") p.onSearch(); }}
              placeholder={p.mode === "device" ? "순 또는 자산번호·기번" : "순 또는 업체명"} aria-label="거래처 검색" className={`${input} pr-24`} />
            <button type="button" onClick={p.onSearch} disabled={p.searching} className="absolute right-1 top-1 inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-[12px] font-bold text-white transition hover:bg-blue-700 disabled:opacity-40"><Search size={14} aria-hidden />{p.searching ? "검색 중" : "검색"}</button>
          </div>
          <div className="flex h-9 shrink-0 divide-x divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white" role="group" aria-label="접수 방식">
            {([["device", "기기로 접수"], ["vendor", "업체로 접수"]] as const).map(([k, t]) => (
              <button key={k} type="button" aria-pressed={p.mode === k} onClick={() => p.onModeChange(k)} className={`whitespace-nowrap px-3 text-[12px] font-bold transition ${p.mode === k ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}>{t}</button>
            ))}
          </div>
        </div>
        {p.searchError && <div role="alert" className="flex items-start gap-1.5 text-[12px] font-bold text-red-600"><AlertCircle size={14} className="mt-0.5 shrink-0" />검색하지 못했습니다. 잠시 뒤 다시 시도해 주세요. ({p.searchError})</div>}
        {p.searching && <div role="status" className="flex items-center gap-1.5 text-[12px] font-bold text-slate-500"><Loader2 size={14} className="animate-spin" />거래처를 찾는 중입니다.</div>}
        {p.candidates}

        {/* 2. 자동 채움 요약 — 상자 대신 옅은 바탕 한 장 */}
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          {p.preview === null ? (
            <div className="text-[12px] font-medium text-slate-400">거래처를 고르시면 업체 정보가 여기에 자동으로 채워집니다.</div>
          ) : (
            <dl className="flex flex-wrap gap-x-3 gap-y-0.5">
              {p.preview.map(([k, v]) => (
                <div key={k} className="flex min-w-0 items-baseline gap-1">
                  <dt className="shrink-0 text-[11px] font-medium text-slate-400">{k}</dt>
                  <dd className="min-w-0 wrap-break-word text-[12px] font-bold text-slate-800">{v || "-"}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-1 text-[11px] font-medium text-slate-400">이 값은 시트에 자동으로 기입됩니다. 직접 고치지 않으셔도 됩니다.</div>
        </div>
      </div>

      <div className="mx-4 border-t border-slate-100 lg:mx-5" />

      {/* 3. 사람 입력 */}
      <div className="px-4 pb-4 pt-4 lg:px-5 lg:pb-5">
        <div className={section}>접수 내용 입력</div>
        <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2">
            <div className={label}>접수유형 <span className="text-red-500">*</span></div>
            <div className={segScroll}>
              <div className={segBar}>
                {p.routeOptions.map((r) => <button key={r} type="button" aria-pressed={p.route === r} onClick={() => p.onRoute(r)} className={seg(p.route === r)}>{r}</button>)}
              </div>
            </div>
            {p.viaSlot && <div className="mt-2">{p.viaSlot}</div>}
          </div>

          <div className="min-w-0 sm:col-span-2">
            <div className={label}>접수분야 <span className="text-red-500">*</span></div>
            <div className={segScroll}>
              <div className={segBar}>
                {p.fieldOptions.map((f) => <button key={f} type="button" aria-pressed={p.field === f} onClick={() => p.onField(f)} className={seg(p.field === f)}>{f}</button>)}
                <button type="button" aria-pressed={p.field === "직접입력"} onClick={() => p.onField("직접입력")} className={seg(p.field === "직접입력")}>직접 입력</button>
              </div>
            </div>
            {p.field === "직접입력" && <input value={p.fieldCustom} onChange={(e) => p.onFieldCustom(e.target.value)} placeholder="접수분야를 입력해 주세요" aria-label="접수분야 직접 입력" className={`${input} mt-2`} />}
          </div>

          {p.contractKind !== undefined && p.onContractKind && (
            <div className="min-w-0 sm:col-span-2">
              <div className={label}>계약서구분</div>
              <div className={segScroll}>
                <div className={segBar}>
                  {["전자", "수기"].map((c) => <button key={c} type="button" aria-pressed={p.contractKind === c} onClick={() => p.onContractKind?.(p.contractKind === c ? "" : c)} className={seg(p.contractKind === c)}>{c}</button>)}
                </div>
              </div>
            </div>
          )}

          <label className="block"><span className={label}>업체담당자</span><input value={p.receiverName} onChange={(e) => p.onReceiverName(e.target.value)} className={`${input} mt-1`} /></label>
          <label className="block"><span className={label}>전화번호</span><input type="tel" inputMode="tel" value={p.receiverPhone} onChange={(e) => p.onReceiverPhone(e.target.value)} placeholder="010-0000-0000" className={`${input} mt-1`} /></label>

          <label className="block sm:col-span-2"><span className={label}>접수내용 <span className="text-red-500">*</span></span>
            <textarea value={p.symptom} onChange={(e) => p.onSymptom(e.target.value)} rows={4} className={area} />
          </label>
          <label className="block sm:col-span-2"><span className={label}>특이사항 (선택, 앱에만 저장됩니다)</span>
            <textarea value={p.notes} onChange={(e) => p.onNotes(e.target.value)} rows={2} className={area} />
          </label>

          <div><div className={label}>처리자</div><div className="mt-1">{p.handlerSlot}</div></div>
          <label className="block"><span className={label}>예정일 (넣으시면 부서 달력에 올라갑니다)</span><input type="date" value={p.scheduledDate} onChange={(e) => p.onScheduledDate(e.target.value)} className={`${input} mt-1`} /></label>

          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[13px] font-semibold text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={p.outside} onChange={(e) => p.onOutside(e.target.checked)} className="h-4 w-4 accent-blue-600" />외근 요청
          </label>
        </div>

        {/* 4. 필수 점검 + 저장 — 카드 하단에 붙는 얇은 띠 */}
        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-4 rounded-b-xl border-t border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:-mx-5 lg:-mb-5 lg:px-5">
          <div className="flex flex-wrap items-center gap-2">
            {p.required.map(([name, ok]) => (
              <span key={name} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ok ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>{ok ? "✓" : "•"} {name}</span>
            ))}
            <button type="button" onClick={p.onSave} disabled={p.saving || !isReady} className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-[13px] font-bold text-white transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40">
              {p.saving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />}{p.saving ? "저장 중…" : "접수 저장"}
            </button>
          </div>
          {p.result && <div role={p.result.tone === "error" ? "alert" : "status"} className={`mt-1.5 text-[12px] font-bold ${p.result.tone === "error" ? "text-red-600" : p.result.tone === "warn" ? "text-amber-700" : "text-emerald-600"}`}>{p.result.text}</div>}
        </div>
      </div>
    </section>
  );
}
