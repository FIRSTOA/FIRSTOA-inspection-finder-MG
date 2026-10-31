/**
 * Supabase 직접 연동 (쓰기 파이프라인 GAS 제거).
 *  - insertRecord : 점검/AS 행 insert, _dupKey 유니크 충돌이면 "dup"
 *  - getConfig    : app_config (TEST_MODE / TEST_ROOM)
 *  - getRoomMap   : room_map (카테고리|지역 → 방이름)
 *  - enqueueOutbox: 카톡 발신 큐 적재 (봇이 폴링)
 *
 *  ※ anon key 는 공개키라 프론트 노출 정상. (정식 운영 전 RLS/Auth 강화 예정)
 */
import type { Row } from "./inspectParser";

export const SUPABASE_URL = "https://kkdiihazgzesbqxjytqv.supabase.co";
export const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw";

const REST = `${SUPABASE_URL}/rest/v1`;
const BASE_HEADERS: Record<string, string> = {
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  "Content-Type": "application/json",
};

// 요청 시간 제한(2026-10-31 사용자 결정) — 폰에서 통신이 끊기면 fetch 가 끝나지 않아 저장 단추가 영원히 '보내는 중'이던 것 방지.
// 읽기 45초 · 쓰기 30초. 호출자가 signal 을 넘기면 그 signal 만 쓰고(취소·오류 처리는 호출자 몫), timeoutMs 를 넘기면 그 값을 쓴다.
// invokeEdgeFunction(20초)·uploadPhoto(60초)는 자체 제한이 있어 대상이 아니다.
export const READ_TIMEOUT_MS = 45_000;
export const WRITE_TIMEOUT_MS = 30_000;
export type RestOptions = { signal?: AbortSignal; timeoutMs?: number };
type RestKind = "read" | "write" | "rpc";

// 쓰기는 서버에 이미 들어갔을 수 있다 — '다시 시도' 전에 확인하라는 문구가 반드시 있어야 한다(중복 저장 방지)
export function restTimeoutMessage(kind: RestKind, ms: number) {
  const label = ms >= 1000 ? `${Math.round(ms / 1000)}초` : `${ms}ms`;
  if (kind === "read") return `서버 응답이 ${label} 넘게 없어 조회를 중단했습니다 — 전파 상태를 확인하고 다시 시도하세요`;
  if (kind === "rpc") return `서버 응답이 ${label} 넘게 없어 중단했습니다 — 저장하던 중이었다면 저장됐는지 목록에서 확인한 뒤 다시 시도하세요`;
  return `서버 응답이 ${label} 넘게 없어 중단했습니다 — 저장됐는지 목록에서 확인한 뒤 다시 시도하세요`;
}

// 요청 한 번(응답 본문 읽기까지)을 시간 제한 안에서 돌린다. 이 파일의 uploadPhoto·invokeEdgeFunction 과 같은 AbortController+setTimeout 방식.
async function withRestTimeout<T>(kind: RestKind, opts: RestOptions | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (opts?.signal) return run(opts.signal);
  const ms = opts?.timeoutMs ?? (kind === "read" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(restTimeoutMessage(kind, ms));
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// PostgREST RPC 호출 (POST /rpc/<fn>). Supabase 함수 search_vendors / vendor_detail 용.
// 읽기·쓰기 함수가 섞여 있어 쓰기 기준(30초)·확인 문구를 쓴다.
export async function rpc<T>(fn: string, args: Record<string, unknown>, opts?: RestOptions): Promise<T> {
  return withRestTimeout("rpc", opts, async (signal) => {
    const res = await fetch(`${REST}/rpc/${fn}`, {
      method: "POST",
      headers: BASE_HEADERS,
      body: JSON.stringify(args),
      signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`RPC ${fn} 실패(${res.status}): ${t.slice(0, 200)}`);
    }
    // void 함수는 204(빈 본문)를 준다 — 무조건 json()을 부르면 파싱 오류가 난다
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  });
}

// 테이블 직접 조회 (select + 필터). 점검/AS 원문 재사용(getInspForms) 용.
export async function selectRows<T>(table: string, query: string, opts?: RestOptions): Promise<T[]> {
  return withRestTimeout("read", opts, async (signal) => {
    const res = await fetch(`${REST}/${table}?${query}`, { headers: BASE_HEADERS, signal });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`조회 실패 ${table}(${res.status}): ${t.slice(0, 160)}`);
    }
    return (await res.json()) as T[];
  });
}

