/**
 * 부서 접수(경영·운영·영업지원) 흐름 — 저장 6단계와 처리 단추 5개를 한 곳에 모은다.
 * 화면(DeptReception·DeptReceptionDetail·DeptActionBar)은 이 함수만 부르고, 네트워크는 deptReceptionApi.ts(→ supabase.ts 래퍼)만 쓴다.
 * 설계: docs/tasks/reception-dept-types.md 4-1(단추 표)·4-3(폼 저장).
 *
 * 실패 규칙: 접수 행 저장이 실패하면 throw(화면이 폼을 유지). 그 뒤 단계(시트·달력·카톡)는 실패해도 접수는 남으므로
 * throw 하지 않고 warnings 에 담아 돌려준다 — 화면이 빨간 줄·토스트로 반드시 보여 준다(삼키지 않는다).
 */
import {
  buildDeptReceptionRow, buildDeptSheetPayload, deptSheetStateLabel, isDeptType, normalizeRegion,
  type DeptReceptionInput, type DeptType,
} from "./deptReception";
import {
  completeDeptCalendar, deptSheetCategoryOf, enqueueDeptSheetJob, saveDeptReception, sendDeptReceptionKakao,
  setDeptSheetRow, updateDeptHandling, upsertDeptCalendar,
} from "./deptReceptionApi";
import { getServiceReceptionById } from "./api";
import { getSsoSession, ssoRequiredCached } from "./sso";
import { kstDate } from "./visits";

/** 처리 단추·상세가 다루는 접수 행의 최소 모양(ServiceReceptionRow·OpenReceptionRow 둘 다 맞는다) */
export type DeptRowLike = {
  id: string; type: string; status?: string; vendor: string; author: string;
  field?: string; symptom?: string; region?: string; grade?: string; lease_no?: string; address?: string; route?: string;
  receiver_name?: string; receiver_phone?: string; notes?: string; created_at?: string; receipt_date?: string;
  sheet_row?: number | null; remote_meta?: Record<string, string> | null;
  completed_at?: string | null; completed_by?: string;
};

// ── 처리한 사람·알림 색 ───────────────────────────────
/** 처리자(단추 누른 사람). 로그인 필수면 그룹웨어 이름, 아니면 넘겨받은 작성자 → 세션 이름 → 기기 작성자 */
export function resolveActor(author?: string): string {
  const session = getSsoSession();
  if (ssoRequiredCached() && session?.user?.name) return session.user.name;
  if (String(author || "").trim()) return String(author).trim();
  if (session?.user?.name) return session.user.name;
  try { return localStorage.getItem("author") || ""; } catch { return ""; }
}
/** 경고 문구 → 토스트 색 */
export function warnTone(w: string): "error" | "info" { return /실패|미반영/.test(w) ? "error" : "info"; }

/** 접수자 결정(설계 1절): 로그인 필수면 그룹웨어 이름·팀 고정, 아니면 화면 작성자 선택값(세션 이름이 같으면 팀도) */
export function resolveReceiver(ssoRequired: boolean, session: { user?: { name?: string; department?: string } } | null, fallbackAuthor: string): { name: string; team: string; locked: boolean } {
  const sName = String(session?.user?.name || "").trim();
  const sTeam = String(session?.user?.department || "").trim();
  if (ssoRequired && sName) return { name: sName, team: sTeam, locked: true };
  const name = String(fallbackAuthor || "").trim() || sName;
  return { name, team: name && name === sName ? sTeam : "", locked: false };
}

