/**
 * 조회 탭 → 기록 조회 — 자가신청 / 부품신청 (2026-10-11, 사용자 사례로 다듬음)
 *
 * 신청 한 줄(품목 단위)에는 두 축이 있다.
 *  · 출고(운영지원): issued_at — 운영지원이 [출고]를 누르면 줄이 그어지고 신청자에게 푸시. 재고 탭 수량도 그만큼 준다(기종이 맞는 재고 품목).
 *  · 단계(고객 쪽): 신청 → 지급 / 반납 / 불량
 *      - 차량재고 건: 현장에서 바로 줬으니 신청 즉시 '지급'. 출고는 차량 보충.
 *      - 출고요청 건: 출고 뒤 엔지니어가 [지급](실제로 준 업체를 고를 수 있다) / [반납](안 썼음) / [불량].
 *        아무것도 안 누르면 "차량 보유"로 남아 재고 추정에 들어간다. 수령·사용완료 단추는 없다(출고하면 다 가져가고, 반납 안 하면 쓴 것).
 *  · 지난 기록(이 화면이 생기기 전, 2026-10-11 이전 신청): 운영지원이 카톡 체크로 처리했으니 "미출고"로 세지 않고, 반납·불량만 적을 수 있다.
 * 단추는 보고(업체·날짜·작성자) 단위다 — 아스트로캠프 10/8 K1 C1 M1 Y1 중 C·M·Y 만 반납하면 머리의 [반납] 한 번에 수량 칸으로 K 를 0 으로(2026-10-11 사용자).
 * 한 번 누르면 품목마다 사건이 남고, 카톡 글은 한 장으로 간다. 운영지원은 카톡 체크 대신 이 화면의 [출고]를 쓴다.
 * 기간은 당일이 기본(60일은 느리고 많다 — 사용자), 모아보기는 품목·품목×기종·기종·업체·작성자·월. 미정의 품목은 화면을 열 때 한 번 저절로 다시 맞춘다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { getRoomMap, insertRow, invokeEdgeFunction, selectRows, updateRows, uploadPhoto } from "./supabase";
import { prepareImageForUpload } from "./imageUpload";
import { workerAlive } from "./counterSmsPhoto";
import { renormalizeUndefined } from "./supplyRequests";
import { modelCore } from "../supabase/functions/_shared/supply-requests.ts";
import SupplyBackfill from "./SupplyBackfill";

type Req = {
  id: number; request_date: string; kind: "부품" | "자가"; vendor: string; team: string; author: string; model: string; serial: string; asset: string;
  item: string; qty: string; status: string; warranty: string; counter: string; expected: string; source_table: string; source_id: string;
  item_std?: string; category?: string; color?: string; set_label?: string; stock_item_id?: string; stage?: string;
  mode?: string; issued_at?: string | null; issued_by?: string; used_vendor?: string; used_at?: string | null; used_by?: string; returned_at?: string | null; return_note?: string;
};
type Ev = { id: number; created_at: string; request_id: number; type: string; qty: number; note: string; author: string; dept: string };
type Member = { name: string; dept: string; team: string };
type Act = "출고" | "지급" | "반납" | "불량";
type Dim = "item" | "itemModel" | "model" | "vendor" | "author" | "month";
/** 보고 단위 처리창 — items: 행 id → 수량(0 = 이번엔 뺌) */
type GroupAct = { key: string; type: Act; items: Record<number, number>; note: string; vendor: string; photo: File | null; preview: string; genuine: "정품" | "재생"; retest: "유" | "무" | ""; report: "유" | "무" | ""; symptom: string };

