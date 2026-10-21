/**
 * 미수 방문이력(CS 방문이력 작성기) 네트워크 층 — src/supabase.ts 래퍼만 쓴다. 순수 로직은 misuVisit.ts, 화면은 MisuVisitForm.tsx.
 * 설계: docs/tasks/misu-redesign.md §4-A(저장 순서·실패 처리) · 표: supabase/misu-visits.sql
 *
 * 저장 순서: (사진은 화면이 먼저 올림) → 앨범 → misu_visits insert(id 고정) → 카톡(outbox)
 *  - 저장이 실패하면 카톡을 보내지 않는다(기록 없는 카톡 금지).
 *  - 같은 id 재전송 = 409 → "dup" = 이미 저장됨(성공). upsert 는 쓰지 않는다(표에 UPDATE 권한이 숨김 3열뿐).
 *  - 방: room_map["미수|<지역>"] 만 본다. 없으면 저장만 하고 카톡 안 보냄 — 테스트방으로 대신 보내지 않는다(D4, 사용자 결정 2026-10-22).
 *    TEST_MODE 면 테스트방, FIELD_KAKAO_SEND_ENABLED 가 꺼져 있으면 저장만.
 *  - 표가 아직 없으면(404 / 42P01 / PGRST205) tableNotReady — 화면이 "표 준비 중"으로 막는다.
 */
import { createAlbum, enqueueOutbox, getConfig, getRoomMap, insertRow, isTestModeValue, selectAllRows, selectRows, uploadPhoto } from "./supabase";
import { searchVendorMaster } from "./deptReceptionApi";
import { prepareImageForUpload } from "./imageUpload";
import { normRegion } from "./region";
import { kstDate } from "./visits";
import { buildMisuKakaoText, validateMisuVisit, type MisuPhoto, type MisuVisit, type MisuVisitDraft } from "./misuVisit";

const enc = encodeURIComponent;
const s = (v: unknown) => String(v ?? "").trim();
const TABLE = "misu_visits";

/** 표가 아직 없을 때의 오류인가(PostgREST 404 · PGRST205 · Postgres 42P01) */
export function isMisuTableMissing(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /\(404\)|42P01|PGRST205/.test(msg);
}

// ───────── 관리부 미수 목록(misu 표의 시트 행) ─────────
export type MisuSheetVendor = {
  key: string;
  name: string;
  team: string; // A~E (출처 "시트:수도권C_담당" → C)
  months: string; // 숫자만("5")
  balance: string; // 숫자만("2140050")
  companyCode: string; // 거래처코드 10자리
  leaseSeq: string; // 임순(_raw.임순)
  csChecked: boolean;
};

const SHEET_ERROR = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|ERROR!?)$/i;
function sheetValue(row: Record<string, unknown>, key: string): string {
  const raw = (row._raw && typeof row._raw === "object" ? row._raw : {}) as Record<string, unknown>;
  for (const v of [row[key], raw[key]]) {
    const t = s(v);
    if (t && !SHEET_ERROR.test(t)) return t;
  }
  return "";
}
const digits = (v: string) => v.replace(/[^\d]/g, "");
const normName = (v: string) => s(v).replace(/\s+/g, "");

/** misu 시트 행 → 작성기 업체 후보. 잔액·개월은 팀마다 열이 달라 MisuOverageBoards 와 같은 순서로 읽는다. */
export function misuSheetRowToVendor(row: Record<string, unknown>, index = 0): MisuSheetVendor | null {
  const name = sheetValue(row, "_업체명");
  if (!name) return null;
  const team = s(row["_출처"]).match(/수도권([A-E])/)?.[1] || "";
  const balance = digits(sheetValue(row, "미수잔액")) || digits(sheetValue(row, "실제 잔액"));
  const months = digits(sheetValue(row, "미수개월")) || digits(sheetValue(row, "실제 개월수"));
  return {
    key: `misu:${s(row.id) || index}`,
    name,
    team,
    months: months && Number(months) ? String(Number(months)) : "",
    balance: balance && Number(balance) ? String(Number(balance)) : "",
    companyCode: digits(sheetValue(row, "거래처코드")),
    leaseSeq: sheetValue(row, "임순"),
    csChecked: false,
  };
}

