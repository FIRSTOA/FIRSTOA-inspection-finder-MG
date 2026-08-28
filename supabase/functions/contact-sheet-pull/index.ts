/**
 * 담당자변경 시트 → 앱(contact_changes) 역방향 채우기 (2026-08-28)
 *
 * 왜: 담당자·키맨 변경은 두 길로 들어온다.
 *   ① 웹앱 FIELD 양식 → contact_changes 저장 + 카톡방 + 시트 기입(field-sheet-sync)
 *   ② 카톡방 메신저봇 + Make로 "/양식" 작성 → **시트에만** 기입
 * 그래서 시트가 최종 저장소인데, 앱은 ①만 알고 있어 ②로 들어온 변경은 키맨 배지·통합이력에 안 보였다.
 * 이 함수가 시트를 읽어 없는 건만 채운다(있는 건은 절대 건드리지 않음 — 인사 완료 표시가 지워지면 안 된다).
 *
 * 안전 규칙
 * - 시트는 **읽기만** 한다. 시트는 우리 관할이 아니라서 쓰지 않는다(2026-08-28 결정) — 인사 완료 표시는 앱에서만 관리.
 * - 쓰기는 insert + on_conflict=_dupKey&resolution=ignore-duplicates (갱신 아님)
 * - _dupKey는 웹앱과 같은 재료로 만든다 → 같은 건이 시트·앱 양쪽에 있어도 한 행으로 합쳐진다
 * - 시트는 읽기만 한다 (원본 훼손 없음)
 */
const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SPREADSHEET_ID = "1H15RFS7h-euPJM1pfPIQl_FQNzxk6OrjkSmZZGsqWKQ";
const SHEET_GID = 1289086745; // 담당자변경 탭 (field-sheet-sync가 기입하는 곳과 같은 탭)
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache.token;
  const sa = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT") || "{}");
  if (!sa.client_email || !sa.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT 시크릿이 없습니다");
  const pem = String(sa.private_key).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const enc = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(new Uint8Array(sig))}` }),
  });
  if (!res.ok) throw new Error(`토큰 발급 실패(${res.status}) ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, exp: Date.now() + 55 * 60_000 };
  return tokenCache.token;
}

/** 헤더 이름 매칭 — 시트 헤더는 줄바꿈·공백·괄호가 섞여 있어 전부 지운 뒤 비교한다 */
const flat = (v: unknown) => String(v ?? "").replace(/\s+/g, "").replace(/[()[\]]/g, "").trim();

function pickIndex(headers: string[], candidates: string[]): number {
  const flatHeaders = headers.map(flat);
  for (const want of candidates) {
    const w = flat(want);
    const exact = flatHeaders.indexOf(w);
    if (exact >= 0) return exact;
  }
  for (const want of candidates) {
    const w = flat(want);
    const partial = flatHeaders.findIndex((h) => h && (h.includes(w) || w.includes(h)));
    if (partial >= 0) return partial;
  }
  return -1;
}

