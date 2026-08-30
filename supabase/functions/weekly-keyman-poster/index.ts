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
  // 제목 칸에는 '구 + 동(로·길)' 만 — 전체 주소는 아래 줄에서 보여 준다
  const m = cut.match(/([가-힣]+(?:구|군|시))\s+([가-힣0-9]+(?:동|읍|면|리|로\d*|길))/);
  const head = m ? `${m[1]} ${m[2]}` : cut.split(" ").slice(0, 2).join(" ");
  return { head: clipText(head, 14), full: clipText(one, 54) };
}

/**
 * 등급 색 — 실제 등급 체계는 SS·S·V·N·NN (임대리스트·워킨맵 접두와 동일, src/ids.ts 참고).
 * A~E로 넘겨짚어 N·NN·V를 잘랐던 실사고(2026-08-28) 뒤 데이터로 확인해 고정했다.
 * SS·S는 금색 계열로 눈에 박히게, V는 보라, N·NN은 차분하게. 유지보수 계약은 "유지" 배지.
 */
const GRADE_COLORS: Record<string, Rgb> = {
  SS: { red: 1, green: 0.815, blue: 0.290 },        // 금색(밝게)
  S: { red: 0.965, green: 0.690, blue: 0.180 },     // 호박색
  V: { red: 0.655, green: 0.545, blue: 0.980 },     // 보라
  A: { red: 0.298, green: 0.576, blue: 1 },
  B: { red: 0.204, green: 0.827, blue: 0.600 },
  N: { red: 0.494, green: 0.576, blue: 0.706 },     // 차분한 강청
  NN: { red: 0.333, green: 0.404, blue: 0.498 },    // 더 낮게
  C: { red: 0.600, green: 0.651, blue: 0.722 },
  D: { red: 0.420, green: 0.478, blue: 0.561 },
  E: { red: 0.420, green: 0.478, blue: 0.561 },
  유지: { red: 0.176, green: 0.831, blue: 0.749 },  // 청록 — 유지보수 계약
  임대: { red: 0.376, green: 0.647, blue: 0.980 },
};

/** 배지에 세울 등급 — "N, V"·"S/NN"처럼 겹쳐 적힌 건 첫 것을 쓴다. 계약형태는 두 글자로 줄인다 */
const letterGrade = (value: string) => {
  const raw = String(value || "").trim();
  if (/유지보수|유지/.test(raw)) return "유지";
  if (/임대|렌탈|리스/.test(raw)) return "임대";
  const g = raw.toUpperCase().replace(/Ⅴ/g, "V").split(/[,/\s]+/)[0] || "";
  return /^(특S|SS|S|V|N|NN|[A-E])$/.test(g) ? g : "";
};

