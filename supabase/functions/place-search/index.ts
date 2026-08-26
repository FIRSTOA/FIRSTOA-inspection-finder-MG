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

export type PhotoHit = { url: string; thumb: string; site: string; doc: string };

/** 가게 사진 자동 찾기 — 카카오·네이버 이미지 검색(공식 API). 지도 API는 사진을 주지 않아 이 길로 간다. */
async function photoSearch(q: string): Promise<PhotoHit[]> {
  const out: PhotoHit[] = [];
  const kakaoKey = Deno.env.get("KAKAO_REST_KEY") || "";
  const nid = Deno.env.get("NAVER_CLIENT_ID") || "";
  const nsecret = Deno.env.get("NAVER_CLIENT_SECRET") || "";

  const tasks: Array<Promise<void>> = [];
  if (kakaoKey) {
    tasks.push((async () => {
      const res = await fetch(`https://dapi.kakao.com/v2/search/image?query=${encodeURIComponent(q)}&size=20&sort=accuracy`, {
        headers: { Authorization: `KakaoAK ${kakaoKey}` },
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      for (const d of data.documents || []) {
        const w = Number(d.width || 0), h = Number(d.height || 0);
        if (w && w < 400) continue;                       // 너무 작은 이미지는 버린다
        if (w && h && h / w > 1.9) continue;              // 세로로 긴 캡처·배너류 제외
        out.push({ url: String(d.image_url || ""), thumb: String(d.thumbnail_url || d.image_url || ""), site: String(d.display_sitename || ""), doc: String(d.doc_url || "") });
      }
    })().catch(() => undefined));
  }
  if (nid && nsecret) {
    tasks.push((async () => {
      const res = await fetch(`https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(q)}&display=20&filter=large`, {
        headers: { "X-Naver-Client-Id": nid, "X-Naver-Client-Secret": nsecret },
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      for (const d of data.items || []) {
        const w = Number(d.sizewidth || 0), h = Number(d.sizeheight || 0);
        if (w && w < 400) continue;
        if (w && h && h / w > 1.9) continue;
        out.push({ url: String(d.link || ""), thumb: String(d.thumbnail || d.link || ""), site: cleanTags(String(d.title || "")).slice(0, 24), doc: "" });
      }
    })().catch(() => undefined));
  }
  await Promise.all(tasks);

  const seen = new Set<string>();
  const uniq: PhotoHit[] = [];
  for (const p of out) {
    if (!/^https:\/\//.test(p.url)) continue;             // http는 브라우저가 막는다
    const key = p.url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
  }
  return uniq.slice(0, 18);
}

/**
 * 고른 사진을 우리 저장소로 복사한다. 네이버·블로그 이미지는 다른 사이트에서 불러오면 막히는 일이 잦아
 * (referer 검사·링크 만료) 원본을 가져와 photos 버킷에 넣고 우리 URL을 돌려준다.
 */
async function savePhoto(url: string, fallback = ""): Promise<{ url: string } | { error: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return { error: "저장소 설정이 없습니다" };
  // 블로그 이미지 서버는 브라우저가 아닌 요청을 403으로 막는다 — 사람이 볼 때와 같은 헤더로 요청하고,
  // 그래도 막히면 검색이 준 썸네일 주소(CDN 프록시)로 받는다. (2026-08-27: 전부 403이라 사진이 하나도 안 붙던 문제)
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  const refererFor = (u: string) => {
    if (/pstatic\.net|naver\./.test(u)) return "https://blog.naver.com/";
    if (/kakaocdn|daum/.test(u)) return "https://search.daum.net/";
    try { return new URL(u).origin + "/"; } catch { return ""; }
  };
  const tryFetch = async (u: string) => {
    for (const referer of [refererFor(u), ""]) {
      try {
        const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8", ...(referer ? { Referer: referer } : {}) } });
        if (r.ok) return r;
      } catch { /* 다음 조합 */ }
    }
    return null;
  };
  let res = await tryFetch(url);
  if (!res && fallback && fallback !== url) res = await tryFetch(fallback);
  if (!res) return { error: "원본을 못 받았습니다(차단)" };
  const type = res.headers.get("content-type") || "image/jpeg";
  if (!type.startsWith("image/")) return { error: "이미지가 아닙니다" };
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > 8 * 1024 * 1024) return { error: "사진이 너무 큽니다(8MB 초과)" };
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("gif") ? "gif" : "jpg";
  const path = `food/auto/${crypto.randomUUID()}.${ext}`;
  const up = await fetch(`${supabaseUrl}/storage/v1/object/photos/${path}`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": type, "x-upsert": "true" },
    body: buf,
  });
  if (!up.ok) return { error: `저장 실패(${up.status}) ${(await up.text().catch(() => "")).slice(0, 120)}` };
  return { url: `${supabaseUrl}/storage/v1/object/public/photos/${path}` };
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

/**
 * 좌표 주변 음식점 찾기 — 이름 대신 주소·건물명으로 저장된 곳(상가·주차장 등)의 실제 가게를 되찾는다.
 * 카카오 카테고리 검색(FD6 음식점 · CE7 카페)을 거리순으로.
 */
async function nearbyFood(lat: number, lng: number, radius: number): Promise<Candidate[]> {
  const key = Deno.env.get("KAKAO_REST_KEY") || "";
  if (!key) return [];
  const out: Candidate[] = [];
  for (const code of ["FD6", "CE7"]) {
    const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${code}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15`;
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
    if (!res.ok) continue;
    const data = await res.json().catch(() => ({}));
    for (const d of data.documents || []) {
      out.push({
        name: cleanTags(d.place_name), category: lastCategory(d.category_name),
        address: cleanTags(d.address_name), roadAddress: cleanTags(d.road_address_name),
        tel: cleanTags(d.phone), lat: d.y ? Number(d.y) : null, lng: d.x ? Number(d.x) : null,
        source: `카카오 ${Math.round(Number(d.distance || 0))}m`, url: cleanTags(d.place_url),
      });
    }
  }
  return out;
}

const PICK_INSTRUCTION = `너는 식당 사진을 골라내는 검수자다. 여러 장의 사진과 가게 이름·업종을 받는다.
그 가게의 사진으로 쓸 만한 것만 고른다. JSON만 출력: {"keep":[0,2]}  (0부터 시작하는 사진 번호)
고르는 기준:
- 그 가게의 음식·내부·간판 사진이면 고른다.
- 다른 가게 간판, 지도 캡처, 사람 얼굴 위주 셀카, 글자만 있는 홍보 이미지, 로고·배너, 만화·일러스트는 고르지 않는다.
- 음식 사진이라도 그 가게와 업종이 전혀 안 맞으면(고깃집인데 케이크 등) 고르지 않는다.
- 확실하지 않으면 고르지 않는다. 아무것도 없으면 {"keep":[]}.
- 최대 3장까지만 고른다. 음식 사진을 먼저, 그다음 내부·간판 순으로.`;

/** 자동으로 찾은 사진이 정말 그 가게 사진인지 AI가 검수한다 (엉뚱한 사진이 대표로 걸리는 것 방지) */
async function pickPhotos(name: string, category: string, urls: string[]): Promise<number[]> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
  if (!apiKey || !urls.length) return [];
  const model = Deno.env.get("OPENAI_VISION_MODEL") || "gpt-5.5";
  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: `가게 이름: ${name}${category ? ` (업종: ${category})` : ""}\n사진 ${urls.length}장을 순서대로 보여준다.` },
  ];
  urls.forEach((u) => content.push({ type: "input_image", image_url: u }));
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      input: [{ role: "system", content: PICK_INSTRUCTION }, { role: "user", content }],
      text: { format: { type: "json_object" } },
    }),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const outputText = data.output_text
    || data.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n")
    || "";
  try {
    const parsed = JSON.parse(outputText || "{}");
    return (Array.isArray(parsed.keep) ? parsed.keep : [])
      .map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0 && n < urls.length).slice(0, 3);
  } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "search");

    if (action === "photos") {
      const q = String(body.q || "").trim();
      if (q.length < 2) return Response.json({ error: "검색어가 너무 짧습니다" }, { status: 400, headers: jsonHeaders });
      const photos = await photoSearch(q);
      return Response.json({ ok: true, photos }, { headers: jsonHeaders });
    }

    if (action === "nearby") {
      const lat = Number(body.lat), lng = Number(body.lng);
      const radius = Math.min(Math.max(Number(body.radius) || 60, 10), 500);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Response.json({ error: "lat·lng가 필요합니다" }, { status: 400, headers: jsonHeaders });
      const places = await nearbyFood(lat, lng, radius);
      return Response.json({ ok: true, places }, { headers: jsonHeaders });
    }

    if (action === "pick_photos") {
      const name = String(body.name || "").trim();
      const category = String(body.category || "").trim();
      const urls = (Array.isArray(body.urls) ? body.urls : []).map((u: unknown) => String(u)).filter((u: string) => /^https:\/\//.test(u)).slice(0, 6);
      if (!name || !urls.length) return Response.json({ error: "name·urls가 필요합니다" }, { status: 400, headers: jsonHeaders });
      const keep = await pickPhotos(name, category, urls);
      return Response.json({ ok: true, keep }, { headers: jsonHeaders });
    }

    if (action === "save_photo") {
      const url = String(body.url || "").trim();
      if (!/^https?:\/\//.test(url)) return Response.json({ error: "url이 필요합니다" }, { status: 400, headers: jsonHeaders });
      const out = await savePhoto(url, String(body.fallback || "").trim());
      if ("error" in out) return Response.json(out, { status: 502, headers: jsonHeaders });
      return Response.json({ ok: true, ...out }, { headers: jsonHeaders });
    }

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
