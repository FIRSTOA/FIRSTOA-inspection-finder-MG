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

export const SUPABASE_URL = "https://jwhwicplfwrorrgtqrlw.supabase.co";
export const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3aHdpY3BsZndyb3JyZ3Rxcmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3ODg0MTQsImV4cCI6MjA5NzM2NDQxNH0.Dx227ZN2b8w6116mrjimoRiYkElddB3pqk9ys4DL72U";

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
  return (await res.json()) as T;
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

// 범용 단일행 insert. on_conflict=_dupKey 무시(중복이면 dup). 201/200 신규, 409 중복.
export async function insertRow(table: string, row: Record<string, unknown>): Promise<InsertResult> {
  const res = await fetch(`${REST}/${table}?on_conflict=_dupKey`, {
    method: "POST",
    headers: { ...BASE_HEADERS, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (res.status === 201 || res.status === 200) return "new";
  if (res.status === 409) return "dup";
  const t = await res.text().catch(() => "");
  throw new Error(`저장 실패 ${table}(${res.status}): ${t.slice(0, 200)}`);
}

// 범용 upsert. 주간 목표/회고처럼 동일 키의 내용을 다시 저장할 때 사용한다.
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
export async function uploadPhoto(path: string, file: Blob, contentType = "image/jpeg"): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/photos/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": contentType, "x-upsert": "true" },
    body: file,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`사진 업로드 실패(${res.status}): ${t.slice(0, 160)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/photos/${path}`;
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

export async function invokeEdgeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: BASE_HEADERS,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `서버 함수 호출 실패(${res.status})`);
  return data;
}

// 사진 여러 장 → 앨범 1건 생성, id 반환. (링크 1개로 모아보기)
export async function createAlbum(urls: string[], vendor: string): Promise<string> {
  const res = await fetch(`${REST}/photo_albums`, {
    method: "POST",
    headers: { ...BASE_HEADERS, Prefer: "return=representation" },
    body: JSON.stringify({ urls, vendor }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`앨범 생성 실패(${res.status}): ${t.slice(0, 160)}`); }
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0].id;
}

export async function getAlbum(id: string): Promise<{ vendor: string; urls: string[]; created_at: string }> {
  const res = await fetch(`${REST}/photo_albums?id=eq.${encodeURIComponent(id)}&select=vendor,urls,created_at`, { headers: BASE_HEADERS });
  if (!res.ok) throw new Error(`앨범 조회 실패(${res.status})`);
  const rows = (await res.json()) as Array<{ vendor: string; urls: string[]; created_at: string }>;
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