/** 관리부 미수 목록(시트 출처 행만, MisuBoard 와 같은 조회) + CS체크 표시. 실패는 throw — 화면이 "목록 실패 → 검색으로" 안내. */
export async function loadMisuSheetVendors(): Promise<MisuSheetVendor[]> {
  const sourceCol = enc("_출처");
  const rows = await selectAllRows<Record<string, unknown>>("misu", `select=*&${sourceCol}=like.${enc("시트")}*&order=id.asc`);
  const list = rows.map((r, i) => misuSheetRowToVendor(r, i)).filter((v): v is MisuSheetVendor => !!v);
  // CS체크 표시는 정렬용 보조 정보다 — 표가 없거나 못 읽어도 목록은 그대로 쓴다(표시만 빠짐)
  try {
    const checks = await selectRows<{ team: string; vendor: string }>("misu_cs_checks", "select=team,vendor&checked=eq.true");
    const marked = new Set(checks.map((c) => `${s(c.team).toUpperCase()}|${normName(c.vendor)}`));
    for (const v of list) v.csChecked = marked.has(`${v.team}|${normName(v.name)}`);
  } catch (e) {
    console.warn("misu_cs_checks 조회 실패 — CS체크 표시 없이 진행", e);
  }
  return list;
}

// ───────── 지난 방문 기록(차수 제안·목록 표시용, 가벼운 열만) ─────────
const INDEX_COLS = "id,created_at,visited_at,visit_round,author,vendor,company_code,lease_seq,supplement_of,_hidden";

/** misu_visits 가벼운 목록. 표가 없으면 isMisuTableMissing(error) 가 true 인 오류를 던진다. */
export async function loadMisuVisitIndex(): Promise<MisuVisit[]> {
  const rows = await selectAllRows<Partial<MisuVisit>>(TABLE, `select=${INDEX_COLS}&order=visited_at.desc`);
  return rows.map((r) => ({ ...r, missing: [], photos: [], photo_skips: {}, rules_ack: {}, dun_methods: [] }) as unknown as MisuVisit);
}

/** 보완 기록용 — 원 기록 1행 전체(모든 열). 없으면 null, 실패는 throw. */
export async function loadMisuVisitById(id: string): Promise<MisuVisit | null> {
  const rows = await selectRows<MisuVisit>(TABLE, `select=*&id=eq.${enc(id)}&limit=1`);
  return rows[0] || null;
}

// ───────── 다른 업체 찾기(vendor_master) ─────────
export type MisuMasterVendor = { key: string; name: string; companyCode: string };
export async function searchMisuOtherVendors(q: string): Promise<MisuMasterVendor[]> {
  const hits = await searchVendorMaster(q);
  return hits.map((h) => ({ key: `master:${h.code}`, name: h.name, companyCode: s(h.code) }));
}

// ───────── 방 결정 ─────────
export type MisuRoomInfo = {
  room: string; // 보낼 방(없으면 "")
  testMode: boolean;
  kakaoEnabled: boolean; // FIELD_KAKAO_SEND_ENABLED
  reason: "ok" | "test" | "no-region" | "no-room" | "disabled";
  notice: { tone: "ok" | "warn"; text: string };
};

/** 지역 → 미수방. 매핑이 없으면 room "" (테스트방 대체 금지). 설정 조회 실패는 throw. */
export async function resolveMisuRoom(region: string): Promise<MisuRoomInfo> {
  const cfg = await getConfig();
  const testMode = isTestModeValue(cfg.TEST_MODE);
  const kakaoEnabled = String(cfg.FIELD_KAKAO_SEND_ENABLED || "").toLowerCase() === "true";
  const key = normRegion(region);
  if (testMode) {
    const room = cfg.TEST_ROOM || "테스트 전용방";
    return { room, testMode, kakaoEnabled, reason: "test", notice: { tone: "warn", text: `테스트 모드 — 카톡은 ${room}으로 갑니다(기록은 실제로 저장됩니다)` } };
  }
  if (!key) return { room: "", testMode, kakaoEnabled, reason: "no-region", notice: { tone: "warn", text: "저장만 됩니다(지역을 몰라 카톡방 미정)" } };
  const map = await getRoomMap();
  const room = s(map[`미수|${key}`]);
  if (!room) return { room: "", testMode, kakaoEnabled, reason: "no-room", notice: { tone: "warn", text: `저장만 됩니다(카톡방 미정 — ${key} 미수방)` } };
  if (!kakaoEnabled) return { room, testMode, kakaoEnabled, reason: "disabled", notice: { tone: "warn", text: "저장만 됩니다(카톡 전송 설정이 꺼져 있음)" } };
  return { room, testMode, kakaoEnabled, reason: "ok", notice: { tone: "ok", text: `카톡: ${room}` } };
}

