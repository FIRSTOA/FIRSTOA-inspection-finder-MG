/**
 * 담당자변경 시트 → 지역 점검방 카톡 공유 (contact-sheet-pull 에서 분리, 2026-10-31)
 * Deno 엣지와 vitest 가 같이 쓴다 — Deno 전용 API 없음(fetch 는 주입 가능).
 *
 * 왜: 담당자 변경은 대부분 카톡방+Make로 시트에만 쌓이고, 그 경로는 점검방에 알림을 보내지 않는다.
 *     그래서 웹앱으로 작성한 건(주로 C팀)만 점검방에 떠서 A·B·D는 키맨이 바뀐 걸 몰랐다(2026-08-28).
 * 어떻게: 아직 공유하지 않은 최근 건만 골라 지역 점검방으로 보낸다. shared_at을 찍어 다시 보내지 않는다.
 *         웹앱 경로는 이미 즉시 보내므로 대상에서 제외한다(source_text 가 '시트…' 인 것만).
 *
 * 2026-10-31 고친 것
 *  - 시간: 카톡 자동 글은 KST 10시 이후만, 밤 22시부터는 보내지 않는다(보류 → 다음 날 10시 이후 첫 실행).
 *  - 겹침: 매일 10:00 KST 에 contact-sheet-pull-daily(0 1 * * *)와 contact-sheet-share(*\/3)가 같은 분에 돈다.
 *          예전엔 둘 다 shared_at=null 행을 읽어 outbox 에 넣은 뒤 shared_at 을 찍어 같은 글이 두 번 갈 수 있었다.
 *          이제 "shared_at is null 일 때만" 조건부 PATCH 로 먼저 잡고(0행이면 다른 실행이 잡은 것 → 건너뜀),
 *          잡은 행만 outbox 에 넣는다. outbox 넣기가 실패하면 잡기를 되돌려 다음 실행이 다시 보낸다.
 */

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type ShareResult = { shared: number; skipped: number; claimedElsewhere: number; rooms: string[]; held?: string };

/** KST 시(0~23) */
export function kstHourOf(nowMs = Date.now()): number {
  return new Date(nowMs + 9 * 3600_000).getUTCHours();
}

/** 지금 공유를 보류해야 하면 이유, 아니면 null — 10시 전·22시 이후는 보류(실방 자동 글 규칙) */
export function shareHoldReason(kstHour: number): string | null {
  if (kstHour < 10) return `${kstHour}시 KST — 10시 전이라 카톡 공유 보류`;
  if (kstHour >= 22) return `${kstHour}시 KST — 22시 이후라 카톡 공유 보류(다음 날 10시 이후 첫 실행에서 나감)`;
  return null;
}

/** 지역 표기("수도권A" · "수도권지역 :A" · "A") → 팀 글자. 못 알아보면 빈칸. */
export function regionLetter(value: string): string {
  const v = String(value || "").toUpperCase();
  const m = v.match(/[A-E]/);
  return m ? m[0] : "";
}

type ChangeRow = {
  id: number | string; change_date: string; company?: string; region?: string; category?: string; reason?: string;
  grade?: string; before_text?: string; after_text?: string; author?: string; notes?: string;
};

/** 공유 글 한 건 */
export function shareText(row: ChangeRow, letter: string): string {
  const person = !/주소/.test(String(row.category || ""))
    && !/삭제|제거|해지|말소|취소|중복|폐업|철수|종료/.test(`${row.category} ${row.reason}`)
    && /키맨|담당|대표|소장|점장|팀장|과장|부장|실장|사장|이사|인사|입사|교체|변경자/.test(`${row.category} ${row.reason}`);
  // 원문의 줄바꿈은 살린다("이름\n번호"가 " · "로 뭉개지지 않게) — 2026-09-08 피드백
  const keepLines = (v: unknown) => String(v || "").replace(/\s*\n\s*/g, "\n").trim();
  return [
    `📌 담당자변경 공유 — ${row.company || "업체명 미기재"}${row.grade ? ` (${row.grade})` : ""}`,
    person && String(row.after_text || "").trim() ? "※ 새 키맨입니다 — 다음 방문 때 인사 부탁드립니다." : "",
    "",
    `지역: 수도권${letter}`,
    `구분: ${row.category || "담당자"}${row.reason ? ` · 사유: ${row.reason}` : ""}`,
    row.before_text ? `변경전: ${keepLines(row.before_text)}` : "",
    row.after_text ? `변경후: ${keepLines(row.after_text)}` : "",
    row.notes ? `특이사항: ${keepLines(row.notes).slice(0, 200)}` : "",
    "",
    `(${row.change_date} 담당자변경 시트 등록${row.author ? ` · ${row.author}` : ""})`,
  ].filter((line, i, arr) => !(line === "" && (i === arr.length - 1 || arr[i + 1] === ""))).join("\n");
}

