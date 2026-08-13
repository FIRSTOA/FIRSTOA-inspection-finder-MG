/**
 * 구글 시트 API 직접 기입 엔진 — 앱스스크립트(field-sheet-sync.gs) 로직의 이식판.
 *
 * 왜: GAS 경유는 문서 열기·잠금 대기로 기입에 10초+ 걸리고 잠금 경합이 잦았다.
 * Sheets REST API 직행은 1~3초. 실패하면 호출부가 GAS 웹훅으로 폴백하므로 무회귀.
 *
 * 필요 Secrets: GOOGLE_SERVICE_ACCOUNT (서비스 계정 JSON 전체 — client_email, private_key)
 * 서비스 계정 이메일이 각 시트 문서에 편집자로 공유돼 있어야 한다.
 *
 * 이식 시 지킨 것들(사고 이력에서 나온 규칙 — 바꾸지 말 것):
 * - 행 재사용(원격 5행~, 복합기 8행~): insertRow는 배열수식 재계산 + 서식 끝 낙하 사고
 * - 헤더 매칭은 공백류 전부 무시("한조⏎처리" 셀 내 줄바꿈)
 * - 원격 AH(34)열 이후·A/C열 보호, 복합기 U(21)열 이후 보호(처리완료 예외)
 * - _updateOnly는 무슨 일이 있어도 새 행 금지
 * - 웹앱 전송ID 멱등성(재시도 중복 append 방지)
 */

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export const FIELD_SHEETS: Record<string, { spreadsheetId: string; sheetId: number }> = {
  expansion_it: { spreadsheetId: "1Q0u_ok6s3o7_qnSFyDW632zkspV_MqttRnFQ4uurmpg", sheetId: 1571265600 },
  expansion_copier: { spreadsheetId: "10850TfeSvd0Z1iiI1ycCyGskGRPXicRUd1_Xx996QKQ", sheetId: 746760933 },
  contact_change: { spreadsheetId: "1H15RFS7h-euPJM1pfPIQl_FQNzxk6OrjkSmZZGsqWKQ", sheetId: 1289086745 },
  complaint: { spreadsheetId: "1H15RFS7h-euPJM1pfPIQl_FQNzxk6OrjkSmZZGsqWKQ", sheetId: 419415178 },
  praise: { spreadsheetId: "1H15RFS7h-euPJM1pfPIQl_FQNzxk6OrjkSmZZGsqWKQ", sheetId: 0 },
  reception_copier: { spreadsheetId: "1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g", sheetId: 1181394897 },
  reception_copier_new: { spreadsheetId: "1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g", sheetId: 1181394897 },
  reception_remote: { spreadsheetId: "1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g", sheetId: 916322987 },
};

export type SheetApiRequest = {
  category: string;
  jobId: string;
  author: string;
  submittedAt: string;
  sourceText: string;
  payload: { data?: Record<string, unknown> } & Record<string, unknown>;
};

export function sheetsApiConfigured(): boolean {
  return !!Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
}

// ── 인증: 서비스 계정 JWT → access token (55분 캐시) ──────────────────────
let tokenCache: { token: string; exp: number } | null = null;

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache.token;
  const sa = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT") || "{}");
  if (!sa.client_email || !sa.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT 시크릿이 없거나 형식이 다릅니다");
  const pem = String(sa.private_key).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const enc = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`구글 토큰 발급 실패: ${JSON.stringify(data).slice(0, 200)}`);
  tokenCache = { token: data.access_token, exp: Date.now() + 55 * 60 * 1000 };
  return data.access_token;
}

// ── Sheets REST 헬퍼 ──────────────────────────────────────────────────────
async function gapi(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const token = await accessToken();
  const res = await fetch(`${SHEETS_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${JSON.stringify((data as { error?: { message?: string } }).error?.message || data).slice(0, 200)}`);
  return data as Record<string, unknown>;
}

function colA1(col: number): string {
  let out = "";
  while (col > 0) { const r = (col - 1) % 26; out = String.fromCharCode(65 + r) + out; col = Math.floor((col - 1) / 26); }
  return out;
}
const quoteTitle = (title: string) => `'${title.replace(/'/g, "''")}'`;

type SheetMeta = { title: string; maxRows: number; maxCols: number };
const metaCache = new Map<string, { at: number; sheets: Map<number, SheetMeta>; byTitle: Map<string, SheetMeta & { sheetId: number }> }>();

