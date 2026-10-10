/**
 * 통합 검색 360 — 자산기번·시리얼·업체명 어느 하나로 "회사에 있는 모든 기록"을 모아 온다 (2026-10-10).
 *
 * 구조(4층)
 *  1. 식별자: 검색어 → 거래처 코드. 기번·자산번호는 lease_ident_code, 이름은 vendor_match_alias·vendor_master, 임대리스트(vendor_info) 직접 조회로 후보를 뽑는다.
 *  2. 키 묶음: 코드 하나에 딸린 이름 변형·기번·자산번호를 전부 모은다(임대리스트 행 + 마스터 별칭) — 표마다 표기가 달라도 같은 업체로 이어진다.
 *  3. 수집: 아래 SOURCES 표마다 "이름 정확 일치 or 기기 번호 일치 or 원문에 기번 포함"으로 한 번씩 조회(병렬). 코드가 직접 들어 있는 표(as_tickets.vendor_code, misu.거래처코드, workin_vendor_code)는 코드로.
 *     이름이 "비슷한" 기록은 따로(loose) 모아 확인용으로 보여 준다 — 조용히 섞지 않는다.
 *  4. 현재 상태: 임대리스트·담당자 변경·미수·초과·재계약·불만·마지막 점검/AS·열린 접수·일정·워킨맵에서 "지금"을 뽑는다(deriveState).
 *
 * 화면은 Search360.tsx. 이 파일은 React 없이 순수 로직 — 테스트 가능(tests/entity360.test.ts).
 */
import { historyCoreName, vendorMatchKey } from "./ids";
import { ACTIVITY_LABELS } from "./operations";
import { selectRows } from "./supabase";

/**
 * 코드 체계가 둘이다(2026-10-10 실측):
 *  - 마스터 코드(10자리, 사업자번호 모양): vendor_master · vendor_match_alias · lease_ident_code · workin_vendor_code · as_tickets.vendor_code · misu.거래처코드
 *  - 임대 코드(5자리): vendor_info.코드 — 관리부 마감 목록 맨 앞 번호("21638 / SL-X7400…")도 이것
 * 둘은 이름으로 잇는다(vendor_master.aliases 가 임대리스트 표기 그대로라 _업체명 in(…) 으로 정확히 붙는다).
 */

export type Row = Record<string, unknown>;
export type Group = "기기·계약" | "현장 기록" | "영업·관리" | "고객 소통" | "기타";
export type SourceDef = {
  table: string; label: string; group: Group; tone: string;
  nameCols: string[];       // 업체명 정확 일치(in) 칸
  deviceCols: string[];     // 기번·자산번호 정확 일치(in) 칸
  rawCols: string[];        // 원문 — 기번이 글 속에 있는 경우 ilike
  looseCols?: string[];     // 이름 "비슷한" 기록을 찾을 칸(ilike core) — 기본은 nameCols
  codeCol?: string;         // 거래처 코드가 직접 든 칸
  codeKind?: "master" | "lease"; // codeCol 의 코드 체계(기본 master)
  hidden?: string;          // 숨김·삭제 제외 조건
  dateKeys: string[]; titleKeys: string[]; snippetKeys: string[]; authorKeys: string[]; teamKeys: string[];
  modelKeys: string[]; serialKeys: string[]; assetKeys: string[];
  titleFn?: (row: Row) => string; // 제목을 칸 그대로가 아니라 바꿔 보여야 할 때(활동 종류 코드 → 한글)
  select?: string; limit?: number;
};

const T = {
  lease: "bg-emerald-50 text-emerald-800 border-emerald-200", jeom: "bg-blue-50 text-blue-800 border-blue-200", as: "bg-violet-50 text-violet-800 border-violet-200",
  recv: "bg-sky-50 text-sky-800 border-sky-200", ticket: "bg-indigo-50 text-indigo-800 border-indigo-200", visit: "bg-slate-100 text-slate-700 border-slate-200",
  contact: "bg-amber-50 text-amber-800 border-amber-200", logi: "bg-yellow-50 text-yellow-800 border-yellow-200", bulman: "bg-red-50 text-red-800 border-red-200",
  misu: "bg-orange-50 text-orange-800 border-orange-200", over: "bg-purple-50 text-purple-800 border-purple-200", recon: "bg-rose-50 text-rose-800 border-rose-200",
  exp: "bg-teal-50 text-teal-800 border-teal-200", msg: "bg-lime-50 text-lime-800 border-lime-200", photo: "bg-pink-50 text-pink-800 border-pink-200",
  map: "bg-cyan-50 text-cyan-800 border-cyan-200", note: "bg-stone-100 text-stone-700 border-stone-200",
};

