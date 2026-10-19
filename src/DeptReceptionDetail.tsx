// 접수리스트에서 부서 접수(경영·운영·영업지원) 행을 펼쳤을 때의 상세(설계 4-4).
// 자동값 요약 · 접수내용 · 메모 기록 · 진행상태 칩 · 처리자 · 진행 메모(영업) · 처리내용 · [처리 저장] · 처리 단추 줄 · 시트/카톡 상태.
import { useMemo, useState } from "react";
import { Loader2, RotateCw, Save } from "lucide-react";
import PortalSelect from "./PortalSelect";
import DeptActionBar from "./DeptActionBar";
import { DEPT_PROGRESS_CHIPS, DEPT_STATUSES, deptRouteLabel, isDeptType, defaultHandler } from "./deptReception";
import { isCheckConstraintError } from "./deptReceptionApi";
import { nameOptions, resolveActor, retryDeptSheetAppend, saveDeptHandlingForm, warnTone, type DeptRowLike } from "./deptReceptionFlow";
import { useMembers } from "./authors";
import { notify } from "./toast";

type Props = {
  row: DeptRowLike & { model?: string; asset_no?: string; serial?: string; report_text?: string };
  onChanged: (row: DeptRowLike) => void;
  author?: string;
};

const chip = (on: boolean) => `min-h-9 rounded-full border px-3 text-[11px] font-black transition ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-slate-400"}`;

