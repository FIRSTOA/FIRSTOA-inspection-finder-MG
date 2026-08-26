/**
 * 맛집 자동 채우기 — 엣지 함수(place-search) 경유.
 * 이름만 치면 업종·주소·전화·좌표가 들어오고(카카오 로컬 + 네이버 지역검색),
 * 메뉴는 메뉴판이나 네이버지도 "메뉴" 화면 사진에서 AI가 읽어온다.
 * 사진·메뉴를 주는 공개 API는 없어서(네이버·카카오 모두 미제공) 사진 인식이 유일한 자동 경로다.
 */
import { invokeEdgeFunction } from "./supabase";
import type { MenuItem } from "./foodImport";

export type PlaceCandidate = {
  name: string; category: string; address: string; roadAddress: string;
  tel: string; lat: number | null; lng: number | null; source: string; url: string;
};

export async function searchPlaces(q: string): Promise<PlaceCandidate[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const res = await invokeEdgeFunction<{ ok?: boolean; places?: PlaceCandidate[]; error?: string }>("place-search", { action: "search", q: query });
  if (res.error) throw new Error(res.error);
  return Array.isArray(res.places) ? res.places : [];
}

export async function menusFromPhoto(imageUrl: string): Promise<MenuItem[]> {
  const res = await invokeEdgeFunction<{ ok?: boolean; menus?: MenuItem[]; error?: string }>("place-search", { action: "menu", imageUrl });
  if (res.error) throw new Error(res.error);
  return (Array.isArray(res.menus) ? res.menus : []).filter((m) => m.name);
}
