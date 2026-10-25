// 필드 탭 🔍 시트의 상태·조회 연결(2026-10-25, 옛 TabSearchBar.tsx 에서 옮김). 표시는 TabSearch.view.tsx, 틀은 field/FieldSearchSheet.tsx.
// 설계: docs/tasks/tab-search-icon-merge-2026-10-25.md 3·5·6절.
//  - 2자 미만은 조회하지 않는다. 300ms 디바운스 후 업체 후보(resolveCandidates).
//  - 후보를 고르면 키 묶음(buildEntity)을 한 번 만들고, 그 탭 표만 모은다(runTabSearch). 카톡은 병렬(searchKakaoForTab — 꺼짐 기억·5분 캐시는 tabSearch.ts),
//    늦게 오면 mergeKakaoLines 로 끼워 넣는다. 카톡 실패는 FIELD 목록을 그대로 두고 맨 아래 한 줄만.
//  - pickName: 점검·AS(VendorSearch)·청정기(AirSearch)에서 고른 이름으로 이력을 연다. entity360 첫 후보가 이름 키로 같을 때만 그 후보를 쓴다(R3).
//  - 탭이 바뀌면 비운다(FieldSearchSheet 가 key=탭으로 새로 그림). 요청 번호로 늦게 온 결과가 새 결과를 덮지 않게 한다.
import { useEffect, useMemo, useRef, useState } from "react";
import { buildEntity, looksLikeDevice, resolveCandidates, sameVendorKey, type Candidate, type Entity } from "./entity360";
import { vendorMatchKey } from "./ids";
import {
  coverageOf, filterByChip, lastEvents, loadedToast, mergeKakaoLines, runTabSearch, searchKakaoForTab, summaryText, TAB_SPECS, toLines,
  type KakaoHit, type TabKey, type TabLine, type TabResult,
} from "./tabSearch";
import { notify } from "./toast";
import { askConfirm } from "./confirmModal";
import type { KakaoStatus } from "./tabSearchLine";

type CandBox = { q: string; list: Candidate[] };
export type Picked = { cand: Candidate | null; name: string; query: string };
type Run = { id: number; tab: TabKey; state: "loading" | "done" | "error"; results: TabResult[]; error: string };
type Kakao = { id: number; status: KakaoStatus; rows: KakaoHit[] };

/** VendorSearch·AirSearch 에서 고른 이름 → entity360 후보. 첫 후보가 이름 키로 같은 업체일 때만 쓰고 아니면 null(이름 글자 그대로 찾기) */
export function candidateForName(name: string, list: Candidate[]): Candidate | null {
  const first = list[0];
  if (!first) return null;
  return sameVendorKey(vendorMatchKey(first.name), vendorMatchKey(name)) ? first : null;
}

/** 카톡 검색에 넣을 이름 — 넓게: 핵심 이름(entity360 core, "세무법인 건영 논현지점"→"건영")이 2자 이상이면 그것, 아니면 업체 이름(정규화는 tabSearch.kakaoQueryOf) — 팀장 결정 */
export const kakaoNameOf = (e: Pick<Entity, "core" | "name">): string => ((e.core || "").length >= 2 ? e.core : e.name);

/**
 * 카드에 이미 보이는 양식(_원문)과 같은 점검·AS 줄을 뺀다 — InspForm 에 id 가 없어 글로 비교.
 * 공백만 정리한 원문 전체 일치. dupKey80(숫자 뺀 앞 80자)은 쓰지 않는다: 같은 업체 양식은 머리(업체명·등급·모델…)가 같고
 * 날짜·매수 숫자만 달라 다른 방문 기록까지 빠진다.
 */
export function excludeShownForms(lines: TabLine[], shownTexts: string[]): TabLine[] {
  const norm = (t: string) => String(t || "").replace(/\s+/g, " ").trim();
  const set = new Set(shownTexts.map(norm).filter(Boolean));
  if (!set.size) return lines;
  return lines.filter((l) => !(l.formText && set.has(norm(l.formText))));
}

/** 양식 카드(ProcessingFormPanel 의 FieldFormCard aria-label)로 스크롤하고 첫 입력에 포커스 — 변환이 끝나 카드가 다시 그려진 뒤에 */
function focusFieldForm() {
  window.setTimeout(() => {
    const card = document.querySelector<HTMLElement>('section[aria-label="점검·AS 양식"]');
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.querySelector<HTMLElement>("input:not([disabled]), textarea, button:not([disabled])")?.focus({ preventScroll: true });
  }, 350);
}

type Opts = {
  onLoadForm?: (text: string) => void; // 점검·AS 만 — App handleLoadForm(t, { silent: true })
  hasDraft?: boolean;
  shownTexts?: string[];               // 점검·AS 시트: 카드에 이미 보이는 양식 원문(이력에서 뺀다)
};

