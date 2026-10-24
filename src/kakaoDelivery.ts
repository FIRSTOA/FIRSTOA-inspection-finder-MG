/**
 * 카톡 배달 기록(kakao_delivery_log) — 홈 실시간 전송 현황판(LiveSendBoard)이 쓰는 순수 로직(2026-10-24).
 * 표: 배달 1건 = 1행(sender bot|pc · sent_at · room · kind · vendor), outbox AFTER DELETE 트리거만 적재
 *     (supabase/kakao-delivery-log-20261024.sql — 사용자 실행 대기). 표가 없으면(404·42P01) 화면은 예전처럼 room_activity 방 수.
 * 조회·화면 없음. 테스트: tests/kakaoDelivery.test.ts
 */

export type DeliveryRow = { sender: string; sent_at: string; room: string; kind: string | null; vendor: string | null };

export type DeliverySummary = {
  bot: number;
  pc: number;
  /** 노트북(pc) 배달 — 최근 것부터 limit 건 */
  pcList: DeliveryRow[];
};

/** KST 날짜(YYYY-MM-DD) 0시 = 전날 15:00 UTC — timestamptz 비교용 */
export function kstDayStartIso(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 9 * 3_600_000).toISOString().replace(".000Z", "Z");
}

/** 표가 아직 없음(SQL 실행 대기) — supabase.ts selectRows 오류 글 "조회 실패 표(404): … PGRST205 …" */
export function isDeliveryTableMissing(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e ?? "");
  return /\(404\)|PGRST205|42P01|does not exist|Could not find the table/i.test(m);
}

/** 오늘 행 → 봇·노트북 건수 + 노트북 배달 목록(시각 내림차순, 최근 limit 건). 모르는 sender 는 세지 않는다 */
export function summarizeDeliveries(rows: DeliveryRow[], limit = 20): DeliverySummary {
  let bot = 0, pc = 0;
  for (const r of rows) { if (r.sender === "bot") bot++; else if (r.sender === "pc") pc++; }
  const pcList = rows.filter((r) => r.sender === "pc").sort((a, b) => (a.sent_at < b.sent_at ? 1 : a.sent_at > b.sent_at ? -1 : 0)).slice(0, limit);
  return { bot, pc, pcList };
}

/** 배달 시각 "HH:MM"(KST) */
export function kstHm(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "--:--";
  const d = new Date(t + 9 * 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
