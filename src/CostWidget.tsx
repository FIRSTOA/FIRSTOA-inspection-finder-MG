/**
 * 홈 상단 "이번 달 비용" 한눈에 보기 (2026-10-10 "홈 화면 상단에 API 비용이나 지출 예상 금액")
 *
 * - AI: 통합검색 질문이 쓴 OpenAI 토큰·추정 비용(ai_usage 표). 월말 예상은 지금까지 쓴 금액을 지난 날수로 나눠 한 달로 늘린 것.
 *   단가(app_config AI_PRICE_IN/OUT/CACHED, 100만 토큰당 달러)가 없으면 토큰만. 원화는 AI_USD_KRW(없으면 1,400원 가정).
 * - 문자: 앱에서 직접 보낸 문자(message_jobs source_type direct:*) 건수. 단가(app_config SMS_PRICE_KRW / LMS_PRICE_KRW / MMS_PRICE_KRW)가
 *   있으면 금액까지. 90바이트(한글 45자) 넘으면 LMS, 사진 있으면 MMS 로 센다.
 * - 표가 없으면(SQL 미실행) 어떤 SQL 을 돌리면 되는지 한 줄만 보여 준다.
 */
import { useEffect, useState } from "react";
import { getConfig, selectRows } from "./supabase";

type AiRow = { input_tokens: number; output_tokens: number; usd: number | null; fn: string };
type MsgRow = { message: string; payload: { mms?: boolean } | null; channel: string };

const bytesKo = (s: string) => Array.from(s || "").reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

