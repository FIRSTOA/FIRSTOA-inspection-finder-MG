// OKR 화면 공용 조각(JSX 아님) — OkrHub.tsx 에 있던 것을 그대로 옮겼다(2026-10-20, 분기 → 월 → 주 화면 분리).
// 칸 클래스·색 정보 갱신·Pillar 묶음·열 너비 훅. 동작은 옮기기 전과 같다.
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { bottleneckLabel, pillarIndex, type OkrGoal, type OkrResultRow, type RichField } from "./okr";

export const teamName = (team: string) => `${team}파트`;
// 3차(2026-10-21): 파트 탭 주차 칩([1주][2주]…)은 파트원 이름을 골랐을 때만 — 파트 종합('')·팀원 집계('__sum__')엔 없다(파트 종합 = 그 달 하나)
export const showsWeekChips = (member: string) => !!member && member !== "__sum__";
export const shortBottleneck = (goals: OkrGoal[], no: number) => bottleneckLabel(goals, no).replace("병목현상", "병목");

// 노란 칸의 색 정보 갱신 — 평문으로 바뀐 칸(AI·합치기)은 색을 지운다
export const withHtml = (row: OkrResultRow, field: RichField, html: string | undefined): OkrResultRow["html"] => {
  const next = { ...(row.html || {}) };
  if (html) next[field] = html; else delete next[field];
  return Object.keys(next).length ? next : undefined;
};
export const clearHtml = (row: OkrResultRow, fields: RichField[]): OkrResultRow["html"] => {
  const next = { ...(row.html || {}) };
  for (const f of fields) delete next[f];
  return Object.keys(next).length ? next : undefined;
};
export const goalHtml = (g: OkrGoal, field: "objective" | "criteria" | "bottleneck", html: string | undefined): OkrGoal["html"] => {
  const next = { ...(g.html || {}) };
  if (html) next[field] = html; else delete next[field];
  return Object.keys(next).length ? next : undefined;
};

export const TD = "border border-slate-200 align-top";
export const TD_READ = `${TD} px-2 py-1.5`;
export const TD_CELL = `${TD} p-0`; // 빈 곳 클릭은 표의 onClick(tableCellClick)이 안쪽 칸으로 넘긴다
export const TD_EDIT = `${TD_CELL} focus-within:ring-2 focus-within:ring-inset focus-within:ring-slate-400`;
export const TD_WRITE = `${TD_CELL} bg-[#FFFBEB] focus-within:bg-white`;
export const TD_FIXED = `${TD_CELL} bg-sky-50`; // 고정 목표(전사 공통) — 파트·팀원 화면에서 읽기만, 색으로 구분(2026-09-30 팀장)
export const TD_FIXED_EDIT = `${TD_FIXED} focus-within:ring-2 focus-within:ring-inset focus-within:ring-sky-400`;
// 새 구조(분기 → 월 → 주, 2026-10-20) 색 — 병목현상·목표 칸(남보라) · 그 밖의 입력(달성기준 포함, TD_WRITE 노랑).
// 3차(2026-10-21): 색은 병목현상·목표 열만. 주차 쪼개기 청록(TD_SPLIT·TH_SPLIT)은 지웠다. 옛 TD_FIXED(8·9월 화면)는 그대로 둔다.
export const TD_LEADER = `${TD_CELL} bg-indigo-50`; // 병목현상·목표 — 읽기
export const TD_LEADER_EDIT = `${TD_LEADER} focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-400`; // 같은 칸을 고칠 수 있을 때
export const TH_LEADER = "border border-slate-300 bg-indigo-100 px-2 py-1.5 text-indigo-900";
export const TH_READ = "border border-slate-300 bg-slate-100 px-2 py-1.5 text-slate-600";
export const TH_WRITE = "border border-slate-300 bg-[#FDECB3] px-2 py-1.5 text-slate-800";
export const LINK = "text-slate-500 hover:text-slate-900 hover:underline disabled:opacity-40";

// 열 너비 — 머리 칸 오른쪽 가장자리를 끌어 조절(엑셀처럼, 2026-09-24). 이 브라우저에 기억(localStorage), 가장자리를 두 번 누르면 기본값.
export function useColWidths(storageKey: string, defaults: number[]) {
  const [widths, setWidths] = useState<number[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || "null"); if (Array.isArray(saved) && saved.length === defaults.length) return saved.map((n) => Math.max(40, Number(n) || 0)); } catch { /* 무시 */ }
    return defaults;
  });
  const persist = (next: number[]) => { try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 무시 */ } };
  const startDrag = (index: number, e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = widths[index];
    let latest = widths;
    const onMove = (ev: MouseEvent) => { const next = [...latest]; next[index] = Math.max(40, start + ev.clientX - startX); latest = next; setWidths(next); };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); persist(latest); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const resetCol = (index: number) => { const next = [...widths]; next[index] = defaults[index]; setWidths(next); persist(next); };
  return { widths, total: widths.reduce((a, b) => a + b, 0), startDrag, resetCol };
}

// 연속된 같은 Pillar 목표를 한 묶음으로(막대 하나 + 병목 1·2·3 행)
export function pillarRuns(goals: OkrGoal[]): Array<{ idx: number; goals: OkrGoal[] }> {
  const out: Array<{ idx: number; goals: OkrGoal[] }> = [];
  for (const g of goals) {
    const idx = pillarIndex(g.pillar);
    const last = out[out.length - 1];
    if (last && last.idx === idx) last.goals.push(g);
    else out.push({ idx, goals: [g] });
  }
  return out;
}

// ── 새 구조 머리(2026-10-21 6차) — 흰 카드 안 경로 줄(breadcrumb). 통합집계 › 10월 / 통합집계 › 4분기 / C파트 › 파트 종합 › 10월 /
//    C파트 › 팀원 집계 › 10월 / C파트 › 이민구 › 10월 3주차 (10/19~23). 옛 화면(8·9월·SQL 전)은 이 줄을 쓰지 않는다.
const mdOf = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
// "2026-10-19","2026-10-23" → "10/19~23", 달이 바뀌면 "9/28~10/2"
export const weekRangeShort = (start: string, end: string) => `${mdOf(start)}~${end.slice(5, 7) === start.slice(5, 7) ? Number(end.slice(8, 10)) : mdOf(end)}`;
export function okrCrumbs(p: { quarterView: boolean; quarter: number; tab: string; member: string; month: number; week?: { weekNo: number; start: string; end: string } | null }): string[] {
  if (p.quarterView) return ["통합집계", `${p.quarter}분기`];
  if (p.tab === "all") return ["통합집계", `${p.month}월`];
  const part = teamName(p.tab);
  if (!p.member) return [part, "파트 종합", `${p.month}월`];
  if (p.member === "__sum__") return [part, "팀원 집계", `${p.month}월`];
  return [part, p.member, p.week ? `${p.month}월 ${p.week.weekNo}주차 (${weekRangeShort(p.week.start, p.week.end)})` : `${p.month}월`];
}
