/**
 * 워킨맵(workinmap.com) 동기화 — 앱 쪽 순수 로직(2026-10-31, 설계 docs/tasks/workinmap-sync-2026-10-31.md v2 P1-4).
 * 화면: src/WorkinSyncAdmin.tsx(관리 › 기타 설정 카드) · src/WalkingMap.tsx(교체 막기·동기화 배지).
 * 서버: supabase/functions/workinmap-sync(응답 모양은 sync.ts runAction 과 맞춘다). 표: supabase/workin-sync-20261031.sql.
 */

// ── WalkingMap [엑셀 불러오기] 교체 막기 ─────────────────────────────

export type ScopeRow = { team?: string | null; quarter?: number | null; kind?: string | null; ext_id?: string | null };
export type ImportScope = { team: string; quarter: number; kind: string };

export const REPLACE_BLOCKED_MESSAGE = "이 범위는 워킨맵 동기화 중이라 교체할 수 없습니다(추가만 가능)";

/** 그 팀·분기·업무 안에서 워킨맵과 짝지어진(ext_id 가 있는) 장소 수 */
export function syncedCountInScope(rows: readonly ScopeRow[], scope: ImportScope): number {
  let n = 0;
  for (const r of rows) {
    if (r.team === scope.team && Number(r.quarter) === Number(scope.quarter) && r.kind === scope.kind && String(r.ext_id ?? "").trim()) n += 1;
  }
  return n;
}

/** 교체(통째로 지우고 넣기)를 해도 되는가 — 동기화된 장소가 하나라도 있으면 안 된다(지우면 ext_id 짝이 끊기고 다음 회차가 새 장소로 다시 넣음) */
export function canReplaceScope(rows: readonly ScopeRow[], scope: ImportScope): boolean {
  return syncedCountInScope(rows, scope) === 0;
}

// ── 엣지 응답 모양(sync.ts runAction) ─────────────────────────────

export type SyncAccountRow = {
  account_no: number; label?: string; expires_at?: string | null; fail_count?: number; paused?: boolean;
  last_login_at?: string | null; last_ok_at?: string | null; last_error?: string; updated_at?: string;
};
export type SyncWorkRow = {
  account_no: number; work_id: string; name: string; team: string | null; year: number | null; quarter: number | null; kind: string | null;
  status: string; place_count: number; override_skip: boolean; first_pulled_at: string | null; last_pulled_at: string | null;
  last_work_modified?: string | null; last_error: string;
};
export type SyncStatus = {
  ok: boolean; enabled: boolean; accountsConfigured: number[]; accounts: SyncAccountRow[]; works: SyncWorkRow[];
  openReviews: Record<string, number>; error?: string;
};
export type PullStats = {
  remote: number; matched: number; byExtId: number; byNumberName: number; byNameAddress: number;
  changed: number; labelChanges: number; memoAdds: number; fresh: number; inserted: number;
  ambiguous: number; missing: number; downgrades: number; keptLocalNewer: number; linkedOnly: number;
  /** 정형 줄 교체 수(엣지 2026-10-31 뒤) */
  memoReplaces?: number;
  /** 워킨맵에 없어 숨긴(dry 는 숨길) 앱 행 수(엣지 2026-10-31 뒤) */
  appOnlyHidden?: number;
  appOnlyKeptByUser?: number;
};
export type ColorCheck = { histogram: Record<string, number>; firstMatchSame: number; firstMatchDiff: number };
export type PullWorkResult = {
  workId: string; name: string; account: number; result: "applied" | "dry" | "stopped" | "error";
  stats?: PullStats; colorCheck?: ColorCheck; error?: string;
  stop?: { reason: string; detail: string } | null;
  writes?: { patched: number; patchFailed: number; inserted: number; insertFailed: number; reviews: number; logs: number };
};
export type PullResponse = {
  ok: boolean; dryRun?: boolean; disabled?: boolean; note?: string; skipped?: string; scope?: unknown; kst?: string; picked?: number;
  results?: PullWorkResult[]; accountErrors?: Array<{ account: number; error: string }>; warnings?: string[];
  unparsed?: Array<{ account: number; workId: string; name: string }>; error?: string;
};
export type ReviewRow = {
  id: number; kind: string; field: string; place_id: number | null; ext_id: string | null; account_no: number | null;
  work_id: string | null; detail: Record<string, unknown> | null; created_at: string;
};

// ── 표시 ─────────────────────────────────────────────────────────

