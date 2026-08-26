/**
 * 맛집 자동 채우기 (2026-08-27) — 맛동여지도에서 이름만 치면 나머지가 알아서 들어오게.
 *
 * action=search : 가게 이름 → 후보 목록(이름·업종·주소·전화·좌표). 카카오 로컬 키워드검색 + 네이버 지역검색을 합친다.
 *                 두 곳 다 공개 API — 사진과 메뉴판은 어느 API도 제공하지 않는다.
 * action=menu   : 메뉴판·네이버 메뉴 화면 사진 URL → 메뉴 배열(이름·가격·대표). 사진에서 AI가 읽는다.
 *                 (사진·메뉴를 자동으로 얻는 유일한 합법적 경로. 스크린샷 한 장이면 끝난다.)
 */
const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Candidate = {
  name: string; category: string; address: string; roadAddress: string;
  tel: string; lat: number | null; lng: number | null; source: string; url: string;
};

const cleanTags = (v: string) => String(v || "").replace(/<[^>]*>/g, "").trim();
/** "음식점 > 일식 > 이자카야" · "한식>고기" → 마지막 조각만 (업종 칸에 넣기 좋게) */
const lastCategory = (v: string) => cleanTags(v).split(/\s*>\s*/).filter(Boolean).pop() || "";
const keyOf = (c: Candidate) => `${c.name.replace(/\s+/g, "")}|${(c.roadAddress || c.address).replace(/\s+/g, "").slice(0, 18)}`;

async function kakaoSearch(q: string): Promise<Candidate[]> {
  const key = Deno.env.get("KAKAO_REST_KEY") || "";
  if (!key) return [];
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=10`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return (data.documents || []).map((d: Record<string, string>) => ({
    name: cleanTags(d.place_name),
    category: lastCategory(d.category_name),
    address: cleanTags(d.address_name),
    roadAddress: cleanTags(d.road_address_name),
    tel: cleanTags(d.phone),
    lat: d.y ? Number(d.y) : null,
    lng: d.x ? Number(d.x) : null,
    source: "카카오",
    url: cleanTags(d.place_url),
  })) as Candidate[];
}

async function naverSearch(q: string): Promise<Candidate[]> {
  const id = Deno.env.get("NAVER_CLIENT_ID") || "";
  const secret = Deno.env.get("NAVER_CLIENT_SECRET") || "";
  if (!id || !secret) return [];
  const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(q)}&display=5&sort=random`;
  const res = await fetch(url, { headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret } });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  // 네이버 지역검색 좌표는 KATECH(mapx/mapy, 1e7 단위 WGS84) — 최근 응답은 WGS84*1e7이다
  const toDeg = (v: string) => { const n = Number(v); return Number.isFinite(n) && n > 1000 ? n / 1e7 : null; };
  return (data.items || []).map((d: Record<string, string>) => ({
    name: cleanTags(d.title),
    category: lastCategory(d.category),
    address: cleanTags(d.address),
    roadAddress: cleanTags(d.roadAddress),
    tel: cleanTags(d.telephone),
    lat: toDeg(d.mapy),
    lng: toDeg(d.mapx),
    source: "네이버",
    url: cleanTags(d.link),
  })) as Candidate[];
}

const MENU_INSTRUCTION = `너는 식당 메뉴판 사진에서 메뉴를 뽑아내는 도구다.
사진은 종이 메뉴판일 수도 있고, 네이버지도 앱의 "메뉴" 화면을 캡처한 것일 수도 있다.
JSON만 출력한다: {"menus":[{"name":"메뉴 이름","price":"9,000원","signature":true}]}
규칙:
- name: 사진에 적힌 그대로. 괄호 설명이 붙어 있으면 함께 담는다("네기마(다리살+대파)").
- price: 숫자에 천단위 콤마와 "원"을 붙인 문자열("3,900원"). 가격이 안 보이면 "".
- signature: "대표"·"인기"·"추천"·"BEST"·"시그니처" 배지가 붙은 메뉴만 true, 나머지는 넣지 않는다.
- 메뉴가 아닌 것(가게 이름, 전화번호, 영업시간, 원산지 표기, 리뷰 수, "메뉴" 같은 머리글)은 넣지 않는다.
- 같은 메뉴가 사진에 두 번 보이면 한 번만 담는다. 최대 40개.
- 사진에서 메뉴를 못 찾으면 {"menus":[]} 를 출력한다. 없는 메뉴를 만들어내면 안 된다.`;

async function menuFromImage(imageUrl: string): Promise<{ menus: unknown[]; model: string } | { error: string }> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
  if (!apiKey) return { error: "OPENAI_API_KEY가 없습니다" };
  const model = Deno.env.get("OPENAI_VISION_MODEL") || "gpt-5.5";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: MENU_INSTRUCTION },
        { role: "user", content: [{ type: "input_text", text: "이 사진의 메뉴를 뽑아줘." }, { type: "input_image", image_url: imageUrl }] },
      ],
      text: { format: { type: "json_object" } },
    }),
  });
  if (!res.ok) return { error: (await res.text().catch(() => "")).slice(0, 300) };
  const data = await res.json();
  const outputText = data.output_text
    || data.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n")
    || "";
  const parsed = JSON.parse(outputText || "{}");
  const menus = (Array.isArray(parsed.menus) ? parsed.menus : []).slice(0, 40).map((m: Record<string, unknown>) => ({
    name: String(m?.name || "").slice(0, 60).trim(),
    price: String(m?.price || "").slice(0, 20).trim(),
    ...(m?.signature ? { signature: true } : {}),
  })).filter((m: { name: string }) => m.name);
  return { menus, model };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "search");

    if (action === "menu") {
      const imageUrl = String(body.imageUrl || "").trim();
      if (!/^https?:\/\//.test(imageUrl)) return Response.json({ error: "imageUrl이 필요합니다" }, { status: 400, headers: jsonHeaders });
      const out = await menuFromImage(imageUrl);
      if ("error" in out) return Response.json(out, { status: 502, headers: jsonHeaders });
      return Response.json({ ok: true, ...out }, { headers: jsonHeaders });
    }

    const q = String(body.q || "").trim();
    if (q.length < 2) return Response.json({ error: "검색어가 너무 짧습니다" }, { status: 400, headers: jsonHeaders });
    // 카카오·네이버를 동시에 물어보고 합친다 — 한쪽에만 있는 가게가 흔하다
    const [kakao, naver] = await Promise.all([
      kakaoSearch(q).catch(() => [] as Candidate[]),
      naverSearch(q).catch(() => [] as Candidate[]),
    ]);
    const merged: Candidate[] = [];
    for (const c of [...kakao, ...naver]) {
      if (!c.name) continue;
      const found = merged.find((m) => keyOf(m) === keyOf(c));
      if (found) {
        // 같은 가게면 빈 칸만 채운다 (좌표는 카카오가 정확해 먼저 온 값을 지키다)
        found.tel = found.tel || c.tel;
        found.category = found.category || c.category;
        found.roadAddress = found.roadAddress || c.roadAddress;
        found.address = found.address || c.address;
        if (found.lat == null) { found.lat = c.lat; found.lng = c.lng; }
        if (!found.source.includes(c.source)) found.source = `${found.source}·${c.source}`;
        continue;
      }
      merged.push({ ...c });
    }
    return Response.json({ ok: true, places: merged.slice(0, 12) }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500, headers: jsonHeaders });
  }
});
