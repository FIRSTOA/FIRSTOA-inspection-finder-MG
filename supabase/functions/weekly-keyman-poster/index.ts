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

// ── 디자인 토큰 (한 곳에서 관리) ──────────────────────────────────
const INK = { red: 0.086, green: 0.106, blue: 0.133 };        // #161B22 배경
const INK_SOFT = { red: 0.129, green: 0.157, blue: 0.196 };   // 카드
const AMBER = { red: 0.976, green: 0.647, blue: 0.106 };      // 키맨(강조)
const SKY = { red: 0.353, green: 0.686, blue: 0.925 };        // 주소
const MINT = { red: 0.204, green: 0.827, blue: 0.600 };       // 업체명
const WHITE = { red: 1, green: 1, blue: 1 };
const MUTED = { red: 0.612, green: 0.639, blue: 0.686 };

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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const restBase = `${Deno.env.get("SUPABASE_URL")}/rest/v1`;
    const restHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

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

      // ── 판형: 16:9 가로(720×405PT → PNG 1600×900). 내용이 적어도 아래가 비지 않게
      //    카드 높이와 인사 문구 칸이 남는 공간을 나눠 갖는다.
      const PAD = 24;
      const GAP = 10;
      const BAND = 64;

      // ── 헤더 띠
      reqs.push(...rect(nid(), 0, 0, W, BAND, INK_SOFT, pageId, 1, "RECTANGLE"));
      reqs.push(...rect(nid(), 0, BAND, W, 2, AMBER, pageId, 1, "RECTANGLE"));
      reqs.push(...rect(nid(), PAD, 16, 64, 31, AMBER, pageId));
      reqs.push(...textBox(nid(), PAD, 23, 64, 20, `${letter}지역`, { size: 13.5, bold: true, color: INK, align: "CENTER" }, pageId));
      reqs.push(...textBox(nid(), PAD + 78, 11, 400, 24, "지난주 담당자·키맨 변경", { size: 17, bold: true }, pageId));
      reqs.push(...textBox(nid(), PAD + 80, 38, 400, 16, `${week.label} 접수분 · 방문하시면 인사 한마디 부탁드립니다`, { size: 9.5, color: MUTED }, pageId));

      // 헤더 오른쪽 요약 칩 (키맨·주소·업체명)
      const CHIP_W = 76;
      const chips = [
        { label: "키맨", n: persons.length, color: AMBER },
        { label: "주소", n: addresses.length, color: SKY },
        { label: "업체명", n: names.length, color: MINT },
      ];
      chips.forEach((chip, i) => {
        const cx = W - PAD - (chips.length - i) * (CHIP_W + 8) + 8;
        reqs.push(...rect(nid(), cx, 17, CHIP_W, 30, chip.color, pageId, chip.n ? 0.18 : 0.07));
        reqs.push(...textBox(nid(), cx + 10, 25, 44, 14, chip.label, { size: 9, bold: true, color: chip.n ? chip.color : MUTED }, pageId));
        reqs.push(...textBox(nid(), cx + CHIP_W - 40, 21, 30, 20, String(chip.n), { size: 14, bold: true, color: chip.n ? WHITE : MUTED, align: "END" }, pageId));
      });

      // ── 카드: 키맨 먼저, 그다음 주소·업체명
      const items = [
        ...persons.map((row) => ({ row, kind: "키맨 변경", color: AMBER })),
        ...addresses.map((row) => ({ row, kind: "주소 변경", color: SKY })),
        ...names.map((row) => ({ row, kind: "업체명 변경", color: MINT })),
      ];
      const shown = items.slice(0, 8);
      const wide = shown.length <= 2; // 한두 건이면 한 단으로 크게
      const cardW = wide ? W - PAD * 2 : (W - PAD * 2 - GAP) / 2;
      const perRow = wide ? 1 : 2;
      const rowsN = Math.max(1, Math.ceil(shown.length / perRow));

      const areaTop = BAND + 30;
      const hint = persons.length ? "이전 담당자 이름은 부르지 않습니다"
        : addresses.length ? "방문 전 새 주소를 지도에 다시 찍어 확인해 주세요"
        : "서류·명세서에 옛 상호가 남아 있는지 확인해 주세요";
      reqs.push(...textBox(nid(), PAD, BAND + 10, 520, 16,
        items.length ? `방문 시 확인 ${items.length}건 — ${hint}` : "지난주 접수된 변경 없음 — 평소처럼 방문하시면 됩니다",
        { size: 10.5, bold: true, color: MUTED }, pageId));

      const areaMax = H - 30 - 96 - areaTop; // 인사 문구 칸 최소 96PT는 남긴다
      const cardH = Math.min(116, Math.max(56, (areaMax - (rowsN - 1) * GAP) / rowsN));
      shown.forEach((it, i) => {
        // 마지막 한 장이 홀수로 남으면 두 칸 폭으로 늘려 빈칸을 없앤다
        const last = i === shown.length - 1;
        const solo = perRow === 2 && last && i % 2 === 0;
        const w = solo ? W - PAD * 2 : cardW;
        const roomy = wide || solo;
        const x = PAD + (i % perRow) * (cardW + GAP);
        const y = areaTop + Math.floor(i / perRow) * (cardH + GAP);
        reqs.push(...rect(nid(), x, y, w, cardH, INK_SOFT, pageId));
        reqs.push(...rect(nid(), x, y + 6, 4, cardH - 12, it.color, pageId, 1, "RECTANGLE"));
        const tx = x + 18;
        const tw = w - 34;
        const grade = gradeLabel(it.row.grade);
        reqs.push(...textBox(nid(), tx, y + 10, tw - 110, 22, clipText(it.row.company, roomy ? 32 : 17), { size: 14, bold: true }, pageId));
        reqs.push(...textBox(nid(), x + w - 118, y + 13, 104, 15,
          `${it.kind}${grade ? `  ${grade}` : ""}`, { size: 9.5, bold: true, color: it.color, align: "END" }, pageId));
        const after = clipText(it.row.after_text, roomy ? 68 : 32);
        reqs.push(...textBox(nid(), tx, y + 35, tw, 18, after || "새 정보 없음 — 방문 시 확인 부탁드립니다", { size: 11.5, bold: true, color: after ? WHITE : MUTED }, pageId));
        if (it.row.before_text) {
          reqs.push(...textBox(nid(), tx, y + 55, tw, 15, `이전  ${clipText(it.row.before_text, roomy ? 64 : 30)}`, { size: 9.5, color: MUTED }, pageId));
        }
        const foot = [dayLabel(it.row.change_date), clipText(it.row.reason, roomy ? 42 : 18), it.row.author].filter(Boolean).join(" · ");
        if (cardH >= 74) reqs.push(...textBox(nid(), tx, y + cardH - 21, tw, 14, foot, { size: 8.5, color: MUTED }, pageId));
      });

      // ── 인사 문구 칸 (남는 공간을 모두 차지해 아래가 비지 않게)
      const cardsBottom = shown.length ? areaTop + rowsN * (cardH + GAP) - GAP : areaTop;
      const tipTop = cardsBottom + 16;
      const tipH = Math.max(60, H - 30 - tipTop);
      const lines = Math.max(2, Math.floor((tipH - 40) / 19)); // 남는 높이에 맞춰 문구 수를 정한다
      // 이번 주에 실제로 들어온 종류만 골라 문구를 섞는다 (키맨 우선, 남는 줄에 주소·업체명)
      const kinds = [
        persons.length ? "키맨" : "",
        addresses.length ? "주소" : "",
        names.length ? "업체명" : "",
      ].filter(Boolean);
      const tipKey = kinds[0] || "키맨";
      // 종류가 여러 개면 한 개씩 돌아가며 담는다 — 주소 변경이 있는데 키맨 문구만 나오면 쓸모가 없다
      const tips: string[] = [];
      const pools = (kinds.length ? kinds : ["키맨"]).map((kind) => ({ kind, list: [...(GREETING_TIPS[kind] || [])] }));
      const cap = Math.min(4, lines);
      while (tips.length < cap && pools.some((p) => p.list.length)) {
        for (const pool of pools) {
          const t = pool.list.shift();
          if (t && tips.length < cap) tips.push(pools.length > 1 ? `${pool.kind} — ${t}` : t);
        }
      }
      const tipColor = tipKey === "주소" ? SKY : tipKey === "업체명" ? MINT : AMBER;
      const josa = tipKey === "주소" ? "가" : "이"; // 주소가 / 키맨이 / 업체명이
      if (tips.length) {
        reqs.push(...rect(nid(), PAD, tipTop, W - PAD * 2, tipH, tipColor, pageId, 0.11));
        reqs.push(...rect(nid(), PAD, tipTop + 8, 4, tipH - 16, tipColor, pageId, 1, "RECTANGLE"));
        reqs.push(...textBox(nid(), PAD + 18, tipTop + 11, 520, 16, kinds.length > 1 ? "방문하시면 이렇게 한마디 — 관리받는 느낌이 재계약 때 다릅니다" : `${tipKey}${josa} 바뀐 곳 — 이렇게 인사하면 좋습니다`, { size: 10.5, bold: true, color: tipColor }, pageId));
        reqs.push(...textBox(nid(), PAD + 18, tipTop + 34, W - PAD * 2 - 36, tipH - 44,
          tips.map((t) => `· ${t}`).join("\n"), { size: 10, lineSpacing: 140 }, pageId));
      }

      const more = items.length > shown.length ? `외 ${items.length - shown.length}건은 앱 통합이력에서 확인 · ` : "";
      reqs.push(...textBox(nid(), PAD, H - 22, W - PAD * 2, 14,
        `${more}인사 후 FIELD·워킨맵의 🤝 버튼으로 표시해 주세요 · 퍼스트전산 CS`, { size: 8.5, color: MUTED, align: "CENTER" }, pageId));

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
          }
        }
      }
      out.push(entry);
    }

    return Response.json({ ok: true, week, action, regions: out }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500, headers: jsonHeaders });
  }
});