export default function DeptReceptionDetail({ row, onChanged, author }: Props) {
  const meta = row.remote_meta || {};
  const members = useMembers();
  const [status, setStatus] = useState(row.status || "접수");
  const [handler, setHandler] = useState(meta.handler || "");
  const [progress, setProgress] = useState(meta.progress || "");
  const [handled, setHandled] = useState(meta.handled || "");
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // 다른 곳(단추·새로고침)에서 행이 바뀌면 입력칸도 따라간다
  const sig = `${row.status || ""}|${meta.handler || ""}|${meta.progress || ""}|${meta.handled || ""}`;
  const [prevSig, setPrevSig] = useState(sig);
  if (sig !== prevSig) {
    setPrevSig(sig);
    setStatus(row.status || "접수"); setHandler(meta.handler || ""); setProgress(meta.progress || ""); setHandled(meta.handled || "");
  }

  const dept = isDeptType(row.type) ? row.type : null;
  const handlerOptions = useMemo(() => {
    const extras = [handler, dept ? defaultHandler(dept, row.region || "") : "", ...(dept === "경영지원" ? ["최영지", "박지은"] : [])];
    return [{ value: "", label: "미정" }, ...nameOptions(members, extras)];
  }, [members, handler, dept, row.region]);

  const dirty = status !== (row.status || "접수") || handler !== (meta.handler || "") || handled !== (meta.handled || "") || (dept === "영업지원" && progress !== (meta.progress || ""));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveDeptHandlingForm(row, { status, handler, progress, handled }, resolveActor(author));
      onChanged(res.row);
      res.warnings.forEach((w) => notify(w, warnTone(w)));
      if (!res.warnings.some((w) => warnTone(w) === "error")) notify("처리 내용을 저장했습니다.", "success");
    } catch (e) {
      notify(isCheckConstraintError(e) ? "저장이 막혔습니다 — 관리자에게 'reception-dept-types.sql 실행 필요'를 알려 주세요." : `처리 저장 실패: ${(e as Error).message}`, "error");
    } finally { setSaving(false); }
  };

  const retrySheet = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const res = await retryDeptSheetAppend(row);
      onChanged(res.row);
      if (res.warnings.length) res.warnings.forEach((w) => notify(w, warnTone(w)));
      else notify(res.row.remote_meta?.sheet_state === "synced" ? "시트에 반영했습니다." : "시트 잡을 다시 쌓았습니다(자동 재시도).", "success");
    } catch (e) {
      notify(`다시 보내지 못했습니다: ${(e as Error).message}`, "error");
    } finally { setRetrying(false); }
  };

  const summary: Array<[string, string]> = [
    ["접수유형", deptRouteLabel(row.route || "", meta.via)],
    ["접수분야", row.field || ""],
    ["순", row.lease_no || (meta.unit === "vendor" ? "업체 단위" : "신규")],
    ["지역/등급", [row.region, row.grade].filter(Boolean).join(" / ")],
    ["업체담당자", [row.receiver_name, row.receiver_phone].filter(Boolean).join(" ")],
    ["자산/모델", [row.asset_no, row.model].filter(Boolean).join(" · ")],
    ["주소", row.address || ""],
    ["예정일", meta.schedule_date ? `${meta.schedule_date}${Number(meta.postpone_count) ? ` · 미룸 ${meta.postpone_count}` : ""}` : ""],
    ["외근", meta.outside || ""],
    ...(row.type === "경영지원" ? [["계약서", meta.contract_kind || ""] as [string, string]] : []),
    ...(meta.vendor_master_name ? [["마스터", `${meta.vendor_master_name}${meta.device_count ? ` · ${meta.device_count}대` : ""}`] as [string, string]] : []),
    ["완료", row.completed_at ? `${String(row.completed_at).slice(0, 10)}${row.completed_by ? ` · ${row.completed_by}` : ""}` : ""],
  ];

  const sheetState = meta.sheet_state || "";
  const label = "text-[11px] font-black text-slate-500";
  const field = "min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-bold text-slate-900 outline-none focus:border-slate-700";

  return (
    <div className="space-y-2.5 text-[12px] text-slate-600" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5">
        {dept !== "운영지원" && sheetState === "failed" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-black text-red-700">
            시트 미반영
            <button type="button" disabled={retrying} onClick={() => void retrySheet()} className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-white px-2 py-0.5 text-[10px] font-black text-red-700 disabled:opacity-40">
              {retrying ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <RotateCw size={11} aria-hidden />}다시 보내기
            </button>
          </span>
        )}
        {dept !== "운영지원" && sheetState === "queued" && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-500">시트 반영 대기</span>}
        {sheetState === "synced" && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">시트 {row.sheet_row ? `${row.sheet_row}행` : "반영"}{meta.sheet_seq ? ` · 순번 ${meta.sheet_seq}` : ""}</span>}
        {meta.kakao === "no_room" && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-400">카톡 방 미정</span>}
        {meta.kakao === "sent" && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-sky-700">카톡 전송</span>}
        {meta.kakao === "test" && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-500">카톡 테스트방</span>}
      </div>

      <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5 font-semibold sm:grid-cols-2">
        {summary.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex min-w-0 gap-2"><dt className="w-16 shrink-0 font-black text-slate-400">{k}</dt><dd className="min-w-0 wrap-break-word">{v}</dd></div>
        ))}
      </dl>
      {row.symptom && <div className="whitespace-pre-wrap"><b className="text-slate-500">접수내용</b> {row.symptom}</div>}
      {row.notes && <div className="whitespace-pre-wrap"><b className="text-slate-500">특이사항</b> {row.notes}</div>}
      {meta.memo_log && (
        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <div className={label}>메모 기록</div>
          <div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] font-semibold leading-5">{meta.memo_log}</div>
        </div>
      )}

      <DeptActionBar row={row} author={author} onChanged={onChanged} />

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <div>
          <div className={label}>진행상태</div>
          <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="진행상태">
            {DEPT_STATUSES.map((s) => <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={chip(status === s)}>{s}</button>)}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div><div className={label}>처리자</div><div className="mt-1"><PortalSelect value={handler} onChange={setHandler} options={handlerOptions} placeholder="처리자" width={200} className="w-full" /></div></div>
          {dept === "영업지원" && (
            <div>
              <div className={label}>진행 메모</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {DEPT_PROGRESS_CHIPS.map((c) => <button key={c} type="button" aria-pressed={progress === c} onClick={() => setProgress(progress === c ? "" : c)} className={chip(progress === c)}>{c}</button>)}
              </div>
              <input value={DEPT_PROGRESS_CHIPS.includes(progress as (typeof DEPT_PROGRESS_CHIPS)[number]) ? "" : progress} onChange={(e) => setProgress(e.target.value)} placeholder="직접 입력" aria-label="진행 메모 직접 입력" className={`${field} mt-1`} />
            </div>
          )}
        </div>
        <label className="block"><span className={label}>처리내용</span>
          <textarea value={handled} onChange={(e) => setHandled(e.target.value)} rows={2} className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-[13px] font-bold text-slate-900 outline-none focus:border-slate-700" />
        </label>
        <div className="flex justify-end">
          <button type="button" disabled={saving || !dirty} onClick={() => void save()} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-[12px] font-black text-white transition hover:bg-blue-700 disabled:opacity-40 sm:min-h-9">
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Save size={14} aria-hidden />}{saving ? "저장 중…" : "처리 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