// ───────── 사진 한 칸 올리기 ─────────
export type MisuUploaded = { url: string; w?: number; h?: number; lowRes: boolean };

/** 사진 한 장 축소 후 photos 버킷에 올린다. 실패는 throw(uploadPhoto 가 3회 재시도). */
export async function uploadMisuSlotPhoto(file: File): Promise<MisuUploaded> {
  const prepared = await prepareImageForUpload(file, 1600);
  const budget = Math.min(180_000, 60_000 + Math.round(prepared.blob.size / 1048576) * 10_000);
  const ymd = kstDate().replace(/-/g, "");
  const url = await uploadPhoto(`${ymd}/${crypto.randomUUID()}.${prepared.ext}`, prepared.blob, prepared.contentType, budget);
  const w = prepared.width, h = prepared.height;
  return { url, w, h, lowRes: !!(w && h && Math.min(w, h) < 600) };
}

// ───────── 저장 ─────────
export type MisuKakaoState = "queued" | "pending" | "already" | "no-room" | "disabled" | "failed";
export type MisuSaveResult = {
  saved: "new" | "dup" | null; // null = 저장 안 됨
  tableNotReady?: boolean;
  error?: string; // 저장 실패 이유(saved=null)
  albumId: string; // 만든(또는 받은) 앨범 id — 재시도 때 다시 쓰도록 화면이 초안에 보관
  albumError?: string;
  room: string;
  testMode: boolean;
  kakao: MisuKakaoState | null; // 저장 안 됐으면 null
  kakaoError?: string;
  text: string; // 저장·전송한 카톡 원문
  message: string; // 사람에게 보일 한 줄
};

