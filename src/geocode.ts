/**
 * 한국 주소 지오코딩 — 엣지 함수(geocode) 경유.
 * 엣지가 카카오(키 등록 시, 네이버지도급) → OSM 노미나팀(서버측 UA) 순으로 처리한다.
 * 브라우저에서 노미나팀을 직접 부르면 UA·속도 제한으로 간헐 실패해서 서버로 옮겼다.
 */
import { invokeEdgeFunction } from "./supabase";

export type GeoPoint = { lat: number; lng: number; label: string };

export async function geocodeKR(raw: string): Promise<GeoPoint | null> {
  const q = raw.trim();
  if (!q) return null;
  try {
    const res = await invokeEdgeFunction<{ ok: boolean; lat?: number; lng?: number; label?: string }>("geocode", { q });
    if (res.ok && typeof res.lat === "number" && typeof res.lng === "number") {
      return { lat: res.lat, lng: res.lng, label: res.label || q };
    }
  } catch { /* 아래 null */ }
  return null;
}
