/**
 * 조회 탭 — 자가신청 / 부품신청 (2026-10-11, 사용자 사례로 다듬음)
 *
 * 신청 한 줄(품목 단위)에는 두 축이 있다.
 *  · 출고(운영지원): issued_at — 운영지원이 [출고]를 누르면 줄이 그어지고 신청자에게 푸시. 재고 탭 수량도 그만큼 준다.
 *  · 단계(고객 쪽): 신청 → 지급 / 반납 / 불량
 *      - 차량재고 건("선출고완료" 등): 현장에서 바로 줬으니 신청 즉시 '지급'. 출고는 차량 보충.
 *      - 출고요청 건: 출고 뒤 엔지니어가 [지급](실제로 준 업체를 고를 수 있다 — 1번 업체에 신청했다가 2번 업체에 준 경우) / [반납](안 썼음) / [불량].
 *        아무것도 안 누르면 "차량 보유"로 남아 재고 추정에 들어간다. 수령·사용완료 단추는 없다(출고하면 다 가져가고, 반납 안 하면 쓴 것).
 * 운영지원은 카톡 체크 대신 이 화면의 [출고]를 쓴다. 숫자 줄이 "미출고·출고 후 미지급·불량"을 보여 준다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { getRoomMap, insertRow, invokeEdgeFunction, selectRows, updateRows, uploadPhoto } from "./supabase";
import { prepareImageForUpload } from "./imageUpload";
import { workerAlive } from "./counterSmsPhoto";

type Req = {
  id: number; request_date: string; kind: "부품" | "자가"; vendor: string; team: string; author: string; model: string; serial: string; asset: string;
  item: string; qty: string; status: string; warranty: string; counter: string; expected: string; source_table: string; source_id: string;
  item_std?: string; category?: string; color?: string; set_label?: string; stock_item_id?: string; stage?: string;
  mode?: string; issued_at?: string | null; issued_by?: string; used_vendor?: string; used_at?: string | null; used_by?: string; returned_at?: string | null; return_note?: string;
};
type Ev = { id: number; created_at: string; request_id: number; type: string; qty: number; note: string; author: string; dept: string };
type Member = { name: string; dept: string; team: string };
type Act = "출고" | "지급" | "반납" | "불량";

const STAGE_TONE: Record<string, string> = { 신청: "bg-amber-100 text-amber-800", 지급: "bg-emerald-100 text-emerald-800", 반납: "bg-sky-100 text-sky-800", 불량: "bg-rose-100 text-rose-800" };
const KST = 9 * 3600_000;
const kstDay = (iso: string) => new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 10);
const md = (d: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");
const num = (v: string | number) => { const n = parseInt(String(v || "").replace(/[^\d]/g, ""), 10); return Number.isFinite(n) && n > 0 ? n : 1; };

export default function SupplyBoard({ author, kind }: { author: string; kind: "자가" | "부품" }) {
  const [days, setDays] = useState(60);
  const [team, setTeam] = useState("전체");
  const [view, setView] = useState<"전체" | "미출고" | "미지급" | "불량" | "미정의" | "내것">("전체");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Req[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [act, setAct] = useState<{ id: number; type: Act; qty: string; note: string; vendor: string; photo: File | null; preview: string; genuine: "정품" | "재생"; retest: "유" | "무" | ""; report: "유" | "무" | ""; symptom: string; siblings: number[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const me = members.find((m) => m.name === author);
  const isOps = !!me && (/운영지원|관리/.test(me.dept || "") || me.team === "팀장");

  // 출고 7일이 지나도록 반납·불량이 없으면 신청한 업체에 지급한 것으로 자동 처리 — "반납 안 하면 쓴 것"이라 엔지니어가 따로 누를 일이 없다
  const autoAssign = async (list: Req[]): Promise<number> => {
    const limit = Date.now() - 7 * 86400_000;
    const due = list.filter((r) => r.mode !== "차량재고" && r.issued_at && (r.stage || "신청") === "신청" && new Date(r.issued_at).getTime() < limit).slice(0, 50);
    for (const r of due) {
      try {
        await updateRows("supply_requests", `id=eq.${r.id}&stage=eq.${encodeURIComponent("신청")}`, { stage: "지급", used_vendor: r.vendor, used_at: new Date().toISOString(), used_by: "자동(출고 7일)" });
        await insertRow("supply_events", { request_id: r.id, type: "지급", qty: num(r.qty), note: "출고 7일 지나 신청 업체에 지급한 것으로 자동 처리", author: "자동", dept: "" });
      } catch { /* 무시 */ }
    }
    return due.length;
  };
  const load = useCallback(async () => {
    const from = new Date(Date.now() - days * 86400_000 + KST).toISOString().slice(0, 10);
    try {
      let list = await selectRows<Req>("supply_requests", `select=*&kind=eq.${encodeURIComponent(kind)}&request_date=gte.${from}&order=request_date.desc,id.desc&limit=3000`);
      if (await autoAssign(list)) list = await selectRows<Req>("supply_requests", `select=*&kind=eq.${encodeURIComponent(kind)}&request_date=gte.${from}&order=request_date.desc,id.desc&limit=3000`);
      setRows(list); setReady(true);
      setEvents(await selectRows<Ev>("supply_events", `select=*&created_at=gte.${encodeURIComponent(new Date(Date.now() - (days + 30) * 86400_000).toISOString())}&order=created_at.asc&limit=5000`).catch(() => [] as Ev[]));
    } catch { setReady(false); }
    setMembers(await selectRows<Member>("cs_members", "select=name,dept,team&active=eq.true").catch(() => [] as Member[]));
  }, [days, kind]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const onFocus = () => { void load(); }; window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus); }, [load]);

  const evsOf = useMemo(() => { const m = new Map<number, Ev[]>(); events.forEach((e) => m.set(e.request_id, [...(m.get(e.request_id) || []), e])); return m; }, [events]);
  const stageOf = (r: Req) => (["신청", "지급", "반납", "불량"].includes(r.stage || "") ? (r.stage as string) : "신청");
  const issued = (r: Req) => !!r.issued_at;
  const holding = (r: Req) => issued(r) && stageOf(r) === "신청" && r.mode !== "차량재고";   // 출고됐는데 아직 지급·반납·불량 없음 = 차량 보유

  const filtered = useMemo(() => rows.filter((r) => {
    if (team !== "전체" && r.team !== team) return false;
    if (view === "미출고" && issued(r)) return false;
    if (view === "미지급" && !holding(r)) return false;
    if (view === "불량" && stageOf(r) !== "불량") return false;
    if (view === "미정의" && r.item_std) return false;
    if (view === "내것" && r.author !== author) return false;
    if (q.trim()) { const k = q.trim().toLowerCase(); if (![r.vendor, r.used_vendor, r.item, r.item_std, r.model, r.author, r.serial, r.asset].some((v) => String(v || "").toLowerCase().includes(k))) return false; }
    return true;
  }), [rows, team, view, q, author]);

  const groups = useMemo(() => {
    const m = new Map<string, Req[]>();
    filtered.forEach((r) => { const key = `${r.request_date}|${r.vendor}|${r.author}|${r.source_table}|${r.source_id}`; m.set(key, [...(m.get(key) || []), r]); });
    return Array.from(m.values());
  }, [filtered]);

  const counts = useMemo(() => ({
    미출고: rows.filter((r) => !issued(r)).length,
    미지급: rows.filter(holding).length,
    불량: rows.filter((r) => stageOf(r) === "불량").length,
    미정의: rows.filter((r) => !r.item_std).length,
  }), [rows]);

  // 내 차량 보유(추정) — 출고된 것 중 아직 지급·반납·불량이 없는 내 신청. 표준 품목별 수량
  const myHolding = useMemo(() => {
    const m = new Map<string, number>();
    rows.filter((r) => r.author === author && holding(r)).forEach((r) => { const k = r.item_std || r.item; m.set(k, (m.get(k) || 0) + num(r.qty)); });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows, author]);

  // 카톡 글 — 반납은 업체·기종·품목·수량·사유, 불량은 운영지원이 쓰는 ※불량/반품요청※ 양식 그대로(2026-10-11 사용자 제공)
  const kakaoLine = (r: Req, a: NonNullable<typeof act>, qty: number) => {
    const name = r.item_std || r.item;
    if (a.type === "반납") {
      const items = [{ name, qty }, ...a.siblings.map((id) => rows.find((x) => x.id === id)).filter((x): x is Req => !!x).map((x) => ({ name: x.item_std || x.item, qty: num(x.qty) }))];
      return ["※자가/부품 반납※", `반납자 : ${author || "미지정"}`, `업체명 : ${r.vendor}`, `기종 : ${r.model || ""}`, `품목/수량 : ${items.map((i) => `${i.name} ${i.qty}`).join(", ")}`, `사유 : ${a.note.trim() || "미사용"}`, "- 반납 물품 사진 첨부"].join("\n");
    }
    if (a.type === "불량") return ["※불량/반품요청※", `접수자 : ${author || "미지정"}`, `업체명(부서/몇 층) : ${a.vendor.trim() || r.vendor}`, `품목(토너/드럼) : ${name}`, `기종 : ${r.model || ""}`, `색상 : ${r.color || ""}`, `수량 : ${qty}`, `정품/재생 : ${a.genuine}`, `사무실 재테스트 여부 확인(유) : ${a.retest}`, `필요리포트 준비(유/무) : ${a.report}`, `증상 (상세히 적어주세요) : ${a.symptom.trim()}`, "----------------------------------", "- 불량 물품 > 불량접수 용지 붙인사진"].join("\n");
    return "";
  };
  /** 방으로 보내기 — 관리 탭 카톡방 매핑(반납 / 불량토너 / 불량부품, 팀 방 → * 공통). 사진이 있고 노트북 실행기가 살아 있으면 카톡 PC가 사진째, 아니면 봇이 글+링크 */
  const sendToRoom = async (category: string, team: string, text: string, photoUrl: string): Promise<string> => {
    const map = await getRoomMap().catch(() => ({} as Record<string, string>));
    const room = map[`${category}|${team}`] || map[`${category}|*`] || "";
    if (!room) return "";
    if (photoUrl && await workerAlive()) {
      await insertRow("worker_jobs", { kind: "kakao_photo", payload: { room, image_url: photoUrl, caption: text }, created_by: author || "미지정" });
      return `${room} (카톡 PC 사진째)`;
    }
    await insertRow("outbox", { room, text: photoUrl ? `${text}\n사진: ${photoUrl}` : text });
    return `${room} (봇)`;
  };

  const decrementStock = async (r: Req, qty: number) => {
    if (!r.stock_item_id) return;
    try {
      const cur = await selectRows<{ id: string; qty: number }>("stock_items", `select=id,qty&id=eq.${encodeURIComponent(r.stock_item_id)}&limit=1`);
      if (cur[0]) await updateRows("stock_items", `id=eq.${encodeURIComponent(r.stock_item_id)}`, { qty: Math.max(0, (cur[0].qty || 0) - qty), updated_by: author || "운영지원" });
    } catch { /* 재고 표 연결이 없으면 넘어간다 */ }
  };

  const doAct = async () => {
    if (!act) return;
    const r = rows.find((x) => x.id === act.id); if (!r) return;
    const qty = num(act.qty);
    if (act.type === "불량" && !act.symptom.trim()) { notify("불량 증상을 적어 주세요", "error"); return; }
    if (act.type === "지급" && !act.vendor.trim()) { notify("지급한 업체를 적어 주세요", "error"); return; }
    setBusy(true);
    try {
      let photoUrl = "";
      if (act.photo && (act.type === "반납" || act.type === "불량")) {
        const prepared = await prepareImageForUpload(act.photo, 1600, { quality: 0.85 });
        photoUrl = await uploadPhoto(`supply/${r.kind}/${Date.now()}-${r.id}.${prepared.ext}`, prepared.blob, prepared.contentType);
      }
      const kakao = kakaoLine(r, act, qty);
      const detail = act.type === "불량" ? { genuine: act.genuine, retest: act.retest, report: act.report, symptom: act.symptom.trim(), vendor: act.vendor.trim() } : {};
      const noteText = act.type === "불량" ? act.symptom.trim() : `${act.type === "지급" && act.vendor.trim() !== r.vendor ? `${act.vendor.trim()}에 지급 · ` : ""}${act.note.trim()}`.trim();
      await insertRow("supply_events", { request_id: r.id, type: act.type, qty, note: noteText, author: author || "미지정", dept: me?.dept || "", kakao_text: kakao, photo_url: photoUrl, detail });
      const now = new Date().toISOString();
      const patch: Record<string, unknown> =
        act.type === "출고" ? { issued_at: now, issued_by: author || "운영지원" }
        : act.type === "지급" ? { stage: "지급", used_vendor: act.vendor.trim(), used_at: now, used_by: author || "미지정" }
        : act.type === "반납" ? { stage: "반납", returned_at: now, return_by: author || "미지정", return_note: act.note.trim() }
        : { stage: "불량", return_note: act.symptom.trim() };
      await updateRows("supply_requests", `id=eq.${r.id}`, patch);
      if (act.type === "반납") {
        for (const sid of act.siblings) {
          const sr = rows.find((x) => x.id === sid); if (!sr) continue;
          await insertRow("supply_events", { request_id: sr.id, type: "반납", qty: num(sr.qty), note: noteText, author: author || "미지정", dept: me?.dept || "", kakao_text: "", photo_url: photoUrl, detail: { with: r.id } });
          await updateRows("supply_requests", `id=eq.${sr.id}`, { stage: "반납", returned_at: now, return_by: author || "미지정", return_note: act.note.trim() });
        }
      }
      if (act.type === "출고") {
        await decrementStock(r, qty);
        if (r.author) void invokeEdgeFunction("push-send", { title: `${r.item_std || r.item} ${qty}개 출고됨`, body: `${r.vendor} · ${r.kind}신청(${md(r.request_date)}) · ${author || "운영지원"}`, targets: [r.author], category: "notice", tag: `supply-${r.id}`, url: "/" }).catch(() => undefined);
      }
      let sent = "";
      if (kakao) sent = await sendToRoom(act.type === "반납" ? "반납" : r.kind === "자가" ? "불량토너" : "불량부품", r.team, kakao, photoUrl).catch(() => "");
      notify(`${r.item_std || r.item} — ${act.type} 처리했습니다${kakao ? (sent ? ` · ${sent}에 글을 올립니다` : " · 카톡방이 아직 없어 기록만 남겼습니다(관리 탭 카톡방 매핑에 반납·불량토너·불량부품 등록)") : ""}`, "success");
      if (act.preview) URL.revokeObjectURL(act.preview);
      setAct(null);
      await load();
    } catch (e) { notify(`처리 실패: ${(e as Error).message}`, "error"); } finally { setBusy(false); }
  };

  const undo = async (r: Req) => {
    const list = (evsOf.get(r.id) || []).filter((e) => e.type !== "메모");
    const last = list[list.length - 1];
    if (!last) return;
    if (!await askConfirm(`"${r.item_std || r.item}"의 마지막 처리(${last.type} · ${last.author})를 되돌릴까요?`, { danger: true, okLabel: "되돌리기" })) return;
    try {
      await updateRows("supply_events", `id=eq.${last.id}`, { type: "메모", note: `[취소된 ${last.type}] ${last.note}`.trim() });
      const patch: Record<string, unknown> = last.type === "출고" ? { issued_at: null, issued_by: "" } : { stage: r.mode === "차량재고" ? "지급" : "신청", used_vendor: r.mode === "차량재고" ? r.vendor : "", used_at: null, returned_at: null, return_note: "" };
      await updateRows("supply_requests", `id=eq.${r.id}`, patch);
      await load();
    } catch (e) { notify(`되돌리기 실패: ${(e as Error).message}`, "error"); }
  };

  const Btn = ({ r, type, label, tone }: { r: Req; type: Act; label: string; tone: string }) => (
    <button type="button" disabled={busy} onClick={() => setAct({ id: r.id, type, qty: r.qty || "1", note: "", vendor: r.vendor, photo: null, preview: "", genuine: "정품", retest: "", report: "", symptom: "", siblings: [] })} className={`rounded-full px-2.5 py-1 text-[10.5px] font-black ${tone}`}>{label}</button>
  );

  if (ready === false) return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-[13px] font-bold text-amber-800">{kind}신청 표가 아직 없습니다 — supabase/supply-requests.sql, supply-v2.sql, supply-v3.sql 을 실행하면 보입니다.</div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["미출고", "미출고(운영지원 대기)", counts.미출고, "text-amber-700"], ["미지급", "출고 후 차량 보유(미지급)", counts.미지급, "text-blue-700"], ["불량", "불량 접수", counts.불량, "text-rose-700"], ["미정의", "미정의 품목", counts.미정의, "text-slate-600"]] as const).map(([key, label, n, tone]) => (
          <button key={key} type="button" onClick={() => setView(view === key ? "전체" : key)} className={`rounded-xl border px-3 py-2.5 text-left transition ${view === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-400"}`}>
            <div className={`text-[10.5px] font-black ${view === key ? "text-slate-300" : "text-slate-500"}`}>{label}</div>
            <div className={`text-[20px] font-black leading-tight ${view === key ? "text-white" : tone}`}>{n}</div>
          </button>
        ))}
      </div>

      {myHolding.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2 text-[11.5px] font-bold text-blue-900">
          내 차량 보유(추정) · 출고됐는데 아직 지급·반납 처리 안 한 것: {myHolding.map(([k, n]) => `${k} ${n}`).join(" · ")}
          <span className="ml-2 font-semibold text-blue-700">안 쓰면 [반납], 다른 업체에 줬으면 [지급(업체 확인)]. 그대로 두면 출고 7일 뒤 신청 업체에 지급한 것으로 자동 처리</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <div className="flex rounded-full bg-slate-100 p-0.5">{["전체", "A", "B", "C", "D", "E"].map((t) => <button key={t} type="button" onClick={() => setTeam(t)} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${team === t ? "bg-slate-900 text-white" : "text-slate-600"}`}>{t === "전체" ? "전체 팀" : `${t}팀`}</button>)}</div>
        <button type="button" onClick={() => setView(view === "내것" ? "전체" : "내것")} className={`rounded-full px-3 py-1 text-[11px] font-black ${view === "내것" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>내 신청만</button>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold">{[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>최근 {d}일</option>)}</select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="업체·품목·기종·작성자" className="min-w-40 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold outline-none focus:border-blue-500" />
        <span className="text-[10.5px] font-bold text-slate-400">{filtered.length}행 · {isOps ? "운영지원 권한(출고)" : "CS 권한(지급·반납·불량)"}</span>
      </div>

      {ready === null && <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-[12px] font-bold text-slate-400">불러오는 중…</div>}
      {ready && groups.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-[12px] font-bold text-slate-400">해당하는 {kind}신청이 없습니다. FIELD 양식의 ※{kind}신청※ 칸에 적으면 여기에 쌓이고, 지난 기록은 관리 탭 [지난 기록 채우기]로 넣습니다.</div>}

      {groups.map((g) => {
        const h = g[0];
        return (
          <section key={`${h.request_date}|${h.vendor}|${h.author}|${h.source_id}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[12px]">
              <span className="font-black text-slate-900">{h.vendor || "(업체 없음)"}</span>
              <span className="font-bold text-slate-500">{md(h.request_date)} · {h.team ? `${h.team}팀 ` : ""}{h.author}</span>
              {h.model && <span className="font-bold text-slate-500">{h.model}{h.asset ? ` · ${h.asset}` : ""}</span>}
              {h.mode === "차량재고" && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-800">차량재고로 지급 → 보충</span>}
              <span className="ml-auto text-[10.5px] font-bold text-slate-400">{h.source_table === "as_records" ? "AS 보고" : "점검 보고"}{h.source_id ? ` #${h.source_id}` : ""}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {g.map((r) => {
                const st = stageOf(r);
                const evs = (evsOf.get(r.id) || []).filter((e) => e.type !== "메모");
                const done = issued(r);
                return (
                  <div key={r.id} className={`px-4 py-2.5 ${done ? "bg-slate-50/60" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[13px] font-black ${done ? "text-slate-400 line-through decoration-slate-400" : "text-slate-900"}`}>{r.item_std || r.item}</span>
                      {r.item_std && r.item_std !== r.item && <span className="text-[10.5px] font-bold text-slate-400">({r.item}{r.set_label ? ` · ${r.set_label}` : ""})</span>}
                      {!r.item_std && <span title="품목 사전에 없는 이름 — 재고 탭에서 별칭을 넣고 관리 탭 [다시 맞추기]" className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">미정의</span>}
                      <span className="text-[12px] font-bold text-slate-700">× {r.qty || "1"}</span>
                      {done
                        ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">출고 {md(kstDay(r.issued_at as string))} {r.issued_by}</span>
                        : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">미출고</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${STAGE_TONE[st]}`}>{st === "지급" ? `지급${r.used_vendor && r.used_vendor !== r.vendor ? ` → ${r.used_vendor}` : ""}` : st === "신청" && done ? "차량 보유" : st}</span>
                      {r.status && !done && <span className="text-[10.5px] font-bold text-slate-400">양식: {r.status}</span>}
                      <span className="ml-auto flex flex-wrap gap-1">
                        {isOps && !done && <Btn r={r} type="출고" label="출고" tone="bg-blue-600 text-white" />}
                        {st === "신청" && done && <Btn r={r} type="지급" label="지급(업체 확인)" tone="bg-emerald-600 text-white" />}
                        {st === "신청" && done && <Btn r={r} type="반납" label="반납" tone="bg-sky-600 text-white" />}
                        {(done || r.mode === "차량재고") && st !== "불량" && st !== "반납" && <Btn r={r} type="불량" label="불량" tone="bg-rose-600 text-white" />}
                        {evs.length > 0 && <button type="button" onClick={() => void undo(r)} className="rounded-full border border-slate-300 px-2 py-1 text-[10.5px] font-black text-slate-500">되돌리기</button>}
                      </span>
                    </div>
                    {evs.length > 0 && <div className="mt-1 text-[10.5px] font-bold text-slate-500">{evs.map((e) => `${e.type}${e.qty ? ` ${e.qty}` : ""} ${md(kstDay(e.created_at))} ${e.author}${e.note ? ` (${e.note})` : ""}`).join(" → ")}</div>}
                    {act && act.id === r.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${act.type === "출고" ? "bg-blue-100 text-blue-800" : STAGE_TONE[act.type]}`}>{act.type}</span>
                        <span className="flex items-center gap-1 text-[11px] font-bold text-slate-600">수량
                          <button type="button" onClick={() => setAct({ ...act, qty: String(Math.max(1, num(act.qty) - 1)) })} className="h-7 w-7 rounded-full border border-slate-300 bg-white text-[14px] font-black text-slate-600">−</button>
                          <span className="min-w-6 text-center text-[13px] font-black tabular-nums text-slate-900">{num(act.qty)}</span>
                          <button type="button" onClick={() => setAct({ ...act, qty: String(num(act.qty) + 1) })} className="h-7 w-7 rounded-full border border-slate-300 bg-white text-[14px] font-black text-slate-600">＋</button>
                          <span className="text-[10px] font-bold text-slate-400">/ 신청 {r.qty || "1"}</span>
                        </span>
                        {act.type === "반납" && (() => {
                          const sibs = rows.filter((x) => x.id !== r.id && x.request_date === r.request_date && x.vendor === r.vendor && x.author === r.author && x.source_id === r.source_id && stageOf(x) === "신청" && issued(x));
                          return sibs.length ? (
                            <span className="flex w-full flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-600">같이 반납:
                              {sibs.map((x) => { const on = act.siblings.includes(x.id); return <button key={x.id} type="button" onClick={() => setAct({ ...act, siblings: on ? act.siblings.filter((v) => v !== x.id) : [...act.siblings, x.id] })} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${on ? "bg-sky-600 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>{x.item_std || x.item} {x.qty || 1}</button>; })}
                            </span>
                          ) : null;
                        })()}
                        {act.type === "반납" && <span className="flex flex-wrap gap-1">{["미사용", "잔량 충분", "기종 불일치", "고객 보류", "중복 신청"].map((c) => <button key={c} type="button" onClick={() => setAct({ ...act, note: c })} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${act.note === c ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>{c}</button>)}</span>}
                        {act.type === "지급" && <label className="text-[11px] font-bold text-slate-600">지급한 업체 <input value={act.vendor} onChange={(e) => setAct({ ...act, vendor: e.target.value })} className="ml-1 w-44 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold" title="신청한 업체와 다른 곳에 줬으면 여기서 고칩니다" /></label>}
                        {act.type !== "불량" && <input value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} placeholder={act.type === "반납" ? "사유(미사용·잔량 충분 등)" : act.type === "지급" ? "메모(선택) · 부품이면 망가진 부품 둔 곳" : "메모(선택)"} className="min-w-48 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-semibold" />}
                        {act.type === "불량" && (
                          <div className="flex w-full flex-wrap items-center gap-2">
                            <label className="text-[11px] font-bold text-slate-600">업체명(부서/층) <input value={act.vendor} onChange={(e) => setAct({ ...act, vendor: e.target.value })} className="ml-1 w-44 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold" /></label>
                            <label className="text-[11px] font-bold text-slate-600">정품/재생 <select value={act.genuine} onChange={(e) => setAct({ ...act, genuine: e.target.value as "정품" | "재생" })} className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold"><option>정품</option><option>재생</option></select></label>
                            <label className="text-[11px] font-bold text-slate-600">사무실 재테스트 <select value={act.retest} onChange={(e) => setAct({ ...act, retest: e.target.value as "유" | "무" | "" })} className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold"><option value="">-</option><option>유</option><option>무</option></select></label>
                            <label className="text-[11px] font-bold text-slate-600">필요리포트 준비 <select value={act.report} onChange={(e) => setAct({ ...act, report: e.target.value as "유" | "무" | "" })} className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold"><option value="">-</option><option>유</option><option>무</option></select></label>
                            <span className="flex flex-wrap gap-1">{["단순 인식 불량", "소음", "줄·얼룩", "누출", "찍힘"].map((c) => <button key={c} type="button" onClick={() => setAct({ ...act, symptom: act.symptom.trim() ? `${act.symptom.trim()}, ${c}` : c })} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-black text-slate-600">{c}</button>)}</span>
                            <input value={act.symptom} onChange={(e) => setAct({ ...act, symptom: e.target.value })} placeholder="증상 (상세히) — 필수" className="min-w-60 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-semibold" />
                          </div>
                        )}
                        {(act.type === "반납" || act.type === "불량") && (
                          <label className="flex items-center gap-2 text-[11px] font-black text-slate-600">
                            <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1">{act.photo ? "사진 바꾸기" : act.type === "불량" ? "사진 선택(불량접수 용지 붙인 사진)" : "사진 선택(반납 물품)"}</span>
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ""; if (act.preview) URL.revokeObjectURL(act.preview); setAct({ ...act, photo: f, preview: f ? URL.createObjectURL(f) : "" }); }} />
                            {act.preview && <img src={act.preview} alt="" className="h-10 w-10 rounded-md border border-slate-200 object-cover" />}
                          </label>
                        )}
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
