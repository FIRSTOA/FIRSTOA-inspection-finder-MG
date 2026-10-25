// 필드 탭 검색 — 표시 틀만(조회·상태 없음). 값과 핸들러는 TabSearchBar.tsx 가 넘긴다.
// 설계: docs/tasks/tab-search-kakao-history.md 4절. 폰(390px) 우선: 접힌 상태는 검색칸 한 줄, 결과는 그 아래 흰 카드로 펼침.
// 줄 색: FIELD 기록 = 흰 바탕. 카톡 원문 = 회색 바탕.
// 2단계(2026-10-24): 결과 칸 위 [FIELD 기록][카톡 대화] 탭. 카톡 대화 칸(KakaoPane)은 자기 검색어·조회 상태를 직접 가진다
// (TabSearchBar 를 고치지 않고 붙이려고 — 조회는 tabSearch.searchKakao 하나, 엣지 kakao-search).
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Download, Loader2, MessageSquareText, RotateCcw, Search, X } from "lucide-react";
import type { Candidate } from "./entity360";
import { canLoadLine, highlightParts, kakaoTimeLabel, relatedLines, searchKakao, type Coverage, type KakaoHit, type KakaoSearchResult, type TabLine, type TabSpec } from "./tabSearch";

export type TabSearchViewProps = {
  spec: TabSpec;
  query: string;
  onQuery: (v: string) => void;
  onClear: () => void;
  candState: "idle" | "loading" | "done";
  candidates: Candidate[];
  onPick: (c: Candidate | null) => void;
  picked: { name: string } | null;
  runState: "idle" | "loading" | "done" | "error";
  error: string;
  onRun: () => void;            // 고른 업체로 (다시) 찾기 — 탭을 바꾼 뒤 누를 때만 조회
  lines: TabLine[];
  chip: string;
  onChip: (key: string) => void;
  summary: string;
  coverage: Coverage | null;
  resultKey: string;            // 새 조회마다 바뀜 — 결과 칸의 "더 보기"·접힘 상태를 처음으로
  onLoad?: (line: TabLine) => void; // 점검·AS 탭만: 그 기록 원문을 양식에 [불러오기]. 줄에 formText 가 있을 때만 단추가 보인다
};

type LoadFn = ((line: TabLine) => void) | undefined;

const PAGE = 40;

/** 펼침 — 주요 칸 · 원문 · 같은 업체 같은 종류 최근 5건(이미 모은 줄에서). 글은 tabSearch.toLines 에서 주민번호를 가린 값 */
function LineDetail({ line, related, onLoad }: { line: TabLine; related: TabLine[]; onLoad: LoadFn }) {
  const fields: [string, string][] = [
    ["날짜", line.date || "날짜 없음"],
    ["작성", [line.author, line.team].filter(Boolean).join(" · ")],
    ["업체", line.vendor],
    ["기기", line.device],
    ["내용", line.title],
    ["상세", line.detail],
  ];
  return (
    <div className="mx-3 mb-2 space-y-1.5 rounded-lg bg-slate-50 p-2 text-[11px] leading-5 text-slate-700">
      <dl className="grid grid-cols-[2.5rem_1fr] gap-x-2">
        {fields.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="contents"><dt className="font-bold text-slate-400">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
        ))}
      </dl>
      {line.raw && line.raw !== line.title && (
        <div>
          <div className="font-bold text-slate-400">원문</div>
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-white p-1.5">{line.raw}</div>
        </div>
      )}
      <div>
        <div className="font-bold text-slate-400">같은 업체 {line.logiKind || line.kind} 최근 {related.length}건</div>
        {related.length === 0 ? <div className="text-slate-400">이 기록 말고는 없음</div> : (
          <ul>
            {related.map((r) => (
              <li key={r.key} className="flex gap-1.5"><span className="shrink-0 font-bold tabular-nums">{r.date || "날짜 없음"}</span><span className="min-w-0 truncate">{r.title}</span></li>
            ))}
          </ul>
        )}
      </div>
      {canLoadLine(line, onLoad) && (
        <button type="button" onClick={() => onLoad!(line)} className="flex h-9 w-full items-center justify-center gap-1 rounded-lg bg-slate-900 text-[12px] font-bold text-white active:scale-[0.99]">
          <Download size={13} />이 {line.kind} 기록을 양식으로 불러오기
        </button>
      )}
    </div>
  );
}