async function spreadsheetMeta(spreadsheetId: string) {
  const cached = metaCache.get(spreadsheetId);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached;
  const data = await gapi(`/${spreadsheetId}?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`);
  const sheets = new Map<number, SheetMeta>();
  const byTitle = new Map<string, SheetMeta & { sheetId: number }>();
  for (const s of (data.sheets as Array<{ properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } } }>) || []) {
    const meta = { title: s.properties.title, maxRows: s.properties.gridProperties?.rowCount || 0, maxCols: s.properties.gridProperties?.columnCount || 0 };
    sheets.set(s.properties.sheetId, meta);
    byTitle.set(meta.title, { ...meta, sheetId: s.properties.sheetId });
  }
  const entry = { at: Date.now(), sheets, byTitle };
  metaCache.set(spreadsheetId, entry);
  return entry;
}

async function getValues(spreadsheetId: string, range: string, render: "FORMATTED_VALUE" | "FORMULA" = "FORMATTED_VALUE"): Promise<string[][]> {
  const data = await gapi(`/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=${render}`);
  return ((data.values as string[][]) || []).map((row) => row.map((v) => String(v ?? "")));
}

async function batchGetValues(spreadsheetId: string, ranges: string[]): Promise<Map<string, string[][]>> {
  if (!ranges.length) return new Map();
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  const data = await gapi(`/${spreadsheetId}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE`);
  const out = new Map<string, string[][]>();
  const returned = (data.valueRanges as Array<{ values?: string[][] }>) || [];
  ranges.forEach((range, i) => {
    out.set(range, ((returned[i]?.values as string[][]) || []).map((row) => row.map((v) => String(v ?? ""))));
  });
  return out;
}

async function setValues(spreadsheetId: string, range: string, values: (string | number)[][]): Promise<void> {
  await gapi(`/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ range, values }),
  });
}

async function batchSetValues(spreadsheetId: string, entries: Array<{ range: string; values: (string | number)[][] }>): Promise<void> {
  if (!entries.length) return;
  await gapi(`/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: entries }),
  });
}

async function batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<void> {
  if (!requests.length) return;
  await gapi(`/${spreadsheetId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
}

// ── 분산 잠금: app_config 행을 조건부 갱신으로 선점 (GAS LockService 대체) ──
// 같은 시트에 두 인스턴스가 동시에 행을 잡는 것 방지. 90초 넘은 잠금은 고아로 보고 뺏는다.
async function acquireLock(rest: string, headers: Record<string, string>): Promise<string> {
  const key = "SHEET_WRITE_LOCK";
  const mine = `${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
  await fetch(`${rest}/app_config`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ key, value: "" }),
  }).catch(() => {});
  for (let attempt = 0; attempt < 20; attempt++) {
    const grab = await fetch(`${rest}/app_config?key=eq.${key}&value=eq.`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ value: mine }),
    });
    const got = (await grab.json().catch(() => [])) as unknown[];
    if (grab.ok && got.length) return mine;
    const cur = await fetch(`${rest}/app_config?key=eq.${key}&select=value`, { headers }).then((r) => r.json()).catch(() => []);
    const holder = String((cur as Array<{ value?: string }>)[0]?.value || "");
    const heldAt = Number(holder.split(":")[0] || 0);
    if (holder && heldAt && Date.now() - heldAt > 90_000) {
      const steal = await fetch(`${rest}/app_config?key=eq.${key}&value=eq.${encodeURIComponent(holder)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ value: mine }),
      });
      const stolen = (await steal.json().catch(() => [])) as unknown[];
      if (steal.ok && stolen.length) return mine;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error("시트 기입 잠금 대기 초과");
}

async function releaseLock(rest: string, headers: Record<string, string>, mine: string): Promise<void> {
  await fetch(`${rest}/app_config?key=eq.SHEET_WRITE_LOCK&value=eq.${encodeURIComponent(mine)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ value: "" }),
  }).catch(() => {});
}

// ── GAS 로직 이식 ─────────────────────────────────────────────────────────
const squeeze = (v: unknown) => String(v ?? "").replace(/\s+/g, "");
const norm = (v: unknown) => String(v ?? "").replace(/[\s,]/g, "");

