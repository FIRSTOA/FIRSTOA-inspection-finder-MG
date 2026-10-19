/**
 * 부서 접수(경영·운영·영업) 네트워크 층 — src/supabase.ts 래퍼만 쓴다. 순수 로직은 deptReception.ts.
 * 설계: docs/tasks/reception-dept-types.md
 *
 * 주의: 저장에 api.ts saveServiceReception 을 쓰지 않는다 — 그 함수는 저장 뒤 지역 팀(A~E)에 웹푸시를 보내
 * 경영·영업 접수가 현장 CS 폰에 울린다. 여기서는 insertRowReturning 만 부른다(푸시 없음).
 */
import {
  deleteRows, getConfig, getRoomMap, enqueueOutbox, insertRow, insertRowReturning, invokeEdgeFunction,
  isTestModeValue, rpc, selectAllRows, selectRows, updateRows,
} from "./supabase";
import {
  DEPT_SHEET_CATEGORY, deptAppendDupKey, deptShort, type DeptMeta, type DeptReceptionRow, type DeptSheetCategory,
  type DeptType, type VendorInfoLite,
} from "./deptReception";
import { kstDate } from "./visits";

const enc = encodeURIComponent;
// 한글·괄호·슬래시 컬럼은 큰따옴표로 감싸 인코딩(entity360.ts col 과 같은 규칙)
const col = (c: string) => enc(/[^A-Za-z0-9_]/.test(c) ? `"${c}"` : c);
const inList = (values: string[]) => `in.(${values.map((v) => `"${enc(v.replace(/"/g, ""))}"`).join(",")})`;