export const SOURCES: SourceDef[] = [
  { table: "vendor_info", label: "임대리스트", group: "기기·계약", tone: T.lease, nameCols: ["_업체명"], deviceCols: ["자산번호", "기번", "시리얼번호(기번)"], rawCols: ["_원문"], codeCol: "코드", codeKind: "lease", hidden: "_hidden=not.is.true",
    dateKeys: ["계약일", "첫계약일"], titleKeys: ["모델명", "기종", "품목"], snippetKeys: ["임대여부", "주소상세주소"], authorKeys: [], teamKeys: [], modelKeys: ["모델명", "기종"], serialKeys: ["기번", "시리얼번호(기번)"], assetKeys: ["자산번호"] },
  { table: "lease_status", label: "납품·교체", group: "기기·계약", tone: T.lease, nameCols: ["_업체명"], deviceCols: [], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["납품일", "년월"], titleKeys: ["구분", "분류"], snippetKeys: ["기종", "품목", "납품여부", "교체전기종"], authorKeys: ["담당자", "납품담당"], teamKeys: ["지역"], modelKeys: ["기종"], serialKeys: [], assetKeys: [] },
  { table: "jeomgeom", label: "점검", group: "현장 기록", tone: T.jeom, nameCols: ["_업체명", "업체명"], deviceCols: ["자산기번", "시리얼넘버"], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["작성일"], titleKeys: ["처리내용", "내용"], snippetKeys: ["특이사항", "매수", "토너잔량"], authorKeys: ["작성자"], teamKeys: ["지역"], modelKeys: ["모델명"], serialKeys: ["시리얼넘버"], assetKeys: ["자산기번"] },
  { table: "as_records", label: "AS", group: "현장 기록", tone: T.as, nameCols: ["_업체명", "업체명"], deviceCols: ["자산기번", "시리얼넘버"], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["작성일"], titleKeys: ["내용", "처리내용"], snippetKeys: ["처리내용", "특이사항"], authorKeys: ["작성자"], teamKeys: ["지역"], modelKeys: ["모델명"], serialKeys: ["시리얼넘버"], assetKeys: ["자산기번"] },
  { table: "service_receptions", label: "접수", group: "현장 기록", tone: T.recv, nameCols: ["vendor"], deviceCols: ["asset_no", "serial"], rawCols: ["symptom", "report_text"], hidden: "deleted=is.false",
    dateKeys: ["receipt_date", "created_at"], titleKeys: ["title", "symptom"], snippetKeys: ["status", "type", "field"], authorKeys: ["author"], teamKeys: ["region"], modelKeys: ["model"], serialKeys: ["serial"], assetKeys: ["asset_no"] },
  { table: "as_tickets", label: "일정", group: "현장 기록", tone: T.ticket, nameCols: ["vendor"], deviceCols: ["serial", "asset"], rawCols: ["issue"], codeCol: "vendor_code",
    dateKeys: ["date"], titleKeys: ["scheduleType"], snippetKeys: ["issue", "status", "assignee"], authorKeys: ["assignee"], teamKeys: ["team"], modelKeys: ["model"], serialKeys: ["serial"], assetKeys: ["asset"] },
  { table: "visit_logs", label: "방문기록", group: "현장 기록", tone: T.visit, nameCols: ["vendor"], deviceCols: [], rawCols: ["source_text"], hidden: "status=neq.cancelled",
    dateKeys: ["work_date"], titleKeys: ["work_kinds"], snippetKeys: ["note", "machine_count"], authorKeys: ["author"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "activity_events", label: "활동", group: "현장 기록", tone: T.visit, nameCols: ["vendor"], deviceCols: [], rawCols: ["source_text"], hidden: "status=neq.cancelled",
    dateKeys: ["activity_date"], titleKeys: ["category"], snippetKeys: ["quantity", "machine_count"], authorKeys: ["author"], teamKeys: ["team"], modelKeys: [], serialKeys: [], assetKeys: [],
    titleFn: (row) => (ACTIVITY_LABELS as Record<string, string>)[str(row, "category")] || str(row, "category") },
  { table: "logistics_records", label: "물류", group: "현장 기록", tone: T.logi, nameCols: ["_업체명", "거래처명"], deviceCols: [], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["작성일"], titleKeys: ["구분"], snippetKeys: ["품목", "수량", "특이사항"], authorKeys: ["작성자"], teamKeys: [], modelKeys: ["품목"], serialKeys: [], assetKeys: [] },
  { table: "contact_changes", label: "담당자·주소 변경", group: "고객 소통", tone: T.contact, nameCols: ["company"], deviceCols: [], rawCols: ["source_text"], hidden: "_hidden=not.is.true",
    dateKeys: ["change_date", "created_at"], titleKeys: ["category"], snippetKeys: ["after_text", "reason"], authorKeys: ["author"], teamKeys: ["region"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "bulman", label: "불만", group: "영업·관리", tone: T.bulman, nameCols: ["_업체명", "업체명"], deviceCols: [], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["날짜", "방문일"], titleKeys: ["불만내용", "불편내용"], snippetKeys: ["조치내용", "최종상태", "불만정도"], authorKeys: ["작성자", "처리자"], teamKeys: ["지역"], modelKeys: ["기종"], serialKeys: [], assetKeys: [] },
  { table: "misu", label: "미수", group: "영업·관리", tone: T.misu, nameCols: ["_업체명", "업체명"], deviceCols: [], rawCols: ["_원문"], codeCol: "거래처코드", hidden: "_hidden=not.is.true",
    dateKeys: ["입력일"], titleKeys: ["미수개월"], snippetKeys: ["미수잔액", "방문내용", "입금약속일"], authorKeys: ["입력자", "작성자"], teamKeys: ["지역"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "overage", label: "초과료", group: "영업·관리", tone: T.over, nameCols: ["_업체명"], deviceCols: ["자산번호"], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["날짜"], titleKeys: ["접수내용"], snippetKeys: ["합계", "마감방식", "특이사항"], authorKeys: [], teamKeys: [], modelKeys: ["모델명"], serialKeys: [], assetKeys: ["자산번호"] },
  { table: "overage_adjust", label: "초과조정", group: "영업·관리", tone: T.over, nameCols: ["_업체명", "업체명"], deviceCols: [], rawCols: ["_원문", "원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["방문일"], titleKeys: ["제안"], snippetKeys: ["진행상태", "현재조건", "고객반응"], authorKeys: ["작성자"], teamKeys: ["지역"], modelKeys: ["기종"], serialKeys: [], assetKeys: [] },
  { table: "recontract", label: "재계약", group: "영업·관리", tone: T.recon, nameCols: ["_업체명", "업체명"], deviceCols: [], rawCols: ["_원문", "원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["날짜", "제안일자"], titleKeys: ["진행상황", "갱신상태"], snippetKeys: ["내용", "결과", "계약종료일"], authorKeys: ["작성자"], teamKeys: ["담당팀", "지역"], modelKeys: ["기종"], serialKeys: [], assetKeys: [] },
  { table: "pc_expansion", label: "PC 확장성", group: "영업·관리", tone: T.exp, nameCols: ["_업체명"], deviceCols: [], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["날짜"], titleKeys: ["렌탈or구매or유지보수", "세부사양"], snippetKeys: ["어필 OR 추가영업", "포인트"], authorKeys: ["작성자"], teamKeys: ["지역"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "mfp_expansion", label: "복합기 확장성", group: "영업·관리", tone: T.exp, nameCols: ["_업체명", "상호"], deviceCols: [], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["등록일", "체크일"], titleKeys: ["품목(원문)", "프로젝트"], snippetKeys: ["영업진행상황", "최종결과(대기 등)"], authorKeys: ["등록자", "전략영업담당자"], teamKeys: ["미팅지역"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "counter_sms_targets", label: "마감 문자", group: "고객 소통", tone: T.msg, nameCols: [], deviceCols: [], rawCols: [], looseCols: ["vendor"],
    dateKeys: ["sent_at", "added_at"], titleKeys: ["vendor"], snippetKeys: ["team", "sent_by", "done_by"], authorKeys: ["sent_by"], teamKeys: ["team"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "report_send_log", label: "리포트 발송", group: "고객 소통", tone: T.msg, nameCols: ["vendor"], deviceCols: [], rawCols: [],
    dateKeys: ["created_at"], titleKeys: ["period"], snippetKeys: ["channel", "recipient_name", "status"], authorKeys: ["sender"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "photo_albums", label: "사진", group: "고객 소통", tone: T.photo, nameCols: ["vendor"], deviceCols: [], rawCols: [],
    dateKeys: ["created_at"], titleKeys: ["category", "source_type"], snippetKeys: [], authorKeys: ["author"], teamKeys: ["region"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "vendor_notes", label: "특이사항", group: "기타", tone: T.note, nameCols: ["vendor"], deviceCols: [], rawCols: [],
    dateKeys: ["updated_at", "created_at"], titleKeys: ["note"], snippetKeys: ["work_start", "lunch_time"], authorKeys: ["author"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "workin_map_places", label: "워킨맵", group: "기타", tone: T.map, nameCols: [], deviceCols: [], rawCols: [], looseCols: ["name"],
    dateKeys: ["updated_at"], titleKeys: ["kind"], snippetKeys: ["label", "address", "comment"], authorKeys: ["updated_by"], teamKeys: ["team"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "stock_items", label: "재고", group: "기타", tone: T.note, nameCols: [], deviceCols: [], rawCols: ["name", "note"], hidden: "_hidden=not.is.true",
    dateKeys: ["updated_at", "created_at"], titleKeys: ["name"], snippetKeys: ["kind", "condition", "qty", "note"], authorKeys: ["updated_by"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [] },
];

// ── 문자열·날짜 도우미 ─────────────────────────────────────────
export const str = (row: Row, key: string): string => String(row[key] ?? "").replace(/_x000d_|\r/g, "").trim();
export const firstOf = (row: Row, keys: string[]): string => { for (const k of keys) { const v = str(row, k); if (v && v !== "null") return v; } return ""; };
/** 기번·자산번호 비교 키 — lease_ident_code.ident 와 같은 규칙(소문자, 영숫자만) */
export const identKey = (s: string): string => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** 표마다 다른 날짜 형식을 yyyy-mm-dd 로 ("2026.9.3", "26-09-03", ISO 모두). 못 읽으면 "" */
export function dateOf(row: Row, keys: string[]): string {
  const raw = firstOf(row, keys) || str(row, "created_at");
  const m = raw.match(/(\d{4}|\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (!m) return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
  const y = m[1].length === 2 ? `20${m[1]}` : m[1];
  return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}
export const daysSince = (ymd: string, today = new Date()): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T12:00:00+09:00`).getTime();
  return Number.isFinite(d) ? Math.max(0, Math.floor((today.getTime() - d) / 86_400_000)) : null;
};

// ── PostgREST 조건 조립 ───────────────────────────────────────
const col = (c: string) => encodeURIComponent(/[^A-Za-z0-9_]/.test(c) ? `"${c}"` : c);
const enc = (v: string) => encodeURIComponent(v);
/** in.("a","b") — 값에 쉼표·괄호·공백이 있어도 안전하게 */
export const inList = (values: string[]) => `in.(${values.map((v) => `"${enc(v.replace(/"/g, ""))}"`).join(",")})`;
const uniq = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter((x) => x && x !== "null")));
/** 가장 많이 나온 값(빈 값 제외) */
const mode = (xs: string[]) => { const m = new Map<string, number>(); xs.filter(Boolean).forEach((x) => m.set(x, (m.get(x) || 0) + 1)); return Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };

// ── 1층: 검색어 → 거래처 코드 후보 ──────────────────────────────
/** code = 마스터 코드(없으면 ""), leaseCode = 임대리스트 코드(없으면 "") — 둘 중 하나는 있다 */
export type Candidate = { code: string; leaseCode: string; name: string; deviceCount: number; how: string };
type MasterRow = { code: string; name: string; aliases?: string[] | null; device_count?: number | null };

export const looksLikeDevice = (q: string) => /^[A-Za-z0-9\-/.#]+$/.test(q) && /\d/.test(q) && q.length >= 3;

export async function resolveCandidates(query: string): Promise<Candidate[]> {
  const raw = query.trim();
  if (!raw) return [];
  const ik = identKey(raw);
  const mk = vendorMatchKey(raw);
  const device = looksLikeDevice(raw);
  const safe = <X,>(p: Promise<X[]>) => p.catch(() => [] as X[]);
  const [byIdent, byAlias, byAliasLike, byMaster, byInfo] = await Promise.all([
    device ? safe(selectRows<{ ident: string; code: string }>("lease_ident_code", `select=ident,code&ident=eq.${enc(ik)}&limit=10`)) : Promise.resolve([]),
    mk.length >= 2 ? safe(selectRows<{ akey: string; code: string }>("vendor_match_alias", `select=akey,code&akey=eq.${enc(mk)}&limit=20`)) : Promise.resolve([]),
    mk.length >= 2 ? safe(selectRows<{ akey: string; code: string }>("vendor_match_alias", `select=akey,code&akey=ilike.*${enc(mk)}*&limit=60`)) : Promise.resolve([]),
    raw.length >= 2 ? safe(selectRows<MasterRow>("vendor_master", `select=code,name,aliases,device_count&name=ilike.*${enc(raw)}*&limit=40`)) : Promise.resolve([]),
    // 임대리스트 직접 — ident 표가 아직 없는 새 기기·자산번호 변형 대비
    device ? safe(selectRows<Row>("vendor_info", `select=${enc("코드,_업체명")}&or=(${["자산번호", "기번", "시리얼번호(기번)"].map((c) => `${col(c)}.ilike.*${enc(raw)}*`).join(",")})&_hidden=not.is.true&limit=20`)) : Promise.resolve([]),
  ]);
  const how = new Map<string, string>();           // 마스터 코드 → 근거
  const put = (code: string, reason: string) => { const c = String(code || "").trim(); if (c && !how.has(c)) how.set(c, reason); };
  byIdent.forEach((r) => put(r.code, "기번·자산번호 일치"));
  byAlias.forEach((r) => put(r.code, "업체명 일치"));
  byMaster.forEach((r) => put(r.code, "업체명 포함"));
  byAliasLike.forEach((r) => put(r.code, "업체명 유사"));
  // 임대리스트 직접 일치는 임대 코드(5자리)라 마스터와 다르다 — 이름으로 마스터를 찾아 잇고, 못 찾으면 임대 코드만 가진 후보로 남긴다
  const leaseHits = new Map<string, string>();     // 임대 코드 → 이름
  byInfo.forEach((r) => { const c = str(r, "코드"); if (c && !leaseHits.has(c)) leaseHits.set(c, str(r, "_업체명")); });
  const leaseNames = uniq(Array.from(leaseHits.values()));
  const mastersByName = leaseNames.length ? await safe(selectRows<MasterRow>("vendor_master", `select=code,name,aliases,device_count&or=(name.${inList(leaseNames)},aliases.cs.${encodeURIComponent(JSON.stringify(leaseNames.slice(0, 1)))})&limit=20`)) : [];
  const masterOfName = new Map<string, MasterRow>();
  mastersByName.forEach((m) => { [m.name, ...(Array.isArray(m.aliases) ? m.aliases.map(String) : [])].forEach((n) => masterOfName.set(n, m)); });
  const leaseOnly: Candidate[] = [];
  const leaseCodeOfMaster = new Map<string, string>();
  leaseHits.forEach((name, leaseCode) => {
    const m = masterOfName.get(name);
    if (m) { put(m.code, "임대리스트 기기 번호 일치"); leaseCodeOfMaster.set(m.code, leaseCode); }
    else leaseOnly.push({ code: "", leaseCode, name: name || `임대 코드 ${leaseCode}`, deviceCount: 0, how: "임대리스트 기기 번호 일치" });
  });
  if (!how.size && !leaseOnly.length) return [];
  const codes = Array.from(how.keys()).slice(0, 40);
  const masters = codes.length ? await safe(selectRows<MasterRow>("vendor_master", `select=code,name,aliases,device_count&code=${inList(codes)}`)) : [];
  const byCode = new Map(masters.map((m) => [m.code, m]));
  const rank = (h: string) => ["기번·자산번호 일치", "임대리스트 기기 번호 일치", "업체명 일치", "업체명 포함", "업체명 유사"].indexOf(h);
  return [
    ...codes.map((code) => ({ code, leaseCode: leaseCodeOfMaster.get(code) || "", name: byCode.get(code)?.name || `코드 ${code}`, deviceCount: Number(byCode.get(code)?.device_count || 0), how: how.get(code) || "" })),
    ...leaseOnly,
  ].sort((a, b) => rank(a.how) - rank(b.how) || b.deviceCount - a.deviceCount);
}

// ── 2층: 코드 → 키 묶음(이름 변형·기번·자산번호) ──────────────────
export type Entity = {
  code: string; leaseCode: string; name: string; names: string[]; serials: string[]; assets: string[]; core: string; query: string; leaseRows: Row[];
  nameKeys: string[];   // names 의 vendorMatchKey — "무암"·"주식회사 무암"·"주식회사 무암 (Mooam)" 이 같은 키로 모인다(느슨 일치를 정확으로 승격하는 기준)
  deviceKeys: string[]; // serials+assets 의 identKey
};
export const withKeys = (e: Omit<Entity, "nameKeys" | "deviceKeys">): Entity => ({
  ...e,
  nameKeys: uniq([...e.names, e.name].map((n) => vendorMatchKey(n)).filter((k) => k.length >= 2)),
  deviceKeys: uniq([...e.serials, ...e.assets].map(identKey).filter((k) => k.length >= 3)),
});

const leaseQuery = (filter: string) => `select=*&${filter}&_hidden=not.is.true&limit=200`;

export async function buildEntity(candidate: Candidate | null, query: string): Promise<Entity> {
  const raw = query.trim();
  if (!candidate) {
    // 코드를 못 찾은 검색어 — 그래도 이름·번호 그대로 모든 표를 뒤진다(임대리스트에 없는 업체·옛 기기)
    const device = looksLikeDevice(raw);
    return withKeys({ code: "", leaseCode: "", name: raw, names: device ? [] : [raw], serials: device ? [raw] : [], assets: device ? [raw] : [], core: device ? "" : (historyCoreName(raw) || raw), query: raw, leaseRows: [] });
  }
  const safeRows = (p: Promise<Row[]>) => p.catch(() => [] as Row[]);
  const master = candidate.code ? (await selectRows<MasterRow>("vendor_master", `select=code,name,aliases&code=eq.${enc(candidate.code)}&limit=1`).catch(() => [] as MasterRow[]))[0] : undefined;
  const masterNames = uniq([master?.name || "", ...(Array.isArray(master?.aliases) ? master!.aliases!.map(String) : [])]);
  // 임대리스트 행: 임대 코드로, 그리고 마스터 이름·별칭(임대리스트 표기 그대로)으로 — 두 코드 체계를 여기서 잇는다
  const [byLeaseCode, byNames] = await Promise.all([
    candidate.leaseCode ? safeRows(selectRows<Row>("vendor_info", leaseQuery(`${col("코드")}=eq.${enc(candidate.leaseCode)}`))) : Promise.resolve([] as Row[]),
    masterNames.length ? safeRows(selectRows<Row>("vendor_info", leaseQuery(`${col("_업체명")}=${inList(masterNames.slice(0, 25))}`))) : Promise.resolve([] as Row[]),
  ]);
  const seen = new Set<string>();
  const leaseRows = [...byLeaseCode, ...byNames].filter((r) => { const k = String(r.id); if (seen.has(k)) return false; seen.add(k); return true; });
  const leaseCode = candidate.leaseCode || mode(leaseRows.map((r) => str(r, "코드")));
  // 마스터 코드가 없던 임대 전용 후보 — 이제 이름으로 한 번 더 찾아 본다(별칭 표에 같은 키가 있으면)
  let code = candidate.code;
  const firstName = master?.name || candidate.name || str(leaseRows[0] || {}, "_업체명");
  if (!code && firstName) {
    const hit = await selectRows<{ code: string }>("vendor_match_alias", `select=code&akey=eq.${enc(vendorMatchKey(firstName))}&limit=1`).catch(() => [] as { code: string }[]);
    code = hit[0]?.code || "";
  }
  const names = uniq([master?.name || candidate.name, ...masterNames, ...leaseRows.map((r) => str(r, "_업체명"))]).slice(0, 25);
  const serials = uniq(leaseRows.flatMap((r) => [str(r, "기번"), str(r, "시리얼번호(기번)")]).filter((v) => v.length >= 4 && !/^미부착|^없음|트레이/.test(v))).slice(0, 15);
  const assets = uniq(leaseRows.map((r) => str(r, "자산번호")).filter((v) => v.length >= 3 && !/^미부착|^없음/.test(v))).slice(0, 15);
  if (looksLikeDevice(raw) && !serials.some((s) => identKey(s) === identKey(raw)) && !assets.some((a) => identKey(a) === identKey(raw))) serials.push(raw);
  const name = master?.name || candidate.name || firstName;
  return withKeys({ code, leaseCode, name, names, serials, assets, core: historyCoreName(name) || vendorMatchKey(name).slice(0, 6) || name, query: raw, leaseRows });
}

// ── 3층: 표마다 모으기 ────────────────────────────────────────
export type SourceResult = { source: SourceDef; exact: Row[]; loose: Row[]; ok: boolean; error?: string; rawSkipped?: boolean };

const tail = (src: SourceDef) => `${src.hidden ? `&${src.hidden}` : ""}&limit=${src.limit || 400}`;

/** 정확 조건: 코드 eq · 이름 in · 기기 번호 in — 전부 짧은 칸이라 빠르다(원문 검색은 buildRawQuery 로 따로) */
export function buildExactQuery(src: SourceDef, e: Entity): string | null {
  const parts: string[] = [];
  const codeValue = src.codeKind === "lease" ? e.leaseCode : e.code;
  if (src.codeCol && codeValue) parts.push(`${col(src.codeCol)}.eq.${enc(codeValue)}`);
  if (e.names.length) src.nameCols.forEach((c) => parts.push(`${col(c)}.${inList(e.names)}`));
  const devices = uniq([...e.serials, ...e.assets]);
  if (devices.length) src.deviceCols.forEach((c) => parts.push(`${col(c)}.${inList(devices)}`));
  if (!parts.length) return null;
  return `select=${src.select || "*"}&or=(${parts.join(",")})${tail(src)}`;
}
/**
 * 원문 속 기번 검색 — 큰 글 칸을 ilike 로 훑어 느리다(2026-10-10: 잡플러스 기번 3개로 jeomgeom 이 statement timeout).
 * 그래서 따로 던지고 실패해도 정확 결과는 살린다. 길고 고유한 기번 2개만 쓴다. jeomgeom 은 기번 배열(_기번목록) 겹침 검색이 있어 그걸 쓴다.
 */
export function buildRawQuery(src: SourceDef, e: Entity): string | null {
  const devices = uniq([...e.serials, ...e.assets]);
  if (src.table === "jeomgeom" && devices.length) {
    return `select=${src.select || "*"}&${col("_기번목록")}=ov.{${devices.slice(0, 12).map((d) => `"${enc(d.replace(/"/g, ""))}"`).join(",")}}${tail(src)}`;
  }
  const longKeys = e.serials.filter((s) => s.length >= 7).slice(0, 2);
  if (!longKeys.length || !src.rawCols.length) return null;
  const parts = longKeys.flatMap((s) => src.rawCols.map((c) => `${col(c)}.ilike.*${enc(s)}*`));
  return `select=${src.select || "*"}&or=(${parts.join(",")})${src.hidden ? `&${src.hidden}` : ""}&limit=${Math.min(src.limit || 400, 200)}`;
}
/** 느슨 일치를 정확으로 승격하는 기준 — 이름 키가 같거나(표기만 다름) 기기 번호가 같으면 같은 업체·기기다 */
export function matchesEntity(src: SourceDef, row: Row, e: Entity): boolean {
  const nameCols = uniq([...src.nameCols, ...(src.looseCols || []), ...src.titleKeys.filter((k) => /vendor|업체|상호|company|name/.test(k))]);
  for (const c of nameCols) { const v = str(row, c); if (v && e.nameKeys.includes(vendorMatchKey(v))) return true; }
  for (const c of [...src.serialKeys, ...src.assetKeys]) { const v = identKey(str(row, c)); if (v.length >= 3 && e.deviceKeys.includes(v)) return true; }
  const list = row["_기번목록"];
  if (Array.isArray(list) && list.some((v) => e.deviceKeys.includes(identKey(String(v))))) return true;
  return false;
}
export function buildLooseQuery(src: SourceDef, e: Entity): string | null {
  const cols = src.looseCols || src.nameCols;
  if (!e.core || e.core.length < 2 || !cols.length) return null;
  return `select=${src.select || "*"}&or=(${cols.map((c) => `${col(c)}.ilike.*${enc(e.core)}*`).join(",")})${src.hidden ? `&${src.hidden}` : ""}&limit=${src.limit || 200}`;
}

async function gatherWorkin(e: Entity): Promise<Row[]> {
  // 워킨맵은 코드 매칭표(workin_vendor_code)로 정확히 — 이름은 "30S업체명/메모" 표기라 정확 일치가 안 된다
  if (!e.code) return [];
  const links = await selectRows<{ place_id: number }>("workin_vendor_code", `select=place_id&code=eq.${enc(e.code)}&limit=50`).catch(() => [] as { place_id: number }[]);
  if (!links.length) return [];
  return selectRows<Row>("workin_map_places", `select=*&id=in.(${links.map((l) => l.place_id).join(",")})&limit=50`).catch(() => [] as Row[]);
}

export async function gather(e: Entity): Promise<SourceResult[]> {
  return Promise.all(SOURCES.map(async (src): Promise<SourceResult> => {
    try {
      let exact: Row[] = src.table === "vendor_info" ? e.leaseRows : [];
      if (src.table === "workin_map_places") exact = await gatherWorkin(e);
      else if (src.table !== "vendor_info" || !e.leaseRows.length) {
        const q = buildExactQuery(src, e);
        if (q) exact = await selectRows<Row>(src.table, q);
      }
      const seen = new Set(exact.map((r) => String(r.id)));
      const add = (rows: Row[], into: Row[]) => rows.forEach((r) => { const k = String(r.id); if (!seen.has(k)) { seen.add(k); into.push(r); } });
      // 원문 속 기번 — 느릴 수 있어 따로. 실패해도 정확 결과는 그대로 둔다
      let rawSkipped = false;
      const rq = buildRawQuery(src, e);
      if (rq) {
        try { add(await selectRows<Row>(src.table, rq), exact); } catch { rawSkipped = true; }
      }
      // 이름이 비슷한 기록 — 표기만 다른 같은 업체(이름 키 일치)나 같은 기기(번호 일치)는 정확으로 올리고, 나머지만 "확인 필요"로
      const loose: Row[] = [];
      const lq = buildLooseQuery(src, e);
      if (lq) {
        const promoted: Row[] = [];
        for (const r of await selectRows<Row>(src.table, lq)) {
          if (seen.has(String(r.id))) continue;
          (matchesEntity(src, r, e) ? promoted : loose).push(r);
        }
        add(promoted, exact);
      }
      return { source: src, exact, loose, ok: true, rawSkipped };
    } catch (err) {
      return { source: src, exact: [], loose: [], ok: false, error: (err as Error).message.slice(0, 120) };
    }
  }));
}

// ── 사건(타임라인 한 줄) ───────────────────────────────────────
export type EventItem = { key: string; source: SourceDef; row: Row; date: string; title: string; snippet: string; author: string; team: string; model: string; serial: string; asset: string; vendor: string; loose: boolean };

export function toEvent(src: SourceDef, row: Row, loose: boolean): EventItem {
  const title = src.titleFn ? src.titleFn(row) : firstOf(row, src.titleKeys);
  const snippet = src.snippetKeys.map((k) => { const v = str(row, k); return v && v !== title ? v : ""; }).filter(Boolean).join(" · ");
  return {
    key: `${src.table}:${String(row.id ?? "")}`, source: src, row, loose,
    date: dateOf(row, src.dateKeys), title: title.slice(0, 160), snippet: snippet.slice(0, 220),
    author: firstOf(row, src.authorKeys), team: firstOf(row, src.teamKeys),
    model: firstOf(row, src.modelKeys), serial: firstOf(row, src.serialKeys), asset: firstOf(row, src.assetKeys),
    vendor: firstOf(row, [...src.nameCols, ...(src.looseCols || [])]),
  };
}
/** 이 기록의 업체가 검색한 업체와 다른가 — 같은 자산기번이 다른 업체에서 쓰이던 이력(이동 기기)을 표시할 때 */
export const isOtherVendor = (ev: EventItem, e: Entity): boolean => {
  if (!ev.vendor) return false;
  const k = vendorMatchKey(ev.vendor);
  return k.length >= 2 && !e.nameKeys.includes(k) && !e.nameKeys.some((nk) => nk.includes(k) || k.includes(nk));
};
export function toEvents(results: SourceResult[]): EventItem[] {
  const list: EventItem[] = [];
  for (const r of results) {
    r.exact.forEach((row) => list.push(toEvent(r.source, row, false)));
    r.loose.forEach((row) => list.push(toEvent(r.source, row, true)));
  }
  return list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
export const rawTextOf = (row: Row): string => str(row, "_원문") || str(row, "원문") || str(row, "source_text") || str(row, "report_text") || str(row, "symptom") || str(row, "content") || "";

// ── 4층: 현재 상태 ────────────────────────────────────────────
export type Device = { model: string; asset: string; serial: string; start: string; end: string; monthsLeft: string; fee: string; status: string; grade: string; lastInspect: string; lastAs: string };
export type State = {
  address: string; addressFrom: string; keyman: string; keymanFrom: string; tel: string; grade: string; leaseStatus: string;
  devices: Device[];
  misu: { months: string; amount: string; date: string } | null;
  overage: { amount: string; date: string } | null;
  recontract: { status: string; end: string; date: string } | null;
  bulman: { date: string; status: string; text: string } | null;
  lastInspect: string; lastAs: string; lastVisit: string;
  openReceptions: number; upcomingTickets: number; changes: number; photos: number;
  workin: { team: string; quarter: string; kind: string; label: string }[];
  counts: { label: string; group: Group; exact: number; loose: number; ok: boolean; rawSkipped: boolean }[];
  total: number; oldest: string; newest: string;
};

const latest =(events: EventItem[], table: string) => events.filter((ev) => !ev.loose && ev.source.table === table && ev.date).sort((a, b) => b.date.localeCompare(a.date))[0] || null;

export function deriveState(e: Entity, results: SourceResult[], today = new Date()): State {
  const events = toEvents(results);
  const exact = events.filter((ev) => !ev.loose);
  const lease = e.leaseRows.length ? e.leaseRows : (results.find((r) => r.source.table === "vendor_info")?.exact || []);
  const devices: Device[] = lease.map((r) => {
    const serial = str(r, "기번") || str(r, "시리얼번호(기번)"); const asset = str(r, "자산번호");
    const mine = (ev: EventItem) => (serial && identKey(ev.serial) === identKey(serial)) || (asset && identKey(ev.asset) === identKey(asset));
    const li = exact.filter((ev) => ev.source.table === "jeomgeom" && mine(ev))[0]; const la = exact.filter((ev) => ev.source.table === "as_records" && mine(ev))[0];
    return { model: str(r, "모델명") || str(r, "기종"), asset, serial, start: dateOf(r, ["계약일", "첫계약일"]), end: dateOf(r, ["종료일"]), monthsLeft: str(r, "남은개월"), fee: str(r, "기본금액"), status: str(r, "임대여부"), grade: str(r, "등급"), lastInspect: li?.date || "", lastAs: la?.date || "" };
  });
  // 담당자·주소 변경은 종류 글이 자유 입력("주소이전"·"결제 담당자 변경"·"키맨 추가"…) — 주소 계열과 사람 계열로 나눠 각각 최신 것을 본다
  const changes = exact.filter((ev) => ev.source.table === "contact_changes" && ev.date).sort((a, b) => b.date.localeCompare(a.date));
  const addrChange = changes.find((ev) => /주소|이전/.test(str(ev.row, "category")) || /^주소/.test(str(ev.row, "after_text")));
  const keymanChange = changes.find((ev) => /담당|키맨|결제|대표|총괄|번호|직급|계약|신규|카운터/.test(str(ev.row, "category")) && !/주소/.test(str(ev.row, "category")));
  // 임대리스트의 주소 칸(주소상세주소)은 비어 있는 곳이 많다 → 일정·접수·워킨맵·미수·확장성에 적힌 최신 주소로 메운다(출처를 같이 보여 준다)
  const leaseAddr = mode(lease.map((r) => str(r, "주소상세주소")));
  const addrFrom = (table: string, keys: string[], label: string): [string, string] => { const ev = exact.filter((x) => x.source.table === table && firstOf(x.row, keys)).sort((a, b) => b.date.localeCompare(a.date))[0]; return ev ? [firstOf(ev.row, keys), `${label}${ev.date ? ` ${ev.date}` : ""}`] : ["", ""]; };
  const addrCandidates: [string, string][] = [
    [addrChange ? str(addrChange.row, "after_text") : "", addrChange ? `담당자·주소 변경 ${addrChange.date}` : ""],
    [leaseAddr, "임대리스트"],
    addrFrom("as_tickets", ["address"], "일정"), addrFrom("service_receptions", ["address"], "접수"), addrFrom("workin_map_places", ["address"], "워킨맵"),
    addrFrom("misu", ["주소"], "미수"), addrFrom("mfp_expansion", ["도로명주소", "프로젝트주소"], "확장성"),
  ];
  const [address, addressFrom] = addrCandidates.find(([v]) => v) || ["", ""];
  const leaseKeyman = mode(lease.map((r) => str(r, "키맨")));
  const keymanCandidates: [string, string][] = [
    [keymanChange ? str(keymanChange.row, "after_text") : "", keymanChange ? `담당자·주소 변경 ${keymanChange.date}` : ""],
    [leaseKeyman, "임대리스트"],
    addrFrom("service_receptions", ["keyman_info", "receiver_name"], "접수"), addrFrom("as_tickets", ["keyman", "contact"], "일정"),
  ];
  const [keyman, keymanFrom] = keymanCandidates.find(([v]) => v) || ["", ""];
  const misu = latest(events, "misu"); const over = latest(events, "overage"); const recon = latest(events, "recontract"); const bul = latest(events, "bulman");
  const counts = results.map((r) => ({ label: r.source.label, group: r.source.group, exact: r.exact.length, loose: r.loose.length, ok: r.ok, rawSkipped: !!r.rawSkipped }));
  const dated = exact.map((ev) => ev.date).filter(Boolean).sort();
  const todayYmd = today.toISOString().slice(0, 10);
  return {
    address, addressFrom, keyman, keymanFrom,
    tel: mode(lease.map((r) => str(r, "일반전화"))), grade: mode(lease.map((r) => str(r, "등급"))), leaseStatus: mode(lease.map((r) => str(r, "임대여부"))),
    devices,
    misu: misu ? { months: str(misu.row, "미수개월") || str(misu.row, "실제 개월수"), amount: str(misu.row, "미수잔액") || str(misu.row, "실제 잔액") || str(misu.row, "미수금액"), date: misu.date } : null,
    overage: over ? { amount: str(over.row, "합계"), date: over.date } : null,
    recontract: recon ? { status: str(recon.row, "진행상황") || str(recon.row, "갱신상태") || str(recon.row, "최종상태"), end: str(recon.row, "계약종료일"), date: recon.date } : null,
    bulman: bul ? { date: bul.date, status: str(bul.row, "최종상태"), text: (str(bul.row, "불만내용") || str(bul.row, "불편내용")).slice(0, 80) } : null,
    lastInspect: latest(events, "jeomgeom")?.date || "", lastAs: latest(events, "as_records")?.date || "", lastVisit: latest(events, "visit_logs")?.date || "",
    openReceptions: exact.filter((ev) => ev.source.table === "service_receptions" && !/완료/.test(str(ev.row, "status"))).length,
    upcomingTickets: exact.filter((ev) => ev.source.table === "as_tickets" && ev.date >= todayYmd && !/완료|취소/.test(str(ev.row, "status"))).length,
    changes: changes.length,
    photos: exact.filter((ev) => ev.source.table === "photo_albums").reduce((n, ev) => n + (Array.isArray(ev.row.urls) ? (ev.row.urls as unknown[]).length : 0), 0),
    workin: exact.filter((ev) => ev.source.table === "workin_map_places").map((ev) => ({ team: str(ev.row, "team"), quarter: str(ev.row, "quarter"), kind: str(ev.row, "kind"), label: str(ev.row, "label") })),
    counts, total: exact.length, oldest: dated[0] || "", newest: dated[dated.length - 1] || "",
  };
}