function findHeaderRow(rows: string[][], category: string): number {
  const signatures: Record<string, string[]> = {
    expansion_it: ["업체명", "세부사양"],
    expansion_copier: ["상호", "등록자"],
    contact_change: ["업체명", "변경전"],
    complaint: ["업체명", "불만내용"],
    praise: ["거래처명", "칭찬이유"],
    reception_copier: ["퍼스트순", "접수유형"],
    reception_copier_new: ["퍼스트순", "접수유형"],
    reception_remote: ["접수일", "한조처리"],
  };
  const required = signatures[category] || [];
  const index = rows.findIndex((row) => {
    const cells = row.map(squeeze);
    return required.every((header) => cells.includes(squeeze(header)));
  });
  return index >= 0 ? index + 1 : 1;
}

function kstFormat(date: Date, pattern: string): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return pattern
    .replace("yyyy", String(kst.getUTCFullYear()))
    .replace("yy", String(kst.getUTCFullYear()).slice(2))
    .replace("MM", two(kst.getUTCMonth() + 1))
    .replace(/\bM\b/, String(kst.getUTCMonth() + 1))
    .replace("dd", two(kst.getUTCDate()))
    .replace(/\bd\b/, String(kst.getUTCDate()))
    .replace("HH", two(kst.getUTCHours()))
    .replace("mm", two(kst.getUTCMinutes()));
}

function isoWeek(date: Date): number {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function parseLabeledText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  String(text).split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:\d+\.\s*)?([^:：]+)\s*[:：]\s*(.*)$/);
    if (match) values[match[1].trim()] = match[2].trim();
  });
  return values;
}

const FIELD_MAPS: Record<string, Record<string, string>> = {
  expansion_it: {
    "사무/설계/디자인/개발": "purpose", "세부사양": "spec", "지역": "region", "업체명": "company", "등급": "grade",
    "업체담당자": "vendorContact", "연락처": "contact", "IT담당자": "itContact", "렌탈or구매or유지보수": "rentalBuyMaint",
    "지정업체": "designatedVendor", "지정업체만족도": "designatedSat", "총 인원": "totalPeople", "인원 추가 설명": "peopleNote",
    "수량": "qty", "금액": "amount", "시기": "timing", "시기 추가 설명": "timingNote", "어필 OR 추가영업": "appeal",
  },
  expansion_copier: {
    "등록자": "registrant", "전략영업담당자": "salesOwner", "상호": "company", "업종": "industryPeopleRevenue",
    "프로젝트주소": "meetingAddress", "키맨성함+직함": "keymanNameTitle", "키맨전화번호": "contact",
    "의사결정 파급력": "decisionPower", "개인 히스토리": "personalHistory", "프로젝트": "projectStatus",
    "품목(원문)": "itemRaw", "예상 발주금액(만원)": "expectedAmount", "예상 발주시기(YYYY-MM)": "expectedOrderMonth",
    "계약 종료(예정)일": "contractEndDate", "특이사항": "notes", "거래처등급": "grade", "[AI 자동완성 개입 여부]": "_webInput",
  },
  contact_change: {
    "담당자": "_author", "등급": "grade", "업체명": "company", "지역": "region",
    "구분": "category", "사유": "reason", "변경전": "before", "변경후": "after",
  },
  complaint: {
    "접수/처리": "_complaintReceipt", "등급": "등급", "업체명": "업체명", "거래처담당자": "_contactName",
    "거래처연락처": "_contactPhone", "불만내용": "불편내용", "불만유형": "불만유형", "불만항목": "불만정도",
  },
  praise: {
    "등급": "grade", "거래처명": "company", "담당자": "manager", "연락처": "contact",
    "전화번호": "phone", "칭찬이유": "reason", "간단": "short",
  },
  reception_copier: {
    "퍼스트순": "firstNo", "접수유형": "route", "접수분야": "field", "유상/무상": "paid",
    "업체담당자": "receiverName", "전화번호": "receiverPhone", "제목(짧게)": "title", "내용": "symptom",
    "처리완료": "complete",
  },
  reception_remote: {
    "시작": "start", "종료": "end", "처리여부": "result", "유입경로": "route", "처리자": "handler",
    "한조처리": "hanjo", "순": "leaseNo", "연락처": "contact", "증상": "symptom",
    "추가대수": "extraCount", "처리내용": "handled", "연동완료": "linked",
    "상호": "company", "등급": "grade", "미수": "misuMonths", "특이사항": "notes", "지역": "region",
    "마감일": "dueDate", "기종": "series", "브랜드": "brand", "자산번호": "assetNo", "시리얼번호": "serialNo",
  },
  reception_copier_new: {
    "퍼스트순": "firstNo", "임대여부": "leaseStatus", "업체명": "company", "접수유형": "route", "접수분야": "field",
    "유상/무상": "paid", "보증여부": "warranty", "자산번호": "assetNo", "미수개월": "misuMonths",
    "일반전화": "tel", "전화번호": "receiverPhone", "제목(짧게)": "title", "내용": "symptom",
    "등급": "grade", "특이사항": "notes", "한조/틴텍코드": "hanjoCode", "모델명": "model", "품목": "item",
    "제조사": "maker", "기종": "series", "기본임대료": "baseRent", "평균임대료": "avgRent",
    "계약일": "contractStart", "종료일": "contractEnd", "남은개월수": "monthsLeft", "주소": "address",
    "기기상태": "deviceState", "시": "city", "구": "district", "방문주기": "visitCycle", "설치업체": "installer",
    "키맨": "keyman", "추가조건": "extraTerms", "장비소유주": "owner", "기번": "serialNo", "자산기번": "assetSerial",
  },
};