export type InsertResult = "new" | "dup";

// 행 insert. 201 → 신규, 409(유니크 _dupKey 충돌) → 중복.
export async function insertRecord(table: "jeomgeom" | "as_records", row: Row, opts?: RestOptions): Promise<InsertResult> {
  return withRestTimeout("write", opts, async (signal) => {
    const res = await fetch(`${REST}/${table}`, {
      method: "POST",
      headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify(row),
      signal,
    });
    if (res.status === 201 || res.status === 200) return "new";
    if (res.status === 409) return "dup";
    const t = await res.text().catch(() => "");
    throw new Error(`저장 실패(${res.status}): ${t.slice(0, 200)}`);
  });
}

// 범용 단일행 insert. 먼저 _dupKey를 조회해 중복을 막는다.
// 일부 기존 테이블은 _dupKey 고유 제약이 없으므로 PostgREST on_conflict에는 의존하지 않는다.
export async function insertRow(table: string, row: Record<string, unknown>, opts?: RestOptions): Promise<InsertResult> {
  touchesSmallTables(table);
  return withRestTimeout("write", opts, async (signal) => {
    const dupKey = String(row._dupKey || "").trim();
    if (dupKey) {
      const duplicateRes = await fetch(
        `${REST}/${table}?_dupKey=eq.${encodeURIComponent(dupKey)}&select=_dupKey&limit=1`,
        { headers: BASE_HEADERS, signal },
      );
      if (duplicateRes.ok) {
        const existing = await duplicateRes.json().catch(() => []);
        if (Array.isArray(existing) && existing.length) return "dup";
      }
    }

    const res = await fetch(`${REST}/${table}`, {
      method: "POST",
      headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify(row),
      signal,
    });
    if (res.status === 201 || res.status === 200) return "new";
    if (res.status === 409) return "dup";
    const t = await res.text().catch(() => "");
    throw new Error(`저장 실패 ${table}(${res.status}): ${t.slice(0, 200)}`);
  });
}

// 범용 upsert. 주간 목표/회고처럼 동일 키의 내용을 다시 저장할 때 사용한다.
// TEST_MODE 판정 공용 — 미설정이면 안전하게 테스트 취급(true). 8곳 인라인 복붙을 통합.
export function isTestModeValue(value: unknown) {
  return String(value ?? "true").toLowerCase() === "true";
}