/** 꼬리말용 등급 표기 — 배지와 같은 판정, 계약형태만 원말로 */
function gradeLabel(value: string): string {
  const g = letterGrade(value);
  return g === "유지" ? "유지보수" : g;
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

/**
 * 왜 바로 인사드리나 — 매주 포스터 맨 아래에 실어 취지를 계속 상기시킨다.
 * 대표님 취지: 변경 직후 인사가 나중에 다가가기 쉽게 만들고 인식을 좋게 한다.
 */
const WHY_GREET = [
  "첫 얼굴 — 지금 인사한 사람이 그 업체의 '담당 CS'로 기억됩니다",
  "관계 선점 — 미리 친해 두면 재계약·추가 발주 때 훨씬 수월합니다",
  "지인 추천 — 소개는 늘 친한 CS에게 먼저 갑니다",
  "해지 방어 — 불만이 생겨도 해지 대신 전화가 먼저 옵니다",
];

// ── 사진 스타일 ─────────────────────────────────────────────
// 세 가지를 만들어 고르게 한다. 색·선·서체만 다르고 담는 내용은 같다.
type Rgb = { red: number; green: number; blue: number };
type Style = {
  key: string;
  bg: Rgb; ink: Rgb; sub: Rgb; muted: Rgb; line: Rgb; accent: Rgb;
  heroFont?: string; titleFont?: string;
  chip: "solid" | "tint" | "text";
  ruleThick: number;      // 묶음 제목 아래 선 두께
  rowRule: boolean;       // 줄 사이 얇은 선
  wm?: Rgb;               // 머리에 깔리는 큰 지역 글자
  gradeBadge?: boolean;   // 등급을 왼쪽 배지로 크게 (등급이 중요하다는 요청)
  edgeBar?: boolean;      // 줄 왼쪽 끝 강조 바
  heroSize?: number;      // 이름 크기
  countsBig?: boolean;    // 건수 숫자를 크게
};
const hx = (v: string): Rgb => ({
  red: parseInt(v.slice(1, 3), 16) / 255,
  green: parseInt(v.slice(3, 5), 16) / 255,
  blue: parseInt(v.slice(5, 7), 16) / 255,
});
const DEFAULT_STYLE = "bold"; // 2026-08-28 선택: 짙은 남색 + 등급 배지
const STYLES: Record<string, Style> = {
  // 1) 밝고 하얀 — 후지리포토 같은 흰 바탕, 강조는 파랑 하나
  light: {
    key: "light",
    bg: hx("#FFFFFF"), ink: hx("#14171F"), sub: hx("#6B7380"), muted: hx("#9AA3B2"),
    line: hx("#E7EAF0"), accent: hx("#2563EB"), chip: "solid", ruleThick: 1, rowRule: true,
  },
  // 2) 진한 배경 — 화면 전체가 짙은 남색, 큰 흰 글씨
  bold: {
    key: "bold",
    bg: hx("#0D1626"), ink: hx("#FFFFFF"), sub: hx("#9FB0C9"), muted: hx("#77899F"),
    line: hx("#24344F"), accent: hx("#4C93FF"), chip: "tint", ruleThick: 2, rowRule: true,
    wm: hx("#16233A"), gradeBadge: true, heroSize: 27, countsBig: true,
  },
  // 4) 부드러운 민트 — 밝고 친근한 톤, 라운드 알약
  soft: {
    key: "soft",
    bg: hx("#F2F7F4"), ink: hx("#16241E"), sub: hx("#5C6B64"), muted: hx("#93A29A"),
    line: hx("#DCE7E1"), accent: hx("#0E9F6E"), chip: "solid", ruleThick: 1, rowRule: true,
  },
  // 5) 흑백 — 색을 아예 쓰지 않고 굵기와 선으로만. 가장 담백하다
  mono: {
    key: "mono",
    bg: hx("#FFFFFF"), ink: hx("#000000"), sub: hx("#4A4A4A"), muted: hx("#8A8A8A"),
    line: hx("#000000"), accent: hx("#000000"), chip: "text", ruleThick: 2.4, rowRule: true,
  },
  // 3) 신문 헤드라인 — 종이색, 굵은 검은 선, 이름은 명조로
  news: {
    key: "news",
    bg: hx("#F7F5F0"), ink: hx("#111111"), sub: hx("#5A5A55"), muted: hx("#8C8C85"),
    line: hx("#111111"), accent: hx("#B3402B"), heroFont: "Nanum Myeongjo", titleFont: "Nanum Myeongjo",
    chip: "text", ruleThick: 2.2, rowRule: true,
  },
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
    const out: Array<{ region: string; url: string; style?: string; poster?: string; page?: string; counts: Record<string, number>; room?: string; queued?: boolean; text?: string }> = [];

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
      const reqs: Req[] = [];
      let seq = 0;
      const nid = () => `obj_${letter}_${String(seq++).padStart(3, "0")}`; // 슬라이드 objectId는 5자 이상이어야 한다

      // ── 세로 사진 만들기 ────────────────────────────────────────
      //   슬라이드는 16:9 가로로 고정이라 판형을 못 바꾼다. 그래서 내용을 **조각(section)** 으로 나눠
      //   여러 장에 그린 뒤, 썸네일을 필요한 만큼 잘라 위아래로 이어 붙여 세로 사진을 만든다.
      const st = STYLES[String(body.style || DEFAULT_STYLE)] || STYLES[DEFAULT_STYLE];
      const portrait = body.portrait !== false;
      const PW = portrait ? 440 : 720;      // 그리는 폭(PT) — 세로는 좁은 단
      const PAD = portrait ? 30 : 40;
      const SEC_MAX = 392;                  // 한 슬라이드에 담을 수 있는 높이(PT)

      // 담을 줄 목록 만들기 (건수는 종류별로 따로 센다)
      type Line =
        | { t: "head"; h: number }
        | { t: "title"; h: number; label: string; n: number }
        | { t: "row"; h: number; row: ChangeRow; kind: "담당" | "주소" | "업체명" }
        | { t: "tips"; h: number }
        | { t: "why"; h: number };
      const ROW_H = portrait ? 118 : 80;
      const groups: Array<{ label: "담당" | "주소" | "업체명"; rows: ChangeRow[] }> = [
        { label: "담당", rows: persons },
        { label: "주소", rows: addresses },
        { label: "업체명", rows: names },
      ];
      const lines: Line[] = [{ t: "head", h: portrait ? (st.wm ? 182 : 142) : 120 }];
      for (const g of groups) {
        if (!g.rows.length) continue;
        lines.push({ t: "title", h: 36, label: g.label, n: g.rows.length });
        for (const row of g.rows.slice(0, 8)) lines.push({ t: "row", h: ROW_H, row, kind: g.label });
      }
      lines.push({ t: "why", h: portrait ? 126 : 110 });   // 취지 — 중요해서 인사 문구보다 위, 강조 박스
      lines.push({ t: "tips", h: portrait ? 86 : 78 });

      // 조각으로 나누기 — 줄을 넘치지 않게 담는다
      const sections: Array<{ lines: Line[]; h: number }> = [];
      let cur: { lines: Line[]; h: number } = { lines: [], h: 0 };
      for (const line of lines) {
        if (cur.h + line.h > SEC_MAX && cur.lines.length) { sections.push(cur); cur = { lines: [], h: 0 }; }
        cur.lines.push(line);
        cur.h += line.h;
      }
      if (cur.lines.length) sections.push(cur);

      // 필요한 만큼 슬라이드를 더 만든다 (첫 장은 이미 있다)
      const sectionPages: string[] = [pageId];
      for (let i = 1; i < sections.length; i++) {
        const id = `sec_${letter}_${i}`;
        sectionPages.push(id);
        reqs.push({ createSlide: { objectId: id, insertionIndex: i, slideLayoutReference: { predefinedLayout: "BLANK" } } });
      }

      // ── 그리기
      sections.forEach((section, si) => {
        const page = sectionPages[si];
        reqs.push({ updatePageProperties: { objectId: page, pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: st.bg } } } }, fields: "pageBackgroundFill" } });
        let y = 0;
        for (const line of section.lines) {
          if (line.t === "head") {
            // 큰 지역 글자를 뒤에 깔아 임팩트를 준다
            if (st.wm) reqs.push(...T(nid(), PW - PAD - 150, y + 6, 150, 130, letter, { size: 104, bold: true, color: st.wm, align: "END" }, page));
            reqs.push(...T(nid(), PAD, y + 26, PW - PAD * 2, 14, "W E E K L Y   B R I E F I N G", { size: 7.5, bold: true, color: st.muted }, page));
            reqs.push(...T(nid(), PAD, y + 42, PW - PAD * 2 - (st.wm ? 90 : 0), 32, `${letter}지역`,
              { size: portrait ? 30 : 32, bold: true, color: st.accent, font: st.titleFont }, page));
            reqs.push(...T(nid(), PAD, y + 76, PW - PAD * 2 - (st.wm ? 60 : 0), 24, "주간 키맨 브리핑",
              { size: portrait ? 20 : 22, bold: true, color: st.ink, font: st.titleFont }, page));
            reqs.push(...T(nid(), PAD, y + 104, PW - PAD * 2, 16, `${week.label} 접수분 · 방문하시면 인사 한마디 부탁드립니다`, { size: 9.5, color: st.sub }, page));
            // 건수는 종류별로 따로 — 칸을 나눠 숫자를 크게
            const stat = [
              { label: "담당 변경", n: persons.length },
              { label: "주소 변경", n: addresses.length },
              { label: "업체명 변경", n: names.length },
            ];
            const big = st.countsBig ? 26 : 20;
            const statY = y + line.h - (st.countsBig ? 60 : 48);
            const cw = (PW - PAD * 2) / 3;
            stat.forEach((it, i) => {
              const x = PAD + i * cw;
              if (i > 0) reqs.push(...rect(nid(), x - 8, statY + 4, 0.8, 28, st.line, page, 1, "RECTANGLE"));
              reqs.push(...T(nid(), x, statY, cw - 10, big + 8, String(it.n),
                { size: big, bold: true, color: it.n ? st.accent : st.muted }, page));
              reqs.push(...T(nid(), x, statY + big + 4, cw - 10, 14, `${it.label}건`,
                { size: 8.5, bold: true, color: it.n ? st.sub : st.muted }, page));
            });
            reqs.push(...rect(nid(), PAD, y + line.h - 6, PW - PAD * 2, st.ruleThick, st.accent, page, st.key === "bold" ? 1 : 0.9, "RECTANGLE"));
          } else if (line.t === "title") {
            reqs.push(...T(nid(), PAD, y + 12, PW - PAD * 2, 18, `${line.label} 변경 ${line.n}건`,
              { size: 12.5, bold: true, color: st.accent, font: st.titleFont }, page));
            reqs.push(...rect(nid(), PAD, y + line.h - 6, PW - PAD * 2, st.ruleThick, st.line, page, 1, "RECTANGLE"));
          } else if (line.t === "row") {
            const r = line.row;
            const badge = st.gradeBadge ? letterGrade(r.grade) : "";
            const badgeW = st.gradeBadge ? 40 : 0;
            const tx = PAD + (st.gradeBadge ? badgeW + 12 : 0);
            // 등급 배지 — 한 열로 서 있어 훑기만 해도 S가 보인다. 등급 없는 곳은 흐린 자리표시로 열을 지킨다
            if (badge) {
              reqs.push(...rect(nid(), PAD, y + 28, badgeW, 30, GRADE_COLORS[badge] || st.accent, page));
              reqs.push(...T(nid(), PAD, y + 36, badgeW, 18, badge, { size: badge.length >= 2 ? 11.5 : 14, bold: true, color: st.bg, align: "CENTER" }, page));
            } else if (st.gradeBadge) {
              reqs.push(...rect(nid(), PAD, y + 28, badgeW, 30, st.line, page, 0.4));
              reqs.push(...T(nid(), PAD, y + 36, badgeW, 18, "–", { size: 11, bold: true, color: st.muted, align: "CENTER" }, page));
            }
            reqs.push(...T(nid(), tx, y + 8, PW - PAD - tx - 128, 15, clipText(r.company, 20), { size: 10.5, bold: true, color: st.sub }, page));
            // 오른쪽 위: 접수일, 그 아래 종류·사유·접수자 — 조각이 넘어가 묶음 제목이 안 보여도 종류를 알 수 있다
            reqs.push(...T(nid(), PW - PAD - 120, y + 6, 120, 16, dayLabel(r.change_date), { size: 11.5, bold: true, color: st.sub, align: "END" }, page));
            const gradeText = st.gradeBadge ? (badge ? "" : gradeLabel(r.grade)) : gradeLabel(r.grade);
            reqs.push(...T(nid(), PW - PAD - 200, y + 20, 200, 12,
              [line.kind, gradeText, clipText(r.reason, 8), r.author].filter(Boolean).join(" · "),
              { size: 8.5, color: st.muted, align: "END" }, page));
            let hero = "", sub = "", before = "";
            if (line.kind === "주소") {
              const a = readAddress(r.after_text);
              hero = a.head || "새 주소 확인";
              sub = a.full;
              before = r.before_text ? `옛 주소  ${readAddress(r.before_text).full}` : ""; // "이전"은 移轉으로 읽혀 헷갈린다
            } else if (line.kind === "업체명") {
              hero = clipText(r.after_text, 18) || "새 상호 확인";
              before = r.before_text ? `옛 상호  ${clipText(r.before_text, 30)}` : "";
            } else {
              const person = readPerson(r.after_text);
              hero = person.name || "새 담당자";
              sub = [person.phone, person.note].filter(Boolean).join("   ");
              const b = r.before_text ? readPerson(r.before_text) : null;
              before = b ? `이전 ${[b.name, b.phone].filter(Boolean).join("  ")}` : "";
            }
            const heroW = PW - PAD - tx - 40;
            const heroSize = !portrait ? 26
              : line.kind === "주소" ? Math.min(20, st.heroSize || 23)
              : line.kind === "업체명" ? Math.min(22, st.heroSize || 23)
              : (st.heroSize || 23);
            // 한글은 글자 폭이 거의 글자 크기와 같다 — 칸에 들어갈 글자 수를 폭에서 뽑아 줄바꿈을 막는다
            reqs.push(...T(nid(), tx, y + 32, heroW, 36, clipText(hero, Math.max(6, Math.floor(heroW / (heroSize * 0.98)))),
              { size: heroSize, bold: true, color: st.ink, font: st.heroFont }, page));
            if (sub) {
              // 담당 변경이면 이 줄이 전화번호 — 현장에서 바로 걸 번호라 크게
              reqs.push(...T(nid(), tx, y + (portrait ? 66 : 56), PW - PAD - tx, 20, clipText(sub, portrait ? 28 : 52),
                { size: line.kind === "담당" ? 13.5 : 12, bold: line.kind === "담당", color: line.kind === "담당" ? st.accent : st.sub }, page));
            }
            if (before) {
              reqs.push(...T(nid(), tx, y + (portrait ? 90 : 72), PW - PAD - tx, 16, clipText(before, portrait ? 36 : 56),
                { size: 9.5, color: st.muted }, page));
            }
            if (st.rowRule) reqs.push(...rect(nid(), PAD, y + line.h - 6, PW - PAD * 2, 0.7, st.line, page, st.key === "news" ? 0.35 : 1, "RECTANGLE"));
          } else if (line.t === "why") {
            // 취지 — 직원들이 왜 하는지 알아야 움직인다. 잘 보이게 강조 박스 (2026-08-28)
            reqs.push(...rect(nid(), PAD, y + 6, PW - PAD * 2, line.h - 14, st.accent, page, st.key === "bold" ? 0.15 : 0.08));
            reqs.push(...rect(nid(), PAD, y + 6, 4, line.h - 14, st.accent, page, 1, "RECTANGLE"));
            reqs.push(...T(nid(), PAD + 16, y + 17, PW - PAD * 2 - 28, 14, "지금 인사드려야 하는 이유", { size: 10.5, bold: true, color: st.accent }, page));
            reqs.push(...T(nid(), PAD + 16, y + 36, PW - PAD * 2 - 30, line.h - 44,
              WHY_GREET.map((t) => `· ${t}`).join("\n"), { size: 10, color: st.ink, lineSpacing: 148 }, page));
          } else {
            // 인사 한마디 — 맨 아래 각주 톤 (실제 멘트만 간단히)
            const kinds = groups.filter((g) => g.rows.length).map((g) => g.label);
            const key = kinds[0] === "담당" ? "키맨" : kinds[0] === "주소" ? "주소" : "업체명";
            const tips = (GREETING_TIPS[key] || []).slice(0, 2);
            reqs.push(...rect(nid(), PAD, y + 8, PW - PAD * 2, 0.7, st.line, page, 1, "RECTANGLE"));
            reqs.push(...T(nid(), PAD, y + 18, PW - PAD * 2, 13, "인사 한마디", { size: 9, bold: true, color: st.muted }, page));
            reqs.push(...T(nid(), PAD, y + 34, PW - PAD * 2, line.h - 38,
              tips.join("\n"), { size: 9.5, color: st.sub, lineSpacing: 140 }, page));
          }
          y += line.h;
        }
      });

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

      // ── 슬라이드 → PNG (조각마다 필요한 높이만 잘라 위아래로 이어 붙인다)
      const shot = async (page: string): Promise<Uint8Array | null> => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const thumb = await fetch(`${SLIDES}/${presentationId}/pages/${page}/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (thumb.ok) {
            const { contentUrl } = await thumb.json();
            const buf = new Uint8Array(await (await fetch(contentUrl)).arrayBuffer());
            if (buf.byteLength > 6000) return buf;   // 너무 작으면 아직 덜 그려진 그림
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        return null;
      };

      const store = async (path: string, bytes: Uint8Array, mime: string) => {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/${path}`, {
          method: "POST",
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": mime, "x-upsert": "true" },
          body: bytes,
        });
        return res.ok;
      };

      await new Promise((resolve) => setTimeout(resolve, 3000));
      const { Image } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
      const SCALE = 900 / H;                        // 썸네일(1600×900) 배율
      const colW = Math.round(PW * SCALE);
      const pieces: Array<InstanceType<typeof Image>> = [];
      for (let i = 0; i < sections.length; i++) {
        const buf = await shot(sectionPages[i]);
        if (!buf) return Response.json({ error: `이미지 변환 실패(${i + 1}번째 조각)` }, { status: 502, headers: jsonHeaders });
        const img = await Image.decode(buf);
        const cutH = Math.max(40, Math.min(img.height, Math.round(sections[i].h * SCALE)));
        pieces.push(img.crop(0, 0, Math.min(img.width, colW), cutH));
      }
      const totalH = pieces.reduce((n, p) => n + p.height, 0);
      const canvas = new Image(colW, totalH);
      canvas.fill(Image.rgbToColor(Math.round(st.bg.red * 255), Math.round(st.bg.green * 255), Math.round(st.bg.blue * 255)));
      let oy = 0;
      for (const piece of pieces) { canvas.composite(piece, 0, oy); oy += piece.height; }
      const png = await canvas.encode();

      const suffix = st.key === DEFAULT_STYLE ? "" : `_${st.key}`; // 기본 스타일은 이름에 붙이지 않는다
      const pngPath = `keyman/${week.from}_${letter}${suffix}.png`;
      if (!await store(`photos/${pngPath}`, png, "image/png")) {
        return Response.json({ error: "이미지 저장 실패" }, { status: 502, headers: jsonHeaders });
      }
      const url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/photos/${pngPath}`;

      // ── 눌러서 보는 안내문: 우리 도메인의 정적 페이지(public/brief)
      //   Supabase는 저장소·엣지 함수 응답을 text/plain + 샌드박스로 강제해 HTML을 못 띄운다(실측).
      //   그 페이지는 열 때마다 데이터를 직접 읽으므로 링크가 낡지 않는다.
      const posterUrl = url;
      const pageUrl = `${APP_URL}/brief/?r=${letter}&w=${week.from}`; // 눌러서 보는 안내문(원하면 문구에 쓸 수 있다)

      const entry: { region: string; url: string; style?: string; poster?: string; page?: string; counts: Record<string, number>; room?: string; queued?: boolean; text?: string } = {
        region: letter, url, style: st.key, poster: posterUrl, page: pageUrl || undefined,
        counts: { 키맨: persons.length, 주소: addresses.length, 업체명: names.length },
      };

      if (action === "run") {
        const mapRows = await (await fetch(`${restBase}/room_map?select=region,room&category=eq.${encodeURIComponent("점검")}`, { headers: restHeaders })).json();
        let room = (Array.isArray(mapRows) ? mapRows : []).find((r: { region: string }) => String(r.region).trim().toUpperCase() === letter)?.room;
        // 앱의 테스트방 모드를 존중 — TEST_MODE=true면 모든 발송이 테스트방으로 (src/api.ts와 같은 규칙)
        const cfgRows = await (await fetch(`${restBase}/app_config?select=key,value&key=in.(TEST_MODE,TEST_ROOM)`, { headers: restHeaders })).json();
        const cfg = Object.fromEntries((Array.isArray(cfgRows) ? cfgRows : []).map((r: { key: string; value: string }) => [r.key, r.value]));
        const testMode = String(cfg.TEST_MODE ?? "true").toLowerCase() === "true";
        const realRoom = room;
        if (testMode && room) room = String(cfg.TEST_ROOM || "테스트 전용방").trim();
        if (room) {
          // 봇(알림 답장)은 글자만 보낼 수 있다 — 그림은 PC가 붙여 보내고, 글에는 눌러지는 안내문 링크를 담는다
          // 문구는 짧게 — 내용은 사진이 다 말한다 (업체 나열은 사진과 중복이라 뺐다, 2026-08-28 피드백)
          const parts = [
            persons.length ? `담당 ${persons.length}` : "",
            addresses.length ? `주소 ${addresses.length}` : "",
            names.length ? `업체명 ${names.length}` : "",
          ].filter(Boolean).join(" · ");
          const head = [
            `🗓 ${letter}지역 주간 키맨 브리핑 (${week.label})`,
            `지난주 변경 ${items.length}곳 (${parts}) — 아래 사진 한 장으로 확인해 주세요 👇`,
          ].join("\n");
          const text = `${testMode ? `[테스트 · 원래는 ${realRoom}]\n` : ""}${head}\n${url}`; // url = 사진. 카톡이 미리보기 썸네일을 붙여 준다
          entry.room = room;
          entry.text = text;
          if (body.dry) { entry.queued = false; } // 실제 발송 없이 방·문구만 확인
          else {
            await fetch(`${restBase}/outbox`, { method: "POST", headers: { ...restHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ room, text }) });
            entry.queued = true;
            if (!testMode) queuedAny = true; // 테스트 발송은 '보냈음' 표시를 남기지 않는다
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
