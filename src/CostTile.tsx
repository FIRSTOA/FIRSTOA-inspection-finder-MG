/**
 * 홈 관제 덱 안의 "비용" 칸 + 자세히 창 (2026-10-11 — "LIVE OPERATIONS 안에, 일별·실시간·지금까지 내역")
 *
 * - 재료: ai_usage(통합검색 질문마다 토큰·추정 비용, 서버 함수가 기록) + message_jobs(앱에서 직접 보낸 문자, source_type direct:*)
 * - 칸: 이번 달 AI 금액·문자 금액·월말 예상·오늘 질문 수. 60초마다(보이는 동안) 다시 읽어 "실시간"에 가깝게.
 * - 자세히 창: 오늘(실시간) · 이 달 일별 표 · 지금까지 전체 합계 · 최근 질문 내역(누가·언제·무슨 질문·토큰·금액·걸린 시간)
 * - 단가: AI 는 서버가 기록한 usd(공식 가격표 기본값), 문자는 솔라피 공개 요금(단문 18·장문 45·사진 110원, 부가세 별도) — app_config 로 덮어쓸 수 있다
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { getConfig, invokeEdgeFunction, selectRows } from "./supabase";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { useScreenActive } from "./screenActive";

type AiRow = { created_at: string; fn: string; author: string; question: string; input_tokens: number; cached_tokens: number; output_tokens: number; usd: number | null; ms: number };
type MsgRow = { sent_at: string; message: string; channel: string; payload: { mms?: boolean; solapi_type?: string } | null };
type MsgKind = "SMS" | "LMS" | "MMS" | "ATA";
const ATA_DEFAULT_KRW = 13; // 솔라피 공개 요금 카카오 알림톡 13원(2026-10-11 조회, 부가세 별도). 다르면 app_config ATA_PRICE_KRW

const KST = 9 * 3600_000;
const kstDay = (iso: string) => new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 10);
const kstHm = (iso: string) => new Date(new Date(iso).getTime() + KST).toISOString().slice(11, 16);
const bytesKo = (s: string) => Array.from(s || "").reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const usdTxt = (n: number) => `$${n.toFixed(n >= 10 ? 1 : 2)}`;
const msgKind = (r: MsgRow): MsgKind => { const t = String(r.payload?.solapi_type || "").toUpperCase(); if (t === "ATA" || t === "CTA" || r.channel === "kakao") return "ATA"; if (t === "MMS" || r.payload?.mms) return "MMS"; if (t === "LMS") return "LMS"; if (t === "SMS") return "SMS"; return bytesKo(r.message) > 90 ? "LMS" : "SMS"; };
const fnLabel = (fn: string) => (fn === "entity-ask" ? "업체 질문" : fn === "data-ask" ? "전체 데이터" : fn);

export default function CostTile() {
  const [rows, setRows] = useState<AiRow[] | null | "none">(null);
  const [msgs, setMsgs] = useState<MsgRow[]>([]);
  const [rate, setRate] = useState(1400);
  const [price, setPrice] = useState({ sms: 18, lms: 45, mms: 110, ata: ATA_DEFAULT_KRW });
  const [open, setOpen] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState("");
  const [importing, setImporting] = useState(false);
  const active = useScreenActive();

  const load = useCallback(async () => {
    const cfg = await getConfig().catch(() => ({} as Record<string, string>));
    const num = (k: string) => Number(String(cfg[k] || "").replace(/[^\d.]/g, "")) || 0;
    if (num("AI_USD_KRW")) setRate(num("AI_USD_KRW"));
    setPrice({ sms: num("SMS_PRICE_KRW") || 18, lms: num("LMS_PRICE_KRW") || 45, mms: num("MMS_PRICE_KRW") || 110, ata: num("ATA_PRICE_KRW") || ATA_DEFAULT_KRW });
    const monthStart = (() => { const k = new Date(Date.now() + KST); return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00+09:00`; })();
    try {
      // 최근 3,000건 — 월 수백 건 수준이라 몇 달치. 그 전은 "지금까지" 합계에서 빠질 수 있다
      setRows(await selectRows<AiRow>("ai_usage", "select=created_at,fn,author,question,input_tokens,cached_tokens,output_tokens,usd,ms&order=id.desc&limit=3000"));
    } catch { setRows("none"); }
    setMsgs(await selectRows<MsgRow>("message_jobs", `select=sent_at,message,channel,payload&source_type=like.direct*&status=eq.sent&sent_at=gte.${encodeURIComponent(monthStart)}&limit=5000`).catch(() => [] as MsgRow[]));
    setRefreshedAt(new Date(Date.now() + KST).toISOString().slice(11, 16));
  }, []);
  useEffect(() => { void load(); }, [load]);
  // 앞으로는 단추 없이 쌓이게: 홈을 열 때 12시간에 한 번 최근 3일치를 솔라피에서 조용히 가져온다(같은 건은 안 겹침, 2026-10-11 "앞으로 들어오는 거만 쌓자")
  useEffect(() => {
    const key = "cs_solapi_import_at";
    const last = Number(localStorage.getItem(key) || 0);
    if (Date.now() - last < 12 * 3600_000) return;
    try { localStorage.setItem(key, String(Date.now())); } catch { /* 무시 */ }
    void invokeEdgeFunction("customer-message-send", { action: "import_history", days: 3 }, 120_000).then(() => load()).catch(() => undefined);
  }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === "visible" && active) void load(); }, 60_000);
    return () => window.clearInterval(t);
  }, [active, load]);

  const now = new Date(Date.now() + KST);
  const today = now.toISOString().slice(0, 10);
  const monthKey = today.slice(0, 7);
  const day = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const project = (v: number) => (day > 0 ? (v / day) * daysInMonth : v);

  const ai = useMemo(() => {
    if (!rows || rows === "none") return null;
    const sum = (list: AiRow[]) => list.reduce((a, r) => ({ n: a.n + 1, tokens: a.tokens + (r.input_tokens || 0) + (r.output_tokens || 0), usd: a.usd + (Number(r.usd) || 0) }), { n: 0, tokens: 0, usd: 0 });
    const month = rows.filter((r) => kstDay(r.created_at).startsWith(monthKey));
    const todayRows = month.filter((r) => kstDay(r.created_at) === today);
    const byDay = new Map<string, AiRow[]>();
    month.forEach((r) => { const d = kstDay(r.created_at); byDay.set(d, [...(byDay.get(d) || []), r]); });
    const days = Array.from(byDay.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([d, list]) => ({ day: d, ...sum(list), byFn: { entity: list.filter((r) => r.fn === "entity-ask").length, data: list.filter((r) => r.fn === "data-ask").length } }));
    return { month: sum(month), today: sum(todayRows), all: sum(rows), days, recent: rows.slice(0, 40), lastAt: rows[0]?.created_at || "" };
  }, [rows, monthKey, today]);

  const msg = useMemo(() => {
    let sms = 0, lms = 0, mms = 0, ata = 0, todayN = 0;
    msgs.forEach((r) => { const k = msgKind(r); if (k === "ATA") ata += 1; else if (k === "MMS") mms += 1; else if (k === "LMS") lms += 1; else sms += 1; if (kstDay(r.sent_at) === today) todayN += 1; });
    return { sms, lms, mms, ata, n: sms + lms + mms + ata, todayN, krw: sms * price.sms + lms * price.lms + mms * price.mms + ata * price.ata };
  }, [msgs, price, today]);

  const aiMonthUsd = ai?.month.usd ?? 0;
  const monthKrw = aiMonthUsd * rate + msg.krw;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition hover:bg-white/[0.08] sm:col-span-2">
        <span className="text-[15px]">💸</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">이번 달 비용 · {now.getUTCMonth() + 1}월 1~{day}일</span>
          <span className="block truncate text-[12.5px] font-black text-slate-100">
            {rows === "none" ? "AI 사용량 표 없음(supabase/ai-usage.sql)" : !ai ? "읽는 중…" : <>
              AI {usdTxt(aiMonthUsd)} ≈ {won(aiMonthUsd * rate)} <span className="text-slate-500">({ai.month.n}건)</span>
              <span className="text-slate-500"> · </span>문자 {won(msg.krw)} <span className="text-slate-500">({msg.n}건)</span>
              <span className="text-slate-500"> · </span>합계 {won(monthKrw)}
              <span className="text-slate-500"> · </span><span className="text-rose-300">월말 예상 {won(project(monthKrw))}</span>
              <span className="text-slate-500"> · </span>오늘 질문 {ai.today.n}건
            </>}
          </span>
        </span>
        <span className="shrink-0 text-[10.5px] font-black text-blue-300">자세히</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[400] flex items-end bg-black/50 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setOpen(false)}>
          <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white text-slate-900 shadow-xl sm:max-w-3xl sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
              <div>
                <div className="text-[15px] font-black">💸 비용 현황</div>
                <div className="text-[11px] font-bold text-slate-500">AI 질문(OpenAI)과 앱에서 보낸 문자(솔라피) · {refreshedAt ? `${refreshedAt} 갱신` : ""} · 보이는 동안 1분마다 새로 읽습니다</div>
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void load()} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-black text-slate-600">새로고침</button>
                <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white">닫기</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {rows === "none" && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800">AI 사용량 표가 아직 없습니다 — supabase/ai-usage.sql 을 한 번 실행하면 쌓이기 시작합니다.</div>}
              {ai && (
                <>
                  {/* 오늘 · 이번 달 · 지금까지 */}
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { t: "오늘 (실시간)", n: ai.today.n, tokens: ai.today.tokens, usd: ai.today.usd, extra: `문자 ${msg.todayN}건${ai.lastAt && kstDay(ai.lastAt) === today ? ` · 마지막 질문 ${kstHm(ai.lastAt)}` : ""}` },
                      { t: `이번 달 (${now.getUTCMonth() + 1}월)`, n: ai.month.n, tokens: ai.month.tokens, usd: ai.month.usd, extra: `문자 ${msg.n}건(단문 ${msg.sms}·장문 ${msg.lms}·사진 ${msg.mms}·알림톡 ${msg.ata}) ${won(msg.krw)} · 합계 ${won(monthKrw)} · 월말 예상 ${won(project(monthKrw))}` },
                      { t: "지금까지 (최근 3,000건 기준)", n: ai.all.n, tokens: ai.all.tokens, usd: ai.all.usd, extra: `첫 기록부터 누적` },
                    ].map((c) => (
                      <div key={c.t} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                        <div className="text-[10.5px] font-black uppercase tracking-wider text-slate-500">{c.t}</div>
                        <div className="mt-1 text-[20px] font-black leading-none">{usdTxt(c.usd)} <span className="text-[13px] text-slate-500">≈ {won(c.usd * rate)}</span></div>
                        <div className="mt-1 text-[11.5px] font-bold text-slate-600">AI 질문 {c.n}건 · 토큰 {c.tokens.toLocaleString()}</div>
                        <div className="text-[11px] font-bold text-slate-500">{c.extra}</div>
                      </div>
                    ))}
                  </div>

                  {/* 일별 */}
                  <div className="mt-4 text-[12px] font-black">이 달 일별</div>
                  {ai.days.length === 0 ? <div className="mt-1 text-[12px] font-bold text-slate-400">이번 달 아직 질문이 없습니다.</div> : (
                    <div className="mt-1 overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[520px] text-[12px]">
                        <thead className="bg-slate-50 text-left text-[10.5px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2">날짜</th><th className="px-3 py-2 text-right">질문</th><th className="px-3 py-2 text-right">업체/전체</th><th className="px-3 py-2 text-right">토큰</th><th className="px-3 py-2 text-right">달러</th><th className="px-3 py-2 text-right">원</th></tr></thead>
                        <tbody>
                          {ai.days.map((d) => (
                            <tr key={d.day} className={`border-t border-slate-100 font-bold ${d.day === today ? "bg-blue-50/60" : ""}`}>
                              <td className="px-3 py-1.5 tabular-nums">{d.day.slice(5).replace("-", "/")}{d.day === today ? " (오늘)" : ""}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{d.n}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{d.byFn.entity}/{d.byFn.data}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{d.tokens.toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{usdTxt(d.usd)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{won(d.usd * rate)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* 최근 내역 */}
                  <div className="mt-4 text-[12px] font-black">최근 질문 내역 <span className="font-bold text-slate-400">· 최근 40건</span></div>
                  <div className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {ai.recent.length === 0 && <div className="px-3 py-3 text-[12px] font-bold text-slate-400">아직 없습니다.</div>}
                    {ai.recent.map((r, i) => (
                      <div key={`${r.created_at}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[11.5px]">
                        <span className="w-24 shrink-0 font-bold tabular-nums text-slate-500">{kstDay(r.created_at).slice(5).replace("-", "/")} {kstHm(r.created_at)}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${r.fn === "data-ask" ? "bg-emerald-100 text-emerald-800" : "bg-indigo-100 text-indigo-800"}`}>{fnLabel(r.fn)}</span>
                        <span className="w-14 shrink-0 truncate font-bold text-slate-700">{r.author || "—"}</span>
                        <span className="min-w-0 flex-1 truncate font-semibold text-slate-800" title={r.question}>{r.question}</span>
                        <span className="shrink-0 font-bold tabular-nums text-slate-500">{((r.input_tokens || 0) + (r.output_tokens || 0)).toLocaleString()}t · {r.usd != null ? usdTxt(Number(r.usd)) : "-"} · {Math.round((r.ms || 0) / 1000)}초</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">
                    <span>AI 는 2026-10-10부터 기록(그 전은 OpenAI 사용량 화면에만). 문자는 홈을 열 때마다 최근 3일치를 솔라피에서 알아서 받아 쌓이고, 지난달치는 이 단추로 한 번 가져옵니다.</span>
                    <button type="button" disabled={importing} onClick={() => void (async () => {
                      const k0 = new Date(Date.now() + KST); const sinceDays = Math.ceil((Date.now() - Date.UTC(k0.getUTCFullYear(), k0.getUTCMonth() - 1, 1)) / 86400_000) + 1;
                      if (!await askConfirm(`솔라피에서 지난달 1일부터 지금까지(${sinceDays}일) 발송 내역을 가져와 문자 건수·금액에 넣을까요? 같은 건은 두 번 넣지 않습니다.`, { okLabel: "가져오기" })) return;
                      setImporting(true);
                      try {
                        // 한 호출에 7,500건까지 — nextKey 가 오면 이어서 부른다
                        let startKey = ""; let fetched = 0, inserted = 0, skipped = 0; const errors: string[] = [];
                        for (let round = 0; round < 20; round += 1) {
                          const out = await invokeEdgeFunction<{ fetched: number; inserted: number; skipped: number; errors: string[]; nextKey?: string }>("customer-message-send", { action: "import_history", days: sinceDays, startKey }, 180_000);
                          fetched += out.fetched || 0; inserted += out.inserted || 0; skipped += out.skipped || 0; errors.push(...(out.errors || []));
                          if (!out.nextKey || errors.length) break;
                          startKey = out.nextKey;
                          notify(`가져오는 중… 읽음 ${fetched.toLocaleString()}건 · 추가 ${inserted.toLocaleString()}건`, "info");
                        }
                        notify(`솔라피 ${fetched.toLocaleString()}건 읽음 · 새로 ${inserted.toLocaleString()}건 추가 · 이미 있음 ${skipped.toLocaleString()}건${errors.length ? ` · 오류 ${errors[0]}` : ""}`, errors.length ? "error" : "success");
                        await load();
                      } catch (e) { notify(`가져오기 실패: ${(e as Error).message}`, "error"); } finally { setImporting(false); }
                    })()} className="ml-auto rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-50">{importing ? "가져오는 중…" : "지난달부터 가져오기"}</button>
                  </div>
                  <div className="mt-3 text-[10.5px] font-bold text-slate-400">
                    단가: AI 는 공식 가격표(gpt-5.5 입력 $5 · 캐시 $0.5 · 출력 $30 / 100만 토큰) 기준, 문자는 솔라피 공개 요금(단문 {price.sms}·장문 {price.lms}·사진 {price.mms}·알림톡 {price.ata}원, 부가세 별도). 환율 {rate.toLocaleString()}원/달러{rate === 1400 ? " 가정" : ""}. 월말 예상은 지금까지 금액 ÷ 지난 날수 × 이 달 날수. 바꾸려면 관리 app_config(AI_PRICE_IN·AI_USD_KRW·SMS_PRICE_KRW 등).
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