export function useTabSearch(tab: TabKey | null, opts: Opts = {}) {
  const [query, setQuery] = useState("");
  const [cand, setCand] = useState<CandBox>({ q: "", list: [] });
  const [picked, setPicked] = useState<Picked | null>(null);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [kakao, setKakao] = useState<Kakao>({ id: 0, status: "off", rows: [] });
  const [chip, setChip] = useState("all");
  const candReq = useRef(0);
  const runReq = useRef(0);
  const q = query.trim();

  const startKakao = async (tabKey: TabKey, e: Entity, id: number) => {
    if (!TAB_SPECS[tabKey].kakaoKinds?.length) { setKakao({ id, status: "off", rows: [] }); return; }
    setKakao({ id, status: "loading", rows: [] });
    try {
      const r = await searchKakaoForTab(tabKey, kakaoNameOf(e));
      if (id !== runReq.current) return;
      if (r.status === "none") setKakao({ id, status: "off", rows: [] });
      else if (r.status === "off") setKakao({ id, status: "disabled", rows: [] });
      else setKakao({ id, status: "done", rows: r.result.rows || [] });
    } catch {
      if (id !== runReq.current) return;
      setKakao({ id, status: "error", rows: [] }); // FIELD 목록은 그대로 — 맨 아래 "카톡 대화를 못 불러왔습니다 [다시]"
    }
  };

  const start = async (tabKey: TabKey, p: Picked, known: Entity | null) => {
    const id = ++runReq.current;
    setRun({ id, tab: tabKey, state: "loading", results: [], error: "" });
    setKakao({ id, status: "off", rows: [] });
    setChip("all");
    try {
      const e = known || await buildEntity(p.cand, p.query);
      if (id !== runReq.current) return;
      if (!known) setEntity(e);
      void startKakao(tabKey, e, id); // FIELD 조회와 병렬
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

  const clearAll = () => {
    candReq.current++; runReq.current++;
    setQuery(""); setCand({ q: "", list: [] }); setPicked(null); setEntity(null); setRun(null); setKakao({ id: 0, status: "off", rows: [] });
  };

  const pick = (c: Candidate | null) => {
    if (!tab) return;
    const p: Picked = { cand: c, name: c?.name || q, query: q };
    setPicked(p);
    setEntity(null);
    void start(tab, p, null);
  };

  /** 점검·AS·청정기: 거래처검색에서 고른 업체 이름으로 이력을 연다. 같은 이름을 다시 고르면 지난 결과를 그대로 둔다 */
  const pickName = async (name: string) => {
    const v = String(name || "").trim();
    if (!tab || !v) return;
    if (picked && picked.name === v && run && run.tab === tab && run.state !== "error") return;
    const id = ++candReq.current;
    let list: Candidate[] = [];
    try { list = await resolveCandidates(v); } catch (err) {
      notify(`이력용 업체 찾기 실패 — ${((err as Error)?.message || String(err)).slice(0, 60)} (이름 그대로 찾습니다)`, "error");
    }
    if (id !== candReq.current) return;
    const p: Picked = { cand: candidateForName(v, list), name: v, query: v };
    setQuery(v);
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
  }, [q, tab, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const onQuery = (v: string) => {
    setQuery(v);
    if (picked) { runReq.current++; setPicked(null); setEntity(null); setRun(null); setKakao({ id: 0, status: "off", rows: [] }); }
  };

  const loadLine = async (line: TabLine) => {
    if (!opts.onLoadForm || !line.formText) return;
    if (opts.hasDraft && !(await askConfirm("입력 중인 내용을 덮어씁니다. 이 기록으로 불러올까요?", { okLabel: "불러오기" }))) return;
    opts.onLoadForm(line.formText);
    notify(loadedToast(line), "success");
    focusFieldForm();
  };

  const current = run && run.tab === tab ? run : null;
  const spec = tab ? TAB_SPECS[tab] : null;
  const shownKey = (opts.shownTexts || []).join("\u0001");
  const fieldLines = useMemo(() => {
    if (!current || current.state !== "done" || !tab) return [];
    return excludeShownForms(toLines(tab, current.results, entity), shownKey ? shownKey.split("\u0001") : []);
  }, [current, tab, entity, shownKey]);
  const kakaoRows = current && kakao.id === current.id && kakao.status === "done" ? kakao.rows : null;
  const merged = useMemo(() => mergeKakaoLines(fieldLines, kakaoRows || [], { e: entity }), [fieldLines, kakaoRows, entity]);

  return {
    spec,
    query, onQuery, clearAll,
    candState: (!tab || picked || q.length < 2 ? "idle" : cand.q === q ? "done" : "loading") as "idle" | "loading" | "done",
    candidates: cand.list,
    pick, pickName, picked,
    runState: (current ? current.state : "idle") as "idle" | "loading" | "done" | "error",
    error: current?.error || "",
    rerun: () => { if (tab && picked) void start(tab, picked, entity); },
    retryKakao: () => { if (tab && entity && current) void startKakao(tab, entity, current.id); },
    all: merged.lines,
    lines: spec ? filterByChip(merged.lines, spec, chip) : [],
    hidden: merged.hidden,
    chip, setChip,
    summary: spec ? summaryText(lastEvents(spec, fieldLines)) : "",
    coverage: current?.state === "done" ? coverageOf(current.results) : null,
    resultKey: `${tab}:${current?.id ?? 0}`,
    kakaoStatus: (current && kakao.id === current.id ? kakao.status : "off") as KakaoStatus,
    loadLine,
  };
}

export type TabSearchState = ReturnType<typeof useTabSearch>;