export default function CostWidget() {
  const [ai, setAi] = useState<{ count: number; tokens: number; usd: number; priced: boolean; byFn: Record<string, number> } | null | "none">(null);
  const [msg, setMsg] = useState<{ sms: number; lms: number; mms: number; krw: number | null }>({ sms: 0, lms: 0, mms: 0, krw: null });
  const [rate, setRate] = useState(1400);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const kst = new Date(Date.now() + 9 * 3600_000);
    const y = kst.getUTCFullYear(), m = kst.getUTCMonth() + 1, d = kst.getUTCDate();
    const from = encodeURIComponent(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+09:00`);
    void (async () => {
      const cfg = await getConfig().catch(() => ({} as Record<string, string>));
      const num = (k: string) => Number(String(cfg[k] || "").replace(/[^\d.]/g, "")) || 0;
      if (num("AI_USD_KRW")) setRate(num("AI_USD_KRW"));
      try {
        const rows = await selectRows<AiRow>("ai_usage", `select=input_tokens,output_tokens,usd,fn&created_at=gte.${from}&limit=3000`);
        const byFn: Record<string, number> = {};
        rows.forEach((r) => { byFn[r.fn] = (byFn[r.fn] || 0) + 1; });
        setAi({ count: rows.length, tokens: rows.reduce((n, r) => n + (r.input_tokens || 0) + (r.output_tokens || 0), 0), usd: rows.reduce((n, r) => n + (Number(r.usd) || 0), 0), priced: rows.some((r) => r.usd != null), byFn });
      } catch { setAi("none"); }
      try {
        const rows = await selectRows<MsgRow>("message_jobs", `select=message,payload,channel&source_type=like.direct*&status=eq.sent&channel=eq.sms&sent_at=gte.${from}&limit=3000`);
        let sms = 0, lms = 0, mms = 0;
        rows.forEach((r) => { if (r.payload?.mms) mms += 1; else if (bytesKo(r.message) > 90) lms += 1; else sms += 1; });
        // 솔라피 공개 요금(2026-10-10 조회, 부가세 별도): 단문 18원 · 장문 45원 · 사진 110원. app_config 에 넣으면 그 값이 우선(월 발송량 할인 반영용)
        const p = { sms: num("SMS_PRICE_KRW") || 18, lms: num("LMS_PRICE_KRW") || 45, mms: num("MMS_PRICE_KRW") || 110 };
        setMsg({ sms, lms, mms, krw: sms * p.sms + lms * p.lms + mms * p.mms });
      } catch { /* 표가 없으면 0 */ }
      void d;
    })();
  }, []);

  const kst = new Date(Date.now() + 9 * 3600_000);
  const day = kst.getUTCDate();
  const daysInMonth = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 0)).getUTCDate();
  const project = (v: number) => (day > 0 ? (v / day) * daysInMonth : v);
  const aiUsd = ai && ai !== "none" ? ai.usd : 0;
  const total = ai && ai !== "none" ? ai.count : 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="text-[12px] font-black text-slate-900">💸 이번 달 비용 <span className="font-bold text-slate-400">· {kst.getUTCMonth() + 1}월 1~{day}일</span></div>
        {ai === "none" && <span className="text-[11.5px] font-bold text-amber-700">AI 사용량 표가 아직 없습니다 — supabase/ai-usage.sql 을 한 번 실행하면 여기와 통합검색에 토큰·비용이 보입니다</span>}
        {ai && ai !== "none" && (
          <>
            <span className="text-[12px] font-bold text-slate-700">AI 질문 <b className="text-slate-900">{total}건</b> · 토큰 {ai.tokens.toLocaleString()}</span>
            {total === 0
              ? <span className="text-[11.5px] font-bold text-slate-400">이번 달 아직 질문이 없습니다 — 통합검색에서 질문하면 여기에 금액이 쌓입니다</span>
              : <span className="text-[12px] font-bold text-slate-700">지금까지 <b className="text-slate-900">${aiUsd.toFixed(2)}</b> ≈ {won(aiUsd * rate)} · 월말 예상 <b className="text-rose-700">${project(aiUsd).toFixed(2)}</b> ≈ {won(project(aiUsd) * rate)}{!ai.priced ? <span className="text-amber-700"> (단가 반영 전 기록)</span> : null}</span>}
          </>
        )}
        <span className="text-[12px] font-bold text-slate-700">문자 <b className="text-slate-900">{msg.sms + msg.lms + msg.mms}건</b>{msg.krw != null ? <> · <b className="text-slate-900">{won(msg.krw)}</b> · 월말 예상 <b className="text-rose-700">{won(project(msg.krw))}</b></> : <span className="text-slate-400"> (단가 미설정)</span>}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="ml-auto text-[10.5px] font-black text-blue-600">{open ? "접기" : "자세히"}</button>
      </div>
      {open && (
        <div className="mt-2 grid gap-1 border-t border-slate-100 pt-2 text-[11px] font-bold text-slate-600 sm:grid-cols-2">
          <div>AI 종류별: {ai && ai !== "none" ? Object.entries(ai.byFn).map(([k, v]) => `${k === "entity-ask" ? "업체 질문" : k === "data-ask" ? "전체 데이터 질문" : k} ${v}건`).join(" · ") || "없음" : "—"}</div>
          <div>문자 종류별: 단문 {msg.sms} · 장문 {msg.lms} · 사진 {msg.mms} (90바이트 넘으면 장문, 사진 있으면 MMS 로 센 추정)</div>
          <div>월말 예상 = 지금까지 금액 ÷ 지난 날수 × 이 달 날수(단순 비례). 환율 {rate.toLocaleString()}원/달러{rate === 1400 ? " 가정(AI_USD_KRW 로 바꿀 수 있음)" : ""}.</div>
          <div>문자 단가는 솔라피 공개 요금(부가세 별도, 단문 18·장문 45·사진 110원) 기준이고, AI 단가는 OpenAI 가격표 기준으로 서버 설정에 넣어 두었습니다. 요금이 바뀌면 관리 탭 app_config(SMS_PRICE_KRW·AI_PRICE_IN 등)에서 덮어쓸 수 있습니다.</div>
        </div>
      )}
    </section>
  );
}
