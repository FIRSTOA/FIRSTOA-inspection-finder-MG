/**
 * 카톡 발송 현황의 공통 셈법 — 홈 실시간 현황판(LiveSendBoard)과 관리 탭 표(RoomDeliveryBoard)가 같은 숫자를 보게 한다 (2026-10-17).
 * 재료: room_map(방 목록) · room_activity(방별 마지막 활동 — 봇 트리거 bot_send · 노트북 pc_send · 수신 message) · outbox(아직 안 나간 글)
 */
export type RoomMapRow = { category: string; region: string; room: string };
export type ActRow = { room: string; last_at: string; source: string | null };
export type OutRow = { room: string; created_at: string };
export type RoomStatus = "delay" | "sending" | "ok" | "quiet";
export type RoomRow = { room: string; uses: string[]; act: ActRow | null; pending: number; oldestMin: number; status: RoomStatus };

export const SOURCE_LABEL: Record<string, string> = { bot_send: "폰 봇이 배달", pc_send: "노트북 PC가 배달", message: "방에 새 글", heartbeat: "봇 심박", seed: "초기값" };
export const STATUS_LABEL: Record<RoomStatus, string> = { delay: "지연", sending: "전송 중", ok: "정상", quiet: "조용" };
export const CATEGORY_LABEL: Record<string, string> = {
  inspection: "점검", as: "AS", logistics: "물류", expansion_it: "PC 확장성", expansion_copier: "복합기 확장성", recontract: "재계약",
  misu: "미수", overage: "초과조정", contact_change: "담당자 변경", complaint: "불만", reception: "접수", praise: "칭찬",
};

export const roomKey = (room: string) => String(room || "").replace(/\s+/g, "");
export const relMin = (iso: string | null | undefined): string => {
  if (!iso) return "기록 없음";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금"; if (m < 60) return `${m}분 전`; if (m < 48 * 60) return `${Math.round(m / 60)}시간 전`; return `${Math.round(m / 1440)}일 전`;
};

/** 방별 한 줄 — 지연(밀린 글 3분+) → 전송 중 → 정상(24h 안 활동) → 조용 순 */
export function buildRoomRows(map: RoomMapRow[], acts: ActRow[], out: OutRow[], now = Date.now()): RoomRow[] {
  const byKey = new Map<string, RoomRow>();
  const ensure = (room: string) => {
    const k = roomKey(room); if (!k) return null;
    let r = byKey.get(k);
    if (!r) { r = { room: String(room).trim(), uses: [], act: null, pending: 0, oldestMin: 0, status: "quiet" }; byKey.set(k, r); }
    return r;
  };
  for (const m of map) { const r = ensure(m.room); if (r) r.uses.push(`${m.category} ${String(m.region || "").trim()}`.trim()); }
  for (const a of acts) { const r = ensure(a.room); if (r && (!r.act || a.last_at > r.act.last_at)) r.act = a; }
  for (const o of out) {
    const r = ensure(o.room); if (!r) continue;
    r.pending++;
    const min = Math.round((now - new Date(o.created_at).getTime()) / 60000);
    if (min > r.oldestMin) r.oldestMin = min;
  }
  const dayAgo = now - 24 * 3600_000;
  for (const r of byKey.values()) {
    r.status = r.pending && r.oldestMin >= 3 ? "delay" : r.pending ? "sending" : r.act && new Date(r.act.last_at).getTime() > dayAgo ? "ok" : "quiet";
  }
  const order: Record<RoomStatus, number> = { delay: 0, sending: 1, ok: 2, quiet: 3 };
  return Array.from(byKey.values()).sort((x, y) => order[x.status] - order[y.status] || (y.act?.last_at || "").localeCompare(x.act?.last_at || ""));
}

export function summarizeRooms(rows: RoomRow[], now = new Date()) {
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const today = rows.filter((r) => r.act && new Date(r.act.last_at) >= todayStart);
  return {
    rooms: rows.length,
    pending: rows.reduce((n, r) => n + r.pending, 0),
    delayed: rows.filter((r) => r.status === "delay").length,
    sending: rows.filter((r) => r.status === "sending").length,
    quiet: rows.filter((r) => r.status === "quiet").length,
    botToday: today.filter((r) => r.act?.source === "bot_send").length,
    pcToday: today.filter((r) => r.act?.source === "pc_send").length,
  };
}