function fieldValue(
  category: string, header: string, column: number,
  data: Record<string, string>, request: SheetApiRequest, labels: Record<string, string>,
): string | undefined {
  const isUpdateJob = !!(data["_updateRow"] || data["_findKeyValue"]);
  if (category === "reception_copier" && isUpdateJob) {
    return squeeze(header) === "처리완료" ? (data["complete"] || undefined) : undefined;
  }
  if (category === "contact_change" && column > 13) return undefined;
  if (category === "reception_copier" && column > 20 && squeeze(header) !== "처리완료") return undefined;
  if (category === "reception_remote") {
    if (column === 1 || column === 3) return undefined;
    if (column >= 34) return undefined;
    if (squeeze(header) === "등급" && column !== 14) return undefined;
    if (squeeze(header) === "순") return column === 13 ? (data["leaseNo"] || undefined) : undefined;
  }
  if (category === "reception_copier_new" && column > 46) return undefined;
  if (category === "reception_copier_new" && squeeze(header) === "업체담당자") {
    return column <= 20 ? (data["receiverName"] || undefined) : (data["vendorManager"] || undefined);
  }

  const submittedAt = new Date(request.submittedAt || Date.now());
  const base: Record<string, string> = {
    "웹앱 전송ID": request.jobId,
    "날짜": request.submittedAt,
    "등록일": request.submittedAt,
    "작성자": request.author,
  };
  if (category === "expansion_copier") {
    base["년월"] = kstFormat(submittedAt, "yy년 MM월");
    base["주차"] = `${isoWeek(submittedAt)}주차`;
  }
  if (category === "contact_change") {
    base["날짜"] = kstFormat(submittedAt, "yyyy-MM-dd");
    base["년월"] = kstFormat(submittedAt, "yy-MM");
    base["유입"] = "웹앱";
  }
  if (category === "complaint") base["날짜"] = kstFormat(submittedAt, "yyyy-MM-dd");
  if (category === "praise") {
    let d = data["date"] ? new Date(`${data["date"]}T09:00:00+09:00`) : submittedAt;
    if (isNaN(d.getTime())) d = submittedAt;
    base["날짜"] = kstFormat(d, "yyyy.MM.dd");
    base["직원"] = request.author;
    base["분류"] = "칭찬";
  }
  if (category === "reception_copier" || category === "reception_copier_new") {
    base["날짜"] = kstFormat(submittedAt, "M월 d일");
    base["접수시간"] = kstFormat(submittedAt, "HH:mm");
    base["접수자"] = request.author;
  }
  if (category === "reception_remote") {
    base["접수일"] = data["receiptDate"] || kstFormat(submittedAt, "M월 d일");
    base["접수"] = data["receiptTime"] || kstFormat(submittedAt, "HH:mm");
    base["접수자"] = data["receiptAuthor"] || request.author;
  }
  if (Object.prototype.hasOwnProperty.call(base, header)) return base[header];

  let sheetValues: Record<string, string> | null = null;
  try { sheetValues = data["_sheetValues"] ? JSON.parse(String(data["_sheetValues"])) : null; } catch { sheetValues = null; }
  const rawSheetValues = (data as unknown as { _sheetValues?: unknown })._sheetValues;
  if (rawSheetValues && typeof rawSheetValues === "object") sheetValues = rawSheetValues as Record<string, string>;
  if (sheetValues && Object.prototype.hasOwnProperty.call(sheetValues, header)) return sheetValues[header];

  const map = FIELD_MAPS[category] || {};
  let key = map[header] || map[String(header).trim()];
  if (!key) {
    const squeezedHeader = squeeze(header);
    for (const mapKey of Object.keys(map)) {
      if (squeeze(mapKey) === squeezedHeader) { key = map[mapKey]; break; }
    }
  }
  if (!key) return undefined;
  if (key === "_author") return request.author;
  if (key === "_webInput") return "웹앱 직접입력";
  if (key === "_complaintReceipt") return "불만접수";
  if (key === "_contactName" || key === "_contactPhone") {
    const contact = String(data["담당자"] || labels["담당자/연락처"] || "").trim();
    const phone = (contact.match(/01[016-9][-\s.]?\d{3,4}[-\s.]?\d{4}/) || [""])[0];
    return key === "_contactPhone" ? phone : (contact.replace(phone, "").trim() || contact);
  }
  if (data[key] !== undefined && data[key] !== "") return data[key];
  if (labels[header] !== undefined) return labels[header];
  return labels[key];
}

