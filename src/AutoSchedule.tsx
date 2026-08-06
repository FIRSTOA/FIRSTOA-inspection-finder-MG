/**
 * 자동 일정 짜기 (1차 스캐폴드)
 * CS팀 실무 순서를 그대로 화면에 옮긴다:
 *   ① 그날 필수 스케줄을 먼저 놓고 → ② 마지막 필수 일정(앵커) 근처의 점검을 뽑고
 *   → ③ 같은 동선에 재계약·미수·초과료 조정이 있으면 끼워 넣는다.
 * 점검 후보 규칙은 DB 함수(suggest_inspection_candidates)에 있다:
 *   60일 초과 기본 / N·NN·S는 언제든 / SS·V는 분기 중반부터 권장.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, MapPin, RefreshCw, Wand2 } from "lucide-react";
import { rpc, selectRows, upsertRow } from "./supabase";
import { kstDate } from "./visits";

type Ticket = { id: string; date: string; time: string; team: string; vendor: string; address: string; assignee: string; scheduleType: string; status: string };
type Candidate = { vendor: string; grade: string; area: string; gu: string; addr: string; last_date: string | null; days_since: number; quarter_ok: boolean; never_visited: boolean; score: number };
type SideRow = { vendor: string; label: string; detail: string; kind: "재계약" | "미수" | "초과" };

const TEAMS = ["A", "B", "C", "D"] as const;
const TEAM_AREA: Record<string, string> = { A: "강북", B: "강서", C: "강남", D: "경기" };

/** 주소에서 구·동을 뽑아 동선 기준으로 쓴다 */
function areaOf(address: string) {
  const gu = address.match(/([가-힣]+구)/)?.[1] || "";
  const dong = address.match(/([가-힣]+동)\b/)?.[1] || "";
  return { gu, dong };
}

