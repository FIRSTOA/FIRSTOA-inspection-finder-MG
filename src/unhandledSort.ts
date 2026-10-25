/** 미처리 정렬 선택 — localStorage 에 기억하고 세 화면(홈 칸·현황판·부서 업무공간)이 같은 값을 본다(2026-10-25 밤) */
import { useSyncExternalStore } from "react";
import { parseSortOrder, UNHANDLED_SORT_KEY, type UnhandledSortOrder } from "./homeUnhandled";

const EVENT = "cs-unhandled-sort-change";
let memory: UnhandledSortOrder | null = null; // 저장소를 못 쓸 때(사생활 모드 등)도 이번 접속 동안은 유지

export function readUnhandledSort(): UnhandledSortOrder {
  try { return parseSortOrder(localStorage.getItem(UNHANDLED_SORT_KEY)); } catch { return memory ?? "old"; }
}
export function writeUnhandledSort(order: UnhandledSortOrder): void {
  memory = order;
  try { localStorage.setItem(UNHANDLED_SORT_KEY, order); } catch { /* 저장은 못 해도 이번 접속에선 아래 이벤트로 바뀐다 */ }
  window.dispatchEvent(new Event(EVENT));
}
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
};
export function useUnhandledSort(): [UnhandledSortOrder, (o: UnhandledSortOrder) => void] {
  const order = useSyncExternalStore(subscribe, readUnhandledSort, () => "old" as UnhandledSortOrder);
  return [order, writeUnhandledSort];
}