const STAGE_TONE: Record<string, string> = { 신청: "bg-amber-100 text-amber-800", 지급: "bg-emerald-100 text-emerald-800", 반납: "bg-sky-100 text-sky-800", 불량: "bg-rose-100 text-rose-800" };
const ACT_TONE: Record<Act, string> = { 출고: "bg-blue-600 text-white", 지급: "bg-emerald-600 text-white", 반납: "bg-sky-600 text-white", 불량: "bg-rose-600 text-white" };
const DIM_LABEL: Record<Dim, string> = { item: "품목", itemModel: "품목×기종", model: "기종", vendor: "업체", author: "작성자", month: "월" };
const DAY_OPTIONS: Array<[number, string]> = [[1, "당일"], [7, "1주일"], [30, "30일"], [60, "60일"], [90, "90일"], [180, "180일"], [365, "1년"], [730, "2년"]];
const KST = 9 * 3600_000;
const kstDay = (iso: string) => new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 10);
const md = (d: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");
const num = (v: string | number) => { const n = parseInt(String(v || "").replace(/[^\d]/g, ""), 10); return Number.isFinite(n) && n > 0 ? n : 1; };
const groupKey = (r: Req) => `${r.request_date}|${r.vendor}|${r.author}|${r.source_table}|${r.source_id}`;
/** 이 화면([출고] 단추)이 생긴 날 — 그 전 신청은 카톡 체크로 처리된 "지난 기록" */
const LEGACY_BEFORE = "2026-10-11";
const DAYS_KEY = "cs_supply_days";
const readDays = (): number => { try { const n = Number(localStorage.getItem(DAYS_KEY)); return DAY_OPTIONS.some(([d]) => d === n) ? n : 1; } catch { return 1; } };
let renormOnce = false;

export default function SupplyBoard({ author, kind, withTools = false }: { author: string; kind: "자가" | "부품"; withTools?: boolean }) {
  const [days, setDays] = useState(readDays);
  const [team, setTeam] = useState("전체");
  const [view, setView] = useState<"전체" | "미출고" | "미지급" | "불량" | "미정의" | "내것">("전체");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Partial<Record<Dim, string>>>({});
  const [pivot, setPivot] = useState<Dim | "">("");
  const [rows, setRows] = useState<Req[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [fixing, setFixing] = useState("");
  const [act, setAct] = useState<GroupAct | null>(null);
  const [busy, setBusy] = useState(false);

  const me = members.find((m) => m.name === author);
  const isOps = !!me && (/운영지원|관리/.test(me.dept || "") || me.team === "팀장");
  const pickDays = (d: number) => { setDays(d); try { localStorage.setItem(DAYS_KEY, String(d)); } catch { /* 무시 */ } };

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
    // 당일 = 오늘(KST)부터, 1주일 = 오늘 포함 7일
    const from = new Date(Date.now() + KST - (days - 1) * 86400_000).toISOString().slice(0, 10);
    const fetchRows = () => selectRows<Req>("supply_requests", `select=*&kind=eq.${encodeURIComponent(kind)}&request_date=gte.${from}&order=request_date.desc,id.desc&limit=3000`);
    try {
      let list = await fetchRows();
      if (await autoAssign(list)) list = await fetchRows();
      setRows(list); setReady(true);
      setEvents(await selectRows<Ev>("supply_events", `select=*&created_at=gte.${encodeURIComponent(new Date(Date.now() - (days + 30) * 86400_000).toISOString())}&order=created_at.asc&limit=5000`).catch(() => [] as Ev[]));
      // 미정의 품목이 있으면 한 번(앱 켜고 처음) 저절로 다시 맞춘다 — 아는 표기(폐·K1 폐·토너1셋·k현상제…)는 사람이 누를 일 없이
      if (!renormOnce && list.some((r) => !r.item_std)) {
        renormOnce = true;
        setFixing("품목 이름 맞추는 중…");
        renormalizeUndefined((d, t) => setFixing(`품목 이름 맞추는 중 ${d}/${t}`))
          .then(async (r) => { setFixing(""); if (r.fixed) { notify(`미정의 품목 ${r.fixed}행을 표준 이름으로 맞췄습니다`, "success"); setRows(await fetchRows()); } })
          .catch(() => setFixing(""));
      }
    } catch { setReady(false); }
    setMembers(await selectRows<Member>("cs_members", "select=name,dept,team&active=eq.true").catch(() => [] as Member[]));
  }, [days, kind]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const onFocus = () => { void load(); }; window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus); }, [load]);

  const evsOf = useMemo(() => { const m = new Map<number, Ev[]>(); events.forEach((e) => m.set(e.request_id, [...(m.get(e.request_id) || []), e])); return m; }, [events]);
  const stageOf = (r: Req) => (["신청", "지급", "반납", "불량"].includes(r.stage || "") ? (r.stage as string) : "신청");
  const issued = (r: Req) => !!r.issued_at;
  const legacy = (r: Req) => !r.issued_at && r.mode !== "차량재고" && (r.request_date || "") < LEGACY_BEFORE;   // 이 화면 전 신청 = 카톡 체크로 처리된 것
  const holding = (r: Req) => issued(r) && stageOf(r) === "신청" && r.mode !== "차량재고";   // 출고됐는데 아직 지급·반납·불량 없음 = 차량 보유
  const dimOf = (r: Req, d: Dim): string => {
    const item = r.item_std || r.item || "(품목 없음)";
    if (d === "item") return item;
    if (d === "itemModel") return `${item} · ${modelCore(r.model) || "기종 없음"}`;     // 3220 K 와 4220 K 를 따로(2026-10-11 사용자)
    if (d === "model") return r.model || "(기종 없음)";
    if (d === "vendor") return r.vendor || "(업체 없음)";
    if (d === "author") return r.author || "(작성자 없음)";
    return (r.request_date || "").slice(0, 7);
  };
  /** 이 행에 이 처리를 할 수 있나 — 출고는 운영지원·미출고, 지급·반납은 출고(또는 지난 기록) 뒤 아직 신청 단계, 불량은 반납·불량이 아닌 것 */
  const canDo = (r: Req, type: Act): boolean => {
    const st = stageOf(r), done = issued(r), old = legacy(r);
    if (type === "출고") return isOps && !done;
    if (type === "지급") return st === "신청" && done;
    if (type === "반납") return st === "신청" && (done || old);
    return (done || old || r.mode === "차량재고") && st !== "불량" && st !== "반납";
  };

  /** 걸러내기 — skip 차원의 필터만 빼고 적용(모아보기 표가 그 차원의 모든 값을 보여 주도록) */
  const passes = useCallback((r: Req, skip?: Dim): boolean => {
    if (team !== "전체" && r.team !== team) return false;
    if (view === "미출고" && (issued(r) || legacy(r))) return false;
    if (view === "미지급" && !holding(r)) return false;
    if (view === "불량" && stageOf(r) !== "불량") return false;
    if (view === "미정의" && r.item_std) return false;
    if (view === "내것" && r.author !== author) return false;
    for (const d of Object.keys(filters) as Dim[]) { if (d === skip || !filters[d]) continue; if (dimOf(r, d) !== filters[d]) return false; }
    if (q.trim()) { const k = q.trim().toLowerCase(); if (![r.vendor, r.used_vendor, r.item, r.item_std, r.model, r.author, r.serial, r.asset].some((v) => String(v || "").toLowerCase().includes(k))) return false; }
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, view, author, filters, q]);

  const filtered = useMemo(() => rows.filter((r) => passes(r)), [rows, passes]);

  const groups = useMemo(() => {
    const m = new Map<string, Req[]>();
    filtered.forEach((r) => { const key = groupKey(r); m.set(key, [...(m.get(key) || []), r]); });
    return Array.from(m.values());
  }, [filtered]);

  // 모아보기 — 고른 차원으로 묶어 건수·수량·업체 수·최근. 그 차원의 필터는 빼고 센다
  const pivotRows = useMemo(() => {
    if (!pivot) return [];
    const m = new Map<string, { key: string; count: number; qty: number; vendors: Set<string>; last: string }>();
    for (const r of rows) {
      if (!passes(r, pivot)) continue;
      const key = dimOf(r, pivot);
      const cur = m.get(key) || { key, count: 0, qty: 0, vendors: new Set<string>(), last: "" };
      cur.count += 1; cur.qty += num(r.qty); cur.vendors.add(r.vendor); if (r.request_date > cur.last) cur.last = r.request_date;
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => (pivot === "month" ? b.key.localeCompare(a.key) : b.qty - a.qty || b.count - a.count));
  }, [rows, pivot, passes]);
  const toggleFilter = (d: Dim, v: string) => setFilters((cur) => (cur[d] === v ? { ...cur, [d]: "" } : { ...cur, [d]: v }));
  const activeFilters = (Object.keys(filters) as Dim[]).filter((d) => filters[d]);

  const counts = useMemo(() => ({
    미출고: rows.filter((r) => !issued(r) && !legacy(r)).length,
    미지급: rows.filter(holding).length,
    불량: rows.filter((r) => stageOf(r) === "불량").length,
    미정의: rows.filter((r) => !r.item_std).length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows]);

  // 내 차량 보유(추정) — 출고된 것 중 아직 지급·반납·불량이 없는 내 신청. 표준 품목별 수량
  const myHolding = useMemo(() => {
    const m = new Map<string, number>();
    rows.filter((r) => r.author === author && holding(r)).forEach((r) => { const k = r.item_std || r.item; m.set(k, (m.get(k) || 0) + num(r.qty)); });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, author]);

  // 카톡 글 — 보고 단위로 한 장. 반납은 업체·기종·품목/수량·사유, 불량은 운영지원이 쓰는 ※불량/반품요청※ 양식 그대로(2026-10-11 사용자 제공)
  const kakaoText = (a: GroupAct, picked: Array<{ r: Req; qty: number }>) => {
    const h = picked[0].r;
    const names = picked.map((p) => `${p.r.item_std || p.r.item}`);
    if (a.type === "반납") return ["※자가/부품 반납※", `반납자 : ${author || "미지정"}`, `업체명 : ${h.vendor}`, `기종 : ${h.model || ""}`, `품목/수량 : ${picked.map((p) => `${p.r.item_std || p.r.item} ${p.qty}`).join(", ")}`, `사유 : ${a.note.trim() || "미사용"}`, "- 반납 물품 사진 첨부"].join("\n");
    if (a.type === "불량") return ["※불량/반품요청※", `접수자 : ${author || "미지정"}`, `업체명(부서/몇 층) : ${a.vendor.trim() || h.vendor}`, `품목(토너/드럼) : ${names.join(", ")}`, `기종 : ${h.model || ""}`, `색상 : ${picked.map((p) => p.r.color || "").filter(Boolean).join(", ")}`, `수량 : ${picked.map((p) => p.qty).join(", ")}`, `정품/재생 : ${a.genuine}`, `사무실 재테스트 여부 확인(유) : ${a.retest}`, `필요리포트 준비(유/무) : ${a.report}`, `증상 (상세히 적어주세요) : ${a.symptom.trim()}`, "----------------------------------", "- 불량 물품 > 불량접수 용지 붙인사진"].join("\n");
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

  const openAct = (g: Req[], type: Act) => {
    const h = g[0];
    const items: Record<number, number> = {};
    g.filter((r) => canDo(r, type)).forEach((r) => { items[r.id] = num(r.qty); });
    if (act?.preview) URL.revokeObjectURL(act.preview);
    setAct({ key: groupKey(h), type, items, note: "", vendor: h.vendor, photo: null, preview: "", genuine: "정품", retest: "", report: "", symptom: "" });
  };

  /** 보고 단위 처리 — 수량 0 이 아닌 품목마다 사건·단계를 남기고, 카톡 글·푸시는 한 번 */
  const doAct = async () => {
    if (!act) return;
    const picked = rows.filter((r) => groupKey(r) === act.key && canDo(r, act.type) && (act.items[r.id] || 0) > 0).map((r) => ({ r, qty: act.items[r.id] }));
    if (!picked.length) { notify("수량이 모두 0입니다 — 처리할 품목의 수량을 올려 주세요", "error"); return; }
    if (act.type === "불량" && !act.symptom.trim()) { notify("불량 증상을 적어 주세요", "error"); return; }
    if (act.type === "지급" && !act.vendor.trim()) { notify("지급한 업체를 적어 주세요", "error"); return; }
    const h = picked[0].r;
    setBusy(true);
    try {
      let photoUrl = "";
      if (act.photo && (act.type === "반납" || act.type === "불량")) {
        const prepared = await prepareImageForUpload(act.photo, 1600, { quality: 0.85 });
        photoUrl = await uploadPhoto(`supply/${h.kind}/${Date.now()}-${h.id}.${prepared.ext}`, prepared.blob, prepared.contentType);
      }
      const kakao = kakaoText(act, picked);
      const detail = act.type === "불량" ? { genuine: act.genuine, retest: act.retest, report: act.report, symptom: act.symptom.trim(), vendor: act.vendor.trim(), with: picked.map((p) => p.r.id) } : { with: picked.map((p) => p.r.id) };
      const noteText = act.type === "불량" ? act.symptom.trim() : `${act.type === "지급" && act.vendor.trim() !== h.vendor ? `${act.vendor.trim()}에 지급 · ` : ""}${act.note.trim()}`.trim();
      const now = new Date().toISOString();
      const patch: Record<string, unknown> =
        act.type === "출고" ? { issued_at: now, issued_by: author || "운영지원" }
        : act.type === "지급" ? { stage: "지급", used_vendor: act.vendor.trim(), used_at: now, used_by: author || "미지정" }
        : act.type === "반납" ? { stage: "반납", returned_at: now, return_by: author || "미지정", return_note: act.note.trim() }
        : { stage: "불량", return_note: act.symptom.trim() };
      for (const { r, qty } of picked) {
        await insertRow("supply_events", { request_id: r.id, type: act.type, qty, note: noteText, author: author || "미지정", dept: me?.dept || "", kakao_text: kakao, photo_url: photoUrl, detail });
        await updateRows("supply_requests", `id=eq.${r.id}`, patch);
        if (act.type === "출고") await decrementStock(r, qty);
      }
      const summary = picked.map((p) => `${p.r.item_std || p.r.item} ${p.qty}`).join(", ");
      if (act.type === "출고" && h.author) void invokeEdgeFunction("push-send", { title: `${summary} 출고됨`, body: `${h.vendor} · ${h.kind}신청(${md(h.request_date)}) · ${author || "운영지원"}`, targets: [h.author], category: "notice", tag: `supply-${h.id}`, url: "/" }).catch(() => undefined);
      let sent = "";
      if (kakao) sent = await sendToRoom(act.type === "반납" ? "반납" : h.kind === "자가" ? "불량토너" : "불량부품", h.team, kakao, photoUrl).catch(() => "");
      notify(`${h.vendor} — ${summary} ${act.type} 처리했습니다${kakao ? (sent ? ` · ${sent}에 글을 올립니다` : " · 카톡방이 아직 없어 기록만 남겼습니다(관리 탭 카톡방 매핑에 반납·불량토너·불량부품 등록)") : ""}`, "success");
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

  if (ready === false) return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-[13px] font-bold text-amber-800">{kind}신청 표가 아직 없습니다 — supabase/supply-requests.sql, supply-v2.sql, supply-v3.sql 을 실행하면 보입니다.</div>;

  const roleNote = !author ? "작성자를 고르면 권한에 맞는 단추가 보입니다" : !me ? `'${author}'는 구성원 명부에 없어 CS 권한으로 봅니다` : isOps ? "운영지원 권한 — [출고]" : "CS 권한 — 출고된 것에 [지급·반납·불량]";
  const dayLabel = DAY_OPTIONS.find(([d]) => d === days)?.[1] || `${days}일`;

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

      {fixing && <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2 text-[11.5px] font-bold text-blue-900">{fixing} <span className="font-semibold text-blue-700">· 폐→폐토너통, K1 폐→토너 K+폐토너통, 토너1셋→색별, k현상제→현상제 K 처럼 표준 이름으로</span></div>}

      {myHolding.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2 text-[11.5px] font-bold text-blue-900">
          내 차량 보유(추정) · 출고됐는데 아직 지급·반납 처리 안 한 것: {myHolding.map(([k, n]) => `${k} ${n}`).join(" · ")}
          <span className="ml-2 font-semibold text-blue-700">안 쓰면 [반납], 다른 업체에 줬으면 [지급(업체 확인)]. 그대로 두면 출고 7일 뒤 신청 업체에 지급한 것으로 자동 처리</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        {/* 기간 — 당일이 기본. 길게 잡으면 느리고 많다 */}
        <div className="flex flex-wrap rounded-full bg-slate-100 p-0.5">{DAY_OPTIONS.map(([d, label]) => <button key={d} type="button" onClick={() => pickDays(d)} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${days === d ? "bg-slate-900 text-white" : "text-slate-600"}`}>{label}</button>)}</div>
        <div className="flex rounded-full bg-slate-100 p-0.5">{["전체", "A", "B", "C", "D", "E"].map((t) => <button key={t} type="button" onClick={() => setTeam(t)} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${team === t ? "bg-slate-900 text-white" : "text-slate-600"}`}>{t === "전체" ? "전체 팀" : `${t}팀`}</button>)}</div>
        <button type="button" onClick={() => setView(view === "내것" ? "전체" : "내것")} className={`rounded-full px-3 py-1 text-[11px] font-black ${view === "내것" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>내 신청만</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="업체·품목·기종·작성자" className="min-w-40 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold outline-none focus:border-blue-500" />
        <span className="text-[10.5px] font-bold text-slate-400">{dayLabel} {filtered.length}행 · {roleNote}</span>
      </div>

      {/* 모아보기 — 품목·품목×기종·기종·업체·작성자·월로 묶어 보고, 줄을 누르면 그 조건으로 거른다 */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          <span className="text-[10.5px] font-black text-slate-500">모아보기</span>
          {(Object.keys(DIM_LABEL) as Dim[]).map((d) => <button key={d} type="button" onClick={() => setPivot(pivot === d ? "" : d)} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${pivot === d ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{DIM_LABEL[d]}별</button>)}
          {activeFilters.map((d) => <button key={d} type="button" onClick={() => toggleFilter(d, filters[d] as string)} className="rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-800" title="누르면 이 조건을 뺍니다">{DIM_LABEL[d]}: {filters[d]} ×</button>)}
          {activeFilters.length > 1 && <button type="button" onClick={() => setFilters({})} className="text-[11px] font-black text-slate-500">모두 지우기</button>}
        </div>
        {pivot && (
          <div className="border-t border-slate-100">
            {pivotRows.length === 0 ? <div className="px-3 py-3 text-[11.5px] font-bold text-slate-400">묶을 게 없습니다 — 기간을 넓혀 보세요</div> : (
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-[11.5px]">
                  <thead className="sticky top-0 bg-slate-50 text-[10.5px] font-black text-slate-500"><tr><th className="px-3 py-1.5 text-left">{DIM_LABEL[pivot]}</th><th className="px-2 py-1.5 text-right">건수</th><th className="px-2 py-1.5 text-right">수량</th>{pivot !== "vendor" && <th className="px-2 py-1.5 text-right">업체</th>}<th className="px-3 py-1.5 text-right">최근</th></tr></thead>
                  <tbody>
                    {pivotRows.map((p) => (
                      <tr key={p.key} onClick={() => toggleFilter(pivot, p.key)} className={`cursor-pointer border-t border-slate-100 ${filters[pivot] === p.key ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                        <td className="px-3 py-1.5 font-black text-slate-800">{p.key}</td>
                        <td className="px-2 py-1.5 text-right font-bold tabular-nums text-slate-600">{p.count}</td>
                        <td className="px-2 py-1.5 text-right font-black tabular-nums text-slate-900">{p.qty}</td>
                        {pivot !== "vendor" && <td className="px-2 py-1.5 text-right font-bold tabular-nums text-slate-500">{p.vendors.size}</td>}
                        <td className="px-3 py-1.5 text-right font-bold tabular-nums text-slate-500">{md(p.last)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {ready === null && <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-[12px] font-bold text-slate-400">불러오는 중…</div>}
      {ready && groups.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-[12px] font-bold text-slate-400">{dayLabel} 안에 해당하는 {kind}신청이 없습니다. {days < 30 ? "위에서 기간을 1주일·30일로 넓혀 보세요. " : ""}FIELD 양식의 ※{kind}신청※ 칸에 적으면 여기에 쌓이고, 지난 기록은 아래 [지난 기록 채우기]로 넣습니다.</div>}

      {withTools && <SupplyBackfill />}
      {groups.map((g) => {
        const h = g[0];
        const key = groupKey(h);
        const avail = (["출고", "지급", "반납", "불량"] as Act[]).filter((t) => g.some((r) => canDo(r, t)));
        const pendingCs = !isOps && g.some((r) => !issued(r) && !legacy(r) && r.mode !== "차량재고");
        const open = act && act.key === key ? act : null;
        return (
          <section key={key} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[12px]">
              <span className="font-black text-slate-900">{h.vendor || "(업체 없음)"}</span>
              <span className="font-bold text-slate-500">{md(h.request_date)} · {h.team ? `${h.team}팀 ` : ""}{h.author}</span>
              <span className={`font-bold ${h.model ? "text-slate-700" : "text-slate-400"}`}>기종 {h.model || "미기재"}{h.asset ? ` · ${h.asset}` : ""}</span>
              {h.mode === "차량재고" && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-800">차량재고로 지급 → 보충</span>}
              <span className="text-[10.5px] font-bold text-slate-400">{h.source_table === "as_records" ? "AS 보고" : "점검 보고"}{h.source_id ? ` #${h.source_id}` : ""}</span>
              {/* 보고 단위 단추 — 품목마다 누르지 않게. 창에서 품목별 수량(0 = 뺌)을 맞춘다 */}
              <span className="ml-auto flex flex-wrap gap-1">
                {avail.map((t) => <button key={t} type="button" disabled={busy} onClick={() => (open?.type === t ? setAct(null) : openAct(g, t))} className={`rounded-full px-2.5 py-1 text-[10.5px] font-black ${open?.type === t ? "ring-2 ring-slate-900 ring-offset-1" : ""} ${ACT_TONE[t]}`}>{t === "출고" && g.some(legacy) ? "출고 기록" : t === "지급" ? "지급(업체 확인)" : t}</button>)}
                {avail.length === 0 && pendingCs && <span className="text-[10px] font-bold text-slate-400">출고 전 — 운영지원이 [출고]를 누르면 단추가 생깁니다</span>}
              </span>
            </div>
            {open && (
              <div className="space-y-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-600">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${open.type === "출고" ? "bg-blue-100 text-blue-800" : STAGE_TONE[open.type]}`}>{open.type}</span>
                  품목마다 수량을 맞추세요 — <b>0이면 이번 처리에서 뺍니다</b>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.filter((r) => r.id in open.items).map((r) => {
                    const n = open.items[r.id] || 0;
                    const set = (v: number) => setAct({ ...open, items: { ...open.items, [r.id]: Math.max(0, v) } });
                    return (
                      <span key={r.id} className={`flex items-center gap-1 rounded-lg border px-2 py-1 ${n ? "border-slate-300 bg-white" : "border-dashed border-slate-300 bg-slate-100 opacity-60"}`}>
                        <span className={`text-[12px] font-black ${n ? "text-slate-900" : "text-slate-500 line-through"}`}>{r.item_std || r.item}</span>
                        <button type="button" onClick={() => set(n - 1)} className="h-7 w-7 rounded-full border border-slate-300 bg-white text-[14px] font-black text-slate-600">−</button>
                        <span className="min-w-5 text-center text-[13px] font-black tabular-nums text-slate-900">{n}</span>
                        <button type="button" onClick={() => set(n + 1)} className="h-7 w-7 rounded-full border border-slate-300 bg-white text-[14px] font-black text-slate-600">＋</button>
                        <span className="text-[10px] font-bold text-slate-400">/ 신청 {r.qty || "1"}</span>
                      </span>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {open.type === "반납" && <span className="flex flex-wrap gap-1">{["미사용", "잔량 충분", "기종 불일치", "고객 보류", "중복 신청"].map((c) => <button key={c} type="button" onClick={() => setAct({ ...open, note: c })} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${open.note === c ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>{c}</button>)}</span>}
                  {open.type === "지급" && <label className="text-[11px] font-bold text-slate-600">지급한 업체 <input value={open.vendor} onChange={(e) => setAct({ ...open, vendor: e.target.value })} className="ml-1 w-44 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold" title="신청한 업체와 다른 곳에 줬으면 여기서 고칩니다" /></label>}
                  {open.type !== "불량" && <input value={open.note} onChange={(e) => setAct({ ...open, note: e.target.value })} placeholder={open.type === "반납" ? "사유(미사용·잔량 충분 등)" : open.type === "지급" ? "메모(선택) · 부품이면 망가진 부품 둔 곳" : "메모(선택)"} className="min-w-48 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-semibold" />}
                  {open.type === "불량" && (
                    <div className="flex w-full flex-wrap items-center gap-2">
                      <label className="text-[11px] font-bold text-slate-600">업체명(부서/층) <input value={open.vendor} onChange={(e) => setAct({ ...open, vendor: e.target.value })} className="ml-1 w-44 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold" /></label>
                      <label className="text-[11px] font-bold text-slate-600">정품/재생 <select value={open.genuine} onChange={(e) => setAct({ ...open, genuine: e.target.value as "정품" | "재생" })} className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold"><option>정품</option><option>재생</option></select></label>
                      <label className="text-[11px] font-bold text-slate-600">사무실 재테스트 <select value={open.retest} onChange={(e) => setAct({ ...open, retest: e.target.value as "유" | "무" | "" })} className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold"><option value="">-</option><option>유</option><option>무</option></select></label>
                      <label className="text-[11px] font-bold text-slate-600">필요리포트 준비 <select value={open.report} onChange={(e) => setAct({ ...open, report: e.target.value as "유" | "무" | "" })} className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-bold"><option value="">-</option><option>유</option><option>무</option></select></label>
                      <span className="flex flex-wrap gap-1">{["단순 인식 불량", "소음", "줄·얼룩", "누출", "찍힘"].map((c) => <button key={c} type="button" onClick={() => setAct({ ...open, symptom: open.symptom.trim() ? `${open.symptom.trim()}, ${c}` : c })} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-black text-slate-600">{c}</button>)}</span>
                      <input value={open.symptom} onChange={(e) => setAct({ ...open, symptom: e.target.value })} placeholder="증상 (상세히) — 필수" className="min-w-60 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-[12px] font-semibold" />
                    </div>
                  )}
                  {(open.type === "반납" || open.type === "불량") && (
                    <label className="flex items-center gap-2 text-[11px] font-black text-slate-600">
                      <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1">{open.photo ? "사진 바꾸기" : open.type === "불량" ? "사진 선택(불량접수 용지 붙인 사진)" : "사진 선택(반납 물품)"}</span>
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ""; if (open.preview) URL.revokeObjectURL(open.preview); setAct({ ...open, photo: f, preview: f ? URL.createObjectURL(f) : "" }); }} />
                      {open.preview && <img src={open.preview} alt="" className="h-10 w-10 rounded-md border border-slate-200 object-cover" />}
                    </label>
                  )}
                  <button type="button" disabled={busy} onClick={() => void doAct()} className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-50">{busy ? "처리 중…" : `${open.type} 확인`}</button>
                  <button type="button" onClick={() => { if (open.preview) URL.revokeObjectURL(open.preview); setAct(null); }} className="text-[11px] font-black text-slate-500">취소</button>
                </div>
              </div>
            )}
            <div className="divide-y divide-slate-100">
              {g.map((r) => {
                const st = stageOf(r);
                const evs = (evsOf.get(r.id) || []).filter((e) => e.type !== "메모");
                const done = issued(r);
                const old = legacy(r);
                return (
                  <div key={r.id} className={`px-4 py-2 ${done ? "bg-slate-50/60" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[13px] font-black ${done ? "text-slate-400 line-through decoration-slate-400" : "text-slate-900"}`}>{r.item_std || r.item}</span>
                      {r.item_std && r.item_std !== r.item && <span className="text-[10.5px] font-bold text-slate-400">({r.item}{r.set_label ? ` · ${r.set_label}` : ""})</span>}
                      {!r.item_std && <span title="품목 사전에 없는 이름 — 재고 탭에서 별칭을 넣으면 다음 열 때 맞춰집니다" className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">미정의</span>}
                      <span className="text-[12px] font-bold text-slate-700">× {r.qty || "1"}</span>
                      {done
                        ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">출고 {md(kstDay(r.issued_at as string))} {r.issued_by}</span>
                        : old
                          ? <span title="이 화면이 생기기 전 신청 — 운영지원이 카톡 체크로 처리한 것" className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">지난 기록</span>
                          : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">미출고</span>}
                      {!(st === "신청" && old) && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${STAGE_TONE[st]}`}>{st === "지급" ? `지급${r.used_vendor && r.used_vendor !== r.vendor ? ` → ${r.used_vendor}` : ""}` : st === "신청" && done ? "차량 보유" : st}</span>}
                      {r.status && !done && !old && <span className="text-[10.5px] font-bold text-slate-400">양식: {r.status}</span>}
                      {evs.length > 0 && <button type="button" onClick={() => void undo(r)} className="ml-auto rounded-full border border-slate-300 px-2 py-1 text-[10.5px] font-black text-slate-500">되돌리기</button>}
                    </div>
                    {evs.length > 0 && <div className="mt-1 text-[10.5px] font-bold text-slate-500">{evs.map((e) => `${e.type}${e.qty ? ` ${e.qty}` : ""} ${md(kstDay(e.created_at))} ${e.author}${e.note ? ` (${e.note})` : ""}`).join(" → ")}</div>}
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