/** "2026. 8. 14" · "2026-08-14" · Date 문자열 → yyyy-mm-dd */
function toYmd(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const m = raw.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

async function md5Hex(text: string): Promise<string> {
  // 웹앱(src/md5.ts)과 같은 값이 나와야 하므로 MD5를 쓴다. Deno에는 내장 MD5가 없어 직접 계산한다.
  const bytes = new TextEncoder().encode(text);
  const s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
  const len = bytes.length;
  const withOne = new Uint8Array((((len + 8) >> 6) + 1) * 64);
  withOne.set(bytes);
  withOne[len] = 0x80;
  const bitLen = len * 8;
  const dv = new DataView(withOne.buffer);
  dv.setUint32(withOne.length - 8, bitLen >>> 0, true);
  dv.setUint32(withOne.length - 4, Math.floor(bitLen / 2 ** 32), true);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let chunk = 0; chunk < withOne.length; chunk += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(chunk + i * 4, true);
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F = 0, g = 0;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  new DataView(out.buffer).setUint32(0, a0, true);
  new DataView(out.buffer).setUint32(4, b0, true);
  new DataView(out.buffer).setUint32(8, c0, true);
  new DataView(out.buffer).setUint32(12, d0, true);
  return Array.from(out).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 지역 표기("수도권A" · "수도권지역 :A" · "A") → 팀 글자. 못 알아보면 빈칸. */
function regionLetter(value: string): string {
  const v = String(value || "").toUpperCase();
  const m = v.match(/[A-E]/);
  return m ? m[0] : "";
}

/**
 * 시트로 들어온 새 변경을 지역 점검방에 카톡으로 알린다.
 * 왜: 담당자 변경은 대부분 카톡방+Make로 시트에만 쌓이고, 그 경로는 점검방에 알림을 보내지 않는다.
 *     그래서 웹앱으로 작성한 건(주로 C팀)만 점검방에 떠서 A·B·D는 키맨이 바뀐 걸 몰랐다(2026-08-28).
 * 어떻게: 우리가 시트를 읽어오는 김에, 아직 공유하지 않은 최근 건만 골라 지역 점검방으로 보낸다.
 *         shared_at을 찍어 다시 보내지 않는다. 웹앱 경로는 이미 즉시 보내므로 대상에서 제외한다.
 */
async function shareNewChanges(serviceKey: string, restBase: string, limit = 20): Promise<{ shared: number; skipped: number; rooms: string[] }> {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const since = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const rows = await (await fetch(
    `${restBase}/contact_changes?select=id,change_date,company,region,category,reason,grade,before_text,after_text,author,notes&shared_at=is.null&source_text=like.${encodeURIComponent("시트%")}&change_date=gte.${since}&order=change_date.desc&limit=${limit}`,
    { headers },
  )).json();
  if (!Array.isArray(rows) || !rows.length) return { shared: 0, skipped: 0, rooms: [] };

  const mapRows = await (await fetch(`${restBase}/room_map?select=category,region,room&category=eq.${encodeURIComponent("점검")}`, { headers })).json();
  const roomOf = new Map<string, string>();
  for (const r of Array.isArray(mapRows) ? mapRows : []) roomOf.set(String(r.region).trim().toUpperCase(), String(r.room));

  let shared = 0, skipped = 0;
  const rooms = new Set<string>();
  for (const row of rows) {
    const letter = regionLetter(String(row.region || ""));
    const room = letter ? roomOf.get(letter) : "";
    if (!room) { skipped += 1; continue; } // 지역을 못 읽거나 그 지역 점검방 매핑이 없으면 건너뛴다(E 등)
    const person = !/주소/.test(String(row.category || ""))
      && !/삭제|제거|해지|말소|취소|중복|폐업|철수|종료/.test(`${row.category} ${row.reason}`)
      && /키맨|담당|대표|소장|점장|팀장|과장|부장|실장|사장|이사|인사|입사|교체|변경자/.test(`${row.category} ${row.reason}`);
    const text = [
      `📌 ${row.category || "담당자"} 변경 공유 — ${row.company || "업체명 미기재"}${row.grade ? ` (${row.grade})` : ""}`,
      person && String(row.after_text || "").trim() ? "※ 새 키맨입니다 — 다음 방문 때 인사 부탁드립니다." : "",
      "",
      `지역: 수도권${letter}${row.reason ? ` · 사유: ${row.reason}` : ""}`,
      row.before_text ? `변경전: ${String(row.before_text).replace(/\s*\n\s*/g, " · ")}` : "",
      row.after_text ? `변경후: ${String(row.after_text).replace(/\s*\n\s*/g, " · ")}` : "",
      row.notes ? `특이사항: ${String(row.notes).replace(/\s*\n\s*/g, " · ").slice(0, 200)}` : "",
      `(${row.change_date} 담당자변경 시트 등록${row.author ? ` · ${row.author}` : ""})`,
    ].filter((line) => line !== "").join("\n");

    const queued = await fetch(`${restBase}/outbox`, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ room, text }) });
    if (!queued.ok) { skipped += 1; continue; }
    await fetch(`${restBase}/contact_changes?id=eq.${row.id}`, {
      method: "PATCH", headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ shared_at: new Date().toISOString(), shared_room: room }),
    });
    shared += 1;
    rooms.add(room);
  }
  return { shared, skipped, rooms: Array.from(rooms) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const peek = body.peek === true;
    const days = Math.min(Math.max(Number(body.days) || 400, 30), 2000);

    const token = await accessToken();
    // 탭 제목 찾기 (gid → title)
    const metaRes = await fetch(`${SHEETS_BASE}/${SPREADSHEET_ID}?fields=sheets(properties(sheetId,title))`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) return Response.json({ error: `시트 정보 실패(${metaRes.status}) ${(await metaRes.text()).slice(0, 200)}` }, { status: 502, headers: jsonHeaders });
    const meta = await metaRes.json();
    const title = (meta.sheets || []).find((s: { properties?: { sheetId?: number } }) => s.properties?.sheetId === SHEET_GID)?.properties?.title;
    if (!title) return Response.json({ error: "담당자변경 탭을 못 찾았습니다", tabs: (meta.sheets || []).map((s: { properties?: { title?: string; sheetId?: number } }) => s.properties) }, { status: 502, headers: jsonHeaders });

    const valuesRes = await fetch(`${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(`${title}!A1:AZ5000`)}?valueRenderOption=FORMATTED_VALUE`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!valuesRes.ok) return Response.json({ error: `시트 읽기 실패(${valuesRes.status}) ${(await valuesRes.text()).slice(0, 200)}` }, { status: 502, headers: jsonHeaders });
    const rows: string[][] = (await valuesRes.json()).values || [];
    if (!rows.length) return Response.json({ ok: true, tab: title, read: 0, note: "빈 시트" }, { headers: jsonHeaders });

    // 이 시트(탭 "키맨체크")는 1행이 안내 배너("※자동 등록되어지는 구간"), 2행이 실제 헤더, 3행이 예시다.
    // 헤더 줄을 찾아 그 아래부터 읽는다 — 구조가 바뀌어도 "업체명"이 있는 줄을 헤더로 본다.
    let headerRow = rows.findIndex((row) => row.some((cell) => flat(cell) === "업체명"));
    if (headerRow < 0) headerRow = 0;
    const headers = (rows[headerRow] || []).map((h) => String(h || ""));
    const idx = {
      date: pickIndex(headers, ["날짜", "변경일", "작성일", "일자"]),
      author: pickIndex(headers, ["담당자", "퍼스트전산직원", "작성자", "등록자"]),
      company: pickIndex(headers, ["업체명", "거래처명", "업체", "상호"]),
      region: pickIndex(headers, ["지역", "수도권지역", "담당지역"]),
      category: pickIndex(headers, ["구분", "변경구분", "종류"]),
      reason: pickIndex(headers, ["사유", "변경사유", "이유"]),
      grade: pickIndex(headers, ["등급"]),
      before: pickIndex(headers, ["변경전", "변경 전", "기존"]),
      after: pickIndex(headers, ["변경후", "변경 후", "신규"]),
      notes: pickIndex(headers, ["비고", "특이사항", "메모"]),
      // 이 시트엔 이미 인사 관리 열이 있다 — 앱의 "인사 완료"와 같은 뜻이라 그대로 받아온다
      greeting: pickIndex(headers, ["신규키맨인사"]),
      greetingBy: pickIndex(headers, ["퍼스트담당"]),
      // 영업파트가 채우는 새 키맨 정보 — 변경후 칸이 비어 있으면 이걸로 "현재 키맨"을 만든다
      newName: pickIndex(headers, ["성명"]),
      newDept: pickIndex(headers, ["부서"]),
      newTitle: pickIndex(headers, ["직책"]),
      newPhone: pickIndex(headers, ["연락처(M)", "연락처M", "연락처"]),
    };
    if (peek) return Response.json({ ok: true, tab: title, headers, matched: idx, sample: rows.slice(1, 4) }, { headers: jsonHeaders });
    if (idx.company < 0) return Response.json({ error: "업체명 열을 못 찾았습니다", headers }, { status: 502, headers: jsonHeaders });

    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const at = (row: string[], i: number) => (i >= 0 ? String(row[i] ?? "").trim() : "");
    const payload: Record<string, unknown>[] = [];
    let skippedOld = 0, skippedEmpty = 0;
    for (const row of rows.slice(headerRow + 1)) {
      const company = at(row, idx.company);
      if (!company) { skippedEmpty += 1; continue; }
      const rawDate = at(row, idx.date);
      if (/예시|샘플/.test(rawDate) || /예시|샘플/.test(company)) { skippedEmpty += 1; continue; } // 안내용 예시 줄
      const date = toYmd(rawDate) || "";
      if (date && date < cutoff) { skippedOld += 1; continue; }
      const author = at(row, idx.author);
      const category = at(row, idx.category);
      const reason = at(row, idx.reason);
      const before = at(row, idx.before);
      // 변경후 칸이 비어 있어도 영업파트가 채운 새 키맨 정보가 있으면 그걸로 "현재 키맨"을 만든다
      const composed = [at(row, idx.newName), at(row, idx.newTitle), at(row, idx.newDept), at(row, idx.newPhone)].filter(Boolean).join(" ");
      const after = at(row, idx.after) || composed;
      // 웹앱과 같은 재료·순서로 키를 만든다 → 같은 건이면 웹앱 행과 합쳐진다(중복 표시 방지)
      const dupKey = await md5Hex(["contact_change", date, author, company, category, reason, before, after].join("|"));
      // 시트의 "신규키맨인사"는 영업파트가 채우는 칸이다. 인사 관리는 앱에서만 하기로 정했으므로(2026-08-28)
      // 앱의 완료 표시로는 쓰지 않고, 참고 정보로만 남긴다("영업 인사: 통화완료" 형태).
      const greetingRaw = at(row, idx.greeting);
      payload.push({
        change_date: date || new Date().toISOString().slice(0, 10),
        author, company, region: at(row, idx.region), category, reason,
        grade: at(row, idx.grade), before_text: before, after_text: after,
        notes: [
          at(row, idx.notes),
          composed && at(row, idx.after) ? `신규키맨: ${composed}` : "",
          greetingRaw ? `영업 인사: ${greetingRaw}${at(row, idx.greetingBy) ? ` (${at(row, idx.greetingBy)})` : ""}` : "",
        ].filter(Boolean).join(" / "),
        source_text: "시트: 키맨체크", photo_link: "",
        _dupKey: dupKey,
      });
    }
    if (!payload.length) return Response.json({ ok: true, tab: title, read: rows.length - 1, inserted: 0, skippedOld, skippedEmpty }, { headers: jsonHeaders });

    const restUrl = `${Deno.env.get("SUPABASE_URL")}/rest/v1/contact_changes?on_conflict=_dupKey`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!serviceKey) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY가 없습니다" }, { status: 500, headers: jsonHeaders });
    let inserted = 0;
    for (let i = 0; i < payload.length; i += 200) {
      const slice = payload.slice(i, i + 200);
      const res = await fetch(restUrl, {
        method: "POST",
        headers: {
          apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json",
          // 이미 있는 건은 그대로 둔다 — 인사 완료 표시(greeting_*)를 절대 덮지 않기 위해 merge가 아니라 ignore
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify(slice),
      });
      if (!res.ok) return Response.json({ error: `적재 실패(${res.status}) ${(await res.text()).slice(0, 200)}`, inserted }, { status: 502, headers: jsonHeaders });
      inserted += ((await res.json()) as unknown[]).length;
    }
    // 인사 완료 표시는 앱에서만 만든다 — 시트 값으로 앱 상태를 바꾸지 않는다(2026-08-28 결정)
    // 새로 들어온 변경은 지역 점검방으로 알린다(Make 경로가 점검방에 안 보내서 A·B·D가 몰랐던 문제)
    const share = body.share === false ? { shared: 0, skipped: 0, rooms: [] } : await shareNewChanges(serviceKey, `${Deno.env.get("SUPABASE_URL")}/rest/v1`);
    return Response.json({ ok: true, tab: title, headerRow: headerRow + 1, read: rows.length - headerRow - 1, candidates: payload.length, inserted, skippedOld, skippedEmpty, shared: share.shared, shareSkipped: share.skipped, rooms: share.rooms }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500, headers: jsonHeaders });
  }
});
