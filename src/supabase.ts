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

// PostgREST RPC 호출 (POST /rpc/<fn>). Supabase 함수 search_vendors / vendor_detail 용.
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${REST}/rpc/${fn}`, {
    method: "POST",
    headers: BASE_HEADERS,
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`RPC ${fn} 실패(${res.status}): ${t.slice(0, 200)}`);
  }
  // void 함수는 204(빈 본문)를 준다 — 무조건 json()을 부르면 파싱 오류가 난다
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// 테이블 직접 조회 (select + 필터). 점검/AS 원문 재사용(getInspForms) 용.
export async function selectRows<T>(table: string, query: string): Promise<T[]> {
  const res = await fetch(`${REST}/${table}?${query}`, { headers: BASE_HEADERS });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`조회 실패 ${table}(${res.status}): ${t.slice(0, 160)}`);
  }
  return (await res.json()) as T[];
}

export type InsertResult = "new" | "dup";

// 행 insert. 201 → 신규, 409(유니크 _dupKey 충돌) → 중복.
export async function insertRecord(table: "jeomgeom" | "as_records", row: Row): Promise<InsertResult> {
  const res = await fetch(`${REST}/${table}`, {
    method: "POST",
    headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (res.status === 201 || res.status === 200) return "new";
  if (res.status === 409) return "dup";
  const t = await res.text().catch(() => "");
  throw new Error(`저장 실패(${res.status}): ${t.slice(0, 200)}`);
}

// 범용 단일행 insert. 먼저 _dupKey를 조회해 중복을 막는다.
// 일부 기존 테이블은 _dupKey 고유 제약이 없으므로 PostgREST on_conflict에는 의존하지 않는다.
export async function insertRow(table: string, row: Record<string, unknown>): Promise<InsertResult> {
  const dupKey = String(row._dupKey || "").trim();
  if (dupKey) {
    const duplicateRes = await fetch(
      `${REST}/${table}?_dupKey=eq.${encodeURIComponent(dupKey)}&select=_dupKey&limit=1`,
      { headers: BASE_HEADERS },
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
  });
  if (res.status === 201 || res.status === 200) return "new";
  if (res.status === 409) return "dup";
  const t = await res.text().catch(() => "");
  throw new Error(`저장 실패 ${table}(${res.status}): ${t.slice(0, 200)}`);
}

// 범용 upsert. 주간 목표/회고처럼 동일 키의 내용을 다시 저장할 때 사용한다.
// TEST_MODE 판정 공용 — 미설정이면 안전하게 테스트 취급(true). 8곳 인라인 복붙을 통합.
export function isTestModeValue(value: unknown) {
  return String(value ?? "true").toLowerCase() === "true";
}

export async function upsertRow(table: string, row: Record<string, unknown>, onConflict: string): Promise<void> {
  const res = await fetch(`${REST}/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: { ...BASE_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`저장 실패 ${table}(${res.status}): ${t.slice(0, 200)}`);
  }
}

export async function getConfig(): Promise<Record<string, string>> {
  const res = await fetch(`${REST}/app_config?select=key,value`, { headers: BASE_HEADERS });
  if (!res.ok) throw new Error(`설정 조회 실패(${res.status})`);
  const rows = (await res.json()) as Array<{ key: string; value: string }>;
  const cfg: Record<string, string> = {};
  rows.forEach((r) => { cfg[r.key] = r.value; });
  return cfg;
}