// ── 거래처 ─────────────────────────────────────────
export type VendorMasterHit = { code: string; name: string; aliases: string[]; device_count: number };
/** vendor_master 이름·별칭 검색 상위 10(기기 수 많은 순). 실패는 throw — 호출부가 안내한다. */
export async function searchVendorMaster(q: string): Promise<VendorMasterHit[]> {
  const kw = String(q || "").trim().replace(/[(),*"]/g, " ").trim();
  if (kw.length < 2) return [];
  const pattern = enc(`*${kw}*`);
  // aliases 는 jsonb 배열이라 ilike 가 안 된다 — 이름 ilike + 별칭 정확 포함(cs) 두 갈래
  const rows = await selectRows<VendorMasterHit>("vendor_master",
    `select=code,name,aliases,device_count&or=(name.ilike.${pattern},aliases.cs.${enc(JSON.stringify([kw]))})&order=device_count.desc&limit=10`);
  return rows.map((r) => ({ ...r, aliases: Array.isArray(r.aliases) ? r.aliases.map(String) : [] }));
}

const VENDOR_INFO_COLS = ["id", "코드", "순번", "_업체명", "등급", "시/구", "주소상세주소", "기번", "자산번호", "모델명", "_hidden", "_raw"];
/**
 * 업체의 임대리스트 행들. code 는 vendor_info."코드"(임대 코드 5자리)다 — vendor_master.code(10자리)와 체계가 다르다.
 * 마스터에서 왔으면 names 에 마스터 이름·별칭을 넘긴다(임대리스트 _업체명 표기 그대로라 정확히 붙는다, entity360 과 같은 방식).
 * _raw 는 지역('관리 담당자')·자동 미리보기 값 때문에 함께 받는다.
 */
export async function vendorInfoByCode(code: string, names: string[] = []): Promise<VendorInfoLite[]> {
  const c = String(code || "").trim();
  const nameList = Array.from(new Set(names.map((n) => String(n || "").trim()).filter(Boolean))).slice(0, 25);
  if (!c && !nameList.length) return [];
  const select = `select=${VENDOR_INFO_COLS.map(col).join(",")}&_hidden=not.is.true&limit=500`;
  const [byCode, byName] = await Promise.all([
    c ? selectRows<VendorInfoLite>("vendor_info", `${select}&${col("코드")}=eq.${enc(c)}`) : Promise.resolve([] as VendorInfoLite[]),
    nameList.length ? selectRows<VendorInfoLite>("vendor_info", `${select}&${col("_업체명")}=${inList(nameList)}`) : Promise.resolve([] as VendorInfoLite[]),
  ]);
  const seen = new Set<string>();
  return [...byCode, ...byName].filter((r) => {
    const k = String(r.id ?? "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── 저장·처리 ───────────────────────────────────────
/** service_receptions insert → id. 웹푸시 없음. 실패는 throw(type/route CHECK 미실행이면 메시지에 check constraint). */
export async function saveDeptReception(row: DeptReceptionRow): Promise<string> {
  const saved = await insertRowReturning<{ id?: string }>("service_receptions", row as unknown as Record<string, unknown>);
  const id = String(saved?.id || "");
  if (!id) throw new Error("접수 저장 결과에 id 가 없습니다");
  return id;
}

/** CHECK 제약 미실행으로 막혔는지 — 화면이 "SQL 실행 필요" 안내를 띄울 때 */
export const isCheckConstraintError = (e: unknown) => /check constraint|23514/i.test(String((e as Error)?.message || e));

/**
 * 처리 저장 — remote_meta 얕은 병합 + status(merge_reception_handling, SECURITY DEFINER).
 * done 을 주면 completed_at/by 를 따로 PATCH(완료: at=ISO, 완료 취소: at=null).
 */
export async function updateDeptHandling(id: string, patch: Partial<DeptMeta>, status?: string, done?: { at: string | null; by: string }): Promise<void> {
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) meta[k] = String(v ?? "");
  await rpc<null>("merge_reception_handling", { p_id: id, p_meta: meta, ...(status ? { p_status: status } : {}) });
  if (done) await updateRows("service_receptions", `id=eq.${enc(id)}`, { completed_at: done.at, completed_by: done.by });
}

/** 접수 시 받은 시트 행 번호 기록 */
export async function setDeptSheetRow(id: string, sheetRow: number): Promise<void> {
  await updateRows("service_receptions", `id=eq.${enc(id)}`, { sheet_row: sheetRow });
}

// ── 시트 잡 ─────────────────────────────────────────
export type DeptSheetJobResult = { state: "synced" | "queued" | "failed" | "disabled"; row: number | null; seq: string; message: string };
const isOn = (v: unknown) => String(v || "").toLowerCase() === "true";

/**
 * field_sheet_sync_jobs 에 부서 시트 잡을 쌓고(카톡 없음: kakao_status 'disabled') 엣지 함수를 즉시 한 번 부른다
 * (api.ts sendReceptionRemoteSheetJob 과 같은 방식 — FIELD_SHEET_SYNC_ENABLED 꺼져 있으면 쌓기만).
 * - 접수: dupKey `dept:<id>:append` → 같은 접수의 append 잡은 한 번만.
 * - 처리 갱신(isUpdate): _updateOnly=1, _updateRow=sheet_row, 키 확인 A열(1)=sheet_seq. 새 행을 만들지 않는다.
 * 잡 insert 자체가 실패하면(category CHECK 미실행 등) throw — 호출부가 sheet_state='failed' 로 남긴다.
 */
export async function enqueueDeptSheetJob(
  category: DeptSheetCategory,
  row: { id: string; vendor: string; author: string; region?: string; sheet_row?: number | null; remote_meta?: Partial<DeptMeta> | Record<string, string> },
  payload: Record<string, string>,
  isUpdate = false,
): Promise<DeptSheetJobResult> {
  const jobId = crypto.randomUUID();
  const data: Record<string, string> = { ...payload };
  if (isUpdate) {
    const seq = String(row.remote_meta?.sheet_seq || "");
    if (!row.sheet_row && !seq) return { state: "failed", row: null, seq: "", message: "시트 행·순번이 없어 갱신할 수 없습니다" };
    data._updateOnly = "1";
    if (row.sheet_row) data._updateRow = String(row.sheet_row);
    if (seq) { data._updateKeyColumn = "1"; data._updateKeyValue = seq; data._findKeyColumn = "1"; data._findKeyValue = seq; }
  }
  const inserted = await insertRow("field_sheet_sync_jobs", {
    id: jobId,
    category,
    author: String(row.author || "").trim(),
    vendor: String(row.vendor || "").trim(),
    region: row.region || "",
    room: "",
    source_text: "",
    payload: { data },
    sheet_status: "pending",
    kakao_status: "disabled",
    "_dupKey": isUpdate ? jobId : deptAppendDupKey(row.id),
  });
  if (inserted === "dup") return { state: "queued", row: null, seq: "", message: "이미 쌓인 시트 잡" };
  const cfg = await getConfig().catch(() => ({} as Record<string, string>));
  if (!isOn(cfg.FIELD_SHEET_SYNC_ENABLED)) return { state: "disabled", row: null, seq: "", message: "시트 동기화 설정 꺼짐(대기)" };
  try {
    const result = await invokeEdgeFunction<{ status?: string; row?: number; seq?: string | number }>("field-sheet-sync", { jobId });
    if (result.status !== "synced") return { state: "queued", row: null, seq: "", message: "시트 반영 대기" };
    return { state: "synced", row: result.row ?? null, seq: result.seq == null ? "" : String(result.seq), message: `시트 ${result.row ? `${result.row}행 ` : ""}${isUpdate ? "갱신" : "기입"}` };
  } catch {
    return { state: "queued", row: null, seq: "", message: "시트 반영 재시도 대기" }; // 잡은 쌓였으니 retry_pending 이 다시 한다
  }
}
export const deptSheetCategoryOf = (dept: DeptType) => DEPT_SHEET_CATEGORY[dept];

// ── 부서 달력(team_calendar_events, 네이버 미러 없음) ─────
type CalRow = { id: string; type: string; vendor: string; field: string; symptom: string; author: string; remote_meta?: Partial<DeptMeta> | Record<string, string> };
const calTitle = (row: CalRow) => `[${deptShort(row.type)}] ${row.vendor} · ${row.field}`.slice(0, 120);
const calMemo = (row: CalRow) => [String(row.symptom || "").slice(0, 200), row.remote_meta?.handler ? `처리자 ${row.remote_meta.handler}` : ""].filter(Boolean).join("\n");

/**
 * 예정일이 있으면 그 부서 달력에 1건(reception_id 로 찾아 있으면 갱신, 없으면 생성) → 일정 id.
 * 예정일이 없으면 기존 일정을 지우고 "" 를 돌려준다. reception_id 는 uuid 컬럼 — 빈 문자열을 보내지 않는다.
 */
export async function upsertDeptCalendar(row: CalRow): Promise<string> {
  if (!row.id) throw new Error("접수 id 없이 달력 일정을 만들 수 없습니다");
  const date = String(row.remote_meta?.schedule_date || "");
  const existing = await selectRows<{ id: string }>("team_calendar_events", `select=id&reception_id=eq.${enc(row.id)}&limit=1`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    if (existing.length) await deleteDeptCalendar(row.id);
    return "";
  }
  const patch = { team: row.type, date, time: "", title: calTitle(row), memo: calMemo(row), updated_at: new Date().toISOString() };
  if (existing[0]?.id) {
    await updateRows("team_calendar_events", `id=eq.${enc(existing[0].id)}`, patch);
    return existing[0].id;
  }
  const saved = await insertRowReturning<{ id?: string }>("team_calendar_events", { ...patch, author: row.author, reception_id: row.id });
  return String(saved?.id || "");
}

/** 완료 → 제목 앞에 ✅ (일정은 남긴다). 이미 붙어 있으면 그대로. */
export async function completeDeptCalendar(receptionId: string): Promise<void> {
  const rows = await selectRows<{ id: string; title: string }>("team_calendar_events", `select=id,title&reception_id=eq.${enc(receptionId)}`);
  for (const ev of rows) {
    if (String(ev.title || "").startsWith("✅")) continue;
    await updateRows("team_calendar_events", `id=eq.${enc(ev.id)}`, { title: `✅ ${ev.title}`, updated_at: new Date().toISOString() });
  }
}

export async function deleteDeptCalendar(receptionId: string): Promise<void> {
  if (!receptionId) return;
  await deleteRows("team_calendar_events", `reception_id=eq.${enc(receptionId)}`);
}

// ── 카톡(구조만 — 방 매핑 없으면 보내지 않는다, 폴백 금지) ─────
export const DEPT_ROOM_KEY: Record<DeptType, string> = { 경영지원: "경영접수|*", 운영지원: "운영접수|*", 영업지원: "영업접수|*" };
export type DeptKakaoResult = { kakao: "sent" | "no_room" | "test"; room: string };
/**
 * TEST_MODE 면 테스트방('test'), 매핑 있으면 그 방('sent'), 없으면 보내지 않고 'no_room'.
 * 설정·방매핑 조회 실패와 outbox 적재 실패는 throw — 호출부가 알린다.
 */
export async function sendDeptReceptionKakao(dept: DeptType, text: string): Promise<DeptKakaoResult> {
  if (!String(text || "").trim()) throw new Error("보낼 양식이 없습니다");
  const cfg = await getConfig();
  if (isTestModeValue(cfg.TEST_MODE)) {
    const room = cfg.TEST_ROOM || "테스트 전용방";
    await enqueueOutbox(room, text);
    return { kakao: "test", room };
  }
  const map = await getRoomMap();
  const room = map[DEPT_ROOM_KEY[dept]] || "";
  if (!room) return { kakao: "no_room", room: "" };
  await enqueueOutbox(room, text);
  return { kakao: "sent", room };
}

// ── 미처리 보드 ─────────────────────────────────────
export type OpenReceptionRow = {
  id: string; created_at: string; receipt_date: string; author: string; type: string; route: string;
  vendor: string; region: string; grade: string; lease_no: string; title: string; field?: string;
  symptom: string; status: string; remote_meta?: Record<string, string> | null; sheet_row?: number | null;
};
const OPEN_COLS = "id,created_at,receipt_date,author,type,route,vendor,region,grade,lease_no,title,field,symptom,status,remote_meta,sheet_row";
/** 6종 전체의 열린 건(접수·진행중·보류·원격대기), 최근 days 일, 오래된 순. 실패는 throw. */
export async function fetchOpenReceptions(days = 90): Promise<OpenReceptionRow[]> {
  const since = new Date(`${kstDate()}T12:00:00+09:00`);
  since.setUTCDate(since.getUTCDate() - days);
  const from = kstDate(since);
  const statuses = ["접수", "진행중", "보류", "원격대기"].map((s) => enc(s)).join(",");
  return selectAllRows<OpenReceptionRow>("service_receptions",
    `select=${OPEN_COLS}&status=in.(${statuses})&receipt_date=gte.${from}&deleted=eq.false&order=receipt_date.asc,created_at.asc,id.asc`);
}