/** 열번호→값 맵을 연속 구간으로 묶어 batch 기입 (GAS writeRowValues_ 이식) */
function segmentsOf(row: number, title: string, valueByCol: Record<number, string>): Array<{ range: string; values: string[][] }> {
  const cols = Object.keys(valueByCol).map(Number).sort((a, b) => a - b);
  const out: Array<{ range: string; values: string[][] }> = [];
  let start = -1, prev = -1, buffer: string[] = [];
  const flush = () => {
    if (start < 0) return;
    out.push({ range: `${quoteTitle(title)}!${colA1(start)}${row}:${colA1(start + buffer.length - 1)}${row}`, values: [buffer] });
    start = -1; buffer = [];
  };
  for (const col of cols) {
    if (start >= 0 && col !== prev + 1) flush();
    if (start < 0) start = col;
    buffer.push(valueByCol[col]);
    prev = col;
  }
  flush();
  return out;
}

/** 임대리스트 순번 조회 → 값 기입 (복합기 fillCopierLeaseValues_ / 원격 fillRemoteLeaseValues_ 이식) */
async function fillLeaseValues(
  spreadsheetId: string, title: string, row: number,
  category: string, data: Record<string, string>,
): Promise<void> {
  const no = String((category === "reception_copier" ? data["firstNo"] : data["leaseNo"]) || "").trim();
  if (!no) return;
  const leaseCol = await getValues(spreadsheetId, `${quoteTitle("임대리스트")}!A2:A`).catch(() => [] as string[][]);
  if (!leaseCol.length) return;
  let leaseRow = 0;
  for (let i = leaseCol.length - 1; i >= 0; i--) {
    if (String(leaseCol[i][0] || "").trim() === no) { leaseRow = i + 2; break; }
  }
  if (!leaseRow) return; // 못 찾으면 수식 폴백

  // 행 전체를 읽는다 — 임대리스트는 300열 이상(LF열대)이라 범위를 자르면
  // 뒤쪽 열(예: 79열 업체명)이 빈 값으로 잘려 수식을 공백으로 덮는 사고가 났다
  const leaseHeaders = (await getValues(spreadsheetId, `${quoteTitle("임대리스트")}!1:1`))[0] || [];
  const leaseValues = (await getValues(spreadsheetId, `${quoteTitle("임대리스트")}!${leaseRow}:${leaseRow}`))[0] || [];

  let overrides: Record<string, string> = {};
  try { overrides = JSON.parse(String(data["leaseFix"] || "{}")) || {}; } catch { overrides = {}; }
  const srcValue = (srcCol: number): string => {
    if (srcCol < 1 || srcCol > leaseValues.length) return "";
    const headerName = String(leaseHeaders[srcCol - 1] || "").trim();
    if (headerName && Object.prototype.hasOwnProperty.call(overrides, headerName) && String(overrides[headerName]) !== "") {
      return String(overrides[headerName]);
    }
    return String(leaseValues[srcCol - 1] ?? "");
  };

  if (category === "reception_copier") {
    const idxRow = (await getValues(spreadsheetId, `${quoteTitle(title)}!A6:AU6`))[0] || []; // 6행 = 원본 열 번호
    const targets = [7, 8, 13, 14, 15, 17];
    for (let col = 21; col <= 47; col++) targets.push(col);
    const out: Record<number, string> = {};
    for (const col of targets) {
      const srcCol = Number(idxRow[col - 1] || 0);
      if (!srcCol) continue;
      out[col] = col === 24 ? `${srcValue(srcCol)} / ${srcValue(srcCol + 1) || " "}` : srcValue(srcCol);
    }
    await batchSetValues(spreadsheetId, segmentsOf(row, title, out));
  } else if (category === "reception_remote") {
    const idxRow = (await getValues(spreadsheetId, `${quoteTitle(title)}!A4:AF4`))[0] || []; // 4행 = 원본 열 번호
    const srcOf = (col: number) => Number(idxRow[col - 1] || 0);
    const adText = srcOf(30) ? srcValue(srcOf(30)) : "";
    const out: Record<number, string> = {};
    for (const col of [14, 15, 16, 17, 20, 22, 26, 27, 32]) {
      if (srcOf(col)) out[col] = srcValue(srcOf(col));
    }
    if (srcOf(18)) out[18] = `${srcValue(srcOf(18))} ${srcValue(srcOf(18) + 1)}`;
    if (srcOf(19)) out[19] = `${srcValue(srcOf(19))} ${adText.substring(6, 9)}`;
    if (srcOf(30)) out[30] = adText;
    await batchSetValues(spreadsheetId, segmentsOf(row, title, out));
  }
}

