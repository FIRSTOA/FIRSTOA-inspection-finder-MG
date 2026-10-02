/**
 * 기기 검색 — 자산기번·시리얼(기번) 하나로 "그 기기가 들어 있는 모든 기록"을 한 화면에(2026-10-02 요청).
 *  - 임대리스트(vendor_info)를 맨 위에 카드로, 그 아래 점검·AS·접수·초과·초과조정·재계약·물류·불만·미수·확장성·방문기록을 날짜순 한 줄로.
 *  - 각 표의 기기 칸(자산기번·시리얼넘버·자산번호·기번·asset_no·serial…)과 원문(_원문·source_text)을 함께 ilike로 찾는다 — 숫자가 글 속에만 있어도 잡힌다.
 *  - 표마다 따로 조회하고 실패(없는 칸 등)는 건너뛴다. 업체명을 누르면 통합이력이 열린다.
 */
import { useMemo, useState } from "react";
import { selectRows } from "./supabase";
import { notify } from "./toast";
import UnifiedHistory from "./UnifiedHistory";

type Row = Record<string, unknown>;
type Source = {
  table: string; label: string; tone: string;
  cols: string[];            // 기기 번호가 든 칸들 (or 조건)
  hidden?: string;           // 숨김 행 제외 조건
  dateKeys: string[];        // 날짜로 쓸 칸 후보(앞에서부터)
  nameKeys: string[];        // 업체명 칸 후보
  snippetKeys: string[];     // 한 줄 요약에 쓸 칸 후보
};
const SOURCES: Source[] = [
  { table: "vendor_info", label: "임대리스트", tone: "bg-emerald-50 text-emerald-700", cols: ["자산번호", "기번", "시리얼번호(기번)", "_원문"], hidden: "_hidden=not.is.true", dateKeys: ["계약일", "첫계약일"], nameKeys: ["_업체명"], snippetKeys: ["모델명", "기종", "품목"] },
  { table: "jeomgeom", label: "점검", tone: "bg-blue-50 text-blue-700", cols: ["자산기번", "시리얼넘버", "_원문"], hidden: "_hidden=not.is.true", dateKeys: ["작성일"], nameKeys: ["_업체명", "업체명"], snippetKeys: ["처리내용", "내용", "특이사항"] },
  { table: "as_records", label: "AS", tone: "bg-violet-50 text-violet-700", cols: ["자산기번", "시리얼넘버", "_원문"], hidden: "_hidden=not.is.true", dateKeys: ["작성일"], nameKeys: ["_업체명", "업체명"], snippetKeys: ["내용", "처리내용", "특이사항"] },
  { table: "service_receptions", label: "접수", tone: "bg-sky-50 text-sky-700", cols: ["asset_no", "serial", "lease_no", "symptom"], hidden: "deleted=is.false", dateKeys: ["receipt_date"], nameKeys: ["vendor"], snippetKeys: ["symptom", "status", "type"] },
  { table: "overage", label: "초과료", tone: "bg-purple-50 text-purple-700", cols: ["자산번호", "_원문"], hidden: "_hidden=not.is.true", dateKeys: ["날짜"], nameKeys: ["_업체명"], snippetKeys: ["접수내용", "합계", "마감방식"] },
  { table: "overage_adjust", label: "초과조정", tone: "bg-fuchsia-50 text-fuchsia-700", cols: ["기종", "원문", "_원문"], hidden: "_hidden=not.is.true", dateKeys: ["방문일"], nameKeys: ["_업체명", "업체명"], snippetKeys: ["제안", "현재조건", "진행상태"] },
  { table: "recontract", label: "재계약", tone: "bg-rose-50 text-rose-700", cols: ["기종", "원문", "_원문"], hidden: "_hidden=not.is.true", dateKeys: ["날짜", "계약종료일"], nameKeys: ["_업체명", "업체명"], snippetKeys: ["내용", "결과", "진행상황"] },
  { table: "logistics_records", label: "물류", tone: "bg-amber-50 text-amber-700", cols: ["자산기번", "시리얼넘버", "_원문"], hidden: "_hidden=not.is.true", dateKeys: ["작성일", "날짜"], nameKeys: ["_업체명", "업체명"], snippetKeys: ["내용", "처리내용"] },
  { table: "bulman", label: "불만", tone: "bg-red-50 text-red-700", cols: ["_원문"], hidden: "_hidden=not.is.true", dateKeys: ["방문일", "날짜"], nameKeys: ["_업체명"], snippetKeys: ["불만내용", "불편내용", "내용"] },
  { table: "misu", label: "미수", tone: "bg-orange-50 text-orange-700", cols: ["_원문"], hidden: "_hidden=not.is.true", dateKeys: ["입력일"], nameKeys: ["_업체명"], snippetKeys: ["미수개월", "미수잔액"] },
  { table: "mfp_expansion", label: "복합기 확장성", tone: "bg-teal-50 text-teal-700", cols: ["_원문"], hidden: "_hidden=not.is.true", dateKeys: ["등록일"], nameKeys: ["_업체명", "상호"], snippetKeys: ["품목(원문)", "영업진행상황"] },
  { table: "pc_expansion", label: "PC 확장성", tone: "bg-cyan-50 text-cyan-700", cols: ["_원문"], hidden: "_hidden=not.is.true", dateKeys: ["날짜"], nameKeys: ["_업체명"], snippetKeys: ["세부사양", "어필 OR 추가영업"] },
  { table: "visit_logs", label: "방문기록", tone: "bg-slate-100 text-slate-700", cols: ["source_text"], hidden: "status=neq.cancelled", dateKeys: ["work_date"], nameKeys: ["vendor"], snippetKeys: ["work_kinds", "note"] },
];

