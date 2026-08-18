/**
 * 자동 일정 짜기 (1차 시안)
 * CS팀 실무 순서 그대로: ① 그날 필수 스케줄을 놓고 → ② 마지막 일정(앵커) 좌표에서
 * 가까운 순으로 워킨맵 점검 후보를 뽑고 → ③ 같은 동선의 재계약도 끼워 넣는다.
 * 후보는 전부 **현재 분기 워킨맵**에서만 찾는다 (suggest_workin_candidates RPC).
 * 규칙: 마지막 점검 경과일 기준(조절 가능) · N·NN·S는 언제든 · SS·V는 분기 중반부터 권장.
 */
import { parseEquipComment } from "./ids";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, MapPin, RefreshCw, Wand2 } from "lucide-react";
import { rpc, selectRows, upsertRow } from "./supabase";
import { historyCoreName, vendorMatchKey } from "./ids";
import { vendorNameByCode } from "./vendorCodes";
import { geocodeKR } from "./geocode";
import { kstDate } from "./visits";
import { defaultPlanDate, nextBusinessDay } from "./planDate";
import { getVendorFlagsBatch, type VendorWorkFlags } from "./vendorFlags";
import { VendorAlertChip } from "./VendorAlert";
import UnifiedHistory from "./UnifiedHistory";
import { usageSpareAdvice } from "./spareAdvice";

type Ticket = { id: string; date: string; time: string; team: string; vendor: string; address: string; scheduleType: string };
type Place = {
  id: number; place_name: string; vendor: string; grade: string; label: string; addr: string;
  lat: number | null; lng: number | null; comment: string;
  last_date: string | null; days_since: number; distance_km: number | null; quarter_ok: boolean; never_visited: boolean;
  code: string;
  prev_date: string | null; last_pages: string | null; prev_pages: string | null;
  last_toner: string | null; last_spare: string | null; last_waste: string | null;
  last_serial: string | null; prev_serial: string | null; last_special: string | null;
  device_count: number; devices: string | null;
};

const TEAMS = ["A", "B", "C", "D"] as const;
const GRADES = ["N", "NN", "S", "SS", "V"] as const;

