// 필드 탭 맨 위 검색 막대(1단계 — FIELD 기록만, 카톡 없음). 상태·조회 연결만 하고 표시는 TabSearch.view.tsx.
// 파일 이름: Windows 는 대소문자를 안 가려 로직 tabSearch.ts 와 TabSearch.tsx 가 같은 파일로 잡힌다 — 그래서 TabSearchBar.
// 설계: docs/tasks/tab-search-kakao-history.md 4절.
//  - 2자 미만은 조회하지 않는다. 300ms 디바운스 후 업체 후보(resolveCandidates).
//  - 후보를 고르면 키 묶음(buildEntity)을 한 번 만들고, 그 탭 표만 모은다(runTabSearch → gather only).
//  - 탭을 바꾸면 결과는 버리고 [이력 보기]를 누를 때만 다시 조회한다(탭 전환마다 여러 표 조회 금지). 키 묶음은 다시 쓴다.
//  - 요청 번호로 늦게 온 결과가 새 결과를 덮지 않게 한다.
import { useEffect, useMemo, useRef, useState } from "react";
import { buildEntity, looksLikeDevice, resolveCandidates, type Candidate, type Entity } from "./entity360";
import { coverageOf, filterByChip, lastEvents, loadedToast, runTabSearch, summaryText, TAB_SPECS, tabKeyOf, toLines, type TabKey, type TabLine, type TabResult } from "./tabSearch";
import { notify } from "./toast";
import { askConfirm } from "./confirmModal";
import TabSearchView from "./TabSearch.view";

type CandBox = { q: string; list: Candidate[] };
type Picked = { cand: Candidate | null; name: string; query: string };
type Run = { id: number; tab: TabKey; state: "loading" | "done" | "error"; results: TabResult[]; error: string };

// 점검·AS 탭 [불러오기](2026-10-25): 거래처검색의 불러오기와 같은 함수(App handleLoadForm — _원문을 변환기에 넣고 점검/AS 양식을 글로 자동 판별)를 받아 쓴다.
//  hasDraft = 원본에 입력 중인 글이 있음 → 덮어쓰기 확인. 불러온 뒤 결과 칸을 닫고 양식 카드로 스크롤·첫 칸 포커스.
type Props = { mode: string; pcSubTab?: string; onLoadForm?: (text: string) => void; hasDraft?: boolean };

/** 양식 카드(ProcessingFormPanel 의 FieldFormCard aria-label)로 스크롤하고 첫 입력에 포커스 — 변환이 끝나 카드가 다시 그려진 뒤에 */
function focusFieldForm() {
  window.setTimeout(() => {
    const card = document.querySelector<HTMLElement>('section[aria-label="점검·AS 양식"]');
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.querySelector<HTMLElement>("input:not([disabled]), textarea, button:not([disabled])")?.focus({ preventScroll: true });
  }, 350);
}

export default function TabSearchBar({ mode, pcSubTab, onLoadForm, hasDraft }: Props) {
  const tab = tabKeyOf(mode, pcSubTab);
  const [query, setQuery] = useState("");
  const [cand, setCand] = useState<CandBox>({ q: "", list: [] });
  const [picked, setPicked] = useState<Picked | null>(null);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [chip, setChip] = useState("all");
  const candReq = useRef(0);
  const runReq = useRef(0);
  const q = query.trim();

  const start = async (tabKey: TabKey, p: Picked, known: Entity | null) => {
    const id = ++runReq.current;
    setRun({ id, tab: tabKey, state: "loading", results: [], error: "" });
    setChip("all");
    try {
      const e = known || await buildEntity(p.cand, p.query);
      if (id !== runReq.current) return;
      if (!known) setEntity(e);
      const results = await runTabSearch(TAB_SPECS[tabKey], e);
      if (id !== runReq.current) return;
      setRun({ id, tab: tabKey, state: "done", results, error: "" });
    } catch (err) {
      if (id !== runReq.current) return;
      const msg = (err as Error)?.message || String(err);
      setRun({ id, tab: tabKey, state: "error", results: [], error: msg.slice(0, 80) });
      notify(`${TAB_SPECS[tabKey].label} 이력을 못 불러왔습니다 — ${msg.slice(0, 60)}`, "error");
    }
  };

  const pick = (c: Candidate | null) => {
    if (!tab) return;
    const p: Picked = { cand: c, name: c?.name || q, query: q };
    setPicked(p);
    setEntity(null);
    void start(tab, p, null);
  };

  // 업체 후보 — 디바운스. 2자 미만·업체를 이미 고른 상태면 조회하지 않는다
  useEffect(() => {
    if (!tab || picked || q.length < 2) return;
    const timer = window.setTimeout(async () => {
      const id = ++candReq.current;
      let list: Candidate[] = [];
      try { list = await resolveCandidates(q); } catch (err) {
        notify(`업체 찾기 실패 — ${((err as Error)?.message || String(err)).slice(0, 60)}`, "error");
      }
      if (id !== candReq.current) return;
      setCand({ q, list });
      // 기번·자산번호로 한 곳만 나오면 바로 결과로
      if (looksLikeDevice(q) && list.length === 1 && /기번|기기 번호/.test(list[0].how)) {
        const p: Picked = { cand: list[0], name: list[0].name, query: q };
        setPicked(p);
        setEntity(null);
        void start(tab, p, null);
      }
    }, 300);
    return () => window.clearTimeout(timer);
    // start 는 매 렌더 새로 만들어지지만 검색어·탭이 바뀔 때만 다시 돌면 된다
  }, [q, tab, picked]);

  const clearAll = () => { candReq.current++; runReq.current++; setQuery(""); setCand({ q: "", list: [] }); setPicked(null); setEntity(null); setRun(null); };

  const loadLine = async (line: TabLine) => {
    if (!onLoadForm || !line.formText) return;
    if (hasDraft && !(await askConfirm("입력 중인 내용을 덮어씁니다. 이 기록으로 불러올까요?", { okLabel: "불러오기" }))) return;
    onLoadForm(line.formText);
    clearAll();
    notify(loadedToast(line), "success");
    focusFieldForm();
  };

  const current = run && run.tab === tab ? run : null; // 탭이 바뀌면 이전 결과는 안 보인다
  const spec = tab ? TAB_SPECS[tab] : null;
  const lines = useMemo(() => (current && current.state === "done" && tab ? toLines(tab, current.results, entity) : []), [current, tab, entity]);
  if (!tab || !spec) return null; // 칭찬·테스트 탭은 숨김

  const candState = q.length < 2 ? "idle" : cand.q === q ? "done" : "loading";
  const coverage = current?.state === "done" ? coverageOf(current.results) : null;

  return (
    <TabSearchView
      spec={spec}
      query={query}
      onQuery={(v) => { setQuery(v); if (picked) { runReq.current++; setPicked(null); setEntity(null); setRun(null); } }}
      onClear={clearAll}
      candState={candState}
      candidates={cand.list}
      onPick={pick}
      picked={picked ? { name: picked.name } : null}
      runState={current ? current.state : "idle"}
      error={current?.error || ""}
      onRun={() => { if (picked) void start(tab, picked, entity); }}
      lines={filterByChip(lines, spec, chip)}
      chip={chip}
      onChip={setChip}
      summary={summaryText(lastEvents(spec, lines))}
      coverage={coverage}
      resultKey={`${tab}:${current?.id ?? 0}`}
      onLoad={tab === "inspection" && onLoadForm ? (line) => { void loadLine(line); } : undefined}
    />
  );
}