export async function upsertRow(table: string, row: Record<string, unknown>, onConflict: string, opts?: RestOptions): Promise<void> {
  touchesSmallTables(table);
  return withRestTimeout("write", opts, async (signal) => {
    const res = await fetch(`${REST}/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      headers: { ...BASE_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
      signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`저장 실패 ${table}(${res.status}): ${t.slice(0, 200)}`);
    }
  });
}

// 설정·방 매핑은 화면마다 다시 읽어 같은 요청이 겹쳤다 — 60초 캐시 + 진행 중 요청 공유. 이 표에 쓰면(아래 writer) 바로 비운다(2026-10-10 속도)
const SMALL_CACHE_MS = 60_000;
let configCache: { at: number; p: Promise<Record<string, string>> } | null = null;
let roomMapCache: { at: number; p: Promise<Record<string, string>> } | null = null;
export function invalidateConfigCaches() { configCache = null; roomMapCache = null; }
const touchesSmallTables = (table: string) => { if (table === "app_config" || table === "room_map") invalidateConfigCaches(); };

export async function getConfig(): Promise<Record<string, string>> {
  if (configCache && Date.now() - configCache.at < SMALL_CACHE_MS) return configCache.p;
  const p = withRestTimeout("read", undefined, async (signal) => {
    const res = await fetch(`${REST}/app_config?select=key,value`, { headers: BASE_HEADERS, signal });
    if (!res.ok) throw new Error(`설정 조회 실패(${res.status})`);
    const rows = (await res.json()) as Array<{ key: string; value: string }>;
    const cfg: Record<string, string> = {};
    rows.forEach((r) => { cfg[r.key] = r.value; });
    return cfg;
  });
  configCache = { at: Date.now(), p };
  p.catch(() => { configCache = null; });
  return p;
}

export async function getRoomMap(): Promise<Record<string, string>> {
  if (roomMapCache && Date.now() - roomMapCache.at < SMALL_CACHE_MS) return roomMapCache.p;
  const p = withRestTimeout("read", undefined, async (signal) => {
    const res = await fetch(`${REST}/room_map?select=category,region,room`, { headers: BASE_HEADERS, signal });
    if (!res.ok) throw new Error(`방매핑 조회 실패(${res.status})`);
    const rows = (await res.json()) as Array<{ category: string; region: string; room: string }>;
    const m: Record<string, string> = {};
    rows.forEach((r) => { m[`${r.category}|${String(r.region).trim().toUpperCase()}`] = r.room; });
    return m;
  });
  roomMapCache = { at: Date.now(), p };
  p.catch(() => { roomMapCache = null; });
  return p;
}

// 사진 → Supabase Storage(photos 버킷) 업로드 후 공개 URL 반환. (버킷/정책은 SQL로 1회 생성)
export async function uploadPhoto(path: string, file: Blob, contentType = "image/jpeg", timeoutMs = 60_000): Promise<string> {
  // 현장 LTE에서 "Failed to fetch"(연결 끊김·타임아웃)가 잦아 3회까지 자동 재시도한다.
  // 실패해도 매번 새 경로를 쓰지 않고 같은 경로로 재시도 — 중복 업로드가 쌓이지 않는다.
  const url = `${SUPABASE_URL}/storage/v1/object/photos/${path}`;
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs); // 사진 60초 · 영상은 크기에 맞춰 호출부에서 늘린다
    try {
      const res = await fetch(url, {
        method: "POST",
        // 재시도 시 같은 경로에 다시 쓰므로 덮어쓰기를 허용한다 (photos 버킷은 public select 정책 있음)
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": contentType, "x-upsert": "true" },
        body: file,
        signal: controller.signal,
      });
      if (res.ok) return `${SUPABASE_URL}/storage/v1/object/public/photos/${path}`;
      const t = await res.text().catch(() => "");
      lastError = `${res.status}: ${t.slice(0, 120)}`;
      if (res.status < 500 && res.status !== 429) break; // 권한·용량 등은 재시도해도 같다
    } catch (e) {
      lastError = (e as Error).name === "AbortError" ? `시간 초과(${Math.round(timeoutMs / 1000)}초)` : (e as Error).message || "네트워크 오류";
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
  const sizeMb = Math.round((file.size || 0) / 1048576);
  const hint = sizeMb >= 20 ? ` · 파일이 ${sizeMb}MB로 큽니다 — 영상은 10~20초로 잘라서 올려 주세요` : " (전파 상태를 확인하고 다시 시도해 주세요)";
  throw new Error(`업로드 실패 — ${lastError}${hint}`);
}

// PostgREST의 기본 1,000행 제한을 넘는 공용 목록을 끝까지 조회한다.
export async function selectAllRows<T>(table: string, query: string, pageSize = 1000, opts?: RestOptions): Promise<T[]> {
  // 2026-10-10 속도: 순차 페이징(미수 8천 행 = 왕복 9번)을 병렬 4장으로 — 호출부 30곳이 그대로 빨라진다. 순서는 페이지 순서 그대로
  return selectAllRowsFast<T>(table, query, pageSize, 4, opts);
}

// 대용량 전체 조회의 병렬판 — 페이지를 동시(concurrency)로 받아 순차 왕복 지연을 줄인다.
// 시간 제한(읽기 45초)은 페이지 한 장마다 따로 건다 — 큰 표 전체를 45초로 자르지 않는다.
export async function selectAllRowsFast<T>(table: string, query: string, pageSize = 1000, concurrency = 6, opts?: RestOptions): Promise<T[]> {
  const separator = query ? "&" : "";
  const fetchPage = (offset: number) => selectRows<T>(table, `${query}${separator}limit=${pageSize}&offset=${offset}`, opts);
  const first = await fetchPage(0);
  if (first.length < pageSize) return first;
  const pages: T[][] = [first];
  // 2026-10-24 속도: 동시 수를 2→4→최대로 늘려 간다 — 2천 행 표가 빈 쪽 5번을 헛요청하던 것(7번→3번). 결과·순서는 같다
  let width = Math.min(2, concurrency);
  for (let offset = pageSize; ; offset += pageSize * width, width = Math.min(width * 2, concurrency)) {
    const batch = await Promise.all(Array.from({ length: width }, (_, index) => fetchPage(offset + index * pageSize)));
    let done = false;
    for (const page of batch) {
      pages.push(page);
      if (page.length < pageSize) { done = true; break; }
    }
    if (done) return pages.flat();
  }
}

export async function upsertRows(table: string, rows: Record<string, unknown>[], onConflict: string, opts?: RestOptions): Promise<void> {
  if (!rows.length) return;
  return withRestTimeout("write", opts, async (signal) => {
    const res = await fetch(`${REST}/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      headers: { ...BASE_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`공용 저장 실패 ${table}(${res.status}): ${detail.slice(0, 200)}`);
    }
  });
}

