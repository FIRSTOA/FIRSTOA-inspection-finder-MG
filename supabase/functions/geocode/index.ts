// 주소 → 좌표 프록시.
// 1순위: 카카오 주소 검색 → 2순위: 카카오 키워드(건물명·상호) → 3순위: OSM 노미나팀.
//
// 현장 주소는 사람이 쓴 것이라 지오코더가 그대로 먹지 못한다(실제 실패 예):
//   "빅오션이엔엠 강남구 강남대로128길73 지하1층 덕양빌딩"  ← 업체명 접두 + 붙은 번지 + 층 + 건물명
//   "서울시 중랑구 신내동800"                              ← 비표준 "서울시" + 동·번지 붙어쓰기
// 그래서 ① 표기를 다듬어 여러 후보를 만들고 ② 주소 검색을 전부 먼저 시도한 뒤 키워드로 넘어가고
// ③ 결과가 질의의 시/구와 다르면 버린다. ③이 없으면 "덕양빌딩"이 고양시 덕양구로 잡힌다(실제 사고).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SIDO = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주", "충청북도", "충청남도", "전라북도", "전라남도", "경상북도", "경상남도", "강원도", "경기도", "제주도"];

/** 표기 다듬기 — 지오코더가 먹는 형태로 */
function tidy(raw: string): string {
  return String(raw || "")
    .replace(/_x000d_|\r|\n|\t/g, " ")
    .replace(/[()［］\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // "서울시·부산시" 같은 비표준 표기 → 지오코더가 아는 형태
    .replace(/^서울\s*(?:특별)?시/, "서울")
    .replace(/^(부산|대구|인천|광주|대전|울산)\s*(?:광역)?시/, "$1")
    .replace(/^세종\s*특별자치시/, "세종")
    // 도로명·번지 붙어쓰기 분리: "강남대로128길73" → "강남대로128길 73", "신내동800" → "신내동 800"
    .replace(/([가-힣A-Za-z0-9·]+(?:로|길))\s+(\d+(?:번)?길)/g, "$1$2")
    .replace(/(\d+(?:번)?길)\s*(\d+(?:-\d+)?)/g, "$1 $2")
    .replace(/([가-힣]+(?:동|리|가))\s*(\d+(?:-\d+)?)(?=\s|$)/g, "$1 $2")
    .replace(/([가-힣]+로)\s*(\d+(?:-\d+)?)(?=\s|$)(?!\s*길)/g, "$1 $2");
}

/** 업체명 접두 제거 — 시/도나 구·시 토큰부터가 주소다 */
function fromAdministrative(value: string): string {
  const sido = new RegExp(`(?:${SIDO.join("|")})\\s`);
  const hitSido = value.search(sido);
  if (hitSido > 0) return value.slice(hitSido).trim();
  const gu = value.search(/[가-힣]{2,}(?:구|군|시)\s/);
  if (gu > 0) return value.slice(gu).trim();
  return value;
}

/** 층·호·건물명 등 뒤쪽 상세 제거 (도로명+건물번호까지만) */
function roadOnly(value: string): string {
  const cut = value
    .replace(/\s*(?:지하|B)\s*\d+\s*(?:층|F)(?:\s.*)?$/i, "")
    .replace(/\s*\d+\s*(?:층|호)(?:\s.*)?$/, "");
  const road = cut.match(/^(.*?(?:로|길)\s*\d+(?:-\d+)?)/);
  if (road) return road[1].trim();
  const jibun = cut.match(/^(.*?(?:동|리|가)\s*\d+(?:-\d+)?)/);
  return jibun ? jibun[1].trim() : cut.trim();
}

/** 질의에서 기대하는 지역(구·군·시) — 결과 검증용 */
function expectedArea(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/([가-힣]{2,4}(?:구|군|시))(?=\s|$)/g)) {
    const token = m[1];
    if (!out.includes(token) && !/^(서울시|세종시)$/.test(token)) out.push(token);
  }
  return out;
}

function candidates(raw: string): string[] {
  const base = tidy(raw);
  const addr = fromAdministrative(base);
  const out: string[] = [];
  const push = (v: string) => { const t = v.trim(); if (t.length >= 4 && !out.includes(t)) out.push(t); };
  push(roadOnly(addr));   // 가장 잘 먹는 형태를 먼저
  push(addr);
  push(roadOnly(base));
  push(base);
  return out;
}

/** 결과가 질의의 구·군·시와 맞는지 — 다르면 다른 도시의 동명 건물이다 */
function areaMatches(expected: string[], label: string): boolean {
  if (!expected.length) return true;
  return expected.some((area) => label.includes(area));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { q } = await req.json();
    const query = String(q || "").trim();
    if (!query) return Response.json({ ok: false, error: "주소가 비었습니다" }, { status: 400, headers: corsHeaders });

    const list = candidates(query);
    const expected = expectedArea(tidy(query));
    const kakaoKey = Deno.env.get("KAKAO_REST_KEY") || "";

    if (kakaoKey) {
      // 주소 검색을 후보 전부에 먼저 — 키워드(건물명)는 헐거워서 마지막에 쓴다
      for (const path of ["address", "keyword"] as const) {
        for (const v of list) {
          const res = await fetch(`https://dapi.kakao.com/v2/local/search/${path}.json?query=${encodeURIComponent(v)}&size=5`, {
            headers: { Authorization: `KakaoAK ${kakaoKey}` },
          });
          if (!res.ok) continue;
          const data = await res.json();
          for (const doc of (data.documents || [])) {
            if (!doc?.y || !doc?.x) continue;
            const label = String(doc.road_address_name || doc.address_name || doc.place_name || "");
            if (!areaMatches(expected, `${label} ${doc.address_name || ""}`)) continue; // 다른 시·구 결과는 버린다
            return Response.json({
              ok: true, lat: Number(doc.y), lng: Number(doc.x),
              label: doc.road_address_name || doc.address_name || doc.place_name || v,
              via: `kakao-${path}`, used: v,
            }, { headers: corsHeaders });
          }
        }
      }
    }

    for (const v of list) {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=3&countrycodes=kr&q=${encodeURIComponent(v)}`, {
        headers: { "Accept-Language": "ko", "User-Agent": "firstoa-cs-app/1.0 (firstoa95@gmail.com)" },
      });
      if (res.ok) {
        const hits = await res.json();
        for (const hit of hits) {
          const label = String(hit.display_name || "");
          if (!areaMatches(expected, label)) continue;
          return Response.json({
            ok: true, lat: Number(hit.lat), lng: Number(hit.lon),
            label: label.split(",").slice(0, 3).join(","), via: "osm", used: v,
          }, { headers: corsHeaders });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1100)); // 노미나팀 속도 예의
    }
    return Response.json({ ok: false, error: "좌표를 찾지 못했습니다", tried: list, expected }, { headers: corsHeaders });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500, headers: corsHeaders });
  }
});