// ── 날짜·메모 (순수) ─────────────────────────────────
/** 다음 영업일 — 토·일만 건너뛴다(설계 7-1 기본값). 입력·출력 YYYY-MM-DD. */
export function nextWeekday(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** 메모 한 줄 `MM/DD HH:mm 이름: 내용`(KST) */
export function memoLine(by: string, text: string, now: Date = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute} ${String(by || "").trim() || "미지정"}: ${String(text || "").trim()}`;
}
/** 새 줄을 위에 쌓는다. 너무 길어지면 오래된 줄부터 자른다(40줄). */
export function prependMemo(log: string | undefined, line: string): string {
  return [line, ...String(log || "").split("\n").filter(Boolean)].slice(0, 40).join("\n");
}

/** 임대리스트 행 → 지역 글자. '관리 담당자'(팀 배정 정답 열, "수도권C …" 꼴) 우선, 없으면 '담당지역'. */
export function leaseRegionOf(lease: Record<string, unknown> | null | undefined): string {
  if (!lease) return "";
  const team = String(lease["관리 담당자"] ?? "").trim();
  const m = team.match(/수도권\s*([A-Ea-e])/);
  if (m) return m[1].toUpperCase();
  const fromTeam = normalizeRegion(team);
  if (fromTeam) return fromTeam;
  return normalizeRegion(String(lease["담당지역"] ?? ""));
}

/** 업체로 접수: DB vendor 에 넣을 이름 — 임대리스트 행이 가장 많은 표기(설계 7-3 기본값), 없으면 마스터 이름 */
export function pickVendorAlias(rows: Array<Record<string, unknown>>, masterName: string): string {
  const count = new Map<string, number>();
  for (const r of rows) {
    const n = String(r["_업체명"] ?? "").trim();
    if (n) count.set(n, (count.get(n) || 0) + 1);
  }
  let best = "", bestN = 0;
  for (const [n, c] of count) if (c > bestN) { best = n; bestN = c; }
  return best || String(masterName || "").trim();
}

// ── 저장 6단계 ───────────────────────────────────────
export type DeptSaveResult = {
  id: string;
  sheetState: "synced" | "queued" | "failed" | "none";
  sheetRow: number | null;
  calendarId: string;
  kakao: "sent" | "no_room" | "test" | "failed";
  warnings: string[];
  summary: string;
};

/**
 * ① 거래처는 화면이 채운 input 으로 받는다 ② 행 저장(실패 throw) ③ 영업·경영 시트 잡 ④ 예정일 달력 ⑤ 카톡 ⑥ 결과 문구.
 * extraMeta: unit·author_team·vendor_master_name·device_count 같은 부가 키(평평한 문자열).
 */
export async function runDeptSave(input: DeptReceptionInput, extraMeta: Record<string, string> = {}): Promise<DeptSaveResult> {
  const row = buildDeptReceptionRow(input);
  const meta = { ...row.remote_meta, ...extraMeta } as typeof row.remote_meta;
  row.remote_meta = meta;
  const id = await saveDeptReception(row); // 실패 → throw (화면: isCheckConstraintError 면 "SQL 실행 필요")
  const createdAt = new Date().toISOString();
  const warnings: string[] = [];
  const patch: Record<string, string> = {};
  let sheetState: DeptSaveResult["sheetState"] = "none";
  let sheetRow: number | null = null;
  let sheetMsg = "";

  // ③ 시트(영업·경영만)
  const cat = deptSheetCategoryOf(input.dept);
  if (cat) {
    try {
      const res = await enqueueDeptSheetJob(cat, { id, vendor: row.vendor, author: row.author, region: row.region, remote_meta: meta },
        buildDeptSheetPayload({ ...row, id, created_at: createdAt }));
      if (res.state === "synced") {
        sheetState = "synced";
        sheetRow = res.row;
        patch.sheet_state = "synced";
        if (res.seq) patch.sheet_seq = res.seq;
        if (res.row) {
          try { await setDeptSheetRow(id, res.row); } catch (e) { warnings.push(`시트 행 번호 기록 실패: ${(e as Error).message}`); }
        }
        sheetMsg = `${input.dept === "영업지원" ? "영업" : "경영"}시트 ${res.row ? `${res.row}행` : "반영"}`;
      } else if (res.state === "failed") {
        sheetState = "failed";
        patch.sheet_state = "failed";
        warnings.push(`시트 미반영: ${res.message}`);
      } else {
        sheetState = "queued"; // 잡은 쌓였다 — 재시도(retry_pending)가 마저 한다
        sheetMsg = res.message;
      }
    } catch (e) {
      sheetState = "failed";
      patch.sheet_state = "failed";
      warnings.push(`시트 미반영: ${(e as Error).message}`);
    }
  }

  // ④ 달력(예정일 있을 때만)
  let calendarId = "";
  if (meta.schedule_date) {
    try {
      calendarId = await upsertDeptCalendar({ id, type: row.type, vendor: row.vendor, field: row.field, symptom: row.symptom, author: row.author, remote_meta: meta });
      if (calendarId) patch.calendar_id = calendarId;
    } catch (e) { warnings.push(`부서 달력 등록 실패: ${(e as Error).message}`); }
  }

  // ⑤ 카톡(방 매핑 있을 때만 — 없으면 보내지 않음)
  let kakao: DeptSaveResult["kakao"] = "failed";
  try {
    const k = await sendDeptReceptionKakao(input.dept, row.report_text);
    kakao = k.kakao;
    patch.kakao = k.kakao;
  } catch (e) { warnings.push(`카톡 전송 실패: ${(e as Error).message}`); }

  if (Object.keys(patch).length) {
    try { await updateDeptHandling(id, patch); } catch (e) { warnings.push(`처리값 기록 실패: ${(e as Error).message}`); }
  }

  // ⑥ 결과 문구
  const parts = ["저장됨"];
  if (sheetState === "synced" || sheetState === "queued") parts.push(sheetMsg || "시트 대기");
  if (sheetState === "failed") parts.push("시트 미반영");
  if (calendarId) parts.push("달력 등록");
  parts.push(kakao === "sent" ? "카톡 전송" : kakao === "test" ? "카톡 테스트방" : kakao === "no_room" ? "카톡 방 미정" : "카톡 실패");
  return { id, sheetState, sheetRow, calendarId, kakao, warnings, summary: parts.join(" · ") };
}

// ── 처리(상세 [처리 저장]·단추 5개) ───────────────────
export type DeptActionKind = "done" | "tomorrow" | "date" | "hold" | "memo";
export type DeptActionOpts = { by: string; date?: string; text?: string; handled?: string; progress?: string; today?: string };
export type DeptActionResult = { row: DeptRowLike; warnings: string[] };

async function freshRow(row: DeptRowLike): Promise<DeptRowLike> {
  // 메모·미룸 횟수는 다른 사람이 방금 바꿨을 수 있다 — 최신 행을 읽고 그 위에 더한다
  const cur = await getServiceReceptionById(row.id);
  if (!cur) throw new Error("접수를 찾지 못했습니다(삭제됐을 수 있음)");
  return { ...row, ...cur, remote_meta: { ...(cur.remote_meta || {}) } };
}

async function pushSheetUpdate(row: DeptRowLike, warnings: string[]): Promise<void> {
  if (!isDeptType(row.type)) return;
  const cat = deptSheetCategoryOf(row.type);
  if (!cat) return;
  const meta = row.remote_meta || {};
  if (!row.sheet_row && !meta.sheet_seq) { warnings.push("시트 행이 아직 없어 시트 갱신은 건너뜁니다"); return; }
  try {
    const payload = buildDeptSheetPayload({
      type: row.type, author: row.author, route: (row.route || "전화") as DeptReceptionInput["route"], vendor: row.vendor,
      grade: row.grade || "", region: row.region || "", lease_no: row.lease_no || "", field: row.field || "", symptom: row.symptom || "",
      notes: row.notes || "", receiver_name: row.receiver_name || "", receiver_phone: row.receiver_phone || "", address: row.address || "",
      id: row.id, created_at: row.created_at, status: row.status, remote_meta: meta,
    });
    const res = await enqueueDeptSheetJob(cat, { id: row.id, vendor: row.vendor, author: row.author, region: row.region, sheet_row: row.sheet_row, remote_meta: meta }, payload, true);
    if (res.state === "failed") warnings.push(`시트 갱신 실패: ${res.message}`);
  } catch (e) { warnings.push(`시트 갱신 실패: ${(e as Error).message}`); }
}

/** 단추 5개 — 설계 4-1 표. DB 실패는 throw, 달력·시트 실패는 warnings. */
export async function runDeptAction(row0: DeptRowLike, kind: DeptActionKind, opts: DeptActionOpts): Promise<DeptActionResult> {
  const row = await freshRow(row0);
  const meta = row.remote_meta || {};
  const by = String(opts.by || "").trim() || "미지정";
  const warnings: string[] = [];
  const dept = isDeptType(row.type) ? (row.type as DeptType) : null;
  if (!dept) throw new Error("부서 접수가 아닙니다");

  if (kind === "done") {
    const patch: Record<string, string> = {};
    if (opts.handled !== undefined && opts.handled.trim()) patch.handled = opts.handled.trim();
    const at = new Date().toISOString();
    await updateDeptHandling(row.id, patch, "완료", { at, by });
    const next: DeptRowLike = { ...row, status: "완료", completed_at: at, completed_by: by, remote_meta: { ...meta, ...patch } };
    if (meta.calendar_id || meta.schedule_date) {
      try { await completeDeptCalendar(row.id); } catch (e) { warnings.push(`달력 완료 표시 실패: ${(e as Error).message}`); }
    }
    await pushSheetUpdate(next, warnings);
    return { row: next, warnings };
  }

  if (kind === "tomorrow" || kind === "date") {
    const date = kind === "tomorrow" ? nextWeekday(opts.today || kstDate()) : String(opts.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("날짜를 골라 주세요");
    const patch: Record<string, string> = { schedule_date: date, postpone_count: String((Number(meta.postpone_count) || 0) + 1) };
    const status = kind === "tomorrow" && (row.status || "접수") === "접수" ? "진행중" : undefined;
    await updateDeptHandling(row.id, patch, status);
    const next: DeptRowLike = { ...row, status: status || row.status, remote_meta: { ...meta, ...patch } };
    try {
      const calId = await upsertDeptCalendar({ id: row.id, type: row.type, vendor: row.vendor, field: row.field || "", symptom: row.symptom || "", author: row.author, remote_meta: next.remote_meta || {} });
      if (calId && calId !== meta.calendar_id) {
        await updateDeptHandling(row.id, { calendar_id: calId });
        next.remote_meta = { ...(next.remote_meta || {}), calendar_id: calId };
      }
    } catch (e) { warnings.push(`부서 달력 반영 실패: ${(e as Error).message}`); }
    return { row: next, warnings }; // 시트에는 예정일 칸이 없다 — 갱신 없음
  }

  if (kind === "hold") {
    const status = row.status === "보류" ? "진행중" : "보류";
    await updateDeptHandling(row.id, {}, status);
    const next: DeptRowLike = { ...row, status };
    await pushSheetUpdate(next, warnings);
    return { row: next, warnings };
  }

  // memo
  const text = String(opts.text || "").trim();
  const progress = opts.progress !== undefined ? opts.progress.trim() : undefined;
  if (!text && progress === undefined) throw new Error("메모 내용을 입력해 주세요");
  const patch: Record<string, string> = {};
  if (text) patch.memo_log = prependMemo(meta.memo_log, memoLine(by, text));
  if (progress !== undefined && dept === "영업지원") patch.progress = progress;
  await updateDeptHandling(row.id, patch);
  const next: DeptRowLike = { ...row, remote_meta: { ...meta, ...patch } };
  if (patch.progress !== undefined && patch.progress !== (meta.progress || "")) await pushSheetUpdate(next, warnings);
  return { row: next, warnings };
}

/** 상세 [처리 저장] — 상태·처리자·진행 메모·처리내용을 한 번에. 완료로 바뀌면 completed_at/by, 완료에서 벗어나면 비움. */
export async function saveDeptHandlingForm(
  row0: DeptRowLike,
  form: { status: string; handler: string; progress: string; handled: string },
  by: string,
): Promise<DeptActionResult> {
  const row = await freshRow(row0);
  const meta = row.remote_meta || {};
  const warnings: string[] = [];
  const patch: Record<string, string> = { handler: form.handler.trim(), handled: form.handled.trim() };
  if (row.type === "영업지원") patch.progress = form.progress.trim();
  const wasDone = row.status === "완료";
  const nowDone = form.status === "완료";
  const done = nowDone && !wasDone ? { at: new Date().toISOString(), by: by || "미지정" } : !nowDone && wasDone ? { at: null, by: "" } : undefined;
  await updateDeptHandling(row.id, patch, form.status, done);
  const next: DeptRowLike = {
    ...row, status: form.status, remote_meta: { ...meta, ...patch },
    ...(done ? { completed_at: done.at, completed_by: done.by } : {}),
  };
  if (nowDone && !wasDone && (meta.calendar_id || meta.schedule_date)) {
    try { await completeDeptCalendar(row.id); } catch (e) { warnings.push(`달력 완료 표시 실패: ${(e as Error).message}`); }
  }
  const sheetChanged = deptSheetStateLabel(row.status || "") !== deptSheetStateLabel(form.status)
    || (meta.handler || "") !== patch.handler || (meta.handled || "") !== patch.handled || (patch.progress !== undefined && (meta.progress || "") !== patch.progress);
  if (sheetChanged) await pushSheetUpdate(next, warnings);
  return { row: next, warnings };
}

/** 시트 미반영 [다시 보내기] — 같은 append 잡(dupKey dept:<id>:append)을 다시 쌓는다. 이미 쌓여 있으면 대기로 본다. */
export async function retryDeptSheetAppend(row0: DeptRowLike): Promise<DeptActionResult> {
  const row = await freshRow(row0);
  if (!isDeptType(row.type)) throw new Error("부서 접수가 아닙니다");
  const cat = deptSheetCategoryOf(row.type);
  if (!cat) throw new Error("운영지원은 시트가 없습니다");
  const meta = row.remote_meta || {};
  const payload = buildDeptSheetPayload({
    type: row.type, author: row.author, route: (row.route || "전화") as DeptReceptionInput["route"], vendor: row.vendor,
    grade: row.grade || "", region: row.region || "", lease_no: row.lease_no || "", field: row.field || "", symptom: row.symptom || "",
    notes: row.notes || "", receiver_name: row.receiver_name || "", receiver_phone: row.receiver_phone || "", address: row.address || "",
    id: row.id, created_at: row.created_at, status: row.status, remote_meta: meta,
  });
  const res = await enqueueDeptSheetJob(cat, { id: row.id, vendor: row.vendor, author: row.author, region: row.region, remote_meta: meta }, payload);
  const patch: Record<string, string> = { sheet_state: res.state === "synced" ? "synced" : res.state === "failed" ? "failed" : "queued" };
  if (res.seq) patch.sheet_seq = res.seq;
  await updateDeptHandling(row.id, patch);
  if (res.row) await setDeptSheetRow(row.id, res.row);
  const warnings = res.state === "failed" ? [`시트 미반영: ${res.message}`] : [];
  return { row: { ...row, sheet_row: res.row ?? row.sheet_row, remote_meta: { ...meta, ...patch } }, warnings };
}

/** 사람 고르기 목록 — 전 인원(부서별 묶음) + 꼭 보여야 할 이름(기본 처리자·현재 값). 중복 제거. */
export function nameOptions(
  members: Array<{ name: string; dept?: string; active?: boolean }>,
  extras: string[] = [],
): Array<{ value: string; label: string; group?: string }> {
  const seen = new Set<string>();
  const out: Array<{ value: string; label: string; group?: string }> = [];
  for (const n of extras.map((x) => String(x || "").trim()).filter(Boolean)) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push({ value: n, label: n, group: "기본" });
  }
  for (const m of members) {
    const n = String(m.name || "").trim();
    if (!n || m.active === false || seen.has(n)) continue;
    seen.add(n);
    out.push({ value: n, label: n, group: String(m.dept || "").trim() || "기타" });
  }
  return out;
}

/** 전화번호 하이픈 — 숫자만 쳐도 010-1234-5678 / 02-123-4567 꼴로. 숫자 외 글자가 섞이면 그대로 둔다. */
export function formatPhone(raw: string): string {
  const v = String(raw || "");
  if (/[^0-9\s-]/.test(v)) return v;
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.startsWith("02")) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}