function LineRow({ line, all, onLoad }: { line: TabLine; all: TabLine[]; onLoad: LoadFn }) {
  const [open, setOpen] = useState(false);
  const loadable = canLoadLine(line, onLoad);
  return (
    <li className="border-b border-slate-100 bg-white last:border-b-0">
      <div className="flex items-start">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="block min-w-0 flex-1 px-3 py-2 text-left hover:bg-slate-50">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="shrink-0 font-bold tabular-nums text-slate-700">{line.date || "날짜 없음"}</span>
          <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold ${line.tone}`}>{line.kind}</span>
          {line.loose && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800">이름 일부 일치</span>}
          {line.otherVendor && <span className="min-w-0 truncate rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-600">당시 {line.otherVendor}</span>}
          <span className="ml-auto min-w-0 truncate text-slate-400">{[line.author, line.team].filter(Boolean).join(" · ")}</span>
        </div>
        <div className={`mt-0.5 text-[13px] font-bold text-slate-900 ${open ? "" : "line-clamp-1"}`}>{line.title}</div>
        {(line.detail || line.device) && <div className={`text-[11px] text-slate-500 ${open ? "" : "line-clamp-1"}`}>{[line.detail, line.device].filter(Boolean).join(" · ")}</div>}
      </button>
      {loadable && (
        <button type="button" onClick={() => onLoad!(line)} aria-label={`${line.date || "날짜 없음"} ${line.kind} 기록 불러오기`}
          className="mr-2 mt-2 shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 active:scale-95">불러오기</button>
      )}
      </div>
      {open && <LineDetail line={line} related={relatedLines(all, line)} onLoad={onLoad} />}
    </li>
  );
}

type KakaoState = { q: string; n: number; result: KakaoSearchResult | null; error: string };

/** 카톡 대화 한 줄 — 회색 바탕. 누르면 본문 전체 */
function KakaoRow({ hit, q }: { hit: KakaoHit; q: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-slate-200 bg-slate-100 last:border-b-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="block w-full px-3 py-2 text-left hover:bg-slate-200/60">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="shrink-0 font-bold tabular-nums text-slate-700">{kakaoTimeLabel(hit.sent_at)}</span>
          <span className="min-w-0 truncate rounded-full bg-white px-1.5 py-px text-[10px] font-bold text-slate-600">{hit.room}</span>
          <span className="ml-auto shrink-0 font-bold text-slate-600">{hit.author}</span>
        </div>
        <div className={`mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-800 ${open ? "" : "line-clamp-3"}`}>
          {highlightParts(hit.text, q).map((part, i) => part.hit
            ? <mark key={i} className="rounded bg-yellow-200 px-0.5 text-slate-900">{part.t}</mark>
            : <span key={i}>{part.t}</span>)}
        </div>
      </button>
    </li>
  );
}

/** [카톡 대화] 칸 — 고른 업체 이름으로 바로 찾고, 낱말을 바꿔 다시 찾을 수 있다 */
function KakaoPane({ spec, initialQuery }: { spec: TabSpec; initialQuery: string }) {
  const [input, setInput] = useState(initialQuery);
  // n = [찾기] 누른 횟수 — 같은 낱말로 다시 눌러도 새로 조회한다
  const [asked, setAsked] = useState({ q: initialQuery.trim(), n: 0 });
  const [state, setState] = useState<KakaoState>({ q: "", n: -1, result: null, error: "" });
  const req = useRef(0);
  const hasRooms = !!spec.kakaoKinds?.length;
  const tooShort = asked.q.replace(/[^0-9A-Za-z가-힣]/g, "").length < 2;

  useEffect(() => {
    if (!hasRooms || tooShort) return;
    const id = ++req.current;
    const { q, n } = asked;
    searchKakao(spec, q).then(
      (result) => { if (id === req.current) setState({ q, n, result, error: "" }); },
      (err) => { if (id === req.current) setState({ q, n, result: null, error: ((err as Error)?.message || String(err)).slice(0, 80) }); },
    );
  }, [spec, asked, hasRooms, tooShort]);

  const current = state.q === asked.q && state.n === asked.n;
  const loading = hasRooms && !tooShort && !current;
  const res = current ? state.result : null;
  const error = current ? state.error : "";

  if (!hasRooms) {
    return <div className="px-3 py-4 text-xs leading-5 text-slate-500">이 탭({spec.label})의 카톡방은 원문 수집 대상이 아닙니다 — FIELD 기록만 보세요.</div>;
  }
  const rooms = spec.kakaoKinds!.join("·");
  return (
    <>
      <form onSubmit={(ev) => { ev.preventDefault(); setAsked((a) => ({ q: input.trim(), n: a.n + 1 })); }} className="sticky top-0 z-[1] flex items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-2">
        <input
          type="search" value={input} onChange={(ev) => setInput(ev.target.value)} placeholder="업체명·키워드(띄어 쓰면 모두 든 글)"
          aria-label="카톡 대화 검색어" className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-[13px] focus:border-slate-400 focus:outline-none"
        />
        <button type="submit" disabled={loading} className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-2.5 text-[11px] font-bold text-white disabled:opacity-60">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}찾기
        </button>
      </form>
      <div className="border-b border-slate-100 px-3 py-1 text-[10px] text-slate-400">{rooms} 방 · 최신순 · 주민·카드·계좌 번호와 휴대폰 가운데 4자리는 가려 보입니다</div>
      {tooShort && <div className="px-3 py-4 text-xs text-slate-400">검색어를 2자 이상 넣고 [찾기]를 누르세요.</div>}
      {loading && <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" />카톡 대화를 찾는 중…</div>}
      {error && (
        <div className="flex items-start gap-2 px-3 py-4 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" /><span>카톡 대화를 못 불러왔습니다. [찾기]를 다시 눌러 주세요. ({error})</span></div>
      )}
      {res && !res.enabled && (
        <div className="px-3 py-4 text-xs leading-5 text-slate-500"><b className="text-slate-700">카톡 원문 검색이 꺼져 있습니다.</b> 직원 고지 뒤 관리자가 켭니다(app_config KAKAO_SEARCH_ENABLED).</div>
      )}
      {res && res.enabled && res.rows.length === 0 && (
        <div className="px-3 py-4 text-xs leading-5 text-slate-500"><b className="text-slate-700">카톡 대화 없음</b> — “{asked.q}”가 든 글을 {rooms} 방 원문에서 못 찾았습니다(수집된 기간만 찾습니다).</div>
      )}
      {res && res.enabled && res.rows.length > 0 && (
        <>
          <ul>{res.rows.map((h) => <KakaoRow key={h.id} hit={h} q={asked.q} />)}</ul>
          {res.truncated && <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">최근 {res.limit}줄만 보입니다 — 낱말을 더 넣어 좁히세요.</div>}
        </>
      )}
    </>
  );
}

export default function TabSearchView(p: TabSearchViewProps) {
  const showCandidates = !p.picked && p.query.trim().length >= 2 && p.candState !== "idle";
  const showResult = !!p.picked;
  const [pane, setPane] = useState<"field" | "kakao">("field");

  return (
    <div className="mt-2">
      {/* 접힌 상태 = 이 한 줄 */}
      <div className="flex h-10 items-center gap-2 rounded-xl bg-white/10 px-3 focus-within:bg-white/15">
        <Search size={15} className="shrink-0 text-white/60" aria-hidden="true" />
        <input
          type="search" autoComplete="off" value={p.query} onChange={(ev) => p.onQuery(ev.target.value)}
          placeholder={p.spec.question} aria-label={`${p.spec.label} 이력 검색`}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-bold text-white placeholder:font-normal placeholder:text-white/50 focus:outline-none"
        />
        {(p.candState === "loading" || p.runState === "loading") && <Loader2 size={14} className="shrink-0 animate-spin text-white/70" aria-label="찾는 중" />}
        {(p.query || p.picked) && (
          <button type="button" onClick={p.onClear} aria-label="검색 지우기" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/70 hover:bg-white/10"><X size={15} /></button>
        )}
      </div>

      {/* 업체 후보 */}
      {showCandidates && (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {p.candState === "loading" && <div className="px-3 py-2.5 text-xs text-slate-400">업체를 찾는 중…</div>}
          {p.candState === "done" && p.candidates.slice(0, 5).map((c) => (
            <button key={`${c.code}|${c.leaseCode}`} type="button" onClick={() => p.onPick(c)} className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50">
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-900">{c.name}</span>
              {c.deviceCount > 0 && <span className="shrink-0 text-[10px] text-slate-400">기기 {c.deviceCount}</span>}
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-600">{c.how}</span>
            </button>
          ))}
          {p.candState === "done" && (
            <button type="button" onClick={() => p.onPick(null)} className="block w-full px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-50">
              {p.candidates.length ? "목록에 없음 — " : "등록된 업체를 못 찾았습니다 — "}<b className="text-slate-700">“{p.query.trim()}”</b> 글자 그대로 찾기
            </button>
          )}
        </div>
      )}

      {/* 결과 */}
      {showResult && (
        <div className="mt-1.5 max-h-[65vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          <div role="tablist" aria-label="검색 결과 종류" className="flex gap-1 border-b border-slate-200 bg-slate-50 px-2 pt-1.5">
            {([["field", "FIELD 기록"], ["kakao", "카톡 대화"]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={pane === k} onClick={() => setPane(k)}
                className={`-mb-px flex items-center gap-1 rounded-t-lg px-3 py-1.5 text-[12px] font-bold ${pane === k ? "border border-b-white border-slate-200 bg-white text-slate-900" : "text-slate-500"}`}>
                {k === "kakao" && <MessageSquareText size={12} />}{label}
              </button>
            ))}
          </div>
          {pane === "kakao" ? <KakaoPane key={`${p.spec.key}|${p.picked!.name}`} spec={p.spec} initialQuery={p.picked!.name} /> : (<>
          <div className="sticky top-0 z-[1] border-b border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-900">{p.picked!.name} <span className="font-normal text-slate-400">· {p.spec.label}</span></span>
              {p.runState !== "loading" && (
                <button type="button" onClick={p.onRun} className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                  <RotateCcw size={11} />{p.runState === "idle" ? `${p.spec.label} 이력 보기` : "다시"}
                </button>
              )}
            </div>
            {p.runState === "done" && <div className="mt-0.5 text-[11px] font-bold text-blue-700">{p.summary}</div>}
            {p.spec.note && <div className="mt-0.5 text-[10px] text-slate-400">{p.spec.note}</div>}
            {p.runState === "done" && p.spec.chips && (
              <div className="mt-1.5 flex gap-1 overflow-x-auto">
                {[{ key: "all", label: "전체" }, ...p.spec.chips].map((c) => (
                  <button key={c.key} type="button" onClick={() => p.onChip(c.key)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${p.chip === c.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{c.label}</button>
                ))}
              </div>
            )}
          </div>

          {p.runState === "idle" && <div className="px-3 py-4 text-center text-xs text-slate-400">탭이 바뀌었습니다 — [{p.spec.label} 이력 보기]를 누르면 찾습니다.</div>}
          {p.runState === "loading" && <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" />{p.spec.label} 기록을 모으는 중…</div>}
          {p.runState === "error" && (
            <div className="flex items-start gap-2 px-3 py-4 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" /><span>기록을 못 불러왔습니다. [다시]를 눌러 주세요.{p.error ? ` (${p.error})` : ""}</span></div>
          )}

          {p.runState === "done" && <DoneList key={p.resultKey} {...p} />}
          </>)}
        </div>
      )}
    </div>
  );
}

/** 결과 목록(조회 끝난 뒤) — 조회마다 key 가 바뀌어 "더 보기"·접힘이 처음으로 돌아간다 */
function DoneList(p: TabSearchViewProps) {
  const [shown, setShown] = useState(PAGE);
  const [looseOpen, setLooseOpen] = useState(false);
  const exact = p.lines.filter((l) => !l.loose);
  const loose = p.lines.filter((l) => l.loose);
  return (
    <>
      {p.coverage && p.coverage.failed.length > 0 && (
        <div className="flex items-start gap-1.5 border-b border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />{p.coverage.failed.join("·")} 기록을 못 불러왔습니다 — 나머지만 보입니다. [다시]
        </div>
      )}
      {exact.length === 0 && loose.length === 0 ? (
        <div className="px-3 py-4 text-xs leading-5 text-slate-500">
          <div className="font-bold text-slate-700">FIELD 기록 없음</div>
          <div>찾아본 곳: {p.coverage?.searched.length ? p.coverage.searched.join(" · ") : "없음"}</div>
          {!!p.coverage?.missing.length && <div className="text-slate-400">아직 표가 없어 건너뜀: {p.coverage.missing.join(" · ")}</div>}
        </div>
      ) : (
        <ul>{exact.slice(0, shown).map((l) => <LineRow key={l.key} line={l} all={p.lines} onLoad={p.onLoad} />)}</ul>
      )}
      {exact.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="block w-full border-t border-slate-100 py-2 text-center text-[11px] font-bold text-slate-500 hover:bg-slate-50">
          {exact.length - shown}줄 더 보기
        </button>
      )}
      {loose.length > 0 && (
        <div className="border-t border-slate-200">
          <button type="button" onClick={() => setLooseOpen((v) => !v)} aria-expanded={looseOpen} className="flex w-full items-center gap-1 px-3 py-2 text-left text-[11px] font-bold text-amber-800 hover:bg-amber-50">
            <ChevronDown size={12} className={looseOpen ? "rotate-180" : ""} />이름 일부만 일치 {loose.length}줄 — 같은 업체인지 확인 필요
          </button>
          {looseOpen && <ul>{loose.slice(0, 60).map((l) => <LineRow key={l.key} line={l} all={p.lines} onLoad={p.onLoad} />)}</ul>}
        </div>
      )}
      {!!p.coverage?.rawSkipped.length && <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">원문 속 기번 검색이 오래 걸려 건너뜀: {p.coverage.rawSkipped.join(" · ")}</div>}
      {p.spec.kakaoKinds?.length ? (
        <div className="flex items-center gap-1.5 border-t border-dashed border-slate-200 bg-slate-100 px-3 py-2 text-[11px] text-slate-500">
          <MessageSquareText size={12} className="shrink-0" />카톡방 원문은 위 [카톡 대화] 탭에서 봅니다
        </div>
      ) : null}
    </>
  );
}
