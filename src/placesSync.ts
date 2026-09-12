// 워킨맵 공용 목록(workin_map_places) 증분 폴링의 순수 병합 규칙.
// WalkingMap.tsx는 leaflet·카카오 SDK를 import해 노드 테스트에서 못 여니, 규칙만 여기로 떼어 검증한다.

export type SyncedRow = { id: number; updatedAt?: string };

// PostgREST가 돌려주는 updated_at(ISO, +00:00)을 ms로. 없거나 못 읽으면 0(= 가장 옛것으로 취급).
export function updatedAtMs(iso: string | undefined) {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

// 비교용 키(µs 해상도) — Date.parse는 소수 넷째 자리부터 버려 now()로 찍힌 마이크로초 stamp끼리 같아 보인다.
// 브라우저 저장은 ms까지라 실무에선 안 겹치지만, 비교는 자릿수를 다 살려 한다.
export function updatedAtKey(iso: string | undefined) {
  const ms = updatedAtMs(iso);
  if (!ms) return 0;
  const fraction = (iso?.match(/\.(\d{1,6})/)?.[1] || "").padEnd(6, "0");
  return ms * 1000 + Number(fraction.slice(3));
}

// 받은 행들 가운데 가장 늦은 updated_at — 서버가 돌려준 값 기준이지 이 기기 시계가 아니다(시계 어긋남 방지).
export function maxUpdatedAt(rows: Array<{ updated_at?: string }>, seed = "") {
  return rows.reduce((best, row) => (updatedAtKey(row.updated_at) > updatedAtKey(best) ? row.updated_at || best : best), seed);
}

// 증분 폴링 병합.
//  · 원격 행은 로컬이 아는 updatedAt보다 새로울 때만 덮어쓴다 — 방금 저장한 낙관적 수정(옛 stamp를 든 로컬 행)이
//    아직 저장 전인 옛 원격 행으로 되살아나지 않게.
//  · updatedAt이 없는 로컬 행(첫 저장 응답 전인 새 행)은 원격 행이 오면 그대로 받는다.
//  · liveIds(정기 대조의 전체 id)가 오면 원격에 없는 행을 지우되, updatedAt이 없는 행은 저장 전 새 행일 수 있어 남긴다.
//    incoming에 있어도 liveIds에 없는 행은 넣지 않는다(대조와 증분 사이에 지워진 행).
//  · 바뀐 게 없으면 같은 배열을 돌려 리렌더를 피한다. 새 행이 섞이면 전량 조회와 같은 id 오름차순으로 맞춘다.
export function mergePlaces<T extends SyncedRow>(current: T[], incoming: T[], liveIds: Set<number> | null): T[] {
  const incomingById = new Map(incoming.map((place) => [place.id, place]));
  let changed = false;
  let added = false;
  const next: T[] = [];
  for (const place of current) {
    if (liveIds && place.updatedAt && !liveIds.has(place.id)) { changed = true; continue; }
    const remote = incomingById.get(place.id);
    incomingById.delete(place.id);
    if (!remote || (place.updatedAt && updatedAtKey(remote.updatedAt) <= updatedAtKey(place.updatedAt))) { next.push(place); continue; }
    next.push(remote);
    changed = true;
  }
  for (const remote of incomingById.values()) {
    if (liveIds && !liveIds.has(remote.id)) continue;
    next.push(remote);
    changed = true;
    added = true;
  }
  if (!changed) return current;
  return added ? next.sort((left, right) => left.id - right.id) : next;
}

// 정기 대조에서 다시 받아야 할 id — 서버 stamp가 로컬이 아는 것과 다른데 이번 증분에 이미 들어 있지 않은 행.
// (시계가 늦은 기기의 저장처럼 updated_at=gt 창에서 빠진 변경을 여기서 건진다.)
export function staleIdsFromStamps(
  stamps: Array<{ id: number; updated_at?: string }>,
  local: Array<SyncedRow>,
  alreadyChangedIds: Iterable<number>,
): number[] {
  const localStamp = new Map(local.map((place) => [place.id, place.updatedAt]));
  const changed = new Set(alreadyChangedIds);
  return stamps.filter((row) => !changed.has(row.id) && localStamp.get(row.id) !== row.updated_at).map((row) => row.id);
}
