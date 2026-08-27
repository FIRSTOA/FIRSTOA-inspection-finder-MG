/**
 * 키맨 카드 — FIELD 점검·AS 화면에서 "이 업체 90일 안에 담당자·키맨·주소가 바뀌었다"를 알려준다.
 * 현장에서 알아야 할 것: ① 새 키맨이면 인사 ② 주소가 바뀌었으면 헛걸음 방지 ③ 이전 담당자 이름을 부르지 않기.
 * 인사 완료는 여기서 바로 체크된다(담당자변경 이력 화면과 같은 값).
 */
import { useEffect, useState } from "react";
import { updateRows } from "./supabase";
import { notify } from "./toast";
import { daysSince, isKeymanChange, recentChangesFor, type ContactChange } from "./keyman";

const dateLabel = (v: string) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? (v || "-") : `${d.getMonth() + 1}/${d.getDate()}`;
};

export default function KeymanCard({ vendor, author, days = 90 }: { vendor: string; author: string; days?: number }) {
  const [rows, setRows] = useState<ContactChange[]>([]);
  const [busyId, setBusyId] = useState("");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const name = String(vendor || "").trim();
    if (name.length < 2) { setRows([]); return; }
    let alive = true;
    // 업체명은 미리보기를 고치는 동안 계속 바뀐다 — 잠깐 기다린 뒤 한 번만 조회한다
    const timer = window.setTimeout(() => {
      recentChangesFor(name, days)
        .then((found) => { if (alive) setRows(found); })
        .catch(() => { if (alive) setRows([]); });
    }, 400);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [vendor, days]);

  if (!rows.length) return null;

  // 인사 대기는 최근 30일 건만 — 그 전 건은 이미 인사했다고 본다(2026-08-28 결정)
  const todo = rows.filter((r) => isKeymanChange(r) && !r.greeting_done && daysSince(r.change_date || r.created_at) <= 30);

  const markGreeted = async (row: ContactChange) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const patch = { greeting_done: true, greeting_by: author || "미지정", greeting_at: new Date().toISOString() };
      await updateRows("contact_changes", `id=eq.${row.id}`, patch);
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
      notify("인사 완료로 표시했습니다 — 담당자변경 이력에도 남습니다", "success");
    } catch (e) { notify(`저장 실패: ${(e as Error).message}`, "error"); }
    finally { setBusyId(""); }
  };

  return (
    <div className={`mb-2 overflow-hidden rounded-xl border ${todo.length ? "border-amber-300 bg-amber-50/70" : "border-slate-200 bg-slate-50"}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="text-[13px]">🤝</span>
        <span className="text-[12px] font-black text-slate-800">
          최근 {days}일 변경 {rows.length}건
          {todo.length > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-black text-white">인사 필요 {todo.length}</span>}
        </span>
        <span className="ml-auto text-[11px] font-bold text-slate-400">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>
      {open && (
        <div className="divide-y divide-white/70 border-t border-white/70">
          {rows.slice(0, 4).map((row) => {
            const keyman = isKeymanChange(row);
            const d = daysSince(row.change_date || row.created_at);
            return (
              <div key={row.id} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-black text-slate-600">{dateLabel(row.change_date || row.created_at)} · D+{d}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${keyman ? "bg-amber-200 text-amber-900" : "bg-slate-200 text-slate-700"}`}>
                    {row.category || "변경"}
                  </span>
                  {row.reason && <span className="text-[11px] font-bold text-slate-500">{row.reason.slice(0, 20)}</span>}
                  {keyman && d <= 30 && (row.greeting_done
                    ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">인사 완료 · {row.greeting_by || "-"}</span>
                    : <button type="button" disabled={busyId === row.id} onClick={() => void markGreeted(row)}
                        className="rounded-full bg-amber-500 px-2.5 py-0.5 text-[10px] font-black text-white transition hover:bg-amber-400 disabled:opacity-50">인사 완료로 표시</button>)}
                </div>
                <div className="mt-1 grid gap-1 text-[12px] leading-5 sm:grid-cols-2">
                  {row.before_text && <div className="min-w-0"><span className="mr-1 text-[10px] font-black text-slate-400">이전</span><span className="font-semibold text-slate-500 line-through decoration-slate-300">{row.before_text.replace(/\n/g, " · ").slice(0, 60)}</span></div>}
                  {row.after_text && <div className="min-w-0"><span className="mr-1 text-[10px] font-black text-slate-400">현재</span><span className="font-black text-slate-900">{row.after_text.replace(/\n/g, " · ").slice(0, 60)}</span></div>}
                </div>
                {row.notes && <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{row.notes.slice(0, 80)}</div>}
              </div>
            );
          })}
          {rows.length > 4 && <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400">외 {rows.length - 4}건 — 담당자변경 이력 화면에서 전체 확인</div>}
          {todo.length > 0 && (
            <div className="bg-amber-100/70 px-3 py-2 text-[11px] font-bold leading-4 text-amber-900">
              새 키맨입니다 — 방문하시면 인사 한마디 부탁드립니다. 초반 관리가 재계약 때 확실히 다릅니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
