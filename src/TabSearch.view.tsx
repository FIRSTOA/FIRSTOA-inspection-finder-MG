// 필드 탭 검색 — 표시 틀만(조회·상태 없음). 값과 핸들러는 TabSearchBar.tsx 가 넘긴다.
// 설계: docs/tasks/tab-search-kakao-history.md 4절. 폰(390px) 우선: 접힌 상태는 검색칸 한 줄, 결과는 그 아래 흰 카드로 펼침.
// 줄 색: FIELD 기록 = 흰 바탕. 카톡 원문(2단계) = 회색 바탕 — 지금은 자리 안내만.
import { useState } from "react";
import { AlertCircle, ChevronDown, Loader2, MessageSquareText, RotateCcw, Search, X } from "lucide-react";
import type { Candidate } from "./entity360";
import { relatedLines, type Coverage, type TabLine, type TabSpec } from "./tabSearch";

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
};

const PAGE = 40;

/** 펼침 — 주요 칸 · 원문 · 같은 업체 같은 종류 최근 5건(이미 모은 줄에서). 글은 tabSearch.toLines 에서 주민번호를 가린 값 */
function LineDetail({ line, related }: { line: TabLine; related: TabLine[] }) {
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
    </div>
  );
}

function LineRow({ line, all }: { line: TabLine; all: TabLine[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-slate-100 bg-white last:border-b-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
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
      {open && <LineDetail line={line} related={relatedLines(all, line)} />}
    </li>
  );
}

export default function TabSearchView(p: TabSearchViewProps) {
  const showCandidates = !p.picked && p.query.trim().length >= 2 && p.candState !== "idle";
  const showResult = !!p.picked;

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
        <ul>{exact.slice(0, shown).map((l) => <LineRow key={l.key} line={l} all={p.lines} />)}</ul>
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
          {looseOpen && <ul>{loose.slice(0, 60).map((l) => <LineRow key={l.key} line={l} all={p.lines} />)}</ul>}
        </div>
      )}
      {!!p.coverage?.rawSkipped.length && <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">원문 속 기번 검색이 오래 걸려 건너뜀: {p.coverage.rawSkipped.join(" · ")}</div>}
      {/* 2단계 자리 — 카톡 원문 줄은 회색 바탕으로 여기 섞인다 */}
      <div className="flex items-center gap-1.5 border-t border-dashed border-slate-200 bg-slate-100 px-3 py-2 text-[11px] text-slate-500">
        <MessageSquareText size={12} className="shrink-0" />카톡방 원문 — 아직 연결 전(FIELD 기록만 보입니다)
      </div>
    </>
  );
}
