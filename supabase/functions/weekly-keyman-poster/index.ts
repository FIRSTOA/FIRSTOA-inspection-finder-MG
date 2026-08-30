/**
 * 주간 키맨·주소 변경 안내 포스터 (2026-08-28)
 *
 * 매주 월요일 아침, 지난주(월~일) 담당자변경 시트에 들어온 변경을 **지역별 한 장 이미지**로 만들어
 * 각 지역 점검방에 보낸다. 목적은 "키맨이 바뀌었으니 방문해서 인사하자"를 눈에 띄게 알리는 것.
 *
 * 이미지 만드는 방법: 구글 슬라이드 API로 한 장을 그리고 PNG 썸네일로 받아 저장소에 올린다.
 *   왜 슬라이드인가 — 엣지 함수에서 한글 폰트를 직접 심어 PNG를 그리려면 폰트 파일을 넣고 WASM 렌더러를
 *   써야 해서 무겁고 깨지기 쉽다. 슬라이드는 구글이 한글을 제대로 렌더해 주고, 서비스 계정이 이미 있다.
 *
 * action=preview : 이미지만 만들어 URL 반환 (발송 없음 — 디자인 확인용)
 * action=run     : 지역별로 만들어 점검방 발송 (월요일 아침 정기 실행)
 */
const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLIDES = "https://slides.googleapis.com/v1/presentations";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
// 서비스 계정은 자기 드라이브에 파일을 못 만든다(저장용량 없음) — 사람이 공유해 준 폴더 안에 만든다.
// 폴더: 드라이브 "CS 주간 키맨 포스터" (편집자로 sheet-mg@… 공유됨, 2026-08-28)
const APP_URL = Deno.env.get("APP_URL") || "https://firstoa-inspection-finder-mg.vercel.app";
const FOLDER_ID = Deno.env.get("KEYMAN_POSTER_FOLDER") || "1CUtmSkE9gPAP9W0AufQ3wm5x2Oeqlbe7";

// ── 디자인 토큰 ─────────────────────────────────────────────
// 방향: 우리 앱과 같은 톤 — 다크 헤더바 + 흰 본문 + 알약 + 연파랑 강조.
// 구성은 표가 아니라 '브리핑 카드' — 인사할 사람 이름이 카드의 주인공이다.
const NAVY = { red: 0.086, green: 0.137, blue: 0.227 };     // #16233A 헤더바
const NAVY_SUB = { red: 0.624, green: 0.690, blue: 0.788 }; // #9FB0C9 헤더 보조글
const WHITE = { red: 1, green: 1, blue: 1 };
const CARD = { red: 0.961, green: 0.969, blue: 0.980 };     // #F5F7FA 카드
const BAND = { red: 0.953, green: 0.961, blue: 0.976 };     // #F3F5F9 아래 띠
const INK = { red: 0.090, green: 0.106, blue: 0.145 };      // #171B25 이름·제목
const SUB = { red: 0.420, green: 0.451, blue: 0.502 };      // #6B7380 업체명
const MUTED = { red: 0.604, green: 0.639, blue: 0.698 };    // #9AA3B2 보조
const BLUE = { red: 0.145, green: 0.388, blue: 0.922 };     // #2563EB 강조(키맨)
const MINT = { red: 0.059, green: 0.725, blue: 0.506 };     // #0FB981 주소

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache.token;
  const sa = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT") || "{}");
  if (!sa.client_email || !sa.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT 시크릿이 없습니다");
  const pem = String(sa.private_key).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const enc = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/presentations https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(new Uint8Array(sig))}` }),
  });
  if (!res.ok) throw new Error(`토큰 발급 실패(${res.status}) ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, exp: Date.now() + 55 * 60_000 };
  return tokenCache.token;
}

type ChangeRow = {
  id: string; change_date: string; company: string; region: string; category: string;
  reason: string; grade: string; before_text: string; after_text: string; notes: string; author: string;
  greeting_done?: boolean; greeting_by?: string;
};

const letterOf = (v: string) => (String(v || "").toUpperCase().match(/[A-E]/) || [""])[0];
const isAddress = (r: ChangeRow) => /주소|이전/.test(r.category) && !/담당|키맨/.test(r.category);
const isName = (r: ChangeRow) => /업체명|상호|사명|법인명/.test(r.category);
const isPerson = (r: ChangeRow) =>
  !isAddress(r) && !isName(r)
  && !/삭제|제거|해지|말소|취소|중복|폐업|철수|종료/.test(`${r.category} ${r.reason}`)
  && /키맨|담당|대표|소장|점장|팀장|과장|부장|실장|사장|이사|인사|입사|교체|변경자/.test(`${r.category} ${r.reason}`);

/**
 * 같은 변경이 두 번 담기는 일이 있다 — 웹앱 양식과 담당자변경 시트(메신저봇·Make) 양쪽에서 들어오기 때문.
 * 업체·구분·변경후가 같으면 한 건으로 본다(실측: C지역 "파커스"가 2장 겹쳐 나왔다).
 */
