/**
 * 분기점검 방문 안내 문자 — 현 분기 워킨맵(분기점검) 대상 업체에 "방문드리겠습니다" 인사 문자.
 * 해피콜(방문 후)과 짝을 이루는 방문 전 안내라 해피콜 탭 안의 모드로 둔다 (탭 난립 방지).
 * 레이아웃은 해피콜과 같은 2열 틀(다크 헤더 + 필터 스트립 + 좌측 목록/우측 작성) — 전환 시 화면이 안 튀게.
 * 등급·팀 선택, 완료(G5)·이관(G12) 제외, ⚠플래그 + 미수 잔액 업체 제외(돈 안 내면 점검 안 감 — 운영 원칙),
 * 휴대폰(01X)만·같은 번호 1통, 같은 분기 재발송 방지(quarter_notice_log), 확인 모달 + 테스트 발송.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MessageSquareText, Send, ShieldCheck } from "lucide-react";
import { insertRow, invokeEdgeFunction, selectAllRows, selectRows } from "./supabase";
import { workinVendorName } from "./ids";
import { getVendorFlagsBatch, type VendorWorkFlags } from "./vendorFlags";
import { VendorAlertChip } from "./VendorAlert";
import UnifiedHistory from "./UnifiedHistory";
import { HappyCallWorkspace } from "./CustomerEngagement";
import { notify } from "./toast";

type Place = { id: number; name: string; phone: string; team: string; label: string };
const GRADES = ["N", "NN", "S", "SS", "V"] as const;

const gradeOf = (name: string) => (name.match(/^\s*[\d/\-#]*\s*(V|SS|S|NN|N)(?=[^A-Za-z])/)?.[1] || "");
const mobileOf = (phone: string) => (String(phone || "").match(/01[016789][ -]?\d{3,4}[ -]?\d{4}/)?.[0] || "").replace(/[^\d]/g, "");

const DEFAULT_MESSAGE = `안녕하세요, {업체명} 담당자님. 사무기기 관리업체 퍼스트전산입니다.
이번 분기 정기 점검을 위해 기간 내 방문드려 인사드리겠습니다.
방문 전 연락드리며, 불편하신 점이 있으시면 언제든 말씀 부탁드립니다.
항상 저희 퍼스트전산을 이용해 주셔서 감사합니다.`;

function QuarterNoticeBoard({ author, switcher }: { author: string; switcher?: ReactNode }) {
  const now = new Date();
  const quarterNum = Math.floor(now.getMonth() / 3) + 1;
  const quarterKey = `${now.getFullYear()}-Q${quarterNum}`;
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [grades, setGrades] = useState<string[]>([...GRADES]);
  const [team, setTeam] = useState("전체");
  const [excludeDone, setExcludeDone] = useState(true);
  const [excludeSent, setExcludeSent] = useState(true);
  const [excludeMisu, setExcludeMisu] = useState(true); // 미수 잔액 있는 곳은 점검을 안 가므로 안내도 기본 제외
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [sentPhones, setSentPhones] = useState<Set<string>>(new Set());
  const [flags, setFlags] = useState<Map<string, VendorWorkFlags>>(new Map());
  const [histVendor, setHistVendor] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [testPhone, setTestPhone] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [rows, log] = await Promise.all([
          selectAllRows<Place>("workin_map_places", `select=id,name,phone,team,label&kind=eq.quarter&quarter=eq.${quarterNum}&visible=not.is.false`),
          selectRows<{ phone: string }>("quarter_notice_log", `select=phone&quarter=eq.${encodeURIComponent(quarterKey)}&limit=3000`).catch(() => [] as Array<{ phone: string }>),
        ]);
        if (!active) return;
        setPlaces(rows);
        setSentPhones(new Set(log.map((r) => r.phone)));
        // ⚠플래그 — 미수·불만·초과·재계약 (일정리스트와 같은 기준)
        void getVendorFlagsBatch(Array.from(new Set(rows.map((p) => workinVendorName(p.name)).filter(Boolean))))
          .then((map) => { if (active) setFlags(map); })
          .catch(() => undefined);
      } catch (e) {
        notify(`대상 불러오기 실패: ${(e as Error).message}`, "error");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [quarterNum, quarterKey]);

  // 팀 목록은 실데이터에서 — 현 분기 워킨맵에 있는 팀만 (E팀 지점이 생기면 자동 표시)
  const teamOptions = useMemo(() => ["전체", ...Array.from(new Set(places.map((p) => p.team).filter(Boolean))).sort()], [places]);
  const flagOf = (p: Place) => flags.get(workinVendorName(p.name));
  const hasMisu = (p: Place) => { const f = flagOf(p); return !!(f?.misu && !f.misu.cleared); };

  // 대상 계산: 등급·팀·라벨 → 미수 제외 → 휴대폰 있는 곳만 → 번호 중복 제거(지점 여러 개 = 1통)
  const { targets, scopeCount, misuExcluded, noPhone, alreadySent } = useMemo(() => {
    const scoped = places.filter((p) => {
      if (excludeDone && (p.label === "G5" || p.label === "G12")) return false;
      if (team !== "전체" && p.team !== team) return false;
      const g = gradeOf(p.name);
      return g ? grades.includes(g) : grades.length === GRADES.length; // 등급 없는 지점은 '전체'일 때만
    });
    const afterMisu = excludeMisu ? scoped.filter((p) => !hasMisu(p)) : scoped;
    const byPhone = new Map<string, Place>();
    let missing = 0;
    for (const p of afterMisu) {
      const phone = mobileOf(p.phone);
      if (!phone) { missing += 1; continue; }
      if (!byPhone.has(phone)) byPhone.set(phone, p);
    }
    const all = Array.from(byPhone.entries()).map(([phone, p]) => ({ phone, place: p, sent: sentPhones.has(phone) }));
    return {
      targets: all.filter((t) => !excludeSent || !t.sent),
      scopeCount: scoped.length,
      misuExcluded: scoped.length - afterMisu.length,
      noPhone: missing,
      alreadySent: all.filter((t) => t.sent).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, grades, team, excludeDone, excludeSent, excludeMisu, sentPhones, flags]);

  const picked = targets.filter((t) => !unchecked.has(t.place.id));
  const toggleGrade = (g: string) => setGrades((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
  const applyMessage = (vendor: string) => message.replaceAll("{업체명}", workinVendorName(vendor) || vendor);

  const sendTest = async () => {
    const to = testPhone.replace(/[^\d]/g, "");
    if (!/^01\d{8,9}$/.test(to)) { notify("테스트 휴대폰 번호를 확인해 주세요.", "error"); return; }
    try {
      await invokeEdgeFunction("customer-message-send", { channel: "sms", type: "quarter_notice_test", to, text: applyMessage(picked[0]?.place.name || "테스트업체"), author });
      notify("테스트 문자를 보냈습니다 — 받은 내용을 확인하세요 ✓", "success");
    } catch (e) { notify(`테스트 발송 실패: ${(e as Error).message}`, "error"); }
  };

  const sendAll = async () => {
    setConfirmOpen(false);
    if (!picked.length) return;
    setSending(true);
    setProgress({ done: 0, total: picked.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < picked.length; i += 1) {
      const t = picked[i];
      try {
        await invokeEdgeFunction("customer-message-send", { channel: "sms", type: "quarter_notice", to: t.phone, text: applyMessage(t.place.name), vendor: workinVendorName(t.place.name), author });
        await insertRow("quarter_notice_log", { quarter: quarterKey, place_id: t.place.id, vendor: workinVendorName(t.place.name), phone: t.phone, author }).catch(() => undefined);
        setSentPhones((cur) => new Set(cur).add(t.phone));
      } catch {
        failed += 1;
      }
      setProgress({ done: i + 1, total: picked.length, failed });
    }
    setSending(false);
    notify(failed ? `발송 완료 — 성공 ${picked.length - failed}건 · 실패 ${failed}건` : `${picked.length}곳에 분기점검 안내를 보냈습니다 ✓`, failed ? "error" : "success");
  };

  const gradeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of picked) { const g = gradeOf(t.place.name) || "기타"; counts[g] = (counts[g] || 0) + 1; }
    return counts;
  }, [picked]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(430px,.95fr)]">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-3 bg-[#1E252F] px-5 py-4">
          <div>
            <h2 className="text-base font-black text-white lg:text-lg">분기점검 안내</h2>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{quarterNum}분기 워킨맵(분기점검) 대상에게 방문 전 인사 문자 — 대표번호로 발송됩니다.</p>
          </div>
          {switcher}
        </div>
        <div className="flex flex-wrap items-center gap-2 bg-[#151A23] px-4 py-2.5">
          <div className="flex rounded-full bg-white/[0.07] p-1">
            {GRADES.map((g) => (
              <button key={g} type="button" onClick={() => toggleGrade(g)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${grades.includes(g) ? "bg-white text-slate-950" : "text-slate-500 hover:text-slate-300"}`}>{g}</button>
            ))}
            <button type="button" onClick={() => setGrades(grades.length === GRADES.length ? [] : [...GRADES])} className="rounded-full px-2.5 py-1.5 text-xs font-black text-blue-300">{grades.length === GRADES.length ? "해제" : "전체"}</button>
          </div>
          <div className="flex rounded-full bg-white/[0.07] p-1">
            {teamOptions.map((t) => (
              <button key={t} type="button" onClick={() => setTeam(t)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${team === t ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>{t === "전체" ? "전체" : `${t}팀`}</button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-300"><input type="checkbox" checked={excludeMisu} onChange={() => setExcludeMisu(!excludeMisu)} className="h-3.5 w-3.5 accent-rose-500" />미수 제외</label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-300"><input type="checkbox" checked={excludeDone} onChange={() => setExcludeDone(!excludeDone)} className="h-3.5 w-3.5 accent-blue-500" />완료·이관 제외</label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-300"><input type="checkbox" checked={excludeSent} onChange={() => setExcludeSent(!excludeSent)} className="h-3.5 w-3.5 accent-blue-500" />발송된 곳 제외</label>
        </div>
        {/* 워킨맵 지점 수와 문자 통수가 왜 다른지 — 깔때기 표기 */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] font-black text-slate-500">
          <span>지점 {scopeCount}곳</span>
          {excludeMisu && misuExcluded > 0 && <><span className="text-slate-300">→</span><span className="text-rose-600">미수 제외 −{misuExcluded}</span></>}
          <span className="text-slate-300">→</span><span>휴대폰 없음 −{noPhone}</span>
          <span className="text-slate-300">→</span><span className="text-blue-700">같은 번호 묶어 문자 {targets.length + (excludeSent ? alreadySent : 0)}통</span>
          {alreadySent > 0 && <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">발송됨 {alreadySent}</span>}
        </div>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
          <span className="text-sm font-black text-slate-900">발송 대상 <span className="text-blue-600">{picked.length}</span>/{targets.length}곳</span>
          <button type="button" onClick={() => setUnchecked(unchecked.size ? new Set() : new Set(targets.map((t) => t.place.id)))} className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-black text-slate-500 hover:bg-slate-50">{unchecked.size ? "전체 선택" : "전체 해제"}</button>
        </div>
        <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
          {loading && <div className="py-14 text-center text-sm font-bold text-slate-400">이번 분기 대상을 불러오는 중…</div>}
          {!loading && targets.map((t) => (
            <label key={t.place.id} className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-slate-50">
              <input type="checkbox" checked={!unchecked.has(t.place.id)} onChange={() => setUnchecked((cur) => { const next = new Set(cur); next.has(t.place.id) ? next.delete(t.place.id) : next.add(t.place.id); return next; })} className="h-4 w-4 shrink-0 accent-blue-600" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-black text-slate-900">{workinVendorName(t.place.name) || t.place.name}</span>
                  {gradeOf(t.place.name) && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${["SS", "V"].includes(gradeOf(t.place.name)) ? "bg-purple-50 text-purple-700" : "bg-slate-100 text-slate-500"}`}>{gradeOf(t.place.name)}</span>}
                  <VendorAlertChip flags={flagOf(t.place)} onOpen={() => setHistVendor(workinVendorName(t.place.name) || t.place.name)} />
                  {t.sent && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">발송됨</span>}
                </span>
                <span className="mt-0.5 block text-[11px] font-semibold text-slate-400">{t.place.team}팀 · {t.phone.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3")}</span>
              </span>
            </label>
          ))}
          {!loading && !targets.length && <div className="py-14 text-center text-sm font-bold text-slate-400">조건에 맞는 대상이 없습니다.</div>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-sm font-black text-slate-900"><MessageSquareText size={16} className="text-blue-600" />문자 내용 <span className="text-[10px] font-bold text-slate-400">{"{업체명}"} 자동 치환</span></div>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[13px] font-semibold leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <div className="mt-1 text-right text-[11px] font-bold text-slate-400">{message.length}자 {message.length > 88 ? "· LMS(장문)로 발송" : "· SMS"}</div>
          {picked[0] && <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2.5 text-[12px] font-semibold leading-5 text-slate-600"><div className="mb-1 text-[10px] font-black text-slate-400">미리보기 — {workinVendorName(picked[0].place.name)}</div>{applyMessage(picked[0].place.name)}</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-sm font-black text-slate-900"><ShieldCheck size={16} className="text-emerald-600" />발송</div>
          <div className="mt-2 flex gap-2">
            <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="내 휴대폰 번호로 테스트" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            <button type="button" onClick={() => void sendTest()} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50">테스트</button>
          </div>
          <button type="button" disabled={sending || !picked.length} onClick={() => setConfirmOpen(true)}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-blue-600 py-3 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40">
            <Send size={15} />{sending ? `발송 중… ${progress.done}/${progress.total}${progress.failed ? ` (실패 ${progress.failed})` : ""}` : `${picked.length}곳에 발송`}
          </button>
          <div className="mt-2 text-[11px] font-semibold leading-4 text-slate-400">발송 즉시 대표번호로 나갑니다. 같은 분기에 보낸 번호는 기록되어 다음에 자동 제외됩니다. ⚠칩을 누르면 통합이력으로 미수·불만을 확인할 수 있습니다.</div>
        </div>
      </section>

      {confirmOpen && (
        <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-black/45 p-5" onMouseDown={() => setConfirmOpen(false)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="bg-[#1E252F] px-5 py-4">
              <div className="text-[11px] font-black text-slate-400">{quarterNum}분기 점검 방문 안내 · 대표번호 발송</div>
              <div className="mt-0.5 text-[15px] font-black text-white">{picked.length}곳에 문자를 보낼까요?</div>
            </div>
            <div className="px-5 py-3">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(gradeCounts).map(([g, n]) => <span key={g} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">{g} {n}곳</span>)}
                {excludeMisu && misuExcluded > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-600">미수 {misuExcluded}곳 제외됨</span>}
              </div>
              <div className="mt-2 text-[12px] font-semibold leading-5 text-slate-500">보내고 나면 되돌릴 수 없습니다. 테스트 발송으로 문안을 먼저 확인하는 것을 권장합니다.</div>
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <button type="button" onClick={() => setConfirmOpen(false)} className="flex-1 rounded-full border border-slate-300 bg-white py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50">취소</button>
              <button type="button" onClick={() => void sendAll()} className="flex-[2] rounded-full bg-blue-600 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">발송</button>
            </div>
          </div>
        </div>
      )}
      <UnifiedHistory vendor={histVendor} accent="#2563eb" open={!!histVendor} onClose={() => setHistVendor("")} onError={(msg) => notify(msg, "error")} />
    </div>
  );
}

// 해피콜(방문 후) + 분기점검 안내(방문 전) — 둘 다 "고객에게 대표번호 문자"라 한 탭에서 모드로 오간다.
// 전환 알약은 각 화면 다크 헤더 안에 심고, 두 화면이 같은 2열 틀을 쓰므로 전환 시 레이아웃이 안 튄다.
export default function CustomerCallHub({ author }: { author: string }) {
  const [tab, setTab] = useState<"happycall" | "quarter">("happycall");
  const switcher = (
    <div className="flex shrink-0 gap-1 rounded-full bg-white/10 p-1">
      <button type="button" onClick={() => setTab("happycall")} className={`rounded-full px-4 py-1.5 text-xs font-black transition ${tab === "happycall" ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>해피콜</button>
      <button type="button" onClick={() => setTab("quarter")} className={`rounded-full px-4 py-1.5 text-xs font-black transition ${tab === "quarter" ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>분기점검 안내</button>
    </div>
  );
  return tab === "happycall" ? <HappyCallWorkspace author={author} switcher={switcher} /> : <QuarterNoticeBoard author={author} switcher={switcher} />;
}