/** appendFieldSheetRow_ 이식 — 성공 시 { row, sheet } 반환, 실패 시 throw (호출부가 GAS 폴백) */
export async function appendViaSheetsApi(
  request: SheetApiRequest,
  env: { rest: string; headers: Record<string, string> },
): Promise<{ row: number; sheet: string; updated?: boolean }> {
  const config = FIELD_SHEETS[request.category];
  if (!config) throw new Error("지원하지 않는 동기화 종류입니다.");

  // 잠금 획득과 정적 읽기(문서 메타·헤더)는 서로 독립 — 병렬로 시작해 왕복을 아낀다
  const lockPromise = acquireLock(env.rest, env.headers);
  const staticPromise = (async () => {
    const meta = await spreadsheetMeta(config.spreadsheetId);
    const sheetMeta = meta.sheets.get(config.sheetId);
    if (!sheetMeta) throw new Error("대상 시트 탭을 찾지 못했습니다.");
    const top = await getValues(config.spreadsheetId, `${quoteTitle(sheetMeta.title)}!1:20`);
    return { sheetMeta, top };
  })();
  const [lockToken, staticData] = await Promise.all([lockPromise, staticPromise.catch((e) => e as Error)]);
  try {
    if (staticData instanceof Error) throw staticData;
    const { sheetMeta, top } = staticData;
    const title = sheetMeta.title;
    const T = quoteTitle(title);
    const headerRow = findHeaderRow(top, request.category);
    const headers = top[headerRow - 1] || [];
    const lastColumn = Math.max(headers.length, 1);
    const bodyStart = headerRow + 1;

    // 본문은 전체가 아니라 "판단에 필요한 열"만 한 번의 batchGet으로 읽는다
    // (원격 탭 700행×32열 통읽기가 기입 시간의 절반을 먹던 병목)
    const dataPre = request.payload?.data || {};
    const neededCols = new Set<number>();
    const jobIdColPre = headers.indexOf("웹앱 전송ID") + 1;
    if (jobIdColPre > 0) neededCols.add(jobIdColPre);
    const markerHeaderNames = request.category === "reception_remote" ? ["접수일", "접수자", "유입경로"]
      : request.category === "praise" ? ["날짜", "직원", "거래처명"]
      : ["날짜", "접수자", "퍼스트순"];
    for (const name of markerHeaderNames) {
      const col = headers.indexOf(name) + 1;
      if (col > 0) neededCols.add(col);
    }
    const updKeyCol = Number(dataPre["_updateKeyColumn"] || 0) || (dataPre["_updateKeyHeader"] ? headers.indexOf(String(dataPre["_updateKeyHeader"])) + 1 : 0);
    if (updKeyCol > 0) neededCols.add(updKeyCol);
    const findKeyCol = Number(dataPre["_findKeyColumn"] || 0) || (dataPre["_findKeyHeader"] ? headers.indexOf(String(dataPre["_findKeyHeader"])) + 1 : 0);
    if (findKeyCol > 0) neededCols.add(findKeyCol);
    if (request.category === "reception_remote") neededCols.add(2); // B열 — 순번 계산 재료

    const colList = [...neededCols].sort((a, b) => a - b);
    const colRanges = colList.map((col) => `${T}!${colA1(col)}${bodyStart}:${colA1(col)}`);
    const fetched = await batchGetValues(config.spreadsheetId, colRanges);
    const colValues = new Map<number, string[]>();
    colList.forEach((col, i) => {
      colValues.set(col, (fetched.get(colRanges[i]) || []).map((row) => String(row[0] ?? "")));
    });
    let lastRow = bodyStart - 1;
    for (const values of colValues.values()) lastRow = Math.max(lastRow, bodyStart + values.length - 1);
    const cellAt = (row: number, col: number) => String((colValues.get(col) || [])[row - bodyStart] ?? "");

    const rawData = request.payload?.data || {};
    const data: Record<string, string> = {};
    for (const key of Object.keys(rawData)) {
      const v = rawData[key];
      data[key] = typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    if (rawData["_sheetValues"] && typeof rawData["_sheetValues"] === "object") {
      (data as unknown as Record<string, unknown>)["_sheetValues"] = rawData["_sheetValues"];
    }
    const labelValues = parseLabeledText(request.sourceText || "");

    // 멱등성: 같은 jobId가 이미 있으면 그 행 반환
    const jobIdCol = headers.indexOf("웹앱 전송ID") + 1;
    if (jobIdCol > 0 && request.jobId) {
      for (let r = bodyStart; r <= lastRow; r++) {
        if (cellAt(r, jobIdCol).trim() === String(request.jobId)) return { row: r, sheet: title };
      }
    }

    const valuesForRow = (row: number): Record<number, string> => {
      const out: Record<number, string> = {};
      headers.forEach((header, index) => {
        const value = fieldValue(request.category, header, index + 1, data, request, labelValues);
        if (value !== undefined && value !== "") out[index + 1] = value;
      });
      return out;
    };

    // 갱신 모드 (행 번호 + 키 검증)
    const updateOnly = String(data["_updateOnly"] || "") === "1";
    const updateRow = Number(data["_updateRow"] || 0);
    if (updateRow > headerRow && updateRow <= lastRow) {
      const keyHeader = String(data["_updateKeyHeader"] || "");
      const keyValue = String(data["_updateKeyValue"] || "");
      const keyCol = Number(data["_updateKeyColumn"] || 0) || (keyHeader ? headers.indexOf(keyHeader) + 1 : 0);
      const keyOk = !keyHeader || (keyCol > 0 && norm(cellAt(updateRow, keyCol)) === norm(keyValue));
      if (keyOk) {
        await batchSetValues(config.spreadsheetId, segmentsOf(updateRow, title, valuesForRow(updateRow)));
        return { row: updateRow, sheet: title, updated: true };
      }
    }

    // 찾기 갱신 모드 (키 값으로 아래→위 검색, 새 행 금지)
    const findValue = String(data["_findKeyValue"] || "").trim();
    if (findValue) {
      const findHeader = String(data["_findKeyHeader"] || "");
      const findCol = Number(data["_findKeyColumn"] || 0) || (findHeader ? headers.indexOf(findHeader) + 1 : 0);
      if (findCol > 0) {
        for (let r = lastRow; r >= bodyStart; r--) {
          if (norm(cellAt(r, findCol)) === norm(findValue)) {
            await batchSetValues(config.spreadsheetId, segmentsOf(r, title, valuesForRow(r)));
            return { row: r, sheet: title, updated: true };
          }
        }
      }
      throw new Error(`찾기 갱신 실패: ${findHeader || findCol}=${findValue} 행 없음`);
    }
    if (updateOnly) throw new Error("갱신 대상 행을 찾지 못했습니다 (새 행 추가 금지)");

    // 행 재사용: 마커 열(직접 입력 열)로 마지막 데이터 행을 찾는다
    const DATA_START: Record<string, number> = { reception_remote: 5, reception_copier: 8, reception_copier_new: 8, praise: headerRow + 1 };
    const dataStart = DATA_START[request.category] || 0;
    let row = 0;
    let reusedRow = false;
    if (dataStart && lastRow >= dataStart) {
      const markerHeaders = request.category === "reception_remote" ? ["접수일", "접수자", "유입경로"]
        : request.category === "praise" ? ["날짜", "직원", "거래처명"]
        : ["날짜", "접수자", "퍼스트순"];
      let lastFilled = 0;
      for (const markerHeader of markerHeaders) {
        const markerCol = headers.indexOf(markerHeader) + 1;
        if (markerCol <= 0) continue;
        for (let r = lastRow; r >= dataStart; r--) {
          if (cellAt(r, markerCol).trim() !== "") { if (r > lastFilled) lastFilled = r; break; }
        }
      }
      const candidate = lastFilled ? lastFilled + 1 : dataStart;
      if (candidate <= sheetMeta.maxRows) { row = candidate; reusedRow = true; }
    }
    if (!row) {
      // 새 행 삽입 + 주변 행 수식 복사 (비접수 카테고리 경로)
      const previousRow = Math.max(headerRow + 1, lastRow);
      await batchUpdate(config.spreadsheetId, [{
        insertDimension: { range: { sheetId: config.sheetId, dimension: "ROWS", startIndex: previousRow, endIndex: previousRow + 1 }, inheritFromBefore: true },
      }]);
      row = previousRow + 1;
      // 위로 최대 30행에서 열마다 가장 가까운 수식을 찾아 복사
      const scanFrom = Math.max(headerRow + 1, row - 30);
      const formulas = await getValues(config.spreadsheetId, `${T}!A${scanFrom}:${colA1(lastColumn)}${row - 1}`, "FORMULA");
      const sourceRowOf: number[] = [];
      for (let col = 0; col < lastColumn; col++) {
        let found = 0;
        for (let r = formulas.length - 1; r >= 0; r--) {
          if (String(formulas[r]?.[col] || "").startsWith("=")) { found = scanFrom + r; break; }
        }
        sourceRowOf.push(found);
      }
      const copyRequests: unknown[] = [];
      let gStart = -1;
      for (let i = 0; i <= lastColumn; i++) {
        const same = i < lastColumn && sourceRowOf[i] > 0 && (gStart < 0 || sourceRowOf[i] === sourceRowOf[gStart]);
        if (same && gStart < 0) gStart = i;
        else if (!same && gStart >= 0) {
          const src = sourceRowOf[gStart];
          copyRequests.push({
            copyPaste: {
              source: { sheetId: config.sheetId, startRowIndex: src - 1, endRowIndex: src, startColumnIndex: gStart, endColumnIndex: i },
              destination: { sheetId: config.sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: gStart, endColumnIndex: i },
              pasteType: "PASTE_FORMULA",
            },
          });
          gStart = i < lastColumn && sourceRowOf[i] > 0 ? i : -1;
        }
      }
      await batchUpdate(config.spreadsheetId, copyRequests);
    }

    // 값 기입 (연속 구간 일괄) — 원격 A열 순번도 같은 batch에 포함 (별도 왕복 제거)
    const rowValues = valuesForRow(row);
    if (request.category === "reception_remote") {
      const bColumn = colValues.get(2) || [];
      let seq = 0;
      for (let r = 5; r < row; r++) { if (String(bColumn[r - bodyStart] ?? "").trim() !== "") seq++; }
      const willWriteB = rowValues[2] !== undefined && String(rowValues[2]).trim() !== "";
      rowValues[1] = String(seq + (willWriteB ? 1 : 0));
    }
    await batchSetValues(config.spreadsheetId, segmentsOf(row, title, rowValues));

    if (request.category === "contact_change") {
      const formula = (await getValues(config.spreadsheetId, `${T}!M${row}`, "FORMULA"))[0]?.[0] || "";
      if (!String(formula).startsWith("=")) {
        await setValues(config.spreadsheetId, `${T}!M${row}`, [['=LET(v, INDEX($G:$G, ROW()), IF(v="","", COUNTIF($G$3:INDEX($G:$G, ROW()), v) & "차"))']]);
      }
    }
    if (request.category === "reception_copier" && data["firstNo"]) {
      try { await fillLeaseValues(config.spreadsheetId, title, row, "reception_copier", data); } catch { /* 수식 폴백 */ }
    }
    if (request.category === "reception_remote" && data["leaseNo"]) {
      try { await fillLeaseValues(config.spreadsheetId, title, row, "reception_remote", data); } catch { /* 수식 폴백 */ }
    }
    return { row, sheet: title };
  } finally {
    await releaseLock(env.rest, env.headers, lockToken);
  }
}