export default function AutoSchedule({ author }: { author: string }) {
  const [team, setTeam] = useState<string>("C");
  const [date, setDate] = useState(kstDate());
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [anchorId, setAnchorId] = useState("");
  const [manualAnchor, setManualAnchor] = useState("");
  const [minDays, setMinDays] = useState(60);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [side, setSide] = useState<SideRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  // ① 그날 필수 스케줄 — 일정리스트에서 그대로 가져온다
  const loadTickets = useCallback(async () => {
    const rows = await selectRows<Ticket>("as_tickets", `select=id,date,time,team,vendor,address,assignee,scheduleType,status&date=eq.${date}&team=eq.${team}&order=time.asc`).catch(() => [] as Ticket[]);
    setTickets(rows);
    setAnchorId(rows.length ? rows[rows.length - 1].id : ""); // 마지막 일정이 기본 앵커
  }, [date, team]);
  useEffect(() => { void loadTickets(); }, [loadTickets]);

  const anchor = useMemo(() => {
    const t = tickets.find((x) => x.id === anchorId);
    if (t) return { label: `${t.vendor}${t.time ? ` (${t.time})` : ""}`, ...areaOf(t.address || "") };
    if (manualAnchor.trim()) return { label: manualAnchor.trim(), ...areaOf(manualAnchor) };
    return { label: "", gu: "", dong: "" };
  }, [tickets, anchorId, manualAnchor]);

  // ② 앵커 근처 점검 후보 + ③ 같은 동선의 재계약·미수·초과
  const suggest = async () => {
    setLoading(true);
    setNotice("");
    try {
      const rows = await rpc<Candidate[]>("suggest_inspection_candidates", {
        p_area: TEAM_AREA[team] || "", p_anchor_gu: anchor.gu, p_anchor_dong: anchor.dong, p_min_days: minDays, p_limit: 60,
      });
      setCandidates(rows || []);

      const near = anchor.gu || "";
      const [recon, misu, over] = await Promise.all([
        near ? selectRows<Record<string, string>>("recontract", `select=*&${encodeURIComponent("_업체명")}=not.is.null&limit=300`).catch(() => []) : Promise.resolve([]),
        near ? selectRows<Record<string, string>>("misu", `select=*&limit=300`).catch(() => []) : Promise.resolve([]),
        near ? selectRows<Record<string, string>>("overage", `select=*&limit=300`).catch(() => []) : Promise.resolve([]),
      ]);
      const pickNear = (list: Record<string, string>[], kind: SideRow["kind"], detailKeys: string[]): SideRow[] =>
        list
          .filter((r) => String(r["지역"] || r["담당팀"] || "").includes(team) || String(r["_원문"] || "").includes(near))
          .slice(0, 8)
          .map((r) => ({
            vendor: String(r["_업체명"] || r["업체명"] || ""),
            label: kind,
            detail: detailKeys.map((k) => (r[k] ? `${k} ${r[k]}` : "")).filter(Boolean).join(" · "),
            kind,
          }))
          .filter((r) => r.vendor);
      setSide([
        ...pickNear(recon, "재계약", ["계약종료일", "진행상황"]),
        ...pickNear(misu, "미수", ["미수개월수", "미수금액"]),
        ...pickNear(over, "초과", ["초과금액", "등급"]),
      ]);
      setNotice(`${(rows || []).length}곳 추천 — 앵커 ${anchor.label || "미지정"}${anchor.gu ? ` (${anchor.gu}${anchor.dong ? ` ${anchor.dong}` : ""})` : ""}`);
    } catch (e) {
      setNotice(`추천 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  };

  const toggle = (vendor: string) => setPicked((cur) => { const next = new Set(cur); next.has(vendor) ? next.delete(vendor) : next.add(vendor); return next; });

  // 선택한 곳을 일정리스트에 일괄 등록 (기본 상태 접수 · 매월점검 아닌 AS 일정)
  const register = async () => {
    const chosen = candidates.filter((c) => picked.has(c.vendor));
    if (!chosen.length) { setNotice("등록할 업체를 선택해 주세요."); return; }
    if (!window.confirm(`${chosen.length}곳을 ${date} ${team}팀 일정으로 등록할까요?`)) return;
    setLoading(true);
    try {
      for (const c of chosen) {
        await upsertRow("as_tickets", {
          id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          team, date, time: "09:00", vendor: c.vendor, contact: "", address: c.addr, department: "",
          model: "", serial: "", asset: "", grade: c.grade, keyman: "",
          issue: `정기점검 (마지막 ${c.last_date || "기록 없음"} · ${c.days_since >= 9999 ? "이력 없음" : `${c.days_since}일 경과`})`,
          note: "", assignee: "", status: "접수", scheduleType: "매월점검", receptionId: "", calendarTitle: `점검 ${c.vendor}`,
        }, "id");
      }
      setPicked(new Set());
      setNotice(`${chosen.length}곳을 일정리스트에 등록했습니다 (작성 ${author}).`);
      void loadTickets();
    } catch (e) {
      setNotice(`등록 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  };

  const chip = "rounded-full px-3 py-1.5 text-xs font-black transition";

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl bg-[#1E252F] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-[15px] font-black text-white">자동 일정 짜기 <span className="ml-1 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] text-amber-300">1차 시안</span></div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">필수 일정을 놓고 → 마지막 일정 근처의 점검을 추천 → 재계약·미수·초과료를 같은 동선으로 묶습니다.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-black text-white outline-none" />
            <div className="flex gap-1 rounded-full bg-white/10 p-1">
              {TEAMS.map((t) => (
                <button key={t} type="button" onClick={() => setTeam(t)} className={`${chip} ${team === t ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>{t}팀</button>
              ))}
            </div>
          </div>
        </div>
        <div className="bg-[#151A23] px-5 py-2 text-[11px] font-bold text-slate-400">
          점검 기준 <span className="text-white">{minDays}일 초과</span> · SS·V는 분기 중반부터 권장 · 담당지역 {TEAM_AREA[team]}
        </div>
      </section>

      {notice && <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-xs font-black text-blue-700">{notice}</div>}

      <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
        <section className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-black text-slate-900">① 필수 스케줄 <span className="text-slate-400">{tickets.length}건</span></div>
              <button type="button" onClick={() => void loadTickets()} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-black text-slate-500"><RefreshCw size={12} />새로고침</button>
            </div>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">기준(앵커)으로 삼을 마지막 일정을 고르세요 — 그 근처로 점검을 찾습니다.</p>
            <div className="mt-2 space-y-1">
              {tickets.map((t) => (
                <label key={t.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition ${anchorId === t.id ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
                  <input type="radio" checked={anchorId === t.id} onChange={() => { setAnchorId(t.id); setManualAnchor(""); }} className="mt-0.5 h-4 w-4 accent-blue-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-black text-slate-900">{t.time} {t.vendor}</span>
                    <span className="block truncate text-[11px] font-semibold text-slate-400">{t.address || "주소 없음"}</span>
                  </span>
                </label>
              ))}
              {!tickets.length && <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs font-bold text-slate-400">이 날짜의 {team}팀 일정이 없습니다.</div>}
            </div>
            <label className="mt-2 block text-[11px] font-black text-slate-500">직접 입력 (주소 또는 업체명)
              <input value={manualAnchor} onChange={(e) => { setManualAnchor(e.target.value); setAnchorId(""); }} placeholder="예: 서울 강남구 역삼동 …"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </label>
            <label className="mt-2 block text-[11px] font-black text-slate-500">점검 기준 경과일: {minDays}일
              <input type="range" min={30} max={180} step={5} value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} className="mt-1 w-full accent-blue-600" />
            </label>
            <button type="button" disabled={loading} onClick={() => void suggest()}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-blue-600 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40">
              <Wand2 size={15} />{loading ? "추천 중…" : "동선 기준 추천받기"}
            </button>
          </div>

          {!!side.length && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-black text-slate-900">③ 같이 묶을 후보</div>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">같은 팀·동선의 재계약·미수·초과료 — 점검 가는 김에 처리</p>
              <div className="mt-2 space-y-1">
                {side.map((r, i) => (
                  <div key={`${r.kind}-${r.vendor}-${i}`} className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${r.kind === "재계약" ? "bg-emerald-50 text-emerald-700" : r.kind === "미수" ? "bg-amber-50 text-amber-700" : "bg-purple-50 text-purple-700"}`}>{r.kind}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-black text-slate-800">{r.vendor}</span>
                      {r.detail && <span className="block truncate text-[10px] font-semibold text-slate-400">{r.detail}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
            <div>
              <div className="text-sm font-black text-slate-900">② 점검 추천 <span className="text-slate-400">{candidates.length}곳</span></div>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">앵커와 같은 구·동일수록 위로 옵니다 · 선택 {picked.size}곳</p>
            </div>
            <button type="button" disabled={loading || !picked.size} onClick={() => void register()}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-40">
              <CalendarPlus size={14} />선택 {picked.size}곳 일정 등록
            </button>
          </div>
          <div className="max-h-[62vh] divide-y divide-slate-100 overflow-y-auto">
            {candidates.map((c) => {
              const on = picked.has(c.vendor);
              return (
                <label key={c.vendor} className={`flex cursor-pointer items-start gap-2.5 px-4 py-2.5 transition ${on ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.vendor)} className="mt-1 h-4 w-4 accent-blue-600" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[13px] font-black text-slate-900">{c.vendor}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${["SS", "V"].includes(c.grade) ? "bg-purple-50 text-purple-700" : "bg-slate-100 text-slate-500"}`}>{c.grade}</span>
                      {c.never_visited && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-600">점검 이력 없음</span>}
                      {!c.quarter_ok && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-700">분기 초반 — 급하지 않으면 보류</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-500">
                      {c.never_visited ? "마지막 점검 기록 없음" : `마지막 ${c.last_date} · ${c.days_since}일 경과`}
                      {c.gu ? ` · ${c.gu}` : ""}
                    </span>
                    <span className="block truncate text-[10px] font-semibold text-slate-400"><MapPin size={9} className="mr-0.5 inline" />{c.addr || "주소 없음"}</span>
                  </span>
                </label>
              );
            })}
            {!candidates.length && <div className="p-12 text-center text-xs font-bold text-slate-400">좌측에서 앵커를 고르고 [동선 기준 추천받기]를 눌러 주세요.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