// 행 수만 필요할 때 (통계 카드용) — 본문 없이 count 헤더만 읽는다
export async function countRows(table: string, query = "", opts?: RestOptions): Promise<number> {
  return withRestTimeout("read", opts, async (signal) => {
    const res = await fetch(`${REST}/${table}?select=id&limit=1${query ? `&${query}` : ""}`, {
      headers: { ...BASE_HEADERS, Prefer: "count=exact" },
      signal,
    });
    if (!res.ok) throw new Error(`행 수 조회 실패 ${table}(${res.status})`);
    return Number((res.headers.get("content-range") || "").split("/")[1] || 0);
  });
}

export async function deleteRows(table: string, query: string, opts?: RestOptions): Promise<void> {
  touchesSmallTables(table);
  return withRestTimeout("write", opts, async (signal) => {
    const res = await fetch(`${REST}/${table}?${query}`, {
      method: "DELETE",
      headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`공용 삭제 실패 ${table}(${res.status}): ${detail.slice(0, 200)}`);
    }
  });
}

// insert 후 생성된 행을 돌려받는다(id 필요 시). 실패는 throw.
export async function insertRowReturning<T = Record<string, unknown>>(table: string, row: Record<string, unknown>, opts?: RestOptions): Promise<T> {
  return withRestTimeout("write", opts, async (signal) => {
    const res = await fetch(`${REST}/${table}`, {
      method: "POST",
      headers: { ...BASE_HEADERS, Prefer: "return=representation" },
      body: JSON.stringify(row),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`저장 실패 ${table}(${res.status}): ${detail.slice(0, 200)}`);
    }
    const rows = await res.json().catch(() => []);
    return (Array.isArray(rows) ? rows[0] : rows) as T;
  });
}

export async function updateRows(table: string, query: string, patch: Record<string, unknown>, opts?: RestOptions): Promise<void> {
  touchesSmallTables(table);
  return withRestTimeout("write", opts, async (signal) => {
    const res = await fetch(`${REST}/${table}?${query}`, {
      method: "PATCH",
      headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify(patch),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`수정 실패 ${table}(${res.status}): ${detail.slice(0, 160)}`);
    }
  });
}

export async function uploadPublicFile(bucket: string, path: string, file: Blob, contentType: string, opts?: RestOptions): Promise<string> {
  return withRestTimeout("write", opts, async (signal) => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": contentType, "x-upsert": "true" },
      body: file,
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`파일 업로드 실패(${res.status}): ${detail.slice(0, 160)}`);
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  });
}

export async function invokeEdgeFunction<T>(name: string, body: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
  // 타임아웃 — 모바일에서 앱 전환으로 응답이 영영 안 오면 뒤에 걸린 저장까지 멈추던 것 방지
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: BASE_HEADERS,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(controller.signal.aborted ? `서버 함수(${name}) 응답 시간 초과` : (error as Error).message);
  } finally {
    window.clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `서버 함수 호출 실패(${res.status})`);
  return data;
}

// 사진 여러 장 → 앨범 1건 생성, id 반환. (링크 1개로 모아보기)
export type PhotoAlbumMeta = {
  id?: string;
  category?: string;
  author?: string;
  region?: string;
  sourceType?: string;
  assets?: Array<{ publicUrl: string; storagePath: string; fileName: string; mimeType: string; sortOrder: number }>;
};

