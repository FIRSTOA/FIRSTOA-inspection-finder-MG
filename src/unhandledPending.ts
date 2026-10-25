/**
 * 미처리 [완료]·[보류]·[배정]을 누른 뒤 "내 화면에서 먼저" 반영(낙관적 제거) — 2026-10-25.
 * 설계: docs/tasks/unhandled-actions-2026-10-25.md 3-3절.
 *
 * 왜: 시트 미처리(reception-sheet-open)는 60초 캐시, 부서 시트 기입은 실측 37초 — 누르자마자 다시 읽으면 줄이 되살아난다.
 * 그래서 누른 줄을 sessionStorage 에 5분 적어 두고, 미처리 로더(kpi/kpiData.loadUnhandledRows)가 반환 직전에 한 번 거른다.
 *  · 완료(done): 줄을 뺀다.  · 보류(hold): 상태만 덮어 보여 준다.  · 배정(assign): 처리자만 덮어 보여 준다.
 *  · 실패하면 부르는 쪽이 clearPending → 줄이 되살아나고 빨간 토스트(unhandledActions.ts).
 *  · 다음 조회에서 원본이 이미 따라왔으면(완료 줄이 없음·상태/처리자가 같음) prune 으로 지운다.
 * 내 브라우저(탭)만 가린다 — 다른 사람 화면은 원본이 바뀐 뒤에 바뀐다.
 */
import { useSyncExternalStore } from "react";

export type PendingAction = "done" | "hold" | "assign";
export type PendingEntry = { action: PendingAction; value: string; until: number };
export type PendingMap = Record<string, PendingEntry>;

export const PENDING_TTL_MS = 5 * 60_000;
export const PENDING_EVENT = "unhandled-pending";
const STORE_KEY = "field.unhandledPending.v1";

// sessionStorage 가 없거나 막힌 환경(테스트·사생활 모드)에서는 메모리로
let memory: PendingMap = {};
let version = 0;

function readRaw(): PendingMap {
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? (parsed as PendingMap) : {};
    }
  } catch { /* 읽기 실패 → 메모리 값 */ }
  return { ...memory };
}

function writeRaw(map: PendingMap) {
  memory = { ...map };
  try {
    if (typeof sessionStorage !== "undefined") {
      if (Object.keys(map).length) sessionStorage.setItem(STORE_KEY, JSON.stringify(map));
      else sessionStorage.removeItem(STORE_KEY);
    }
  } catch { /* 저장 못 해도 메모리 값으로 이번 화면은 동작 */ }
  version += 1;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PENDING_EVENT));
}

/** 만료되지 않은 항목만 */
export function readPending(now: number = Date.now()): PendingMap {
  const out: PendingMap = {};
  for (const [k, v] of Object.entries(readRaw())) {
    if (v && typeof v === "object" && Number(v.until) > now && (v.action === "done" || v.action === "hold" || v.action === "assign")) out[k] = v;
  }
  return out;
}

export function markPending(key: string, action: PendingAction, value = "", now: number = Date.now(), ttl: number = PENDING_TTL_MS) {
  if (!key) return;
  writeRaw({ ...readPending(now), [key]: { action, value, until: now + ttl } });
}

export function clearPending(key: string) {
  const cur = readRaw();
  if (!(key in cur)) return;
  delete cur[key];
  writeRaw(cur);
}

/** 테스트용 — 전부 지움 */
export function resetPending() { writeRaw({}); }

type RowLike = { key: string; status: string; assignee: string };

/**
 * rows 에 pending 을 입힌다(순수에 가깝게: 저장소 읽기만, prune 일 때만 지운다).
 * prune 은 **전체 목록**을 다 읽었을 때만 켠다(부서 탭처럼 일부만 넘기면 다른 줄의 pending 을 잘못 지운다).
 */
export function applyPending<T extends RowLike>(rows: T[], opts: { now?: number; prune?: boolean } = {}): T[] {
  const now = opts.now ?? Date.now();
  const map = readPending(now);
  const keys = Object.keys(map);
  if (!keys.length) {
    if (opts.prune && Object.keys(readRaw()).length) writeRaw({}); // 만료분 정리
    return rows;
  }
  const seen = new Set(rows.map((r) => r.key));
  const stale: string[] = [];
  const out: T[] = [];
  for (const r of rows) {
    const p = map[r.key];
    if (!p) { out.push(r); continue; }
    if (p.action === "done") continue;
    if (p.action === "hold") {
      if (r.status === p.value) stale.push(r.key);
      out.push({ ...r, status: p.value });
      continue;
    }
    if (r.assignee === p.value) stale.push(r.key);
    out.push({ ...r, assignee: p.value });
  }
  if (opts.prune) {
    for (const k of keys) if (map[k].action === "done" && !seen.has(k)) stale.push(k); // 원본에서 이미 빠짐
    if (stale.length || keys.length !== Object.keys(readRaw()).length) {
      const next = { ...map };
      for (const k of stale) delete next[k];
      writeRaw(next);
    }
  }
  return out;
}

function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PENDING_EVENT, cb);
  return () => window.removeEventListener(PENDING_EVENT, cb);
}
/** pending 이 바뀔 때마다 오르는 숫자 — 화면이 useMemo 의존값으로 쓴다 */
export function usePendingVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}