export async function shareNewChanges(
  serviceKey: string,
  restBase: string,
  opts: { limit?: number; nowMs?: number; fetchFn?: FetchFn } = {},
): Promise<ShareResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const f: FetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  const limit = opts.limit ?? 20;
  const held = shareHoldReason(kstHourOf(nowMs));
  if (held) return { shared: 0, skipped: 0, claimedElsewhere: 0, rooms: [], held };

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const since = new Date(nowMs - 3 * 86400000).toISOString().slice(0, 10);
  const rowsRes = await f(
    `${restBase}/contact_changes?select=id,change_date,company,region,category,reason,grade,before_text,after_text,author,notes&shared_at=is.null&source_text=like.${encodeURIComponent("시트%")}&change_date=gte.${since}&order=change_date.desc&limit=${limit}`,
    { headers },
  );
  if (!rowsRes.ok) throw new Error(`공유 대상 조회 실패(${rowsRes.status}) ${(await rowsRes.text().catch(() => "")).slice(0, 160)}`);
  const rows = await rowsRes.json() as ChangeRow[];
  if (!Array.isArray(rows) || !rows.length) return { shared: 0, skipped: 0, claimedElsewhere: 0, rooms: [] };

  const mapRes = await f(`${restBase}/room_map?select=category,region,room&category=eq.${encodeURIComponent("점검")}`, { headers });
  if (!mapRes.ok) throw new Error(`방 매핑 조회 실패(${mapRes.status})`);
  const mapRows = await mapRes.json() as Array<{ region: string; room: string }>;
  const roomOf = new Map<string, string>();
  for (const r of Array.isArray(mapRows) ? mapRows : []) roomOf.set(String(r.region).trim().toUpperCase(), String(r.room));

  let shared = 0, skipped = 0, claimedElsewhere = 0;
  const rooms = new Set<string>();
  for (const row of rows) {
    const letter = regionLetter(String(row.region || ""));
    const room = letter ? roomOf.get(letter) : "";
    if (!room) { skipped += 1; continue; } // 지역을 못 읽거나 그 지역 점검방 매핑이 없으면 건너뛴다(E 등)

    // 잡기 — shared_at 이 아직 비어 있을 때만 찍는다. 0행이면 겹쳐 돈 다른 실행이 이미 잡았다
    const claim = await f(`${restBase}/contact_changes?id=eq.${encodeURIComponent(String(row.id))}&shared_at=is.null`, {
      method: "PATCH", headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ shared_at: new Date(nowMs).toISOString(), shared_room: room }),
    });
    const claimed = claim.ok ? await claim.json().catch(() => []) : [];
    if (!Array.isArray(claimed) || !claimed.length) { claimedElsewhere += 1; continue; }

    const queued = await f(`${restBase}/outbox`, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ room, text: shareText(row, letter) }) });
    if (!queued.ok) {
      // 되돌린다 — 다음 실행이 다시 보낸다
      await f(`${restBase}/contact_changes?id=eq.${encodeURIComponent(String(row.id))}`, {
        method: "PATCH", headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ shared_at: null, shared_room: "" }),
      }).catch(() => null);
      skipped += 1;
      continue;
    }
    shared += 1;
    rooms.add(room);
  }
  return { shared, skipped, claimedElsewhere, rooms: Array.from(rooms) };
}
