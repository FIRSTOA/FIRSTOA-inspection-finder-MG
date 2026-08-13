// 주소 → 좌표 프록시.
// 1순위: 카카오 주소·키워드 검색 (Secrets KAKAO_REST_KEY — 네이버지도급 정확도)
// 2순위: OSM 노미나팀 (서버측 User-Agent 포함 — 브라우저 직접 호출은 UA·속도 제한으로 불안정했다)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function variants(raw: string): string[] {
  const q = raw.trim().replace(/\s+/g, " ");
  const out: string[] = [];
  const push = (v: string) => { const t = v.trim(); if (t && !out.includes(t)) out.push(t); };
  const joined = q
    .replace(/([가-힣A-Za-z0-9·]+(?:로|길))\s+(\d+(?:번)?길)/g, "$1$2")
    .replace(/(\d+(?:번)?길)\s*(\d+(?:-\d+)?)(?=\s|$)/g, "$1 $2")
    .replace(/([가-힣]로)\s*(\d+(?:-\d+)?)(?=\s|$)(?!\s*길)/g, "$1 $2");
  push(joined);
  push(q);
  push(joined.replace(/\s*\d+(층|호)\b.*$/, "").replace(/\s*\([^)]*\)\s*$/, ""));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { q } = await req.json();
    const query = String(q || "").trim();
    if (!query) return Response.json({ ok: false, error: "주소가 비었습니다" }, { status: 400, headers: corsHeaders });

    const kakaoKey = Deno.env.get("KAKAO_REST_KEY") || "";
    if (kakaoKey) {
      for (const v of variants(query)) {
        // 주소 검색 → 없으면 키워드 검색(건물명·상호도 잡는다)
        for (const path of ["address", "keyword"]) {
          const res = await fetch(`https://dapi.kakao.com/v2/local/search/${path}.json?query=${encodeURIComponent(v)}&size=1`, {
            headers: { Authorization: `KakaoAK ${kakaoKey}` },
          });
          if (!res.ok) continue;
          const data = await res.json();
          const doc = (data.documents || [])[0];
          if (doc?.y && doc?.x) {
            return Response.json({ ok: true, lat: Number(doc.y), lng: Number(doc.x), label: doc.address_name || doc.place_name || v, via: `kakao-${path}` }, { headers: corsHeaders });
          }
        }
      }
    }
    // 노미나팀 폴백 — 서버에서 UA를 달아 호출 (브라우저 직접 호출은 UA 없음/속도 제한으로 실패 잦음)
    for (const v of variants(query)) {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&q=${encodeURIComponent(v)}`, {
        headers: { "Accept-Language": "ko", "User-Agent": "firstoa-cs-app/1.0 (firstoa95@gmail.com)" },
      });
      if (!res.ok) continue;
      const hits = await res.json();
      if (hits.length) {
        return Response.json({ ok: true, lat: Number(hits[0].lat), lng: Number(hits[0].lon), label: String(hits[0].display_name || "").split(",").slice(0, 3).join(","), via: "osm" }, { headers: corsHeaders });
      }
      await new Promise((resolve) => setTimeout(resolve, 1100)); // 노미나팀 속도 예의
    }
    return Response.json({ ok: false, error: "좌표를 찾지 못했습니다" }, { headers: corsHeaders });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500, headers: corsHeaders });
  }
});
