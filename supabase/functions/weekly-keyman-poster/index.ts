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
const FOLDER_ID = Deno.env.get("KEYMAN_POSTER_FOLDER") || "1CUtmSkE9gPAP9W0AufQ3wm5x2Oeqlbe7";

// ── 디자인 토큰 ─────────────────────────────────────────────
// 방향: 밝은 편집 디자인(종이 같은 바탕 + 진한 잉크 + 강조색 하나).
// 카드 박스를 쓰지 않고 여백과 얇은 선으로 나눈다 — 카톡 목록에서도 밝아서 눈에 띈다.
const PAPER = { red: 0.969, green: 0.969, blue: 0.961 };   // #F7F7F5 바탕
const INK = { red: 0.086, green: 0.094, blue: 0.114 };     // #16181D 제목·업체명
const INK2 = { red: 0.357, green: 0.376, blue: 0.408 };     // #5B6068 본문
const MUTED = { red: 0.616, green: 0.631, blue: 0.659 };    // #9DA1A8 보조
const RULE = { red: 0.890, green: 0.882, blue: 0.855 };     // #E3E1DA 구분선
const ACCENT = { red: 0.169, green: 0.361, blue: 0.902 };   // #2B5CE6 강조(하나만 쓴다)
const WATERMARK = { red: 0.875, green: 0.871, blue: 0.847 };// #DFDED8 큰 지역 글자
const WHITE = { red: 1, green: 1, blue: 1 };

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
      `${restBase}/contact_changes?select=id,change_date,company,region,category,reason,grade,before_text,after_text,notes,author&change_date=gte.${week.from}&change_date=lte.${week.to}&order=change_date.asc&limit=1000`,
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
    const out: Array<{ region: string; url: string; counts: Record<string, number>; room?: string; queued?: boolean; text?: string }> = [];

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

      const reqs: Req[] = [];
      let seq = 0;
      const nid = () => `obj_${letter}_${String(seq++).padStart(3, "0")}`; // 슬라이드 objectId는 5자 이상이어야 한다

      // 배경 (16:9 가로 판형 — 새로 만든 슬라이드의 기본값. 두 단으로 나눠 담는다)
      reqs.push({ updatePageProperties: { objectId: pageId, pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: INK } } } }, fields: "pageBackgroundFill" } });

      // ── 판형 720×405PT(→PNG 1600×900). 카드 박스 없이 선과 여백으로 나눈다.
      const PAD = 36;

      reqs.push({ updatePageProperties: { objectId: pageId, pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: PAPER } } } }, fields: "pageBackgroundFill" } });

      const rule = (y: number, x = PAD, w = W - PAD * 2, thick = 0.75, color = RULE) =>
        reqs.push(...rect(nid(), x, y, w, thick, color, pageId, 1, "RECTANGLE"));

      // ── 머리말
      reqs.push(...T(nid(), PAD, 26, 300, 12, "W E E K L Y   R E P O R T", { size: 7.5, bold: true, color: MUTED }, pageId));
      reqs.push(...T(nid(), PAD, 40, 460, 30, "지난주 담당자·키맨 변경", { size: 23, bold: true, color: INK }, pageId));
      reqs.push(...T(nid(), PAD, 74, 460, 16, `${week.label} 접수 · 방문하시면 인사 한마디 부탁드립니다`, { size: 10, color: INK2 }, pageId));
      // 오른쪽에 지역 글자를 크게 — 어느 지역 것인지 멀리서도 보인다
      reqs.push(...T(nid(), W - PAD - 140, 18, 140, 72, letter, { size: 58, bold: true, color: WATERMARK, align: "END" }, pageId));
      reqs.push(...T(nid(), W - PAD - 140, 78, 140, 14, `${letter}지역 점검`, { size: 9, bold: true, color: MUTED, align: "END" }, pageId));

      rule(102);

      // 건수는 있는 것만 (0은 적지 않는다 — 줄이 지저분해진다)
      const counts = [
        persons.length ? `키맨 ${persons.length}` : "",
        addresses.length ? `주소 ${addresses.length}` : "",
        names.length ? `업체명 ${names.length}` : "",
      ].filter(Boolean).join("      ");
      reqs.push(...T(nid(), PAD, 111, 320, 14, counts || "지난주 접수된 변경 없음", { size: 9.5, bold: true, color: ACCENT }, pageId));
      reqs.push(...T(nid(), W - PAD - 300, 111, 300, 14,
        persons.length ? "이전 담당자 이름은 부르지 않습니다" : addresses.length ? "방문 전 새 주소를 다시 확인해 주세요" : "서류의 옛 상호도 함께 확인해 주세요",
        { size: 9, color: MUTED, align: "END" }, pageId));

      // ── 목록
      const items = [
        ...persons.map((row) => ({ row, kind: "키맨", tone: "solid" as const })),
        ...addresses.map((row) => ({ row, kind: "주소", tone: "tint" as const })),
        ...names.map((row) => ({ row, kind: "업체명", tone: "plain" as const })),
      ];
      const shown = items.slice(0, 5);
      const TIP_MIN = 56;   // 인사 블록 최소 높이 — 남는 공간은 이 블록이 흡수한다
      const listTop = 130;
      const listBottom = H - 26 - 14 - TIP_MIN;
      const rowH = shown.length ? Math.min(74, Math.max(34, (listBottom - listTop) / shown.length)) : 0;
      const roomy = rowH >= 56;                 // 넉넉하면 '이전'까지 보여준다
      const contentH = roomy ? 54 : 36;         // 글 묶음 높이 — 행 안에서 세로 가운데로 놓는다

      shown.forEach((it, i) => {
        const y = listTop + i * rowH;
        if (i > 0) rule(y - 0.4, PAD, W - PAD * 2, 0.6);
        const mid = y + rowH / 2 - 2;

        // 구분 라벨 — 색은 하나만 쓰고, 채움·연한 채움·없음으로 종류를 구분한다
        const pillW = 42;
        if (it.tone === "solid") reqs.push(...rect(nid(), PAD, mid - 9, pillW, 18, ACCENT, pageId, 1));
        else if (it.tone === "tint") reqs.push(...rect(nid(), PAD, mid - 9, pillW, 18, ACCENT, pageId, 0.12));
        else reqs.push(...rect(nid(), PAD, mid - 9, pillW, 18, INK, pageId, 0.06));
        reqs.push(...T(nid(), PAD, mid - 5, pillW, 12, it.kind,
          { size: 8, bold: true, color: it.tone === "solid" ? WHITE : it.tone === "tint" ? ACCENT : INK2, align: "CENTER" }, pageId));

        const tx = PAD + pillW + 14;
        const dateW = 92;
        const tw = W - PAD - tx - dateW - 12;
        const grade = gradeLabel(it.row.grade);
        if (grade) reqs.push(...T(nid(), PAD, mid + 12, pillW, 11, grade, { size: 7.5, color: MUTED, align: "CENTER" }, pageId));
        const top = y + (rowH - contentH) / 2;
        reqs.push(...T(nid(), tx, top, tw, 20, clipText(it.row.company, 26), { size: roomy ? 14.5 : 13, bold: true, color: INK }, pageId));
        reqs.push(...T(nid(), tx, top + (roomy ? 21 : 18), tw, 16,
          clipText(it.row.after_text, 44) || "새 정보 없음 — 방문 시 확인 부탁드립니다", { size: 10.5, color: INK2 }, pageId));
        if (roomy && it.row.before_text) {
          reqs.push(...T(nid(), tx, top + 39, tw, 14, `이전  ${clipText(it.row.before_text, 46)}`, { size: 9, color: MUTED }, pageId));
        }
        // 오른쪽: 접수일·사유
        reqs.push(...T(nid(), W - PAD - dateW, top + 1, dateW, 14, dayLabel(it.row.change_date), { size: 10, bold: true, color: INK2, align: "END" }, pageId));
        reqs.push(...T(nid(), W - PAD - dateW - 60, top + (roomy ? 19 : 17), dateW + 60, 13,
          [clipText(it.row.reason, 14), it.row.author].filter(Boolean).join(" · "), { size: 8.5, color: MUTED, align: "END" }, pageId));
      });

      let listUsed = listTop + shown.length * rowH;
      if (items.length > shown.length) {
        reqs.push(...T(nid(), PAD, listUsed + 6, 400, 14, `외 ${items.length - shown.length}곳 — 앱 통합이력에서 확인`, { size: 9, color: MUTED }, pageId));
        listUsed += 22;
      }

      // ── 인사 한마디 (한 가지만, 그 주에 가장 많이 들어온 종류로)
      const kinds = [
        persons.length ? "키맨" : "",
        addresses.length ? "주소" : "",
        names.length ? "업체명" : "",
      ].filter(Boolean);
      const tipKey = kinds[0] || "키맨";
      const tipTop = Math.min(H - 26 - TIP_MIN, listUsed + 16);
      const tipH = H - 26 - tipTop;
      const howMany = Math.max(1, Math.min(3, Math.floor((tipH - 26) / 24)));
      // 여러 종류가 들어온 주에는 종류별로 한 줄씩 (키맨 문구만 나오면 주소 온 곳은 도움이 안 된다)
      const tips = kinds.length > 1
        ? kinds.map((kind) => `${kind} · ${(GREETING_TIPS[kind] || [])[0] || ""}`).filter((t) => t.length > 6).slice(0, howMany)
        : (GREETING_TIPS[tipKey] || []).slice(0, howMany);
      if (tips.length) {
        reqs.push(...rect(nid(), PAD, tipTop, W - PAD * 2, tipH, ACCENT, pageId, 0.07));
        reqs.push(...T(nid(), PAD + 18, tipTop + 12, 240, 12, kinds.length > 1 ? "인사 한마디" : `인사 한마디 · ${tipKey} 변경`, { size: 8.5, bold: true, color: ACCENT }, pageId));
        reqs.push(...T(nid(), PAD + 18, tipTop + 30, W - PAD * 2 - 36, tipH - 36,
          tips.join("\n"), { size: tips.length > 1 ? 10.5 : 11, color: INK, lineSpacing: 135 }, pageId));
      }

      // ── 꼬리말
      reqs.push(...T(nid(), PAD, H - 20, 400, 12, "인사 후 FIELD·워킨맵에서 🤝 버튼으로 표시", { size: 8, color: MUTED }, pageId));
      reqs.push(...T(nid(), W - PAD - 240, H - 20, 240, 12, "퍼스트전산 CS", { size: 8, bold: true, color: MUTED, align: "END" }, pageId));

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

      // PNG 썸네일 → 저장소
      // 구글은 썸네일을 비동기로 만들어, 방금 그린 요소가 빠진 그림이 오는 일이 있다(실측). 그래서
      // 잠시 기다린 뒤 여러 번 받아 "가장 큰(=요소가 다 들어간) 파일"을 고른다. 주 1회 작업이라 몇 초는 문제없다.
      let png: ArrayBuffer | null = null;
      let bestSize = 0;
      for (let attempt = 1; attempt <= Number(body.tries || 4); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 8000 : 7000));
        const thumb = await fetch(`${SLIDES}/${presentationId}/pages/${pageId}/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!thumb.ok) continue;
        const { contentUrl } = await thumb.json();
        const buf = await (await fetch(contentUrl)).arrayBuffer();
        if (buf.byteLength > bestSize) { bestSize = buf.byteLength; png = buf; }
        // 두 번 연속 같은 크기면 렌더가 끝난 것으로 본다
        if (attempt >= 2 && buf.byteLength === bestSize) break;
      }
      if (!png) return Response.json({ error: "이미지 변환 실패(썸네일을 못 받음)" }, { status: 502, headers: jsonHeaders });
      const path = `keyman/${week.from}_${letter}.png`;
      const up = await fetch(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/photos/${path}`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "image/png", "x-upsert": "true" },
        body: new Uint8Array(png as ArrayBuffer),
      });
      if (!up.ok) return Response.json({ error: `이미지 저장 실패(${up.status})` }, { status: 502, headers: jsonHeaders });
      const url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/photos/${path}`;

      // 슬라이드 원본은 지운다 (서비스 계정 드라이브에 쌓이지 않게)
      await fetch(`${DRIVE}/${presentationId}?supportsAllDrives=true`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);

      const entry: { region: string; url: string; counts: Record<string, number>; room?: string; queued?: boolean; text?: string } = {
        region: letter, url, counts: { 키맨: persons.length, 주소: addresses.length, 업체명: names.length },
      };

      if (action === "run") {
        const mapRows = await (await fetch(`${restBase}/room_map?select=region,room&category=eq.${encodeURIComponent("점검")}`, { headers: restHeaders })).json();
        const room = (Array.isArray(mapRows) ? mapRows : []).find((r: { region: string }) => String(r.region).trim().toUpperCase() === letter)?.room;
        if (room) {
          const cfg = await (await fetch(`${restBase}/app_config?select=key,value&key=eq.KAKAO_IMAGE_SEND`, { headers: restHeaders })).json();
          const imageMode = (Array.isArray(cfg) ? cfg : []).some((r: { value: string }) => /on|true|1/i.test(String(r.value)));
          // 봇이 이미지 전송을 지원하면 #사진# 표시로 보내고(봇이 내려받아 사진으로 전송), 아니면 링크로 보낸다
          const brief = [
            ...persons.map((r) => `🤝 ${clipText(r.company, 16)} — 새 키맨`),
            ...addresses.map((r) => `📍 ${clipText(r.company, 16)} — 주소 변경`),
            ...names.map((r) => `🏷 ${clipText(r.company, 16)} — 업체명 변경`),
          ];
          const shownBrief = brief.slice(0, 6);
          const head = [
            `📸 ${letter}지역 지난주 담당자·주소 변경 (${week.label})`,
            ...shownBrief,
            brief.length > shownBrief.length ? `외 ${brief.length - shownBrief.length}건` : "",
            "자세한 내용·인사 문구는 아래 한 장 이미지에 정리했습니다 👇",
          ].filter(Boolean).join("\n");
          const text = imageMode ? `#사진#${url}\n${head}` : `${head}\n${url}`;
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