export const WORK_STATUS_LABEL: Record<string, string> = { target: "대상", excluded: "제외", unparsed: "이름 해석 안 됨", duplicate: "공유(중복)" };
export const KIND_LABEL: Record<string, string> = { quarter: "분기점검", monthly: "매월점검", renewal: "재계약" };
export const RESULT_LABEL: Record<PullWorkResult["result"], string> = { dry: "미리보기", applied: "반영", stopped: "중단", error: "오류" };
export const STOP_LABEL: Record<string, string> = { empty: "응답 0곳", shrunk: "평소의 절반 미만", too_many_new: "새 장소 너무 많음" };
export const REVIEW_KIND_LABEL: Record<string, string> = {
  unmatched: "짝 없음", ambiguous: "후보 여럿", new: "새 장소(첫 회차)", missing: "워킨맵에서 사라짐", downgrade: "완료 내려감",
  conflict: "양쪽 동시 변경", field_diff: "칸 차이", loop: "왕복 반복", format: "응답 형식 이상",
};

/**
 * 확인 큐 종류 나누기(2026-10-31 사용자: "확인 필요 304건 중 294건이 참고용이라 겁을 줌").
 * 처리 필요 = 사람이 맞추거나 판단해야 하는 것. 참고 = 이미 반영됐거나(완료 내려감·상호 변경) 앱 값을 지킨 기록 — 노란 줄·머리 수에서 뺀다.
 */
export const REVIEW_ACTION_KINDS = ["new", "ambiguous", "missing", "unmatched", "format", "loop"] as const;
export const REVIEW_INFO_KINDS = ["downgrade", "conflict", "field_diff"] as const;
/** PostgREST 조건 kind=in.(…) — 영문 값이라 인코딩 불필요 */
export const reviewKindFilter = (kinds: readonly string[]) => `kind=in.(${kinds.join(",")})`;

/** status.openReviews(종류별 미처리 수) → 처리 필요·참고 합계. 모르는 종류는 처리 필요로 센다(새 종류를 놓치지 않게) */
export function splitOpenReviews(openByKind: Record<string, number> | null | undefined): { action: number; info: number } {
  let action = 0, info = 0;
  for (const [k, v] of Object.entries(openByKind || {})) {
    const n = Number(v) || 0;
    if ((REVIEW_INFO_KINDS as readonly string[]).includes(k)) info += n; else action += n;
  }
  return { action, info };
}

/** 한 워크 미리보기 결과를 표 한 줄로 */
export type DryRow = {
  key: string; name: string; account: number; result: string; tone: "ok" | "warn" | "bad";
  remote: number | null; matched: number | null; fresh: number | null; changed: number | null; labelChanges: number | null; memoAdds: number | null;
  /** 엣지가 이 칸을 보낼 때만 숫자(옛 응답이면 null) */
  memoReplaces: number | null; appOnlyHidden: number | null;
  color: string; reason: string;
};

