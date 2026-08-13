/**
 * 한국 주소 지오코딩 (OSM 노미나팀) — 도로명 띄어쓰기에 극도로 민감한 문제를
 * 변형 생성으로 흡수한다: "삼성로 100길8" / "삼성로100길 8" / "삼성로 100길 8" /
 * "삼성로100길8" 전부 → 표준형 "삼성로100길 8"을 포함한 후보들로 차례 시도.
 */

export type GeoPoint = { lat: number; lng: number; label: string };

/** 도로명 주소 띄어쓰기 변형 생성 — 표준형을 앞에 둔다 */
export function addressVariants(raw: string): string[] {
  const q = raw.trim().replace(/\s+/g, " ");
  const out: string[] = [];
  const push = (v: string) => { const t = v.trim(); if (t && !out.includes(t)) out.push(t); };

  // 1) "OO로 N길", "OO로N길" → 표준은 붙임("OO로N길"), 건물번호 앞은 한 칸
  const joined = q
    .replace(/([가-힣A-Za-z0-9·]+(?:로|길))\s+(\d+(?:번)?길)/g, "$1$2")   // 로 100길 → 로100길
    .replace(/(\d+(?:번)?길)\s*(\d+(?:-\d+)?)(?=\s|$)/g, "$1 $2")          // 길8 / 길 8 → 길 8
    .replace(/([가-힣]로)\s*(\d+(?:-\d+)?)(?=\s|$)(?!\s*길)/g, "$1 $2");   // 로8 → 로 8 (N길 아님)
  push(joined);
  push(q);
  // 2) 반대 방향: 전부 띄운 형태
  push(q.replace(/([가-힣A-Za-z0-9·]+로)(\d+(?:번)?길)/g, "$1 $2"));
  // 3) 층·호·상세를 뗀 형태 (노미나팀은 상세주소를 모른다)
  const noDetail = joined.replace(/\s*\d+(층|호)\b.*$/, "").replace(/\s*\([^)]*\)\s*$/, "");
  push(noDetail);
  // 4) 건물번호까지만 남긴 압축형
  const m = noDetail.match(/^(.*?(?:로|길)\d*(?:번)?길?\s*\d+(?:-\d+)?)/);
  if (m) push(m[1]);
  return out;
}

/** 변형들을 차례로 시도해 첫 좌표를 돌려준다 (없으면 null) */
export async function geocodeKR(raw: string): Promise<GeoPoint | null> {
  for (const variant of addressVariants(raw)) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&q=${encodeURIComponent(variant)}`,
        { headers: { "Accept-Language": "ko" } },
      );
      const hits = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (hits.length) {
        return { lat: Number(hits[0].lat), lng: Number(hits[0].lon), label: hits[0].display_name.split(",").slice(0, 3).join(",") };
      }
    } catch { /* 다음 변형 */ }
  }
  return null;
}