export async function getRoomMap(): Promise<Record<string, string>> {
  const res = await fetch(`${REST}/room_map?select=category,region,room`, { headers: BASE_HEADERS });
  if (!res.ok) throw new Error(`방매핑 조회 실패(${res.status})`);
  const rows = (await res.json()) as Array<{ category: string; region: string; room: string }>;
  const m: Record<string, string> = {};
  rows.forEach((r) => { m[`${r.category}|${String(r.region).trim().toUpperCase()}`] = r.room; });
  return m;
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
export async function selectAllRows<T>(table: string, query: string, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = query ? "&" : "";
    const page = await selectRows<T>(table, `${query}${separator}limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// 대용량 전체 조회의 병렬판 — 페이지를 동시(concurrency)로 받아 순차 왕복 지연을 줄인다.
export async function selectAllRowsFast<T>(table: string, query: string, pageSize = 1000, concurrency = 6): Promise<T[]> {
  const separator = query ? "&" : "";
  const fetchPage = (offset: number) => selectRows<T>(table, `${query}${separator}limit=${pageSize}&offset=${offset}`);
  const first = await fetchPage(0);
  if (first.length < pageSize) return first;
  const pages: T[][] = [first];
  for (let offset = pageSize; ; offset += pageSize * concurrency) {
    const batch = await Promise.all(Array.from({ length: concurrency }, (_, index) => fetchPage(offset + index * pageSize)));
    let done = false;
    for (const page of batch) {
      pages.push(page);
      if (page.length < pageSize) { done = true; break; }
    }
    if (done) return pages.flat();
  }
}

export async function upsertRows(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
  if (!rows.length) return;
  const res = await fetch(`${REST}/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: { ...BASE_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`공용 저장 실패 ${table}(${res.status}): ${detail.slice(0, 200)}`);
  }
}

// 행 수만 필요할 때 (통계 카드용) — 본문 없이 count 헤더만 읽는다
export async function countRows(table: string, query = ""): Promise<number> {
  const res = await fetch(`${REST}/${table}?select=id&limit=1${query ? `&${query}` : ""}`, {
    headers: { ...BASE_HEADERS, Prefer: "count=exact" },
  });
  if (!res.ok) throw new Error(`행 수 조회 실패 ${table}(${res.status})`);
  return Number((res.headers.get("content-range") || "").split("/")[1] || 0);
}

export async function deleteRows(table: string, query: string): Promise<void> {
  const res = await fetch(`${REST}/${table}?${query}`, {
    method: "DELETE",
    headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`공용 삭제 실패 ${table}(${res.status}): ${detail.slice(0, 200)}`);
  }
}

// insert 후 생성된 행을 돌려받는다(id 필요 시). 실패는 throw.
export async function insertRowReturning<T = Record<string, unknown>>(table: string, row: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${REST}/${table}`, {
    method: "POST",
    headers: { ...BASE_HEADERS, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`저장 실패 ${table}(${res.status}): ${detail.slice(0, 200)}`);
  }
  const rows = await res.json().catch(() => []);
  return (Array.isArray(rows) ? rows[0] : rows) as T;
}

export async function updateRows(table: string, query: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${REST}/${table}?${query}`, {
    method: "PATCH",
    headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`수정 실패 ${table}(${res.status}): ${detail.slice(0, 160)}`);
  }
}

export async function uploadPublicFile(bucket: string, path: string, file: Blob, contentType: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": contentType, "x-upsert": "true" },
    body: file,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`파일 업로드 실패(${res.status}): ${detail.slice(0, 160)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
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
    const assetRes = await fetch(`${REST}/photo_assets?on_conflict=album_id,public_url`, {
      method: "POST",
      headers: { ...BASE_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(meta.assets.map((asset) => ({
        album_id: albumId,
        public_url: asset.publicUrl,
        storage_path: asset.storagePath,
        file_name: asset.fileName,
        mime_type: asset.mimeType,
        sort_order: asset.sortOrder,
      }))),
    });
    if (!assetRes.ok) {
      const detail = await assetRes.text().catch(() => "");
      // 사진 색인은 기존 사진을 정리하기 위한 보조 기능이다.
      // 앨범과 실제 파일은 이미 저장됐으므로, 색인 테이블 미설정이 현장 전송을 막으면 안 된다.
      console.warn(`사진 목록 색인 건너뜀(${assetRes.status}): ${detail.slice(0, 160)}`);
    }
  }
  return albumId;
}

export async function getAlbum(id: string): Promise<{ vendor: string; urls: string[]; created_at: string }> {
  const rows = await rpc<Array<{ vendor: string; urls: string[]; created_at: string }>>("get_photo_album", { p_id: id });
  if (!rows.length) throw new Error("앨범을 찾을 수 없어요");
  return rows[0];
}

export async function enqueueOutbox(room: string, text: string): Promise<void> {
  const res = await fetch(`${REST}/outbox`, {
    method: "POST",
    headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify({ room, text }),
  });
  if (!res.ok && res.status !== 201) {
    const t = await res.text().catch(() => "");
    throw new Error(`발신큐 적재 실패(${res.status}): ${t.slice(0, 120)}`);
  }
}

export type FieldSheetSyncCategory = "expansion_it" | "expansion_copier" | "contact_change" | "complaint" | "praise" | "reception_copier" | "reception_copier_new" | "reception_remote";

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