export function histogramText(h: Record<string, number> | undefined): string {
  if (!h) return "";
  return Object.entries(h)
    .sort(([a], [b]) => (Number(a.replace(/\D/g, "")) || 0) - (Number(b.replace(/\D/g, "")) || 0) || a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
}

export function dryRows(results: readonly PullWorkResult[] | undefined): DryRow[] {
  return (results || []).map((r) => {
    const s = r.stats;
    const reason = r.stop ? `${STOP_LABEL[r.stop.reason] || r.stop.reason} — ${r.stop.detail}` : r.error || "";
    const cc = r.colorCheck;
    const color = cc ? `처음 짝 색 같음 ${cc.firstMatchSame} · 다름 ${cc.firstMatchDiff}${histogramText(cc.histogram) ? ` (${histogramText(cc.histogram)})` : ""}` : "";
    return {
      key: `${r.account}|${r.workId}`, name: r.name, account: r.account, result: RESULT_LABEL[r.result] || r.result,
      tone: r.result === "error" ? "bad" : r.result === "stopped" ? "warn" : "ok",
      remote: s ? s.remote : null, matched: s ? s.matched : null, fresh: s ? s.fresh : null, changed: s ? s.changed : null,
      labelChanges: s ? s.labelChanges : null, memoAdds: s ? s.memoAdds : null,
      memoReplaces: typeof s?.memoReplaces === "number" ? s.memoReplaces : null,
      appOnlyHidden: typeof s?.appOnlyHidden === "number" ? s.appOnlyHidden : null,
      color, reason,
    };
  });
}

/** 표에 정형 줄 교체·숨김 칸을 그릴지 — 어느 워크든 1 이상일 때만 */
export function dryExtraColumns(rows: readonly DryRow[]): { memoReplaces: boolean; appOnlyHidden: boolean } {
  return { memoReplaces: rows.some((r) => (r.memoReplaces ?? 0) > 0), appOnlyHidden: rows.some((r) => (r.appOnlyHidden ?? 0) > 0) };
}

/** 미리보기 머리 한 줄 */
export function pullSummary(res: PullResponse): string {
  if (res.skipped === "busy") return "다른 동기화가 돌고 있어 건너뛰었습니다. 잠시 뒤 다시 누르세요.";
  const rows = res.results || [];
  const matched = rows.reduce((a, r) => a + (r.stats?.matched || 0), 0);
  const changed = rows.reduce((a, r) => a + (r.stats?.changed || 0), 0);
  const fresh = rows.reduce((a, r) => a + (r.stats?.fresh || 0), 0);
  const hidden = rows.reduce((a, r) => a + (r.stats?.appOnlyHidden || 0), 0);
  const bad = rows.filter((r) => r.result === "error" || r.result === "stopped").length;
  const head = res.dryRun ? "미리보기(쓰기 0)" : "동기화";
  return `${head} · ${res.kst || ""} 워크 ${res.picked ?? rows.length}개 · 짝 ${matched}곳 · 바뀔 곳 ${changed} · 새 장소 ${fresh}${hidden ? ` · 워킨맵에 없어 숨김 ${hidden}` : ""}${bad ? ` · 중단·오류 ${bad}개` : ""}`;
}

/** 확인 큐 배지 글자 — missing·app_only(앱에만 있어 숨김)는 따로 이름 */
export function reviewLabel(r: { kind: string; field?: string | null }): string {
  if (r.kind === "missing" && r.field === "app_only") return "워킨맵에 없음(숨김)";
  if (r.kind === "format" && r.field === "app_only_too_many") return "숨길 곳 너무 많음";
  return `${REVIEW_KIND_LABEL[r.kind] || r.kind}${r.field ? ` · ${r.field}` : ""}`;
}

/** 미처리 확인 큐 한 줄 요약(detail 은 엣지가 넣는 자유 jsonb — 이름·주소·전후 값만 골라 짧게) */
export function reviewSummary(detail: Record<string, unknown> | null | undefined): string {
  if (!detail || typeof detail !== "object") return "";
  const pick = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  const parts: string[] = [];
  for (const k of ["name", "remoteName", "address", "before", "after", "reason", "detail", "error"]) {
    const v = pick(detail[k]);
    if (v) parts.push(k === "before" ? `전 ${v}` : k === "after" ? `후 ${v}` : v);
  }
  if (!parts.length) parts.push(JSON.stringify(detail));
  return parts.join(" · ").slice(0, 160);
}

// ── 크론 일정(SQL 8절: KST 09·12·15·18시 정각) ───────────────────────

export const PULL_HOURS_KST = [9, 12, 15, 18] as const;

/** 다음 자동 가져오기 시각 — "오늘 12:00" / "내일 09:00" */
export function nextPullKst(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const h = kst.getUTCHours();
  const m = kst.getUTCMinutes();
  const next = PULL_HOURS_KST.find((x) => x > h || (x === h && m === 0 && kst.getUTCSeconds() === 0));
  if (next !== undefined) return `오늘 ${String(next).padStart(2, "0")}:00`;
  return `내일 ${String(PULL_HOURS_KST[0]).padStart(2, "0")}:00`;
}

/** ISO → "10/31 09:00"(KST). 없으면 "-" */
export function kstShort(iso: string | null | undefined): string {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "-";
  const d = new Date(t + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 미리보기 범위 고르기 — 전체 현재 분기 + 대상 워크(건너뛰기 아닌 것) 하나씩 */
export function scopeOptions(works: readonly SyncWorkRow[]): Array<{ value: string; label: string }> {
  const out = [{ value: "current", label: "전체 · 이번 분기" }];
  for (const w of works) {
    if (w.status !== "target" || w.override_skip) continue;
    out.push({ value: w.work_id, label: `${w.name} (계정${w.account_no})` });
  }
  return out;
}

/** override_by·resolved_by(최대 40자) — 이 기기 작성자 이름 */
export function actorName(stored: string | null | undefined): string {
  return (String(stored || "").trim() || "관리자").slice(0, 40);
}
