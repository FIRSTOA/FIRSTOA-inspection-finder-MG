// 필드 탭 검색 — 표시 부품만(조회·상태 없음). 값과 핸들러는 src/useTabSearch.ts 훅 → src/field/FieldSearchSheet.tsx 가 넘긴다.
// 설계: docs/tasks/tab-search-icon-merge-2026-10-25.md 5절(헤더 🔍 시트 + 한 목록). 폰(390px) 우선.
// 줄 색: FIELD 기록 = 흰 바탕 + 종류 배지. 카톡 원문 = 회색 바탕 + "카톡" 배지(표에 없는 대화만 — 병합은 tabSearch.mergeKakaoLines).
// 2026-10-25: 맨 위 가로 입력·[FIELD 기록|카톡 대화] 두 칸·KakaoPane 을 지웠다. 남은 것 = 후보 목록·결과 목록·줄.
import { useState } from "react";
import { AlertCircle, ChevronDown, Download, Loader2, MessageSquareText, RotateCcw } from "lucide-react";
import type { Candidate } from "./entity360";
import { canLoadLine, relatedLines, type Coverage, type TabLine, type TabSpec } from "./tabSearch";
import { isFormLeft, isKakaoLine, kakaoNote, type KakaoStatus } from "./tabSearchLine";

type LoadFn = ((line: TabLine) => void) | undefined;

const PAGE = 40;

/** 펼침 — 주요 칸 · 원문 · 같은 업체 같은 종류 최근 5건(이미 모은 줄에서). 글은 tabSearch.toLines 에서 주민번호를 가린 값 */
function LineDetail({ line, related, onLoad }: { line: TabLine; related: TabLine[]; onLoad: LoadFn }) {
  const kakao = isKakaoLine(line);
  const fields: [string, string][] = [
    ["날짜", [line.date || "날짜 없음", line.time].filter(Boolean).join(" ")],
    [kakao ? "보낸이" : "작성", [line.author, line.team].filter(Boolean).join(" · ")],
    ["업체", line.vendor],
    ["기기", line.device],
    ["내용", line.title],
    [kakao ? "방" : "상세", line.detail],
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
      {!kakao && (
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
      )}
      {canLoadLine(line, onLoad) && (
        <button type="button" onClick={() => onLoad!(line)} className="flex h-9 w-full items-center justify-center gap-1 rounded-lg bg-slate-900 text-[12px] font-bold text-white active:scale-[0.99]">
          <Download size={13} />이 {line.kind} 기록을 양식으로 불러오기
        </button>
      )}
    </div>
  );
}