export async function createAlbum(urls: string[], vendor: string, meta: PhotoAlbumMeta = {}): Promise<string> {
  // 빈 칸이 섞인 앨범은 만들지 않는다 — 구멍(null)이 그대로 저장돼 '사진 없는 앨범'이 되던 사고 방지(2026-10-02)
  const blanks = Array.from({ length: urls.length }, (_, i) => urls[i]).filter((u) => !u).length;
  if (blanks) throw new Error(`사진 ${blanks}장의 주소가 비어 있어 앨범을 만들 수 없습니다 — 다시 올려 주세요`);
  const albumId = await rpc<string>("create_photo_album", {
    p_urls: urls,
    p_vendor: vendor,
    p_category: meta.category || "현장",
    p_author: meta.author || "",
    p_region: meta.region || "",
    p_source_type: meta.sourceType || "field",
  });
  if (!albumId) throw new Error("앨범 ID를 확인하지 못했습니다.");
  if (meta.assets?.length) {
    const assets = meta.assets;
    await withRestTimeout("write", undefined, async (signal) => {
      const assetRes = await fetch(`${REST}/photo_assets?on_conflict=album_id,public_url`, {
        method: "POST",
        headers: { ...BASE_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(assets.map((asset) => ({
          album_id: albumId,
          public_url: asset.publicUrl,
          storage_path: asset.storagePath,
          file_name: asset.fileName,
          mime_type: asset.mimeType,
          sort_order: asset.sortOrder,
        }))),
        signal,
      });
      if (!assetRes.ok) {
        const detail = await assetRes.text().catch(() => "");
        // 사진 색인은 기존 사진을 정리하기 위한 보조 기능이다.
        // 앨범과 실제 파일은 이미 저장됐으므로, 색인 테이블 미설정이 현장 전송을 막으면 안 된다.
        console.warn(`사진 목록 색인 건너뜀(${assetRes.status}): ${detail.slice(0, 160)}`);
      }
    });
  }
  return albumId;
}

export async function getAlbum(id: string): Promise<{ vendor: string; urls: string[]; created_at: string }> {
  const rows = await rpc<Array<{ vendor: string; urls: string[]; created_at: string }>>("get_photo_album", { p_id: id });
  if (!rows.length) throw new Error("앨범을 찾을 수 없어요");
  return rows[0];
}

// 같은 방에 같은 글이 아직 게시 대기 중이면 다시 쌓지 않는다(2026-09-28) — 봇이 잠든 사이 여러 번 누르면 깨어난 뒤 같은 글이 줄줄이 올라갔다.
// 봇은 보낸 행만 지우므로(gas-and-bot/supabase-outbox-poller.js: 전송 성공분만 DELETE) 남아 있는 행 = 아직 안 나간 글이다.
export async function enqueueOutbox(room: string, text: string, opts?: RestOptions): Promise<"queued" | "pending"> {
  return withRestTimeout("write", opts, async (signal) => {
    try {
      const since = new Date(Date.now() - 6 * 3600_000).toISOString();
      const dupRes = await fetch(`${REST}/outbox?select=text&room=eq.${encodeURIComponent(room)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=50`, { headers: BASE_HEADERS, signal });
      if (dupRes.ok) {
        const rows = await dupRes.json().catch(() => []);
        if (Array.isArray(rows) && rows.some((r) => String((r as { text?: string }).text || "") === text)) return "pending";
      }
    } catch { /* 조회가 안 되면 예전처럼 그냥 쌓는다 — 시간 초과였다면 아래 적재도 같은 signal 로 곧바로 중단돼 시간 초과 메시지가 난다 */ }
    const res = await fetch(`${REST}/outbox`, {
      method: "POST",
      headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify({ room, text }),
      signal,
    });
    if (!res.ok && res.status !== 201) {
      const t = await res.text().catch(() => "");
      throw new Error(`발신큐 적재 실패(${res.status}): ${t.slice(0, 120)}`);
    }
    return "queued";
  });
}

export type FieldSheetSyncCategory = "expansion_it" | "expansion_copier" | "contact_change" | "complaint" | "praise" | "reception_copier" | "reception_copier_new" | "reception_remote" | "reception_sales" | "reception_mgmt";

export async function enqueueFieldSheetSyncJob(job: {
  id: string;
  category: FieldSheetSyncCategory;
  author: string;
  vendor: string;
  region?: string;
  room?: string;
  sourceText: string;
  payload: Record<string, unknown>;
  dupKey: string;
}): Promise<InsertResult> {
  return insertRow("field_sheet_sync_jobs", {
    id: job.id,
    category: job.category,
    author: job.author,
    vendor: job.vendor,
    region: job.region || "",
    room: job.room || "",
    source_text: job.sourceText,
    payload: job.payload,
    "_dupKey": job.dupKey,
  });
}
