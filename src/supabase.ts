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