export default function AutoSchedule({ author }: { author: string }) {
  const [team, setTeam] = useState("C");
  const [date, setDate] = useState(defaultPlanDate()); // 오후 4시 이후엔 다음 영업일이 기본 (내일 일정 짜는 시간)
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [onlyMine, setOnlyMine] = useState(true);
  const [anchorId, setAnchorId] = useState("");
  const [anchorQuery, setAnchorQuery] = useState("");
  const [anchorGeo, setAnchorGeo] = useState<{ name: string; lat: number; lng: number } | null>(null);
  const [grades, setGrades] = useState<string[]>(["N", "NN", "S"]);
  const [minDays, setMinDays] = useState(60);
  const [kind, setKind] = useState<"quarter" | "renewal">("quarter");
  const [rows, setRows] = useState<Place[]>([]);
  const [flags, setFlags] = useState<Map<string, VendorWorkFlags>>(new Map()); // 불만·미수·초과·재계약·점검 (일정리스트와 같은 기준)
  const [histVendor, setHistVendor] = useState(""); // ⚠ 칩 클릭 → 통합이력 팝업
  // 코드가 붙은 후보는 마스터 대표명으로 검색(정확) — 워킨맵 잡문 이름 폴백
  const openPlaceHistory = (r: { vendor: string; place_name: string; code: string }) => {
    const fallback = historyCoreName(r.vendor || r.place_name);
    if (!r.code) { setHistVendor(fallback); return; }
    void vendorNameByCode(r.code).then((name) => setHistVendor(name || fallback)).catch(() => setHistVendor(fallback));
  };
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
      const found = await geocodeKR(q);
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
      void getVendorFlagsBatch((list || []).map((r) => r.vendor || r.place_name)).then(setFlags).catch(() => undefined);
    } catch (e) {
      setNotice(`추천 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  };

  const toggleGrade = (g: string) => setGrades((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
  const toggle = (id: number) => setPicked((cur) => { const next = new Set(cur); next.has(id) ? next.delete(id) : next.add(id); return next; });

  // 같은 코드(사업자)의 지점들 = 같은 회사의 기기들 — 방문 1건으로 묶는다 (빅오션 3층/2층/지하1층 → 카드 1장)
  type Group = { key: string; rep: string; members: Place[] };
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Place[]>();
    const order: string[] = [];
    rows.forEach((r) => {
      const key = r.code || `k:${vendorMatchKey(r.vendor || r.place_name).slice(0, 10) || r.id}`;
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key)!.push(r);
    });
    const commonPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i += 1; return a.slice(0, i); };
    return order.map((key) => {
      const members = map.get(key)!;
      let rep = members[0].vendor || members[0].place_name;
      for (const m of members.slice(1)) rep = commonPrefix(rep, m.vendor || m.place_name);
      rep = rep.replace(/[\s\-·,(/]+$/, "").trim();
      if (rep.length < 4) rep = members[0].vendor || members[0].place_name;
      return { key, rep, members };
    });
  }, [rows]);
  const memberTail = (group: Group, member: Place) => {
    const name = member.vendor || member.place_name;
    const tail = name.startsWith(group.rep) ? name.slice(group.rep.length).replace(/^[\s\-·,]+/, "").trim() : "";
    return tail || parseEquipComment(member.comment).model || `기기 ${group.members.indexOf(member) + 1}`;
  };
  const toggleGroup = (group: Group) => setPicked((cur) => {
    const next = new Set(cur);
    const allOn = group.members.every((m) => next.has(m.id));
    group.members.forEach((m) => { if (allOn) next.delete(m.id); else next.add(m.id); });
    return next;
  });


  const [registerConfirm, setRegisterConfirm] = useState(false);
  const [candLimit, setCandLimit] = useState(12); // 후보 목록 표시 개수 — '더 보기'로 늘린다
  useEffect(() => { setCandLimit(12); }, [kind, team, rows.length]);
  const register = async () => {
    setRegisterConfirm(false);
    const chosenGroups = groups.map((group) => ({ ...group, members: group.members.filter((m) => picked.has(m.id)) })).filter((group) => group.members.length);
    if (!chosenGroups.length) return;
    setLoading(true);
    try {
      for (const group of chosenGroups) {
        // 같은 회사 기기 여러 대 = 방문 1건 — 일정 1개로 등록하고 기기 목록은 메모에 (FIELD 점검 양식이 여러 대를 지원한다)
        const first = group.members[0];
        const eq = parseEquipComment(first.comment);
        const multi = group.members.length > 1;
        const vendorName = multi ? group.rep : (first.vendor || first.place_name);
        const machineNote = multi
          ? `워킨맵 등록 ${group.members.length}곳 — ${group.members.map((m) => { const meq = parseEquipComment(m.comment); return `${memberTail(group, m)}${meq.model ? `: ${meq.model}` : ""}${meq.serial ? `/${meq.serial}` : ""}`; }).join(" · ")}`.slice(0, 400)
          : "";
        const lastDate = group.members.map((m) => m.last_date || "").sort().at(-1) || "";
        const minDaysSince = Math.min(...group.members.map((m) => m.days_since));
        await upsertRow("as_tickets", {
          id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          team, date, time: "", vendor: vendorName, contact: "", address: first.addr, department: "", // 자동 배정 일정은 시간 미정 — 순서는 내 일정 동선이 정한다
          model: eq.model, serial: eq.serial, asset: "", grade: first.grade, keyman: "",
          issue: `${kind === "renewal" ? "재계약 방문" : `정기점검 (마지막 ${lastDate || "기록 없음"}${minDaysSince < 9999 ? ` · ${minDaysSince}일 경과` : ""})`}${multi ? ` · 기기 ${group.members.length}대` : ""}`,
          note: machineNote, assignee: author, status: "배정", scheduleType: kind === "renewal" ? "AS" : "매월점검",
          receptionId: "", calendarTitle: `${kind === "renewal" ? "재계약" : "점검"} ${vendorName}`, source: "autoplan",
        }, "id");
      }
      setPicked(new Set());
      setNotice(`${chosenGroups.length}곳 등록 완료 (${author}) — 일정리스트에서 확인하세요.`);
      void loadTickets();
    } catch (e) {
      setNotice(`등록 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  };

  // 같은 건물(도로명+번지)에 법인 그룹이 여럿 — 청연원 건물처럼 한 방문으로 처리하는 관행을 동선 단계에서 보이게
  const buildingKey = (addr: string) => {
    const match = String(addr || "").match(/^(.*?(?:로|길)\s*\d+(?:-\d+)?)/);
    return (match ? match[1] : String(addr || "")).replace(/\s+/g, "");
  };
  const buildingMates = useMemo(() => {
    const counts = new Map<string, { groups: number; devices: number }>();
    groups.forEach((group) => {
      const key = buildingKey(group.members[0].addr);
      if (!key) return;
      const mfp = Number(String(group.members[0].devices || "").match(/복합기 (\d+)/)?.[1] || 0) || group.members[0].device_count || group.members.length;
      const cur = counts.get(key) || { groups: 0, devices: 0 };
      cur.groups += 1;
      cur.devices += mfp;
      counts.set(key, cur);
    });
    return counts;
  }, [groups]);
  const buildingBadge = (addr: string) => {
    const mates = buildingMates.get(buildingKey(addr));
    return mates && mates.groups > 1
      ? <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-black text-cyan-700">🏢 같은 건물 {mates.groups}개 법인 · 총 {mates.devices}대</span>
      : null;
  };

  const chip = "rounded-full px-3 py-1.5 text-xs font-black transition";
  const gradeChip = (on: boolean) => `rounded-full px-3 py-1.5 text-xs font-black transition ${on ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`;
  const anchorLabel = anchorTicket?.vendor || anchorQuery.trim();

  return (
    <div className="max-w-full space-y-3 overflow-x-hidden">
      <section className="overflow-hidden rounded-xl bg-[#1E252F] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-[15px] font-black text-white">자동 일정 짜기</div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">필수 일정을 놓고 → 마지막 일정에서 가까운 워킨맵 점검·재계약을 추천합니다.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex max-w-full flex-wrap items-center gap-1">
              <button type="button" onClick={() => setDate(kstDate())} className={`rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${date === kstDate() ? "bg-white text-slate-950" : "bg-white/10 text-slate-300 hover:text-white"}`}>오늘</button>
              <button type="button" onClick={() => setDate(nextBusinessDay(kstDate()))} className={`rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${date === nextBusinessDay(kstDate()) ? "bg-white text-slate-950" : "bg-white/10 text-slate-300 hover:text-white"}`}>내일</button>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-w-0 rounded-lg border border-white/15 bg-white/10 px-2 py-2 text-xs font-black text-white outline-none" />
            </div>
            <div className="flex gap-1 rounded-full bg-white/10 p-1">
              {TEAMS.map((t) => <button key={t} type="button" onClick={() => setTeam(t)} className={`${chip} ${team === t ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>{t}팀</button>)}
            </div>
          </div>
        </div>
        <div className="bg-[#151A23] px-5 py-2 text-[11px] font-bold text-slate-400">
          현재 분기 워킨맵에서만 찾습니다 · 앵커 {anchorGeo ? <span className="text-emerald-300">좌표 확인됨</span> : <span className="text-amber-300">좌표 없음</span>}
        </div>
      </section>

      {notice && <div className="break-words rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-xs font-black text-blue-700">{notice}</div>}

      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[340px_1fr]">
        <section className="min-w-0 space-y-3">
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
                  <span className="min-w-0 flex-1 overflow-hidden">
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

        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
            <div>
              <div className="text-sm font-black text-slate-900">③ {kind === "renewal" ? "재계약" : "점검"} 후보 <span className="text-slate-400">{rows.length}곳</span></div>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">가까운 순 · 선택 {picked.size}곳</p>
            </div>
            <button type="button" disabled={loading || !picked.size} onClick={() => setRegisterConfirm(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-40">
              <CalendarPlus size={14} />선택 {groups.filter((g) => g.members.some((m) => picked.has(m.id))).length}곳 일정 등록
            </button>
          </div>
          {/* 내부 스크롤(64vh)이 카드를 중간에서 자르고 페이지 스크롤과 겹쳐 답답했다(사용자 지적) →
              페이지 흐름으로 두고 12곳씩 '더 보기'로 늘린다(후보가 수십 곳이어도 렌더가 가볍다) */}
          <div className="divide-y divide-slate-100">
            {groups.slice(0, candLimit).map((group) => {
              const single = group.members.length === 1;
              const first = group.members[0];
              const allOn = group.members.every((m: Place) => picked.has(m.id));
              const fl = flags.get((first.vendor || first.place_name).trim());
              if (single) {
                const r = first;
                const on = picked.has(r.id);
                // 최근 2회 점검으로 사용량·여분 권장 계산 — MyPlan의 여분 분석과 같은 헬퍼
                const latest = r.last_date ? { date: r.last_date, counts: r.last_pages || "", toner: r.last_toner || "", spare: r.last_spare || "", waste: r.last_waste || "", serial: r.last_serial || "" } : undefined;
                const previous = r.prev_date ? { date: r.prev_date, counts: r.prev_pages || "", toner: "", spare: "", serial: r.prev_serial || "" } : undefined;
                const advice = usageSpareAdvice(latest, previous, parseEquipComment(r.comment).model || r.devices || "");
                const special = String(r.last_special || "").replace(/[ㅡ\-_.\s]/g, "") ? String(r.last_special).trim() : ""; // "ㅡㅡㅡ" 채움표시는 특이사항 아님
                return (
                  <label key={group.key} className={`flex cursor-pointer items-start gap-2.5 px-4 py-2.5 transition ${on ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(r.id)} className="mt-1 h-4 w-4 accent-blue-600" />
                    <span className="min-w-0 flex-1 overflow-hidden">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {r.distance_km != null && <span className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-white">{r.distance_km < 1 ? `${Math.round(r.distance_km * 1000)}m` : `${r.distance_km}km`}</span>}
                        <span className="min-w-0 max-w-full truncate text-[13px] font-black text-slate-900">{r.vendor || r.place_name}</span>
                        {r.grade && <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${["SS", "V"].includes(r.grade) ? "bg-purple-50 text-purple-700" : "bg-slate-100 text-slate-500"}`}>{r.grade}</span>}
                        {r.label && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-black text-blue-600">{r.label}</span>}
                        {r.never_visited && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-600">점검 이력 없음</span>}
                        {!r.quarter_ok && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-700">분기 초반 — 보류 권장</span>}
                        {buildingBadge(r.addr)}
                        <VendorAlertChip flags={fl} onOpen={() => openPlaceHistory(r)} />
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-500">
                        {r.never_visited ? "마지막 점검 기록 없음" : `마지막 ${r.last_date} · ${r.days_since}일 경과`}
                        {r.device_count > 0 && <span className="ml-1.5 text-slate-400">🖨 {r.device_count}대{r.devices ? ` · ${r.devices}` : ""}</span>}
                      </span>
                      {r.last_pages && <span className="block truncate text-[10px] font-semibold text-slate-500">📊 {r.last_pages.trim()}{r.prev_pages ? ` ｜ 전전(${(r.prev_date || "").slice(5)}) ${r.prev_pages.trim()}` : ""}</span>}
                      {advice?.usageLine && <span className="block truncate text-[10px] font-bold text-blue-600">📈 {advice.usageLine}</span>}
                      {(r.last_spare || advice?.adviceLine) && <span className="block truncate text-[10px] font-bold text-emerald-700">🧰 여분 {String(r.last_spare || "-").trim()}{advice?.adviceLine ? ` → ${advice.adviceLine}` : ""}</span>}
                      {advice?.warning && <span className="block truncate text-[10px] font-bold text-amber-600">⚠ {advice.warning}</span>}
                      {special && <span className="block truncate text-[10px] font-bold text-rose-600">❗ {special}</span>}
                      <span className="block truncate text-[10px] font-semibold text-slate-400"><MapPin size={9} className="mr-0.5 inline" />{r.addr || "주소 없음"}</span>
                    </span>
                  </label>
                );
              }
              // 같은 회사 기기 여러 대 — 카드 1장, 방문 1건
              const distances = group.members.map((m: Place) => m.distance_km).filter((d: number | null): d is number => d != null);
              const lastDate = group.members.map((m: Place) => m.last_date || "").sort().at(-1) || "";
              const minDaysSince = Math.min(...group.members.map((m: Place) => m.days_since));
              const allNever = group.members.every((m: Place) => m.never_visited);
              // "기기 N대"는 임대리스트 기준 — 워킨맵에 지점(기기)이 일부만 등록된 업체(청연원 9대 중 3곳)가 있다
              const mfpCount = Number(String(first.devices || "").match(/복합기 (\d+)/)?.[1] || 0);
              // 임대리스트 기번→코드 매핑이 빠진 기기(청연원 B5650 등)는 코드 집계에서 새니, 워킨맵 등록 수와의 최댓값으로
              const deviceTotal = Math.max(mfpCount || first.device_count || 0, group.members.length);
              return (
                <label key={group.key} className={`flex cursor-pointer items-start gap-2.5 px-4 py-2.5 transition ${allOn ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                  <input type="checkbox" checked={allOn} onChange={() => toggleGroup(group)} className="mt-1 h-4 w-4 accent-blue-600" />
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {distances.length > 0 && <span className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-white">{Math.min(...distances) < 1 ? `${Math.round(Math.min(...distances) * 1000)}m` : `${Math.min(...distances)}km`}</span>}
                      <span className="min-w-0 max-w-full truncate text-[13px] font-black text-slate-900">{group.rep}</span>
                      <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-black text-white">기기 {deviceTotal}대</span>
                      {first.grade && <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${["SS", "V"].includes(first.grade) ? "bg-purple-50 text-purple-700" : "bg-slate-100 text-slate-500"}`}>{first.grade}</span>}
                      {allNever && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-600">점검 이력 없음</span>}
                      {!first.quarter_ok && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-700">분기 초반 — 보류 권장</span>}
                      {buildingBadge(first.addr)}
                      <VendorAlertChip flags={fl} onOpen={() => openPlaceHistory(first)} />
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-500">
                      {allNever ? "마지막 점검 기록 없음" : `마지막 ${lastDate} · ${minDaysSince}일 경과`} · 워킨맵 {group.members.length}곳{deviceTotal > group.members.length ? ` (기기 ${deviceTotal - group.members.length}대는 워킨맵 미등록)` : ""} · 방문 1건으로 등록
                    </span>
                    <span className="mt-1 block space-y-0.5">
                      {group.members.map((m: Place) => {
                        const eq = parseEquipComment(m.comment);
                        // 코드 묶음의 이력은 그룹 공통이라 그대로 뿌리면 같은 사용량이 전 기기에 복제된다
                        // — 최근 기록의 기번·시리얼과 이 기기가 일치할 때만 그 기기의 수치로 보여준다
                        const mine = !!eq.serial && !!m.last_serial && (eq.serial.replace(/[^0-9a-z]/gi, "").toLowerCase() === String(m.last_serial).replace(/[^0-9a-z]/gi, "").toLowerCase());
                        const latest = mine && m.last_date ? { date: m.last_date, counts: m.last_pages || "", toner: m.last_toner || "", spare: m.last_spare || "", waste: m.last_waste || "", serial: m.last_serial || "" } : undefined;
                        const previous = mine && m.prev_date ? { date: m.prev_date, counts: m.prev_pages || "", toner: "", spare: "", serial: m.prev_serial || "" } : undefined;
                        const advice = latest ? usageSpareAdvice(latest, previous, eq.model) : null;
                        return <span key={m.id} className="block truncate text-[10px] font-semibold text-slate-500">
                          <span className="rounded bg-slate-100 px-1 py-0.5 font-bold text-slate-600">{memberTail(group, m)}</span>
                          {eq.model && <span className="ml-1">{eq.model}{eq.serial ? `/${eq.serial}` : ""}</span>}
                          {mine && m.last_date && <span className="ml-1 text-slate-400">마지막 {m.last_date.slice(2)}</span>}
                          {advice?.usageLine && <span className="ml-1 font-bold text-blue-600">📈 {advice.usageLine.replace(/^.*\(/, "").replace(/\)$/, "")}</span>}
                          {advice?.adviceLine && !/기록 없음/.test(advice.adviceLine) && <span className="ml-1 font-bold text-emerald-700">🧰 {advice.adviceLine.replace(/\s*\(.+\)\s*$/, "")}</span>}
                        </span>;
                      })}
                    </span>
                    <span className="block truncate text-[10px] font-semibold text-slate-400"><MapPin size={9} className="mr-0.5 inline" />{first.addr || "주소 없음"}</span>
                  </span>
                </label>
              );
            })}
            {!rows.length && <div className="p-12 text-center text-xs font-bold text-slate-400">좌측에서 조건을 고르고 [가까운 순으로 추천]을 눌러 주세요.</div>}
            {groups.length > candLimit && (
              <button type="button" onClick={() => setCandLimit((n) => n + 12)}
                className="w-full py-3 text-sm font-black text-slate-500 transition hover:bg-slate-50">
                더 보기 ({candLimit} / {groups.length}곳)
              </button>
            )}
          </div>
        </section>
      </div>
      <UnifiedHistory vendor={histVendor} accent="#2563eb" open={!!histVendor} onClose={() => setHistVendor("")} onError={(msg) => setNotice(msg)} />
      {registerConfirm && (() => {
        const chosen = groups.map((group: Group) => ({ ...group, members: group.members.filter((m: Place) => picked.has(m.id)) })).filter((group: Group) => group.members.length);
        return (
          <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-black/45 p-5" onMouseDown={() => setRegisterConfirm(false)}>
            <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
              <div className="bg-[#1E252F] px-5 py-4">
                <div className="text-[11px] font-black text-slate-400">{date} · {team}팀 · {kind === "renewal" ? "재계약" : "점검"}</div>
                <div className="mt-0.5 text-[15px] font-black text-white">{chosen.length}곳 일정 등록</div>
              </div>
              <div className="max-h-[38vh] space-y-1 overflow-y-auto px-5 py-3">
                {chosen.map((group: Group) => (
                  <div key={group.key} className="flex items-center gap-2 text-[12px] font-bold text-slate-700">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                    <span className="truncate">{group.members.length > 1 ? group.rep : (group.members[0].vendor || group.members[0].place_name)}</span>
                    {group.members.length > 1 && <span className="shrink-0 rounded bg-indigo-50 px-1.5 text-[10px] font-black text-indigo-600">기기 {group.members.length}대</span>}
                    {group.members[0].distance_km != null && <span className="shrink-0 text-[10px] font-black text-slate-400">{group.members[0].distance_km < 1 ? `${Math.round(group.members[0].distance_km * 1000)}m` : `${group.members[0].distance_km}km`}</span>}
                  </div>
                ))}
              </div>
              <div className="px-5 pb-2 text-[11px] font-bold text-slate-400">✅ {author}에게 배정되어 일정리스트의 [내 일정]에 바로 나타납니다.</div>
              <div className="flex gap-2 px-4 pb-4">
                <button type="button" onClick={() => setRegisterConfirm(false)} className="flex-1 rounded-full border border-slate-300 bg-white py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50">취소</button>
                <button type="button" onClick={() => void register()} className="flex-[2] rounded-full bg-blue-600 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">등록</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
