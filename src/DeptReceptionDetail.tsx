// 접수리스트에서 부서 접수(경영·운영·영업팀) 행을 펼쳤을 때의 상세(설계 4-4).
// 자동값 요약 · 접수내용 · 메모 기록 · 진행상태 칩 · 처리자 · 진행 메모(영업) · 처리내용 · [처리 저장] · 처리 단추 줄 · 시트/카톡 상태.
import { useMemo, useState } from "react";
import { Loader2, Pencil, RotateCw, Save, Trash2 } from "lucide-react";
import PortalSelect from "./PortalSelect";
import DeptActionBar from "./DeptActionBar";
import { DEPT_FIELD_CHIPS, DEPT_PROGRESS_CHIPS, DEPT_STATUSES, deptRouteLabel, isDeptType, defaultHandler } from "./deptReception";
import { isCheckConstraintError } from "./deptReceptionApi";
import {
  deleteDeptReception, formatPhone, nameOptions, resolveActor, retryDeptSheetAppend, saveDeptHandlingForm, saveDeptReceptionEdit, warnTone,
  type DeptEditForm, type DeptRowLike,
} from "./deptReceptionFlow";
import { askConfirm } from "./confirmModal";
import { useMembers } from "./authors";
import { notify } from "./toast";

type Props = {
  row: DeptRowLike & { model?: string; asset_no?: string; serial?: string; report_text?: string };
  onChanged: (row: DeptRowLike) => void;
  /** [삭제] 뒤 — 목록에서 빼고 현황판을 다시 읽는다. 없으면 onChanged 만 부른다 */
  onDeleted?: (id: string) => void;
  author?: string;
};

const chip = (on: boolean) => `min-h-9 rounded-full border px-3 text-[11px] font-black transition ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-slate-400"}`;

export default function DeptReceptionDetail({ row, onChanged, onDeleted, author }: Props) {
  const meta = row.remote_meta || {};
  const members = useMembers();
  const [status, setStatus] = useState(row.status || "접수");
  const [handler, setHandler] = useState(meta.handler || "");
  const [progress, setProgress] = useState(meta.progress || "");
  const [handled, setHandled] = useState(meta.handled || "");
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // [수정] 모드 — 접수분야·접수내용·업체담당자·전화·특이사항·예정일(거래처는 삭제 후 다시 접수)
  const [edit, setEdit] = useState<DeptEditForm | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const dirty = status !== (row.status || "접수") || handler !== (meta.handler || "") || handled !== (meta.handled || "") || (dept === "영업팀" && progress !== (meta.progress || ""));

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

  const openEdit = () => setEdit({
    field: row.field || "", symptom: row.symptom || "", receiver_name: row.receiver_name || "",
    receiver_phone: row.receiver_phone || "", notes: row.notes || "", schedule_date: meta.schedule_date || "",
  });
  const saveEdit = async () => {
    if (!edit || editing) return;
    setEditing(true);
    try {
      const res = await saveDeptReceptionEdit(row, edit);
      onChanged(res.row);
      setEdit(null);
      res.warnings.forEach((w) => notify(w, warnTone(w)));
      if (!res.warnings.some((w) => warnTone(w) === "error")) notify("접수를 수정했습니다.", "success");
    } catch (e) {
      notify(`접수 수정 실패: ${(e as Error).message}`, "error");
    } finally { setEditing(false); }
  };
  const remove = async () => {
    if (deleting) return;
    const ok = await askConfirm(`${row.vendor || "이 접수"} 건을 삭제할까요? (잘못 접수된 건 정리용)\n부서 달력 일정도 함께 지웁니다. 이미 기입된 시트 행은 남습니다.`, { danger: true, okLabel: "삭제" });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await deleteDeptReception(row);
      res.warnings.forEach((w) => notify(w, warnTone(w)));
      if (!res.warnings.length) notify("접수를 삭제했습니다.", "success");
      if (onDeleted) onDeleted(row.id); else onChanged(row);
    } catch (e) {
      notify(`접수 삭제 실패: ${(e as Error).message}`, "error");
    } finally { setDeleting(false); }
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
  const fieldChips: readonly string[] = dept ? DEPT_FIELD_CHIPS[dept] : [];
  const textArea ="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-[13px] font-bold text-slate-900 outline-none focus:border-slate-700";

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
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={() => (edit ? setEdit(null) : openEdit())} aria-pressed={!!edit}
            className="inline-flex min-h-9 items-center gap-1 rounded-full border border-slate-300 bg-white px-3 text-[11px] font-black text-slate-600 hover:bg-slate-50"><Pencil size={12} aria-hidden />{edit ? "수정 닫기" : "수정"}</button>
          <button type="button" disabled={deleting} onClick={() => void remove()}
            className="inline-flex min-h-9 items-center gap-1 rounded-full border border-rose-200 bg-white px-3 text-[11px] font-black text-rose-600 hover:bg-rose-50 disabled:opacity-40">{deleting ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Trash2 size={12} aria-hidden />}삭제</button>
        </span>
      </div>

      {edit && (
        <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3">
          <div className="text-[11px] font-bold text-slate-500">접수 수정 · 거래처를 바꾸려면 이 접수를 삭제하고 다시 접수해 주세요.</div>
          <div>
            <div className={label}>접수분야 <span className="text-red-500">*</span></div>
            <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="접수분야">
              {fieldChips.map((f) => <button key={f} type="button" aria-pressed={edit.field === f} onClick={() => setEdit({ ...edit, field: f })} className={chip(edit.field === f)}>{f}</button>)}
            </div>
            <input value={fieldChips.includes(edit.field) ? "" : edit.field} onChange={(e) => setEdit({ ...edit, field: e.target.value })}
              placeholder="직접 입력" aria-label="접수분야 직접 입력" className={`${field} mt-1`} />
          </div>
          <label className="block"><span className={label}>접수내용 <span className="text-red-500">*</span></span>
            <textarea value={edit.symptom} onChange={(e) => setEdit({ ...edit, symptom: e.target.value })} rows={3} className={textArea} />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block"><span className={label}>업체담당자</span><input value={edit.receiver_name} onChange={(e) => setEdit({ ...edit, receiver_name: e.target.value })} className={`${field} mt-1`} /></label>
            <label className="block"><span className={label}>전화번호</span><input type="tel" inputMode="tel" value={edit.receiver_phone} onChange={(e) => setEdit({ ...edit, receiver_phone: formatPhone(e.target.value) })} className={`${field} mt-1`} /></label>
          </div>
          <label className="block"><span className={label}>특이사항</span>
            <textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} rows={2} className={textArea} />
          </label>
          <label className="block"><span className={label}>예정일 (비우면 부서 달력 일정도 지웁니다)</span>
            <input type="date" value={edit.schedule_date} onChange={(e) => setEdit({ ...edit, schedule_date: e.target.value })} className={`${field} mt-1`} />
          </label>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setEdit(null)} className="inline-flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-4 text-[12px] font-black text-slate-600 sm:min-h-9">취소</button>
            <button type="button" disabled={editing || !edit.field.trim() || !edit.symptom.trim()} onClick={() => void saveEdit()} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-[12px] font-black text-white transition hover:bg-blue-700 disabled:opacity-40 sm:min-h-9">
              {editing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Save size={14} aria-hidden />}{editing ? "저장 중…" : "수정 저장"}
            </button>
          </div>
        </div>
      )}

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
          {dept === "영업팀" && (
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
