// 접수리스트 시트 줄 펼침(2026-10-28, docs/tasks/reception-list-sheet-rows-2026-10-28.md 5절 4·5).
// 엣지 reception-sheet-open 의 한 행 상세(allowDone — 완료 줄도 열림)를 읽어 열 전부(전화 열 제외)를 보여 주고,
// 열린 영업·경영·원격·IT 줄에만 기존 [완료][보류][배정](UnhandledActionBar → statusOnly 시트 상태·처리자 칸만).
// 완료 줄·CS(copier) 줄·순번 빈 줄은 단추 없이 상세만. 상세를 못 읽으면 안내문(목록 값은 줄에 그대로 남음).
import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { invokeEdgeFunction } from "./supabase";
import { normalizeSheetRowDetail, sheetListRowUrl, type SheetListReceptionRow, type SheetRowDetail } from "./receptionSheetOpen";
import { ageDaysOf, type UnhandledKind, type UnhandledRow } from "./homeUnhandled";
import { sheetListCanAct } from "./sheetListRowState";
import { kstDate } from "./visits";
import UnhandledActionBar from "./UnhandledActionBar.view";

const SOURCE_LABEL: Record<string, string> = { sales: "해지방어접수(영업)", mgmt: "경영지원접수", remote: "원격", copier: "AS접수용(CS)" };
export const SHEET_LIST_NOTICE = "시트에서 적은 접수 — 사진·메모·카톡 후속 글·일정 연결은 없습니다";

/** 한 행 상세 — 완료 줄도 열리게 allowDone(엣지가 옛 버전이면 완료 줄은 409 → 안내문). 실패는 throw */
async function loadSheetListDetail(source: string, sheetRow: number, seq: string): Promise<SheetRowDetail> {
  const raw = await invokeEdgeFunction<{ detail?: unknown }>("reception-sheet-open", { row: { source, sheetRow, seq, allowDone: true }, allowDone: true }, 20_000);
  // normalizeSheetRowDetail 은 sales·mgmt·remote 만 받는다 — CS(copier) 상세는 칸·내용만 쓰므로 출처를 잠시 바꿔 모양만 맞춘다
  const d = raw?.detail && typeof raw.detail === "object" ? (raw.detail as Record<string, unknown>) : null;
  const detail = normalizeSheetRowDetail(d && d.source === "copier" ? { ...d, source: "remote" } : d);
  if (!detail) throw new Error("시트 행 상세를 받지 못했습니다(엣지 함수가 아직 옛 버전일 수 있음)");
  return detail;
}

export default function SheetListDetail({ row, handler, author, onFinished }: { row: SheetListReceptionRow; handler: string; author?: string; onFinished?: () => void }) {
  const [after, setAfter] = useState("");
  const { sheetSource: source, sheetRow, sheetSeq: seq, sheetCls: cls } = row;
  const loadKey = `${source}:${sheetRow}:${seq}`;
  // 읽은 결과를 행 키와 같이 둔다 — 키가 다르면 읽는 중(효과 안에서 바로 setState 하지 않게)
  const [result, setResult] = useState<{ key: string; detail: SheetRowDetail | null; error: string } | null>(null);

  useEffect(() => {
    let alive = true;
    loadSheetListDetail(source, sheetRow, seq)
      .then((d) => { if (alive) setResult({ key: loadKey, detail: d, error: "" }); })
      .catch((e: unknown) => { if (alive) setResult({ key: loadKey, detail: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [source, sheetRow, seq, loadKey]);
  const loading = result?.key !== loadKey;
  const detail = loading ? null : result?.detail ?? null;
  const error = loading ? "" : result?.error ?? "";

  const canAct = sheetListCanAct({ cls, source, seq });
  const date = String(row.receipt_date || "").slice(0, 10);
  const urow: UnhandledRow | null = canAct ? {
    key: `s:${source}:${sheetRow}`, source: "reception", kind: row.type as UnhandledKind, team: "", date,
    vendor: row.vendor || "", title: row.symptom || row.title || "", assignee: handler, status: row.sheetState || (cls === "hold" ? "보류" : ""),
    ageDays: date ? ageDaysOf(date, kstDate()) : 0,
    sheet: { source: source as "sales" | "mgmt" | "remote", row: sheetRow, seq, author: row.author || "", vendor: row.vendor || "" },
  } : null;
  const url = sheetListRowUrl(source, sheetRow);

  return (
    <div className="space-y-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-black text-slate-600">{SOURCE_LABEL[source] || "시트"} {sheetRow}행{seq ? ` · 순번 ${seq}` : ""}</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50">
          시트에서 열기<ExternalLink size={11} aria-hidden />
        </a>
      </div>
      <p className="text-[11px] font-semibold text-slate-500">{SHEET_LIST_NOTICE}</p>
      {loading && <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400"><Loader2 size={12} className="animate-spin" aria-hidden />시트 행 읽는 중…</div>}
      {!loading && error && <div role="alert" className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-800">시트 행 상세를 못 읽음 — {error}. [시트에서 열기]로 확인하세요.</div>}
      {!loading && detail && (
        <>
          {detail.cells.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
              {detail.cells.map((c, i) => (
                <div key={`${c.label}-${i}`} className="contents">
                  <dt className="font-bold text-slate-400">{c.label}</dt>
                  <dd className="min-w-0 wrap-break-word font-semibold text-slate-700">{c.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {detail.content.trim() && (
            <div className="rounded-lg bg-white px-2.5 py-1.5">
              <div className="text-[10px] font-black text-slate-400">{detail.contentLabel}</div>
              <p className="whitespace-pre-wrap wrap-break-word font-semibold text-slate-700">{detail.content}</p>
            </div>
          )}
        </>
      )}
      {urow && (after
        ? <div role="status" className="text-[12px] font-bold text-emerald-700">{after}</div>
        : <UnhandledActionBar row={urow} author={author} onFinished={(action, ok) => {
          if (!ok) return; // 실패는 UnhandledActionBar 가 빨간 토스트로 알린다
          setAfter(action === "done" ? "처리완료로 보냈습니다 — 1~2분 뒤 목록에 반영됩니다" : action === "hold" ? "보류 상태를 보냈습니다 — 1~2분 뒤 반영" : "처리자를 보냈습니다 — 1~2분 뒤 반영");
          onFinished?.();
        }} />)}
    </div>
  );
}
