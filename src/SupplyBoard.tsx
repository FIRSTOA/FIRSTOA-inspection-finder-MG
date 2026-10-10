/**
 * 조회 탭 — 자가·부품 신청 (2026-10-11)
 *
 * 모든 직원이 본다. 신청 한 줄(품목 단위)의 단계가 신청 → 출고 → 수령 → 사용완료 / 반납 / 불량 으로 흐르고,
 *  - 운영지원(팀장 포함)은 [출고] — 신청자에게 푸시 "드럼 1 출고됨"
 *  - 엔지니어는 [수령] [사용완료] [반납] [불량] — 수량·사유를 적으면 사건(supply_events)에 남고, 방이 정해지면 카톡 글도 자동으로 나간다
 * 카톡 체크 표시를 읽을 수 없어서(알림 기반 봇) 운영지원이 같은 목록을 쓰는 것으로 대신한다. 위의 숫자 줄이 "어디서 막혔는지"를 보여 준다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { insertRow, invokeEdgeFunction, selectRows, updateRows } from "./supabase";

type Req = {
  id: number; request_date: string; kind: "부품" | "자가"; vendor: string; team: string; author: string; model: string; serial: string; asset: string;
  item: string; qty: string; status: string; warranty: string; counter: string; expected: string; source_table: string; source_id: string;
  item_std?: string; category?: string; color?: string; set_label?: string; stage?: string; returned_at?: string | null; return_note?: string;
};
type Ev = { id: number; created_at: string; request_id: number; type: string; qty: number; note: string; author: string; dept: string };
type Member = { name: string; dept: string; team: string };

const STAGES = ["신청", "출고", "수령", "사용완료", "반납", "불량"] as const;
type Stage = typeof STAGES[number];
const STAGE_TONE: Record<string, string> = { 신청: "bg-amber-100 text-amber-800", 출고: "bg-blue-100 text-blue-800", 수령: "bg-indigo-100 text-indigo-800", 사용완료: "bg-slate-200 text-slate-700", 반납: "bg-emerald-100 text-emerald-800", 불량: "bg-rose-100 text-rose-800" };
const KST = 9 * 3600_000;
const kstDay = (iso: string) => new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 10);
const md = (d: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");
const num = (v: string) => { const n = parseInt(String(v || "").replace(/[^\d]/g, ""), 10); return Number.isFinite(n) && n > 0 ? n : 1; };

export default function SupplyBoard({ author }: { author: string }) {
  const [days, setDays] = useState(60);
  const [kind, setKind] = useState<"전체" | "부품" | "자가">("전체");
  const [team, setTeam] = useState("전체");
  const [stage, setStage] = useState<"전체" | Stage | "미정의">("전체");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Req[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [act, setAct] = useState<{ id: number; type: Stage; qty: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const me = members.find((m) => m.name === author);
  const isOps = !!me && (/운영지원|관리/.test(me.dept || "") || me.team === "팀장");

  const load = useCallback(async () => {
    const from = new Date(Date.now() - days * 86400_000 + KST).toISOString().slice(0, 10);
    try {
      const list = await selectRows<Req>("supply_requests", `select=*&request_date=gte.${from}&order=request_date.desc,id.desc&limit=3000`);
      setRows(list); setReady(true);
      const evs = await selectRows<Ev>("supply_events", `select=*&created_at=gte.${encodeURIComponent(new Date(Date.now() - (days + 30) * 86400_000).toISOString())}&order=created_at.asc&limit=5000`).catch(() => [] as Ev[]);
      setEvents(evs);
    } catch { setReady(false); }
    setMembers(await selectRows<Member>("cs_members", "select=name,dept,team&active=eq.true").catch(() => [] as Member[]));
  }, [days]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const onFocus = () => { void load(); }; window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus); }, [load]);

  const evsOf = useMemo(() => { const m = new Map<number, Ev[]>(); events.forEach((e) => m.set(e.request_id, [...(m.get(e.request_id) || []), e])); return m; }, [events]);
  const stageOf = (r: Req): Stage => (STAGES.includes((r.stage || "신청") as Stage) ? (r.stage as Stage) : "신청");

  const filtered = useMemo(() => rows.filter((r) => {
    if (kind !== "전체" && r.kind !== kind) return false;
    if (team !== "전체" && r.team !== team) return false;
    if (stage === "미정의" ? !!r.item_std : stage !== "전체" && stageOf(r) !== stage) return false;
    if (q.trim()) { const k = q.trim().toLowerCase(); if (![r.vendor, r.item, r.item_std, r.model, r.author, r.serial, r.asset].some((v) => String(v || "").toLowerCase().includes(k))) return false; }
    return true;
  }), [rows, kind, team, stage, q]);

  // 신청 묶음: 같은 보고(날짜·업체·작성자·원본) 단위
  const groups = useMemo(() => {
    const m = new Map<string, Req[]>();
    filtered.forEach((r) => { const key = `${r.request_date}|${r.vendor}|${r.author}|${r.source_table}|${r.source_id}`; m.set(key, [...(m.get(key) || []), r]); });
    return Array.from(m.values());
  }, [filtered]);

  const counts = useMemo(() => ({
    신청: rows.filter((r) => stageOf(r) === "신청").length,
    출고: rows.filter((r) => stageOf(r) === "출고").length,
    수령: rows.filter((r) => stageOf(r) === "수령" && r.kind === "자가").length,
    불량: rows.filter((r) => stageOf(r) === "불량").length,
    미정의: rows.filter((r) => !r.item_std).length,
  }), [rows]);

  const kakaoLine = (r: Req, type: Stage, qty: number, note: string) => {
    const name = r.item_std || r.item;
    if (type === "반납") return `[미사용 반납] ${r.vendor} · ${name} ${qty}개 · ${author || "미지정"} ${md(kstDay(new Date().toISOString()))}${note ? ` · ${note}` : ""}`;
    if (type === "불량") return `[불량 접수] ${r.vendor} · ${name} ${qty}개 · ${r.model || ""}${r.serial ? ` ${r.serial}` : ""} · ${author || "미지정"}${note ? ` · 사유: ${note}` : ""}`;
    return "";
  };

  const doAct = async () => {
    if (!act) return;
    const r = rows.find((x) => x.id === act.id); if (!r) return;
    const qty = num(act.qty);
    if (act.type === "불량" && !act.note.trim()) { notify("불량 사유를 한 줄 적어 주세요", "error"); return; }
    setBusy(true);
    try {
      const kakao = kakaoLine(r, act.type, qty, act.note.trim());
      await insertRow("supply_events", { request_id: r.id, type: act.type, qty, note: act.note.trim(), author: author || "미지정", dept: me?.dept || "", kakao_text: kakao });
      const patch: Record<string, unknown> = { stage: act.type };
      if (act.type === "반납") { patch.returned_at = new Date().toISOString(); patch.return_by = author || "미지정"; patch.return_note = act.note.trim(); }
      await updateRows("supply_requests", `id=eq.${r.id}`, patch);
      if (act.type === "출고" && r.author) {
        void invokeEdgeFunction("push-send", { title: `${r.item_std || r.item} ${qty}개 출고됨`, body: `${r.vendor} · ${r.kind} 신청(${md(r.request_date)}) · ${author || "운영지원"}`, targets: [r.author], category: "notice", tag: `supply-${r.id}`, url: "/" }).catch(() => undefined);
      }
      notify(`${r.item_std || r.item} — ${act.type} 처리했습니다${kakao ? " (카톡 글은 방이 정해지면 자동으로 나갑니다)" : ""}`, "success");
      setAct(null);
      await load();
    } catch (e) { notify(`처리 실패: ${(e as Error).message}`, "error"); } finally { setBusy(false); }
  };

  const undo = async (r: Req) => {
    const list = evsOf.get(r.id) || [];
    const last = list[list.length - 1];
    if (!last) return;
    if (!await askConfirm(`"${r.item_std || r.item}"의 마지막 처리(${last.type} · ${last.author})를 되돌릴까요?`, { danger: true, okLabel: "되돌리기" })) return;
    try {
      await updateRows("supply_events", `id=eq.${last.id}`, { type: "메모", note: `[취소된 ${last.type}] ${last.note}`.trim() });
      const prev = [...list].reverse().find((e) => e.id !== last.id && e.type !== "메모");
      await updateRows("supply_requests", `id=eq.${r.id}`, { stage: prev ? prev.type : "신청" });
      await load();
    } catch (e) { notify(`되돌리기 실패: ${(e as Error).message}`, "error"); }
  };

  const Btn = ({ r, type, label, tone }: { r: Req; type: Stage; label: string; tone: string }) => (
    <button type="button" disabled={busy} onClick={() => setAct({ id: r.id, type, qty: r.qty || "1", note: "" })} className={`rounded-full px-2.5 py-1 text-[10.5px] font-black ${tone}`}>{label}</button>
  );

  if (ready === false) return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-[13px] font-bold text-amber-800">자가·부품 신청 표가 아직 없습니다 — supabase/supply-requests.sql 과 supply-v2.sql 을 실행하면 보입니다.</div>;

  return (
    <div className="space-y-3">
      {/* 숫자 줄 — 어디서 막혔나 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {([["신청", "미출고", counts.신청, "text-amber-700"], ["출고", "출고 후 미수령", counts.출고, "text-blue-700"], ["수령", "수령 후 미처리(자가)", counts.수령, "text-indigo-700"], ["불량", "불량 접수", counts.불량, "text-rose-700"], ["미정의", "미정의 품목", counts.미정의, "text-slate-600"]] as const).map(([key, label, n, tone]) => (
          <button key={key} type="button" onClick={() => setStage(stage === key ? "전체" : key)} className={`rounded-xl border px-3 py-2.5 text-left transition ${stage === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-400"}`}>
            <div className={`text-[10.5px] font-black ${stage === key ? "text-slate-300" : "text-slate-500"}`}>{label}</div>
            <div className={`text-[20px] font-black leading-tight ${stage === key ? "text-white" : tone}`}>{n}</div>
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <div className="flex rounded-full bg-slate-100 p-0.5">{(["전체", "부품", "자가"] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-[11px] font-black ${kind === k ? "bg-slate-900 text-white" : "text-slate-600"}`}>{k}</button>)}</div>
        <div className="flex rounded-full bg-slate-100 p-0.5">{["전체", "A", "B", "C", "D", "E"].map((t) => <button key={t} type="button" onClick={() => setTeam(t)} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${team === t ? "bg-slate-900 text-white" : "text-slate-600"}`}>{t === "전체" ? "전체 팀" : `${t}팀`}</button>)}</div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold">{[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>최근 {d}일</option>)}</select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="업체·품목·기종·작성자" className="min-w-40 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold outline-none focus:border-blue-500" />
        <span className="text-[10.5px] font-bold text-slate-400">{filtered.length}행 · {isOps ? "운영지원 권한(출고)" : "CS 권한(수령·반납·불량)"}</span>
      </div>

      {ready === null && <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-[12px] font-bold text-slate-400">불러오는 중…</div>}
      {ready && groups.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-[12px] font-bold text-slate-400">해당하는 신청이 없습니다. FIELD 양식으로 부품·자가를 신청하면 여기에 쌓이고, 지난 기록은 관리 탭 [지난 기록 채우기]로 넣습니다.</div>}

      {groups.map((g) => {
        const h = g[0];
        return (
          <section key={`${h.request_date}|${h.vendor}|${h.author}|${h.source_id}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[12px]">
              <span className="font-black text-slate-900">{h.vendor || "(업체 없음)"}</span>
              <span className="font-bold text-slate-500">{md(h.request_date)} · {h.team ? `${h.team}팀 ` : ""}{h.author}</span>
              {h.model && <span className="font-bold text-slate-500">{h.model}{h.asset ? ` · ${h.asset}` : ""}</span>}
              <span className="ml-auto text-[10.5px] font-bold text-slate-400">{h.source_table === "as_records" ? "AS 보고" : "점검 보고"}{h.source_id ? ` #${h.source_id}` : ""}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {g.map((r) => {
                const st = stageOf(r);
                const evs = evsOf.get(r.id) || [];
                return (
                  <div key={r.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${r.kind === "부품" ? "bg-violet-100 text-violet-800" : "bg-cyan-100 text-cyan-800"}`}>{r.kind}</span>
                      <span className="text-[13px] font-black text-slate-900">{r.item_std || r.item}{r.item_std && r.item_std !== r.item ? <span className="ml-1 text-[10.5px] font-bold text-slate-400">({r.item}{r.set_label ? ` · ${r.set_label}` : ""})</span> : null}</span>
                      {!r.item_std && <span title="품목 사전에 없는 이름 — 재고 탭에서 별칭을 넣고 관리 탭 [다시 맞추기]" className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">미정의</span>}
                      <span className="text-[12px] font-bold text-slate-700">× {r.qty || "1"}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${STAGE_TONE[st]}`}>{st}</span>
                      {r.status && st === "신청" && <span className="text-[10.5px] font-bold text-slate-400">양식: {r.status}</span>}
                      <span className="ml-auto flex flex-wrap gap-1">
                        {isOps && st === "신청" && <Btn r={r} type="출고" label="출고" tone="bg-blue-600 text-white" />}
                        {(st === "출고" || st === "신청") && <Btn r={r} type="수령" label="수령" tone="bg-indigo-600 text-white" />}
                        {(st === "수령" || st === "출고") && <Btn r={r} type="사용완료" label="사용완료" tone="bg-slate-700 text-white" />}
                        {(st === "수령" || st === "출고" || st === "사용완료") && r.kind === "자가" && <Btn r={r} type="반납" label="반납" tone="bg-emerald-600 text-white" />}
                        {st !== "불량" && st !== "신청" && <Btn r={r} type="불량" label="불량" tone="bg-rose-600 text-white" />}
                        {evs.filter((e) => e.type !== "메모").length > 0 && <button type="button" onClick={() => void undo(r)} className="rounded-full border border-slate-300 px-2 py-1 text-[10.5px] font-black text-slate-500">되돌리기</button>}
                      </span>
                    </div>
                    {evs.length > 0 && <div className="mt-1 text-[10.5px] font-bold text-slate-500">{evs.map((e) => `${e.type}${e.qty ? ` ${e.qty}` : ""} ${md(kstDay(e.created_at))} ${e.author}${e.note ? ` (${e.note})` : ""}`).join(" → ")}</div>}
                    {act && act.id === r.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${STAGE_TONE[act.type]}`}>{act.type}</span>
                        <label className="text-[11px] font-bold text-slate-600">수량 <input type="number" min={1} value={act.qty} onChange={(e) => setAct({ ...act, qty: e.target.value })} className="ml-1 w-16 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold" /></label>
                        <input value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} placeholder={act.type === "불량" ? "불량 사유(필수)" : act.type === "반납" ? "미사용 사유·둔 곳(선택)" : act.type === "사용완료" ? "망가진 부품 둔 곳 등(선택)" : "메모(선택)"} className="min-w-48 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-semibold" />
                        <button type="button" disabled={busy} onClick={() => void doAct()} className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-50">{busy ? "처리 중…" : "확인"}</button>
                        <button type="button" onClick={() => setAct(null)} className="text-[11px] font-black text-slate-500">취소</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