const str = (row: Row, key: string) => String(row[key] ?? "").replace(/_x000d_|\r/g, "").trim();
const firstOf = (row: Row, keys: string[]) => { for (const k of keys) { const v = str(row, k); if (v) return v; } return ""; };
// 날짜 — 표마다 칸 이름·형식이 달라 yyyy-mm-dd 로 맞춘다("2026.9.3", "26-09-03", "2026-09-03T…" 모두)
function dateOf(row: Row, keys: string[]): string {
  const raw = firstOf(row, keys) || str(row, "created_at");
  const m = raw.match(/(\d{4}|\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (!m) return raw.slice(0, 10);
  const y = m[1].length === 2 ? `20${m[1]}` : m[1];
  return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}
// 어느 칸에 번호가 들어 있었나 — 기기 칸이면 그 이름, 원문에만 있으면 '원문'
function matchedIn(row: Row, cols: string[], needle: string): string {
  const n = needle.toLowerCase();
  for (const c of cols) { if (str(row, c).toLowerCase().includes(n)) return c.startsWith("_") || c === "원문" || c === "source_text" ? "원문" : c; }
  for (const [k, v] of Object.entries(row)) { if (!k.startsWith("_") && typeof v === "string" && v.toLowerCase().includes(n)) return k; }
  return "";
}
type Hit = { src: Source; row: Row; date: string; vendor: string; snippet: string; where: string };

export default function DeviceLookup({ author }: { author: string }) {
  const [input, setInput] = useState("");
  const [needle, setNeedle] = useState("");
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [only, setOnly] = useState("전체");
  const [histVendor, setHistVendor] = useState("");
  const [openRaw, setOpenRaw] = useState<string | null>(null);

  const run = async () => {
    const q = input.trim();
    if (q.length < 3) { notify("자산기번이나 시리얼을 3자 이상 넣어 주세요", "info"); return; }
    if (!/^[A-Za-z0-9\-/.]+$/.test(q)) { notify("자산기번·시리얼은 영문·숫자만 넣어 주세요 (업체명은 기록 조회에서)", "info"); return; }
    setBusy(true); setNeedle(q); setOnly("전체"); setFailed([]);
    const enc = encodeURIComponent(q);
    const results = await Promise.all(SOURCES.map(async (src) => {
      const or = src.cols.map((c) => `${encodeURIComponent(/[^A-Za-z0-9_가-힣]/.test(c) ? `"${c}"` : c)}.ilike.*${enc}*`).join(",");
      const query = `select=*&or=(${or})${src.hidden ? `&${src.hidden}` : ""}&limit=200`;
      try { return { src, rows: await selectRows<Row>(src.table, query), ok: true }; }
      catch { return { src, rows: [] as Row[], ok: false }; }
    }));
    const list: Hit[] = [];
    const bad: string[] = [];
    for (const { src, rows, ok } of results) {
      if (!ok) bad.push(src.label);
      for (const row of rows) list.push({ src, row, date: dateOf(row, src.dateKeys), vendor: firstOf(row, src.nameKeys), snippet: firstOf(row, src.snippetKeys).slice(0, 140), where: matchedIn(row, src.cols, q) });
    }
    list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    setHits(list); setFailed(bad); setBusy(false);
  };

  const counts = useMemo(() => { const c = new Map<string, number>(); hits.forEach((h) => c.set(h.src.label, (c.get(h.src.label) || 0) + 1)); return c; }, [hits]);
  const lease = hits.filter((h) => h.src.table === "vendor_info");
  const timeline = hits.filter((h) => h.src.table !== "vendor_info" && (only === "전체" || h.src.label === only));
  const vendors = useMemo(() => Array.from(new Set(hits.map((h) => h.vendor).filter(Boolean))), [hits]);
  const rawText = (row: Row) => str(row, "_원문") || str(row, "원문") || str(row, "source_text") || str(row, "symptom") || "";

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-[11px] font-black text-slate-500">자산기번 · 시리얼(기번)로 기기 하나의 모든 기록 찾기</div>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="예: B7230, 376340313832, C6523" inputMode="text" autoCapitalize="characters"
            className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-4 font-mono text-[15px] font-bold tracking-wide text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <button type="submit" disabled={busy} className="h-11 shrink-0 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-50">{busy ? "찾는 중…" : "찾기"}</button>
        </form>
        <p className="mt-2 text-[11px] font-semibold text-slate-400">임대리스트 · 점검 · AS · 접수 · 초과 · 초과조정 · 재계약 · 물류 · 불만 · 미수 · 확장성 · 방문기록의 기기 칸과 원문을 모두 뒤집니다.</p>
      </section>

      {needle && !busy && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-black text-white">{needle.toUpperCase()} · {hits.length}건</span>
            {vendors.slice(0, 4).map((v) => <button key={v} type="button" onClick={() => setHistVendor(v)} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-black text-slate-700 hover:bg-slate-50" title="통합이력 열기">{v} ↗</button>)}
            {failed.length > 0 && <span className="text-[10px] font-bold text-amber-700">조회 못 함: {failed.join(", ")}</span>}
          </div>

          {lease.length > 0 && <section className="grid gap-2 sm:grid-cols-2">
            {lease.map((h, i) => <div key={i} className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-black text-emerald-700">임대리스트 · {str(h.row, "임대여부") || "상태 미기재"}</div>
                  <button type="button" onClick={() => h.vendor && setHistVendor(h.vendor)} className="mt-0.5 block truncate text-left text-[15px] font-black text-slate-900 hover:underline">{h.vendor || "업체명 없음"}</button>
                </div>
                <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-[11px] font-black text-slate-700">{str(h.row, "자산번호") || str(h.row, "기번")}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] text-slate-700">
                {([["기종", str(h.row, "모델명") || str(h.row, "기종")], ["시리얼", str(h.row, "시리얼번호(기번)") || str(h.row, "기번")], ["계약", [str(h.row, "계약일"), str(h.row, "종료일")].filter(Boolean).join(" ~ ")], ["남은 개월", str(h.row, "남은개월")], ["등급", str(h.row, "등급")], ["기본금액", str(h.row, "기본금액")], ["주소", str(h.row, "주소상세주소")], ["키맨", str(h.row, "키맨")]] as [string, string][])
                  .filter(([, v]) => v).map(([k, v]) => <div key={k} className={k === "주소" ? "col-span-2 truncate" : "truncate"}><span className="mr-1 font-black text-slate-400">{k}</span><span className="font-semibold">{v}</span></div>)}
              </div>
            </div>)}
          </section>}

          <div className="flex flex-wrap items-center gap-1.5">
            {["전체", ...SOURCES.filter((s) => s.table !== "vendor_info" && counts.get(s.label)).map((s) => s.label)].map((name) => (
              <button key={name} type="button" onClick={() => setOnly(name)} className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${only === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {name}{name !== "전체" && <span className="ml-1 tabular-nums opacity-70">{counts.get(name)}</span>}
              </button>
            ))}
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="divide-y divide-slate-100">
              {timeline.map((h, i) => {
                const key = `${h.src.table}-${String(h.row.id ?? i)}`;
                const raw = rawText(h.row);
                return <div key={key} className="px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="w-[76px] shrink-0 font-black tabular-nums text-slate-500">{h.date ? h.date.slice(2) : "날짜 없음"}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${h.src.tone}`}>{h.src.label}</span>
                    <button type="button" onClick={() => h.vendor && setHistVendor(h.vendor)} className="truncate text-[13px] font-black text-slate-900 hover:underline">{h.vendor || "업체명 없음"}</button>
                    {h.where && <span className="ml-auto shrink-0 text-[10px] font-bold text-slate-400">{h.where === "원문" ? "원문에 포함" : `${h.where} 일치`}</span>}
                  </div>
                  {h.snippet && <div className="mt-1 whitespace-pre-wrap pl-[84px] text-[12px] leading-5 text-slate-700">{h.snippet}</div>}
                  {raw && <div className="pl-[84px]">
                    <button type="button" onClick={() => setOpenRaw(openRaw === key ? null : key)} className="mt-1 text-[10px] font-bold text-slate-400 hover:text-slate-700 hover:underline">{openRaw === key ? "원문 접기" : "원문 보기"}</button>
                    {openRaw === key && <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-slate-700">{raw}</pre>}
                  </div>}
                </div>;
              })}
              {!timeline.length && <div className="p-10 text-center text-sm font-bold text-slate-400">{hits.length ? "이 분류에는 기록이 없습니다" : `${needle}가 들어 있는 기록을 찾지 못했습니다`}</div>}
            </div>
          </section>
        </>
      )}

      <UnifiedHistory vendor={histVendor} accent="#2563eb" open={!!histVendor} onClose={() => setHistVendor("")} onError={(msg) => notify(msg, "error")} author={author} />
    </div>
  );
}
