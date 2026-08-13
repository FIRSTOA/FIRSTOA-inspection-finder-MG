/**
 * 자동 일정 짜기 (1차 시안)
 * CS팀 실무 순서 그대로: ① 그날 필수 스케줄을 놓고 → ② 마지막 일정(앵커) 좌표에서
 * 가까운 순으로 워킨맵 점검 후보를 뽑고 → ③ 같은 동선의 재계약도 끼워 넣는다.
 * 후보는 전부 **현재 분기 워킨맵**에서만 찾는다 (suggest_workin_candidates RPC).
 * 규칙: 마지막 점검 경과일 기준(조절 가능) · N·NN·S는 언제든 · SS·V는 분기 중반부터 권장.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, MapPin, RefreshCw, Wand2 } from "lucide-react";
import { rpc, selectRows, upsertRow } from "./supabase";
import { vendorMatchKey } from "./ids";
import { kstDate } from "./visits";

type Ticket = { id: string; date: string; time: string; team: string; vendor: string; address: string; scheduleType: string };
type Place = { id: number; place_name: string; vendor: string; grade: string; label: string; addr: string; lat: number | null; lng: number | null; last_date: string | null; days_since: number; distance_km: number | null; quarter_ok: boolean; never_visited: boolean };

const TEAMS = ["A", "B", "C", "D"] as const;
const GRADES = ["N", "NN", "S", "SS", "V"] as const;

export default function AutoSchedule({ author }: { author: string }) {
  const [team, setTeam] = useState("C");
  const [date, setDate] = useState(kstDate());
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [onlyMine, setOnlyMine] = useState(true);
  const [anchorId, setAnchorId] = useState("");
  const [anchorQuery, setAnchorQuery] = useState("");
  const [anchorGeo, setAnchorGeo] = useState<{ name: string; lat: number; lng: number } | null>(null);
  const [grades, setGrades] = useState<string[]>(["N", "NN", "S"]);
  const [minDays, setMinDays] = useState(60);
  const [kind, setKind] = useState<"quarter" | "renewal">("quarter");
  const [rows, setRows] = useState<Place[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  // ① 그날 필수 스케줄 (일정리스트)
  const loadTickets = useCallback(async () => {
    const mineFilter = onlyMine && author ? `&assignee=eq.${encodeURIComponent(author)}` : "";
    const list = await selectRows<Ticket>("as_tickets", `select=id,date,time,team,vendor,address,scheduleType&date=eq.${date}&team=eq.${team}${mineFilter}&order=time.asc`).catch(() => [] as Ticket[]);
    setTickets(list);
    setAnchorId(list.length ? list[list.length - 1].id : "");
  }, [date, team, onlyMine, author]);
  useEffect(() => { void loadTickets(); }, [loadTickets]);

  // 앵커 좌표 — 워킨맵에서 업체명으로 찾고(정규화 키 대조), 없으면 주소 지오코딩 폴백
  // 도로명 띄어쓰기 변형까지 시도하는 지오코딩 ("삼성로 100길" ↔ "삼성로100길")
  const geocodeFlexible = async (q: string): Promise<{ lat: number; lng: number } | null> => {
    const variants = [...new Set([
      q,
      q.replace(/([가-힣]+로)\s+(\d+길)/g, "$1$2"),
      q.replace(/([가-힣]+로)(\d+길)/g, "$1 $2"),
      q.replace(/\s*\d+호$/, "").replace(/\s*\d+층$/, ""),
    ])];
    for (const variant of variants) {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&q=${encodeURIComponent(variant)}`, { headers: { "Accept-Language": "ko" } });
        const geo = (await res.json()) as Array<{ lat: string; lon: string }>;
        if (geo.length) return { lat: Number(geo[0].lat), lng: Number(geo[0].lon) };
      } catch { /* 다음 변형 */ }
    }
    return null;
  };

  const resolveAnchor = useCallback(async (name: string, address = "") => {
    const raw = name.trim();
    if (!raw) { setAnchorGeo(null); return; }
    // 법인 접두어·기호를 뺀 핵심 토큰으로 검색 — "주식회사 무암 (Mooam)" → "무암"
    const core = raw.replace(/주식회사|유한회사|재단법인|사단법인|농업회사법인|㈜|\(주\)/g, "").trim().match(/[가-힣a-zA-Z0-9]+/)?.[0] || raw;
    const hits = await selectRows<{ name: string; latitude: number | null; longitude: number | null }>(
      "workin_map_places", `select=name,latitude,longitude&name=ilike.*${encodeURIComponent(core.slice(0, 8))}*&limit=20`,
    ).catch(() => []);
    const key = vendorMatchKey(raw);
    const scored = hits
      .filter((h) => h.latitude != null && h.longitude != null)
      .map((h) => {
        const hk = vendorMatchKey(h.name);
        const score = hk === key ? 3 : hk.startsWith(key) || key.startsWith(hk) ? 2 : hk.includes(key.slice(0, 4)) ? 1 : 0;
        return { h, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const hit = scored[0]?.h;
    if (hit) { setAnchorGeo({ name: hit.name, lat: hit.latitude as number, lng: hit.longitude as number }); return; }
    // 워킨맵에 없는 업체(예: 분기점검 대상 아님) — 일정의 주소 → 입력값 순으로 지오코딩
    for (const source of [address, raw]) {
      const q = String(source || "").trim();
      if (!q) continue;
      const found = await geocodeFlexible(q);
      if (found) { setAnchorGeo({ name: `${q.slice(0, 20)} (주소)`, lat: found.lat, lng: found.lng }); return; }
    }
    setAnchorGeo(null);
    setNotice(`"${raw}"의 좌표를 못 찾았습니다 — 업체명 또는 주소로 다시 시도해 보세요 (거리 정렬 없이 경과일 순).`);
  }, []);

  const anchorTicket = tickets.find((t) => t.id === anchorId);
  useEffect(() => { void resolveAnchor(anchorTicket?.vendor || anchorQuery, anchorTicket?.address || ""); }, [anchorTicket?.vendor, anchorTicket?.address, anchorQuery, resolveAnchor]);

  const suggest = async () => {
    setLoading(true);
    setNotice("");
    try {
      const list = await rpc<Place[]>("suggest_workin_candidates", {
        p_team: team, p_kind: kind, p_grades: grades,
        p_lat: anchorGeo?.lat ?? null, p_lng: anchorGeo?.lng ?? null,
        p_min_days: kind === "quarter" ? minDays : 0, p_limit: 120,
      });
      setRows(list || []);
      setPicked(new Set());
      setNotice(`${(list || []).length}곳 — ${anchorGeo ? `${anchorGeo.name.slice(0, 14)} 기준 가까운 순` : "거리 기준 없음(경과일 순)"}`);
    } catch (e) {
      setNotice(`추천 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  };

  const toggleGrade = (g: string) => setGrades((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
  const toggle = (id: number) => setPicked((cur) => { const next = new Set(cur); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const register = async () => {
    const chosen = rows.filter((r) => picked.has(r.id));
    if (!chosen.length) return;
    if (!window.confirm(`${chosen.length}곳을 ${date} ${team}팀 일정으로 등록할까요?`)) return;
    setLoading(true);
    try {
      for (const c of chosen) {
        await upsertRow("as_tickets", {
          id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          team, date, time: "09:00", vendor: c.vendor, contact: "", address: c.addr, department: "",
          model: "", serial: "", asset: "", grade: c.grade, keyman: "",
          issue: kind === "renewal" ? "재계약 방문" : `정기점검 (마지막 ${c.last_date || "기록 없음"}${c.days_since < 9999 ? ` · ${c.days_since}일 경과` : ""})`,
          note: "", assignee: "", status: "접수", scheduleType: kind === "renewal" ? "AS" : "매월점검",
          receptionId: "", calendarTitle: `${kind === "renewal" ? "재계약" : "점검"} ${c.vendor}`,
        }, "id");
      }
      setPicked(new Set());
      setNotice(`${chosen.length}곳 등록 완료 (${author}) — 일정리스트에서 확인하세요.`);
      void loadTickets();
    } catch (e) {
      setNotice(`등록 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  };

  const chip = "rounded-full px-3 py-1.5 text-xs font-black transition";
  const gradeChip = (on: boolean) => `rounded-full px-3 py-1.5 text-xs font-black transition ${on ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`;
  const anchorLabel = anchorTicket?.vendor || anchorQuery.trim();

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl bg-[#1E252F] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-[15px] font-black text-white">자동 일정 짜기 <span className="ml-1 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] text-amber-300">1차 시안</span></div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">필수 일정을 놓고 → 마지막 일정에서 가까운 워킨맵 점검·재계약을 추천합니다.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-black text-white outline-none" />
            <div className="flex gap-1 rounded-full bg-white/10 p-1">
              {TEAMS.map((t) => <button key={t} type="button" onClick={() => setTeam(t)} className={`${chip} ${team === t ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>{t}팀</button>)}
            </div>
          </div>
        </div>
        <div className="bg-[#151A23] px-5 py-2 text-[11px] font-bold text-slate-400">
          현재 분기 워킨맵에서만 찾습니다 · 앵커 {anchorGeo ? <span className="text-emerald-300">좌표 확인됨</span> : <span className="text-amber-300">좌표 없음</span>}
        </div>
      </section>

      {notice && <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-xs font-black text-blue-700">{notice}</div>}

      <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
        <section className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-black text-slate-900">① 필수 스케줄 <span className="text-slate-400">{tickets.length}건</span>
                <button type="button" onClick={() => setOnlyMine((v) => !v)} className={`rounded-full px-2 py-0.5 text-[10px] font-black transition ${onlyMine ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>{onlyMine ? "내 배정" : "전체"}</button>
              </div>
              <button type="button" onClick={() => void loadTickets()} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-black text-slate-500"><RefreshCw size={12} />새로고침</button>
            </div>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">마지막에 가는 일정을 기준(앵커)으로 잡습니다.</p>
            <div className="mt-2 space-y-1">
              {tickets.map((t) => (
                <label key={t.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition ${anchorId === t.id ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
                  <input type="radio" checked={anchorId === t.id} onChange={() => { setAnchorId(t.id); setAnchorQuery(""); }} className="mt-0.5 h-4 w-4 accent-blue-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-black text-slate-900">{t.time} {t.vendor}</span>
                    <span className="block truncate text-[11px] font-semibold text-slate-400">{t.address || "주소 없음"}</span>
                  </span>
                </label>
              ))}
              {!tickets.length && <div className="rounded-lg border border-dashed border-slate-200 py-5 text-center text-xs font-bold text-slate-400">이 날짜의 {team}팀 일정이 없습니다.</div>}
            </div>
            <label className="mt-2 block text-[11px] font-black text-slate-500">직접 지정 (업체명 또는 주소)
              <input value={anchorQuery} onChange={(e) => { setAnchorQuery(e.target.value); setAnchorId(""); }} placeholder="업체명 또는 주소 (예: 강남구 삼성로100길 8)"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </label>
            {anchorLabel && <div className={`mt-1 text-[10px] font-black ${anchorGeo ? "text-emerald-600" : "text-amber-600"}`}>{anchorGeo ? `📍 ${anchorGeo.name.slice(0, 20)} 좌표로 거리 계산` : "좌표 미확인 — 경과일 순 정렬"}</div>}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-black text-slate-900">② 추천 조건</div>
            <div className="mt-2 flex gap-1 rounded-full bg-slate-100 p-1">
              {([["quarter", "점검"], ["renewal", "재계약"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setKind(k)} className={`${chip} flex-1 ${kind === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-400"}`}>{label}</button>
              ))}
            </div>
            <div className="mt-3 text-[11px] font-black text-slate-500">등급 (중복 선택)</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {GRADES.map((g) => <button key={g} type="button" onClick={() => toggleGrade(g)} className={gradeChip(grades.includes(g))}>{g}</button>)}
              <button type="button" onClick={() => setGrades(grades.length === GRADES.length ? [] : [...GRADES])} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-500">{grades.length === GRADES.length ? "해제" : "전체"}</button>
            </div>
            {(grades.includes("SS") || grades.includes("V")) && <div className="mt-1.5 text-[10px] font-bold text-amber-600">SS·V는 분기 중반부터 권장 — 분기 초반이면 경고가 표시됩니다.</div>}
            {kind === "quarter" && (
              <label className="mt-3 block text-[11px] font-black text-slate-500">마지막 점검 경과: {minDays}일 초과
                <input type="range" min={0} max={180} step={5} value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} className="mt-1 w-full accent-blue-600" />
              </label>
            )}
            <button type="button" disabled={loading} onClick={() => void suggest()}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-blue-600 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40">
              <Wand2 size={15} />{loading ? "찾는 중…" : "가까운 순으로 추천"}
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
            <div>
              <div className="text-sm font-black text-slate-900">③ {kind === "renewal" ? "재계약" : "점검"} 후보 <span className="text-slate-400">{rows.length}곳</span></div>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">가까운 순 · 선택 {picked.size}곳</p>
            </div>
            <button type="button" disabled={loading || !picked.size} onClick={() => void register()}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-40">
              <CalendarPlus size={14} />선택 {picked.size}곳 일정 등록
            </button>
          </div>
          <div className="max-h-[64vh] divide-y divide-slate-100 overflow-y-auto">
            {rows.map((r) => {
              const on = picked.has(r.id);
              return (
                <label key={r.id} className={`flex cursor-pointer items-start gap-2.5 px-4 py-2.5 transition ${on ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(r.id)} className="mt-1 h-4 w-4 accent-blue-600" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {r.distance_km != null && <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-white">{r.distance_km < 1 ? `${Math.round(r.distance_km * 1000)}m` : `${r.distance_km}km`}</span>}
                      <span className="truncate text-[13px] font-black text-slate-900">{r.vendor || r.place_name}</span>
                      {r.grade && <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${["SS", "V"].includes(r.grade) ? "bg-purple-50 text-purple-700" : "bg-slate-100 text-slate-500"}`}>{r.grade}</span>}
                      {r.label && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-black text-blue-600">{r.label}</span>}
                      {r.never_visited && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-600">점검 이력 없음</span>}
                      {!r.quarter_ok && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-700">분기 초반 — 보류 권장</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-500">
                      {r.never_visited ? "마지막 점검 기록 없음" : `마지막 ${r.last_date} · ${r.days_since}일 경과`}
                    </span>
                    <span className="block truncate text-[10px] font-semibold text-slate-400"><MapPin size={9} className="mr-0.5 inline" />{r.addr || "주소 없음"}</span>
                  </span>
                </label>
              );
            })}
            {!rows.length && <div className="p-12 text-center text-xs font-bold text-slate-400">좌측에서 조건을 고르고 [가까운 순으로 추천]을 눌러 주세요.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