/** 저장할 행(misu_visits 45열 중 서버가 채우는 created_at 빼고). 문자열은 '' , 배열은 [] 로 채운다. */
export function buildMisuVisitRow(d: MisuVisitDraft, extra: { missing: string[]; text: string; room: string; albumId: string }): Record<string, unknown> {
  const photos: MisuPhoto[] = (d.photos || []).filter((p) => p && /^https?:\/\//.test(s(p.url))).map((p) => ({ slot: p.slot, url: s(p.url), ...(p.w ? { w: p.w } : {}), ...(p.h ? { h: p.h } : {}) }));
  const skips = Object.fromEntries(Object.entries(d.photo_skips || {}).filter(([, v]) => s(v)).map(([k, v]) => [k, s(v)]));
  return {
    id: d.id,
    visited_at: d.visited_at,
    visit_round: d.visit_round,
    author: s(d.author), author_sub: s(d.author_sub), author_team: s(d.author_team),
    vendor: s(d.vendor), company_code: s(d.company_code), site_code: s(d.site_code), lease_seq: s(d.lease_seq), region: s(d.region),
    misu_months: s(d.misu_months), misu_balance: s(d.misu_balance),
    contact_name: d.no_contact ? "" : s(d.contact_name), contact_title: d.no_contact ? "" : s(d.contact_title),
    contact_is_rep: d.no_contact ? null : d.contact_is_rep,
    rep_phone: d.no_contact ? "" : s(d.rep_phone), rep_phone_status: d.no_contact ? "" : s(d.rep_phone_status),
    no_contact: !!d.no_contact, open_status: d.open_status || "",
    evid_mail: s(d.evid_mail), evid_sign: s(d.evid_sign), evid_neighbor: s(d.evid_neighbor), closed_estimate: s(d.closed_estimate),
    dun_methods: (d.dun_methods || []).map(s).filter(Boolean), dun_reply: s(d.dun_reply), promise_date: s(d.promise_date),
    return_requested: !!d.return_requested,
    return_to: d.return_requested ? s(d.return_to) : "", return_reply: d.return_requested ? s(d.return_reply) : "", return_method: d.return_requested ? s(d.return_method) : "",
    photos, photo_skips: skips, album_id: extra.albumId,
    judgment: d.judgment || "", judgment_reason: s(d.judgment_reason),
    rules_ack: d.rules_ack || {}, missing: extra.missing, supplement_of: d.supplement_of || null,
    text_body: extra.text, room: extra.room,
    _hidden: false,
  };
}

export function albumLink(albumId: string, origin?: string): string {
  if (!albumId) return "";
  const base = origin ?? (typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "");
  return `${base}?album=${albumId}`;
}

/**
 * 방문 1건 저장 + 카톡. 사진은 이미 올라가 있어야 한다(url 이 http). 던지지 않고 결과로 돌려준다.
 * opts.kakaoAlreadySent: 앞선 시도에서 카톡까지 나갔으면 dup 재시도 때 다시 보내지 않는다.
 */
export async function saveMisuVisit(d: MisuVisitDraft, opts: { kakaoAlreadySent?: boolean; origin?: string } = {}): Promise<MisuSaveResult> {
  const base: MisuSaveResult = { saved: null, albumId: s(d.album_id), room: "", testMode: false, kakao: null, text: "", message: "" };
  const v = validateMisuVisit(d);
  if (!v.ok) return { ...base, error: v.blocks[0]?.message || "필수 항목이 비어 있습니다", message: "저장 안 됨 — 필수 항목을 채워 주세요" };
  const notUploaded = (d.photos || []).filter((p) => p && !/^https?:\/\//.test(s(p.url)));
  if (notUploaded.length) return { ...base, error: `사진 ${notUploaded.length}장이 아직 올라가지 않았습니다`, message: "저장 안 됨 — 사진을 다시 올려 주세요" };

  // 방 결정(설정 못 읽으면 저장 전에 멈춘다 — 저장했는데 카톡 여부를 모르는 상태를 만들지 않음)
  let room: MisuRoomInfo;
  try { room = await resolveMisuRoom(d.region); }
  catch (e) { return { ...base, error: `설정을 읽지 못했습니다: ${(e as Error).message}`, message: "저장 안 됨 — 전파 상태를 확인하고 다시 보내 주세요" }; }
  base.room = room.room;
  base.testMode = room.testMode;

  // 앨범(사진 모아보기). 실패해도 기록은 남긴다 — 사진 주소는 행의 photos 에 들어간다
  const urls = (d.photos || []).map((p) => s(p.url)).filter(Boolean);
  let albumId = s(d.album_id);
  let albumError = "";
  if (urls.length && !albumId) {
    try {
      albumId = await createAlbum(urls, s(d.vendor) || "미기재", {
        category: "미수", sourceType: "misu", author: s(d.author), region: s(d.region),
        assets: urls.map((publicUrl, i) => ({ publicUrl, storagePath: publicUrl.split("/photos/")[1] || "", fileName: `${d.photos[i]?.slot || i + 1}.jpg`, mimeType: "image/jpeg", sortOrder: i + 1 })),
      });
    } catch (e) {
      albumError = (e as Error).message || "앨범 만들기 실패";
    }
  }
  base.albumId = albumId;
  if (albumError) base.albumError = albumError;

  const filled: MisuVisitDraft = { ...d, missing: v.missing, room: room.room, album_id: albumId };
  const text = buildMisuKakaoText(filled, { albumUrl: albumLink(albumId, opts.origin) });
  base.text = text;

  let saved: "new" | "dup";
  try {
    saved = await insertRow(TABLE, buildMisuVisitRow(filled, { missing: v.missing, text, room: room.room, albumId }));
  } catch (e) {
    if (isMisuTableMissing(e)) return { ...base, tableNotReady: true, error: "방문이력 표 준비 중", message: "방문이력 표가 아직 준비 중이라 저장·전송하지 않았습니다" };
    return { ...base, error: (e as Error).message || "네트워크 오류", message: "저장 실패 — 카톡도 보내지 않았습니다. 다시 보내 주세요" };
  }
  base.saved = saved;
  const head = saved === "new" ? "저장 완료" : "이미 저장된 기록 확인";
  const albumNote = albumError ? ` · 사진 모아보기 링크 실패(${albumError})` : "";

  if (opts.kakaoAlreadySent) return { ...base, kakao: "already", message: `${head} · 카톡은 이미 보냄${albumNote}` };
  if (!room.room) return { ...base, kakao: "no-room", message: `${head} · ${room.notice.text}${albumNote}` };
  if (!room.testMode && !room.kakaoEnabled) return { ...base, kakao: "disabled", message: `${head} · ${room.notice.text}${albumNote}` };
  try {
    const q = await enqueueOutbox(room.room, text);
    const kakaoNote = q === "pending" ? `${room.room}에 같은 글이 이미 게시 대기 중` : `카톡 게시 대기: ${room.room}`;
    return { ...base, kakao: q, message: `${head} · ${kakaoNote}${albumNote}` };
  } catch (e) {
    return { ...base, kakao: "failed", kakaoError: (e as Error).message, message: `${head} · 카톡 보내기 실패 — 다시 누르면 카톡만 다시 보냅니다${albumNote}` };
  }
}