/** 결과 한 줄 — FIELD 는 흰 바탕·종류 배지, 카톡은 회색 바탕·"카톡" 배지와 "표에 없는 대화 · 방 이름" */
export function LineRow({ line, all, onLoad, dim }: { line: TabLine; all: TabLine[]; onLoad: LoadFn; dim?: boolean }) {
  const [open, setOpen] = useState(false);
  const kakao = isKakaoLine(line);
  const loadable = !kakao && canLoadLine(line, onLoad);
  const bg = kakao || dim ? "bg-slate-100" : "bg-white";
  return (
    <li className={`border-b border-slate-100 last:border-b-0 ${bg} ${dim ? "opacity-70" : ""}`}>
      <div className="flex items-start">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`block min-w-0 flex-1 px-3 py-2 text-left ${kakao || dim ? "hover:bg-slate-200/60" : "hover:bg-slate-50"}`}>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="shrink-0 font-bold tabular-nums text-slate-700">{line.date || "날짜 없음"}</span>
          {kakao
            ? <span className="flex shrink-0 items-center gap-0.5 rounded-full border border-slate-300 bg-white px-1.5 py-px text-[10px] font-bold text-slate-600"><MessageSquareText size={10} />카톡</span>
            : <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold ${line.tone}`}>{line.kind}</span>}
          {kakao && isFormLeft(line) && <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-px text-[10px] font-bold text-violet-800">표에 안 들어간 양식 글</span>}
          {line.loose && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800">이름 일부 일치</span>}
          {line.otherVendor && <span className="min-w-0 truncate rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-600">당시 {line.otherVendor}</span>}
          <span className="ml-auto min-w-0 truncate text-slate-400">{[line.author, line.team].filter(Boolean).join(" · ")}</span>
        </div>
        <div className={`mt-0.5 text-[13px] font-bold text-slate-900 ${open ? "" : "line-clamp-1"}`}>{line.title}</div>
        {kakao
          ? <div className="line-clamp-1 text-[10px] text-slate-500">{kakaoNote(line)}</div>
          : (line.detail || line.device) && <div className={`text-[11px] text-slate-500 ${open ? "" : "line-clamp-1"}`}>{[line.detail, line.device].filter(Boolean).join(" · ")}</div>}
      </button>
      {loadable && (
        <button type="button" onClick={() => onLoad!(line)} aria-label={`${line.date || "날짜 없음"} ${line.kind} 기록 불러오기`}
          className="mr-2 mt-2 shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 active:scale-95">불러오기</button>
      )}
      </div>
      {open && <LineDetail line={line} related={kakao ? [] : relatedLines(all, line)} onLoad={kakao ? undefined : onLoad} />}
    </li>
  );
}

/** 업체 후보 목록(시트 안, 흰 바탕) — entity360 후보 최대 5곳 + "글자 그대로 찾기" */
export function TabSearchCandidates({ state, candidates, query, onPick }: {
  state: "idle" | "loading" | "done"; candidates: Candidate[]; query: string; onPick: (c: Candidate | null) => void;
}) {
  if (state === "idle") return null;
  return (
    <div className="mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {state === "loading" && <div className="px-3 py-2.5 text-xs text-slate-400">업체를 찾는 중…</div>}
      {state === "done" && candidates.slice(0, 5).map((c) => (
        <button key={`${c.code}|${c.leaseCode}`} type="button" onClick={() => onPick(c)} className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-900">{c.name}</span>
          {c.deviceCount > 0 && <span className="shrink-0 text-[10px] text-slate-400">기기 {c.deviceCount}</span>}
          <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-600">{c.how}</span>
        </button>
      ))}
      {state === "done" && (
        <button type="button" onClick={() => onPick(null)} className="block w-full px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-50">
          {candidates.length ? "목록에 없음 — " : "등록된 업체를 못 찾았습니다 — "}<b className="text-slate-700">“{query.trim()}”</b> 글자 그대로 찾기
        </button>
      )}
    </div>
  );
}

export type TabSearchResultsProps = {
  spec: TabSpec;
  title: string;                // 머리 줄 — 고른 업체 이름
  runState: "idle" | "loading" | "done" | "error";
  error: string;
  onRun: () => void;            // 고른 업체로 다시 찾기
  lines: TabLine[];             // 칩으로 거른 한 목록(FIELD + 표에 없는 카톡)
  all: TabLine[];               // 펼침 "같은 업체 최근 n건" 재료(거르기 전)
  hidden: TabLine[];            // 표에 이미 있는 카톡 글(숨김) — [보기]로 회색 줄
  chip: string;
  onChip: (key: string) => void;
  summary: string;
  coverage: Coverage | null;
  resultKey: string;            // 새 조회마다 바뀜 — "더 보기"·접힘 상태를 처음으로
  kakao: KakaoStatus;
  onKakaoRetry: () => void;
  onLoad?: (line: TabLine) => void; // 점검·AS 만: 그 기록 원문을 양식에 [불러오기]
  heading?: string;             // 점검·AS 시트의 "더 지난 이력" 같은 머리 글(없으면 업체 이름 줄)
  foldKakao?: boolean;          // 점검·AS 시트: 카톡 줄을 목록에서 빼 접힌 묶음으로(팀장 결정 Q1)
};

/** 결과 목록 — 머리(업체·다시·요약·칩) + 상태 + 한 목록 + 맨 아래 안내 */
export function TabSearchResults(p: TabSearchResultsProps) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-900">
            {p.heading || p.title} <span className="font-normal text-slate-400">· {p.heading ? p.title : p.spec.label}</span>
          </span>
          {p.runState !== "loading" && p.runState !== "idle" && (
            <button type="button" onClick={p.onRun} className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
              <RotateCcw size={11} />다시
            </button>
          )}
        </div>
        {p.runState === "done" && p.summary && <div className="mt-0.5 text-[11px] font-bold text-blue-700">{p.summary}</div>}
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

      {p.runState === "loading" && <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" />{p.spec.label} 기록을 모으는 중…</div>}
      {p.runState === "error" && (
        <div className="flex items-start gap-2 px-3 py-4 text-xs text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" /><span>기록을 못 불러왔습니다. [다시]를 눌러 주세요.{p.error ? ` (${p.error})` : ""}</span></div>
      )}
      {p.runState === "done" && <DoneList key={p.resultKey} {...p} />}
    </div>
  );
}

/** 결과 목록(조회 끝난 뒤) — 조회마다 key 가 바뀌어 "더 보기"·접힘이 처음으로 돌아간다 */
function DoneList(p: TabSearchResultsProps) {
  const [shown, setShown] = useState(PAGE);
  const [looseOpen, setLooseOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [kakaoOpen, setKakaoOpen] = useState(false);
  const folded = p.foldKakao ? p.lines.filter(isKakaoLine) : [];
  const main = p.foldKakao ? p.lines.filter((l) => !isKakaoLine(l)) : p.lines;
  const exact = main.filter((l) => !l.loose);
  const loose = main.filter((l) => l.loose);
  return (
    <>
      {p.coverage && p.coverage.failed.length > 0 && (
        <div className="flex items-start gap-1.5 border-b border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />{p.coverage.failed.join("·")} 기록을 못 불러왔습니다 — 나머지만 보입니다. [다시]
        </div>
      )}
      {exact.length === 0 && loose.length === 0 ? (
        <div className="px-3 py-4 text-xs leading-5 text-slate-500">
          <div className="font-bold text-slate-700">{p.heading ? "더 지난 기록 없음" : "FIELD 기록 없음"}</div>
          <div>찾아본 곳: {p.coverage?.searched.length ? p.coverage.searched.join(" · ") : "없음"}</div>
          {!!p.coverage?.missing.length && <div className="text-slate-400">아직 표가 없어 건너뜀: {p.coverage.missing.join(" · ")}</div>}
        </div>
      ) : (
        <ul>{exact.slice(0, shown).map((l) => <LineRow key={l.key} line={l} all={p.all} onLoad={p.onLoad} />)}</ul>
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
          {looseOpen && <ul>{loose.slice(0, 60).map((l) => <LineRow key={l.key} line={l} all={p.all} onLoad={p.onLoad} />)}</ul>}
        </div>
      )}
      {folded.length > 0 && (
        <div className="border-t border-slate-200">
          <button type="button" onClick={() => setKakaoOpen((v) => !v)} aria-expanded={kakaoOpen} className="flex w-full items-center gap-1 bg-slate-50 px-3 py-2 text-left text-[11px] font-bold text-slate-600 hover:bg-slate-100">
            <ChevronDown size={12} className={kakaoOpen ? "rotate-180" : ""} /><MessageSquareText size={12} />카톡 대화 {folded.length}건(표에 없는 글)
          </button>
          {kakaoOpen && <ul>{folded.slice(0, 60).map((l) => <LineRow key={l.key} line={l} all={p.all} onLoad={undefined} />)}</ul>}
        </div>
      )}
      {!!p.coverage?.rawSkipped.length && <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">원문 속 기번 검색이 오래 걸려 건너뜀: {p.coverage.rawSkipped.join(" · ")}</div>}
      {p.hidden.length > 0 && (
        <div className="border-t border-slate-200">
          <button type="button" onClick={() => setHiddenOpen((v) => !v)} aria-expanded={hiddenOpen} className="flex w-full items-center gap-1 px-3 py-2 text-left text-[11px] text-slate-500 hover:bg-slate-50">
            표에 이미 있는 카톡 글 {p.hidden.length}건 숨김 <b className="ml-1 text-slate-700">[{hiddenOpen ? "접기" : "보기"}]</b>
          </button>
          {hiddenOpen && <ul>{p.hidden.slice(0, 60).map((l) => <LineRow key={l.key} line={l} all={p.all} onLoad={undefined} dim />)}</ul>}
        </div>
      )}
      <KakaoFooter status={p.kakao} onRetry={p.onKakaoRetry} />
    </>
  );
}

/** 맨 아래 카톡 상태 한 줄 — 꺼짐 안내 / 실패 [다시] / 찾는 중. 수집 방이 없는 탭(off)·정상(done)은 아무것도 없음 */
export function KakaoFooter({ status, onRetry }: { status: KakaoStatus; onRetry: () => void }) {
  if (status === "disabled") {
    return <div className="flex items-center gap-1.5 border-t border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500"><MessageSquareText size={12} className="shrink-0" />카톡 원문 검색은 꺼져 있습니다(관리자가 켬)</div>;
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-1.5 border-t border-dashed border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700">
        <AlertCircle size={12} className="shrink-0" />카톡 대화를 못 불러왔습니다
        <button type="button" onClick={onRetry} className="ml-auto shrink-0 rounded-lg border border-red-200 bg-white px-2 py-0.5 font-bold">다시</button>
      </div>
    );
  }
  if (status === "loading") {
    return <div className="flex items-center gap-1.5 border-t border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-400"><Loader2 size={12} className="shrink-0 animate-spin" />카톡 대화를 찾는 중…</div>;
  }
  return null;
}