function dedupe(list: ChangeRow[]): ChangeRow[] {
  const seen = new Set<string>();
  const out: ChangeRow[] = [];
  for (const row of list) {
    const key = [row.company, row.category, row.after_text].map((v) => String(v || "").replace(/\s+/g, "")).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** 한글 글자 수 — 어느 쪽이 사람 이름인지 고를 때 쓴다 */
const hangul = (v: string) => (String(v || "").match(/[가-힣]/g) || []).length;

/**
 * 변경후 글에서 **인사할 사람**과 전화번호를 뽑는다.
 * 원문 순서가 제각각이고("010-4944-0410 윤상필 팀장"), 번호가 두 개 섞이기도 한다
 * ("진달래 010-… (육아휴직) · 점검 연락 010-…"). 그래서 번호를 걷어내고 남은 한글 앞 두 마디를 이름으로 쓴다.
 */
function readPerson(text: string): { name: string; phone: string; note: string } {
  const one = String(text || "").replace(/\s*\n\s*/g, " · ").replace(/\s+/g, " ").trim();
  const phones = one.match(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g) || [];
  const bare = one.replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, " ").replace(/[()·,]/g, " ").replace(/\s+/g, " ").trim();
  const words = bare.split(" ").filter((w) => hangul(w) > 0);
  // 첫 마디가 이름, 두 번째는 **직급일 때만** 붙인다 (사유가 이름에 붙던 것 수리: "진달래 육아휴직")
  const TITLE = /^(팀장|과장|부장|차장|대리|주임|실장|소장|사장|이사|상무|전무|본부장|점장|원장|대표|사원|기사|님|담당)/;
  const name = [words[0] || "", TITLE.test(words[1] || "") ? words[1] : ""].filter(Boolean).join(" ");
  const rest = words.slice(name.split(" ").length);
  return { name: clipText(name || bare.slice(0, 12), 14), phone: phones[0] || "", note: clipText(rest.join(" "), 22) };
}

/** 주소에서 눈에 들어오는 앞부분(구·동·번지)과 전체를 나눈다 */
function readAddress(text: string): { head: string; full: string } {
  const one = String(text || "").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
  const cut = one.replace(/^(서울특별시|서울시|서울|경기도|경기|인천광역시|인천)\s*/, "");
  return { head: clipText(cut, 24), full: clipText(one, 54) };
}

/** 카드에 보일 만한 등급·계약형태만 남긴다 — 시트 등급 열에는 'NN'처럼 뜻 없는 값도 섞여 있다 */
function gradeLabel(value: string): string {
  const g = String(value || "").trim();
  if (/^(특S|S|A|B|C|D)$/.test(g)) return g;
  if (/유지보수|임대|렌탈|리스|판매/.test(g)) return g;
  return "";
}

/** 접수일 표시 (8/17) — change_date는 'YYYY-MM-DD' 문자열이라 시차 계산 없이 자른다 */
function dayLabel(value: string): string {
  const m = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : "";
}

/** 지난주 월요일 00:00 ~ 일요일 (KST 기준 날짜 문자열) */
function lastWeekRange(baseIso?: string): { from: string; to: string; label: string } {
  const base = baseIso ? new Date(`${baseIso}T00:00:00+09:00`) : new Date(Date.now() + 9 * 3600_000);
  const day = base.getUTCDay(); // 0=일
  const mondayOffset = day === 0 ? 6 : day - 1;
  const thisMonday = new Date(base.getTime() - mondayOffset * 86400000);
  const from = new Date(thisMonday.getTime() - 7 * 86400000);
  const to = new Date(thisMonday.getTime() - 86400000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return { from: ymd(from), to: ymd(to), label: `${md(from)} ~ ${md(to)}` };
}

/** 변경 종류별 인사 안내 문구 — 현장에서 바로 쓸 수 있게 */
const GREETING_TIPS: Record<string, string[]> = {
  키맨: [
    "\"안녕하세요, 퍼스트전산 OOO입니다. 담당이 바뀌셨다고 들어 인사드리러 왔습니다.\"",
    "명함을 드리고 \"급하실 때 저에게 바로 연락 주세요\" 한마디 — 첫 통로를 만들어 둡니다.",
    "이전 담당자 이름은 부르지 않습니다. 인수인계가 안 된 경우가 많습니다.",
  ],
  주소: [
    "방문 전 새 주소를 지도에 다시 찍어 확인 — 헛걸음이 제일 큰 손해입니다.",
    "\"이전하셨다고 들었습니다. 기기 위치·전원은 문제 없으셨나요?\" 로 자연스럽게 점검 연결.",
    "주차 조건이 바뀌었을 수 있으니 워킨맵 주차 메모도 같이 고쳐 주세요.",
  ],
  업체명: [
    "서류·명세서에 옛 상호가 남아 있는지 확인해 드리면 신뢰가 확 올라갑니다.",
    "\"상호 변경되신 것 반영해 두겠습니다\" — 이 한마디가 관리받는 느낌을 줍니다.",
  ],
};

// ── 슬라이드 만들기 ────────────────────────────────────────────
type Req = Record<string, unknown>;

/** 한 줄에 넣을 수 있게 줄바꿈을 지우고 길이를 자른다 */
function clipText(value: string, max: number): string {
  const one = String(value || "").replace(/\s*\n\s*/g, " · ").replace(/\s+/g, " ").trim().replace(/^[:;,.\-·]+\s*/, "");
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * 슬라이드 텍스트 상자는 안쪽 여백(좌우 7.2PT, 위아래 3.6PT)이 강제로 붙는다 — API로 못 끈다.
 * 그래서 좌표를 그만큼 밀어, 우리가 적은 x·y에 글자가 정확히 오게 한다.
 */
function T(id: string, x: number, y: number, w: number, h: number, text: string, opts: Parameters<typeof textBox>[6], pageId: string): Req[] {
  return textBox(id, x - 7.2, y - 3.6, w + 14.4, h + 7.2, text, opts, pageId);
}

function textBox(id: string, x: number, y: number, w: number, h: number, text: string, opts: {
  size: number; bold?: boolean; color?: { red: number; green: number; blue: number };
  align?: "START" | "CENTER" | "END"; font?: string; lineSpacing?: number;
}, pageId: string): Req[] {
  const reqs: Req[] = [
    { createShape: { objectId: id, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: pageId, size: { width: { magnitude: w, unit: "PT" }, height: { magnitude: h, unit: "PT" } }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "PT" } } } },
    { insertText: { objectId: id, text } },
    {
      updateTextStyle: {
        objectId: id, textRange: { type: "ALL" },
        style: {
          fontFamily: opts.font || "Noto Sans KR",
          fontSize: { magnitude: opts.size, unit: "PT" },
          bold: !!opts.bold,
          foregroundColor: { opaqueColor: { rgbColor: opts.color || WHITE } },
        },
        fields: "fontFamily,fontSize,bold,foregroundColor",
      },
    },
    { updateParagraphStyle: { objectId: id, textRange: { type: "ALL" }, style: { alignment: opts.align || "START", lineSpacing: opts.lineSpacing || 100, spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" } }, fields: "alignment,lineSpacing,spaceAbove,spaceBelow" } },
    { updateShapeProperties: { objectId: id, shapeProperties: { autofit: { autofitType: "NONE" }, contentAlignment: "TOP" }, fields: "contentAlignment" } },
  ];
  return reqs;
}

function rect(id: string, x: number, y: number, w: number, h: number, fill: { red: number; green: number; blue: number }, pageId: string, alpha = 1, shape = "ROUND_RECTANGLE"): Req[] {
  return [
    { createShape: { objectId: id, shapeType: shape, elementProperties: { pageObjectId: pageId, size: { width: { magnitude: w, unit: "PT" }, height: { magnitude: h, unit: "PT" } }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "PT" } } } },
    { updateShapeProperties: { objectId: id, shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: fill }, alpha } }, outline: { propertyState: "NOT_RENDERED" } }, fields: "shapeBackgroundFill,outline" } },
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "preview");
    if (action === "checkfolder") {
      const token = await accessToken();
      const id = String(body.folder || FOLDER_ID);
      const res = await fetch(`${DRIVE}/${id}?fields=id,name,mimeType,driveId,capabilities(canAddChildren)&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      return Response.json({ ok: res.ok, status: res.status, folder: id, detail: text.slice(0, 400) }, { headers: jsonHeaders });
    }
    // GIF 인코딩이 이 런타임에서 되는지 확인용 (한 번만 쓰고 지워도 되는 진단)
    if (action === "gifselftest") {
      const { Image, GIF, Frame } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
      const mk = (r: number, g: number, b: number) => {
        const img = new Image(160, 90);
        img.fill(Image.rgbToColor(r, g, b));
        return Frame.from(img, 60); // 0.6초
      };
      const gif = new GIF([mk(20, 35, 60), mk(37, 99, 235), mk(15, 185, 129)], -1);
      const bytes = await gif.encode();
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      const up = await fetch(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/photos/keyman/_selftest.gif`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "image/gif", "x-upsert": "true" },
        body: bytes,
      });
      return Response.json({ ok: up.ok, bytes: bytes.byteLength, status: up.status,
        url: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/photos/keyman/_selftest.gif` }, { headers: jsonHeaders });
    }
    if (action === "whoami") {
      const sa = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT") || "{}");
      return Response.json({ ok: true, client_email: sa.client_email || "(없음)", note: "이 주소를 슬라이드 파일 편집자로 공유해 주세요" }, { headers: jsonHeaders });
    }
    const week = lastWeekRange(typeof body.base === "string" ? body.base : undefined);
    const SENT_KEY = "KEYMAN_POSTER_SENT"; // 사진으로 보낸 주(=지난주 시작일). PC 자동전송이 성공하면 여기 적는다.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const restBase = `${Deno.env.get("SUPABASE_URL")}/rest/v1`;
    const restHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

    // 이번 주 발송 여부 — PC 스크립트가 먼저 물어보고 중복 발송을 피한다
    if (action === "status") {
      const cfg = await (await fetch(`${restBase}/app_config?select=key,value&key=eq.${SENT_KEY}`, { headers: restHeaders })).json();
      const sent = (Array.isArray(cfg) ? cfg : [])[0]?.value || "";
      return Response.json({ ok: true, week, sent, already: String(sent) === week.from }, { headers: jsonHeaders });
    }
    // PC(카톡 자동전송)가 이미 사진으로 보냈다고 표시하는 창구
    if (action === "mark") {
      await fetch(`${restBase}/app_config`, {
        method: "POST",
        headers: { ...restHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: SENT_KEY, value: week.from }),
      });
      return Response.json({ ok: true, marked: week.from }, { headers: jsonHeaders });
    }
    // 서버 발송은 안전망이다 — PC가 사진으로 이미 보냈으면 건너뛴다(같은 내용 두 번 가지 않게)
    if (action === "run" && body.ifMissing) {
      const cfg = await (await fetch(`${restBase}/app_config?select=key,value&key=eq.${SENT_KEY}`, { headers: restHeaders })).json();
      const sent = (Array.isArray(cfg) ? cfg : [])[0]?.value;
      if (String(sent || "") === week.from) {
        return Response.json({ ok: true, skipped: "PC가 이미 사진으로 발송함", week }, { headers: jsonHeaders });
      }
    }

    // ── 지난주 변경 읽기
    const rows: ChangeRow[] = await (await fetch(
      `${restBase}/contact_changes?select=id,change_date,company,region,category,reason,grade,before_text,after_text,notes,author,greeting_done,greeting_by&change_date=gte.${week.from}&change_date=lte.${week.to}&order=change_date.asc&limit=1000`,
      { headers: restHeaders },
    )).json();

    const wanted = String(body.region || "").toUpperCase();
    const byRegion = new Map<string, ChangeRow[]>();
    for (const row of Array.isArray(rows) ? rows : []) {
      const letter = letterOf(row.region);
      if (!letter) continue;
      if (wanted && letter !== wanted) continue;
      byRegion.set(letter, [...(byRegion.get(letter) || []), row]);
    }
    if (!byRegion.size) return Response.json({ ok: true, week, note: "지난주 변경 없음", regions: [] }, { headers: jsonHeaders });

    const token = await accessToken();
    let queuedAny = false;
    const out: Array<{ region: string; url: string; gif?: string; poster?: string; page?: string; counts: Record<string, number>; room?: string; queued?: boolean; text?: string }> = [];

    for (const [letter, list] of byRegion) {
      const persons = dedupe(list.filter(isPerson));
      const addresses = dedupe(list.filter(isAddress));
      const names = dedupe(list.filter(isName));

      // ── 공유 폴더 안에 슬라이드 1장 만들기 (서비스 계정 단독 생성은 권한이 없다)
      const create = await fetch(`${DRIVE}?supportsAllDrives=true`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: `키맨안내_${letter}_${week.from}`, mimeType: "application/vnd.google-apps.presentation", parents: [FOLDER_ID] }),
      });
      if (!create.ok) return Response.json({ error: `파일 생성 실패(${create.status}) ${(await create.text()).slice(0, 300)}` }, { status: 502, headers: jsonHeaders });
      const presentationId = (await create.json()).id as string;
      // 새 파일의 실제 페이지 크기·첫 장 id를 읽어 그 크기에 맞춰 그린다 (기본은 16:9 720×405PT)
      const info = await (await fetch(`${SLIDES}/${presentationId}?fields=slides(objectId),pageSize`, { headers: { Authorization: `Bearer ${token}` } })).json();
      const pageId = info.slides?.[0]?.objectId as string;
      // pageSize는 EMU로 온다(9144000 = 720PT). 우리 좌표는 PT라서 반드시 환산해야 한다 —
      // 안 하면 W로 계산한 요소가 전부 화면 밖으로 나가 "본문이 안 보이는" 그림이 나온다(실측 사고).
      const toPt = (dim: { magnitude?: number; unit?: string } | undefined, fallback: number) => {
        const m = Number(dim?.magnitude || 0);
        if (!m) return fallback;
        return Math.round(dim?.unit === "EMU" ? m / 12700 : m);
      };
      const W = toPt(info.pageSize?.width, 720);
      const H = toPt(info.pageSize?.height, 405);
      if (!pageId) return Response.json({ error: "새 슬라이드의 첫 장을 못 찾았습니다" }, { status: 502, headers: jsonHeaders });

      const items = [
        ...persons.map((row) => ({ row, kind: "키맨" as const })),
        ...addresses.map((row) => ({ row, kind: "주소" as const })),
        ...names.map((row) => ({ row, kind: "업체명" as const })),
      ];
      // 움직이는 브리핑(GIF): 슬라이드를 여러 장 만들어 한 장씩 넘어가게 한다
      const animate = action === "gif" || body.gif === true;
      const frameItems = items.slice(0, 4);
      const framePages: string[] = [];

      const reqs: Req[] = [];
      let seq = 0;
      const nid = () => `obj_${letter}_${String(seq++).padStart(3, "0")}`; // 슬라이드 objectId는 5자 이상이어야 한다

      if (animate) {
        for (let i = 0; i < frameItems.length + 2; i++) { // 표지 + 곳마다 + 마무리
          const id = `frm_${letter}_${i}`;
          framePages.push(id);
          reqs.push({ createSlide: { objectId: id, insertionIndex: i + 1, slideLayoutReference: { predefinedLayout: "BLANK" } } });
        }
      }

      // ── 판형 720×405PT(→PNG 1600×900)
      //   위: 다크 헤더바에 큰 숫자(몇 곳 인사해야 하는지) / 가운데: 곳마다 카드 한 장 / 아래: 인사 문구 띠
      const PAD = 34;
      const GAP = 14;
      const HEAD = 96;
      const FOOT = 52;

      reqs.push({ updatePageProperties: { objectId: pageId, pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: WHITE } } } }, fields: "pageBackgroundFill" } });

      // ── 헤더바
      reqs.push(...rect(nid(), 0, 0, W, HEAD, NAVY, pageId, 1, "RECTANGLE"));
      reqs.push(...rect(nid(), PAD, HEAD - 4, 84, 4, BLUE, pageId, 1, "RECTANGLE")); // 짧은 강조선
      reqs.push(...T(nid(), PAD, 24, 520, 26, `${letter}지역 · 주간 키맨 브리핑`, { size: 19, bold: true, color: WHITE }, pageId));
      reqs.push(...T(nid(), PAD, 56, 520, 16, `${week.label} 접수분 · 방문하시면 인사 한마디 부탁드립니다`, { size: 10, color: NAVY_SUB }, pageId));
      // 오른쪽: 몇 곳인지 크게
      reqs.push(...T(nid(), W - PAD - 120, 20, 92, 48, String(items.length), { size: 38, bold: true, color: WHITE, align: "END" }, pageId));
      reqs.push(...T(nid(), W - PAD - 24, 38, 24, 22, "곳", { size: 13, bold: true, color: NAVY_SUB }, pageId));
      reqs.push(...T(nid(), W - PAD - 160, 66, 160, 14, items.length ? "이번 주 인사 대상" : "지난주 변경 없음", { size: 9.5, color: NAVY_SUB, align: "END" }, pageId));

      // ── 카드 (한 곳에 한 장)
      const shown = items.slice(0, 4);
      const cardW = (W - PAD * 2 - GAP) / 2;
      const perRow = 2;
      const rowsN = Math.max(1, Math.ceil(shown.length / perRow));
      const bodyTop = HEAD + 18;
      const bodyH = H - FOOT - 12 - bodyTop;
      const cardH = Math.min(138, (bodyH - (rowsN - 1) * GAP) / rowsN);
      const gridTop = bodyTop + Math.max(0, (bodyH - (cardH * rowsN + GAP * (rowsN - 1))) / 2);

      shown.forEach((it, i) => {
        // 홀수로 남는 마지막 장은 두 칸 폭으로 늘려 빈칸을 없앤다
        const wideLast = perRow === 2 && i === shown.length - 1 && i % 2 === 0;
        const w = wideLast ? W - PAD * 2 : cardW;
        const roomy = wideLast || shown.length === 1;
        const x = PAD + (i % perRow) * (cardW + GAP);
        const y = gridTop + Math.floor(i / perRow) * (cardH + GAP);
        reqs.push(...rect(nid(), x, y, w, cardH, CARD, pageId));

        // 카드가 낮으면 '이전' 줄을 빼고 위쪽으로 모은다 — 글이 겹치지 않게 좌표를 높이에서 뽑는다
        const tight = cardH < 126;
        const yCompany = y + (tight ? 36 : 42);
        const yHero = y + (tight ? 51 : 60);
        const ySub = y + (tight ? 78 : 90);
        const heroSize = tight ? 17.5 : 21;

        const tone = it.kind === "키맨" ? BLUE : it.kind === "주소" ? MINT : SUB;
        const chipW = 44;
        reqs.push(...rect(nid(), x + 18, y + 14, chipW, 18, tone, pageId));
        reqs.push(...T(nid(), x + 18, y + 18, chipW, 12, it.kind, { size: 8, bold: true, color: WHITE, align: "CENTER" }, pageId));
        const grade = gradeLabel(it.row.grade);
        reqs.push(...T(nid(), x + w - 170, y + 16, 152, 14,
          [dayLabel(it.row.change_date), grade, clipText(it.row.reason, 10)].filter(Boolean).join("  ·  "),
          { size: 9, bold: true, color: MUTED, align: "END" }, pageId));

        const tx = x + 18;
        const tw = w - 36;
        const wide = roomy ? 2 : 1;
        reqs.push(...T(nid(), tx, yCompany, tw, 15, clipText(it.row.company, 22 * wide), { size: 10.5, bold: true, color: SUB }, pageId));

        if (it.kind === "주소") {
          const a = readAddress(it.row.after_text);
          reqs.push(...T(nid(), tx, yHero, tw, 26, clipText(a.head, 22 * wide) || "새 주소 확인 필요", { size: heroSize - 1, bold: true, color: INK }, pageId));
          reqs.push(...T(nid(), tx, ySub, tw, 14, clipText(a.full, 46 * wide), { size: 9, color: MUTED }, pageId));
          if (!tight && it.row.before_text) {
            reqs.push(...T(nid(), tx, y + cardH - 24, tw, 13, `이전  ${clipText(readAddress(it.row.before_text).full, 46 * wide)}`, { size: 8.5, color: MUTED }, pageId));
          }
        } else if (it.kind === "업체명") {
          reqs.push(...T(nid(), tx, yHero, tw, 28, clipText(it.row.after_text, 18 * wide) || "새 상호 확인 필요", { size: heroSize, bold: true, color: INK }, pageId));
          reqs.push(...T(nid(), tx, ySub, tw, 14, `이전 상호  ${clipText(it.row.before_text, 30 * wide)}`, { size: 9, color: MUTED }, pageId));
        } else {
          const person = readPerson(it.row.after_text);
          reqs.push(...T(nid(), tx, yHero, tw, 30, person.name || "새 담당자", { size: heroSize, bold: true, color: INK }, pageId));
          reqs.push(...T(nid(), tx, ySub, tw, 16, [person.phone, person.note].filter(Boolean).join("   ") || "연락처 확인 필요",
            { size: 11.5, bold: true, color: BLUE }, pageId));
          if (!tight && it.row.before_text) {
            const before = readPerson(it.row.before_text);
            reqs.push(...T(nid(), tx, y + cardH - 24, tw, 13, `이전  ${[before.name, before.phone].filter(Boolean).join("  ")}`, { size: 9, color: MUTED }, pageId));
          }
        }
      });

      if (!shown.length) {
        reqs.push(...T(nid(), PAD, bodyTop + 40, W - PAD * 2, 24, "지난주에 접수된 담당자·주소 변경이 없습니다 — 평소처럼 방문하시면 됩니다",
          { size: 13, bold: true, color: SUB, align: "CENTER" }, pageId));
      }

      // ── 아래 띠: 인사 문구 + 남은 곳 안내
      const kinds = [persons.length ? "키맨" : "", addresses.length ? "주소" : "", names.length ? "업체명" : ""].filter(Boolean);
      const tipKey = kinds[0] || "키맨";
      const tip = (GREETING_TIPS[tipKey] || [])[0] || "";
      const footTop = H - FOOT;
      reqs.push(...rect(nid(), PAD, footTop, W - PAD * 2, 40, BAND, pageId));
      reqs.push(...T(nid(), PAD + 18, footTop + 8, 90, 12, `인사 한마디`, { size: 8.5, bold: true, color: BLUE }, pageId));
      reqs.push(...T(nid(), PAD + 18, footTop + 21, W - PAD * 2 - 200, 14, tip, { size: 10, color: INK }, pageId));
      const more = items.length > shown.length ? `외 ${items.length - shown.length}곳은 앱에서 · ` : "";
      reqs.push(...T(nid(), W - PAD - 250, footTop + 15, 232, 13, `${more}인사 후 🤝 버튼으로 표시`, { size: 8.5, color: MUTED, align: "END" }, pageId));

      // ── 움직이는 브리핑 프레임 (한 화면에 한 가지만, 폰에서 읽히도록 크게)
      if (animate) {
        const bg = (page: string, color: typeof NAVY) =>
          reqs.push({ updatePageProperties: { objectId: page, pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: color } } } }, fields: "pageBackgroundFill" } });

        // 표지
        const cover = framePages[0];
        bg(cover, NAVY);
        reqs.push(...rect(nid(), PAD, 96, 84, 5, BLUE, cover, 1, "RECTANGLE"));
        reqs.push(...T(nid(), PAD, 58, 400, 16, "W E E K L Y   B R I E F I N G", { size: 9.5, bold: true, color: NAVY_SUB }, cover));
        reqs.push(...T(nid(), PAD, 112, 420, 60, `${letter}지역`, { size: 46, bold: true, color: WHITE }, cover));
        reqs.push(...T(nid(), PAD, 176, 420, 30, "주간 키맨 브리핑", { size: 21, bold: true, color: NAVY_SUB }, cover));
        reqs.push(...T(nid(), PAD, 214, 420, 20, `${week.label} 접수분`, { size: 12, color: NAVY_SUB }, cover));
        reqs.push(...T(nid(), W - PAD - 300, 92, 250, 130, String(items.length), { size: 108, bold: true, color: WHITE, align: "END" }, cover));
        reqs.push(...T(nid(), W - PAD - 44, 158, 44, 40, "곳", { size: 26, bold: true, color: NAVY_SUB }, cover));
        reqs.push(...T(nid(), W - PAD - 320, 232, 320, 22, items.length ? "이번 주 인사 대상" : "지난주 변경 없음", { size: 13, bold: true, color: NAVY_SUB, align: "END" }, cover));
        reqs.push(...T(nid(), PAD, H - 46, 500, 18, "방문하시면 인사 한마디 부탁드립니다 · 퍼스트전산 CS", { size: 11, color: NAVY_SUB }, cover));

        // 곳마다 한 화면
        frameItems.forEach((it, i) => {
          const page = framePages[i + 1];
          bg(page, WHITE);
          const tone = it.kind === "키맨" ? BLUE : it.kind === "주소" ? MINT : SUB;
          reqs.push(...rect(nid(), 0, 0, 12, H, tone, page, 1, "RECTANGLE"));

          reqs.push(...rect(nid(), PAD, 34, 56, 22, tone, page));
          reqs.push(...T(nid(), PAD, 39, 56, 14, it.kind, { size: 9.5, bold: true, color: WHITE, align: "CENTER" }, page));
          reqs.push(...T(nid(), W - PAD - 200, 30, 200, 32, dayLabel(it.row.change_date), { size: 22, bold: true, color: MUTED, align: "END" }, page));
          reqs.push(...T(nid(), W - PAD - 220, 62, 220, 18,
            [gradeLabel(it.row.grade), clipText(it.row.reason, 12), it.row.author].filter(Boolean).join("  ·  "),
            { size: 11, color: MUTED, align: "END" }, page));

          reqs.push(...T(nid(), PAD, 74, W - PAD * 2, 22, clipText(it.row.company, 34), { size: 15, bold: true, color: SUB }, page));

          if (it.kind === "주소") {
            const a = readAddress(it.row.after_text);
            reqs.push(...T(nid(), PAD, 100, W - PAD * 2, 56, clipText(a.head, 20) || "새 주소 확인 필요", { size: 38, bold: true, color: INK }, page));
            reqs.push(...T(nid(), PAD, 162, W - PAD * 2, 24, a.full, { size: 15, color: SUB }, page));
            if (it.row.before_text) {
              reqs.push(...T(nid(), PAD, 196, W - PAD * 2, 20, `이전  ${readAddress(it.row.before_text).full}`, { size: 12.5, color: MUTED }, page));
            }
          } else if (it.kind === "업체명") {
            reqs.push(...T(nid(), PAD, 100, W - PAD * 2, 58, clipText(it.row.after_text, 18) || "새 상호 확인 필요", { size: 40, bold: true, color: INK }, page));
            reqs.push(...T(nid(), PAD, 168, W - PAD * 2, 22, `이전 상호  ${clipText(it.row.before_text, 30)}`, { size: 14, color: MUTED }, page));
          } else {
            const person = readPerson(it.row.after_text);
            reqs.push(...T(nid(), PAD, 98, W - PAD * 2, 62, person.name || "새 담당자", { size: 44, bold: true, color: INK }, page));
            reqs.push(...T(nid(), PAD, 166, W - PAD * 2, 28, person.phone || "연락처 확인 필요", { size: 22, bold: true, color: BLUE }, page));
            if (person.note) reqs.push(...T(nid(), PAD, 198, W - PAD * 2, 20, person.note, { size: 12.5, color: SUB }, page));
            if (it.row.before_text) {
              const before = readPerson(it.row.before_text);
              reqs.push(...T(nid(), PAD, 224, W - PAD * 2, 20,
                `이전  ${[before.name, before.phone].filter(Boolean).join("  ")}`, { size: 12.5, color: MUTED }, page));
            }
          }

          // 아래 띠: 그 종류에 맞는 인사 문구 + 몇 번째인지
          const line = (GREETING_TIPS[it.kind] || [])[0] || "";
          reqs.push(...rect(nid(), 0, H - 76, W, 76, BAND, page, 1, "RECTANGLE"));
          reqs.push(...T(nid(), PAD, H - 60, 200, 16, "인사 한마디", { size: 10, bold: true, color: BLUE }, page));
          reqs.push(...T(nid(), PAD, H - 42, W - PAD * 2 - 110, 22, line, { size: 13.5, color: INK }, page));
          reqs.push(...T(nid(), W - PAD - 110, H - 58, 110, 20, `${i + 1} / ${frameItems.length}`, { size: 13, bold: true, color: MUTED, align: "END" }, page));
        });

        // 마무리
        const last = framePages[framePages.length - 1];
        bg(last, NAVY);
        reqs.push(...rect(nid(), PAD, 92, 84, 5, BLUE, last, 1, "RECTANGLE"));
        reqs.push(...T(nid(), PAD, 56, 500, 20, "H O W   T O   G R E E T", { size: 9.5, bold: true, color: NAVY_SUB }, last));
        reqs.push(...T(nid(), PAD, 108, W - PAD * 2, 40, "방문하시면 이렇게 한마디", { size: 28, bold: true, color: WHITE }, last));
        const closing = [
          persons.length ? (GREETING_TIPS["키맨"] || [])[0] : "",
          addresses.length ? (GREETING_TIPS["주소"] || [])[0] : "",
          names.length ? (GREETING_TIPS["업체명"] || [])[0] : "",
          (GREETING_TIPS["키맨"] || [])[1],
        ].filter(Boolean).slice(0, 3);
        reqs.push(...T(nid(), PAD, 162, W - PAD * 2, 120, closing.map((t) => `· ${t}`).join("\n"), { size: 14, color: NAVY_SUB, lineSpacing: 150 }, last));
        reqs.push(...T(nid(), PAD, H - 52, 520, 20, "인사 후 FIELD·워킨맵에서 🤝 버튼으로 표시해 주세요", { size: 12, color: NAVY_SUB }, last));
        reqs.push(...T(nid(), W - PAD - 220, H - 52, 220, 20, "퍼스트전산 CS", { size: 12, bold: true, color: WHITE, align: "END" }, last));
      }

      const batch = await fetch(`${SLIDES}/${presentationId}:batchUpdate`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: reqs }),
      });
      if (!batch.ok) return Response.json({ error: `슬라이드 작성 실패(${batch.status}) ${(await batch.text()).slice(0, 400)}` }, { status: 502, headers: jsonHeaders });
      if (body.debug) {
        const replies = (await batch.json()).replies || [];
        const state = await (await fetch(`${SLIDES}/${presentationId}?fields=slides(pageElements(objectId,shape(shapeType,text(textElements(textRun(content))))))`, { headers: { Authorization: `Bearer ${token}` } })).json();
        const els = state.slides?.[0]?.pageElements || [];
        return Response.json({
          ok: true, debug: true, requests: reqs.length, replies: replies.length, elements: els.length,
          W, H, sample: els.slice(0, 40).map((e: Record<string, unknown>) => ({
            id: e.objectId,
            type: (e.shape as { shapeType?: string } | undefined)?.shapeType,
            text: ((e.shape as { text?: { textElements?: Array<{ textRun?: { content?: string } }> } } | undefined)?.text?.textElements || []).map((t) => t.textRun?.content || "").join("").trim().slice(0, 24),
          })),
        }, { headers: jsonHeaders });
      }

      // ── 슬라이드 → PNG 썸네일
      // 좌표 사고를 겪은 뒤로는 한 번에 잘 나온다. 그래도 첫 장은 3초 기다리고, 너무 작으면 한 번 더 받는다.
      const shot = async (page: string): Promise<Uint8Array | null> => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const thumb = await fetch(`${SLIDES}/${presentationId}/pages/${page}/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (thumb.ok) {
            const { contentUrl } = await thumb.json();
            const buf = new Uint8Array(await (await fetch(contentUrl)).arrayBuffer());
            if (buf.byteLength > 8000) return buf;   // 8KB 미만이면 아직 덜 그려진 그림
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        return null;
      };

      await new Promise((resolve) => setTimeout(resolve, 3000));
      const png = await shot(pageId);
      if (!png) return Response.json({ error: "이미지 변환 실패(썸네일을 못 받음)" }, { status: 502, headers: jsonHeaders });

      const store = async (path: string, bytes: Uint8Array, mime: string) => {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/${path}`, {
          method: "POST",
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": mime, "x-upsert": "true" },
          body: bytes,
        });
        return res.ok;
      };

      const pngPath = `keyman/${week.from}_${letter}.png`;
      if (!await store(`photos/${pngPath}`, png, "image/png")) {
        return Response.json({ error: "이미지 저장 실패" }, { status: 502, headers: jsonHeaders });
      }
      let url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/photos/${pngPath}`;
      let gifUrl = "";

      // ── 움직이는 GIF (표지 → 곳마다 → 마무리)
      if (animate && framePages.length) {
        const { Image, GIF, Frame } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
        const frames: InstanceType<typeof Frame>[] = [];
        for (let i = 0; i < framePages.length; i++) {
          const buf = await shot(framePages[i]);
          if (!buf) continue;
          const img = await Image.decode(buf);
          img.resize(880, 495);                       // 파일 크기와 읽기 편함의 균형
          const isCover = i === 0;
          const isLast = i === framePages.length - 1;
          frames.push(Frame.from(img, isCover ? 2200 : isLast ? 3200 : 2800)); // 머무는 시간(ms)
        }
        if (frames.length >= 2) {
          const gif = new GIF(frames, -1);            // -1 = 무한 반복
          const bytes = await gif.encode();
          const gifPath = `keyman/${week.from}_${letter}.gif`;
          if (await store(`photos/${gifPath}`, bytes, "image/gif")) {
            gifUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/photos/${gifPath}`;
            url = gifUrl;                             // 발송은 움직이는 쪽으로
          }
        }
      }

      // 슬라이드 원본은 지운다 (서비스 계정 드라이브에 쌓이지 않게)
      await fetch(`${DRIVE}/${presentationId}?supportsAllDrives=true`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);

      // ── 눌러서 보는 안내문: 우리 도메인의 정적 페이지(public/brief)
      //   Supabase는 저장소·엣지 함수 응답을 text/plain + 샌드박스로 강제해 HTML을 못 띄운다(실측).
      //   그 페이지는 열 때마다 데이터를 직접 읽으므로 링크가 낡지 않는다.
      const posterUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/photos/${pngPath}`;
      const pageUrl = `${APP_URL}/brief/?r=${letter}&w=${week.from}`; // 눌러서 보는 안내문(원하면 문구에 쓸 수 있다)

      const entry: { region: string; url: string; gif?: string; poster?: string; page?: string; counts: Record<string, number>; room?: string; queued?: boolean; text?: string } = {
        region: letter, url, gif: gifUrl || undefined, poster: posterUrl, page: pageUrl || undefined,
        counts: { 키맨: persons.length, 주소: addresses.length, 업체명: names.length },
      };

      if (action === "run") {
        const mapRows = await (await fetch(`${restBase}/room_map?select=region,room&category=eq.${encodeURIComponent("점검")}`, { headers: restHeaders })).json();
        const room = (Array.isArray(mapRows) ? mapRows : []).find((r: { region: string }) => String(r.region).trim().toUpperCase() === letter)?.room;
        if (room) {
          // 봇(알림 답장)은 글자만 보낼 수 있다 — 그림은 PC가 붙여 보내고, 글에는 눌러지는 안내문 링크를 담는다
          const brief = [
            ...persons.map((r) => `🤝 ${clipText(r.company, 16)} — 새 키맨`),
            ...addresses.map((r) => `📍 ${clipText(r.company, 16)} — 주소 변경`),
            ...names.map((r) => `🏷 ${clipText(r.company, 16)} — 업체명 변경`),
          ];
          const shownBrief = brief.slice(0, 6);
          const head = [
            `🗓 ${letter}지역 주간 키맨 브리핑 (${week.label})`,
            ...shownBrief,
            brief.length > shownBrief.length ? `외 ${brief.length - shownBrief.length}곳` : "",
          ].filter(Boolean).join("\n") + "\n\n👇 한 장 요약 (눌러서 크게 보기)";
          const text = `${head}\n${url}`; // url = 사진(정지 이미지). 카톡이 미리보기 썸네일을 붙여 준다
          entry.room = room;
          entry.text = text;
          if (body.dry) { entry.queued = false; } // 실제 발송 없이 방·문구만 확인
          else {
            await fetch(`${restBase}/outbox`, { method: "POST", headers: { ...restHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ room, text }) });
            entry.queued = true;
            queuedAny = true;
          }
        }
      }
      out.push(entry);
    }

    if (queuedAny) {
      // 서버가 보냈다는 표시 — PC가 늦게 켜져도 같은 내용을 또 보내지 않는다
      await fetch(`${restBase}/app_config`, {
        method: "POST",
        headers: { ...restHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: SENT_KEY, value: week.from }),
      });
    }
    return Response.json({ ok: true, week, action, regions: out }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500, headers: jsonHeaders });
  }
});
