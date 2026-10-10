/**
 * 관리부 마감 목록 자동 반영 — 계획 세우기(순수 함수). 앱과 엣지 함수(counter-inbox-ingest)가 같이 쓴다 (2026-10-10).
 *
 * 규칙(사용자 요구 그대로):
 *  - 목록은 올라올 때마다 날짜·시간·보낸이와 함께 기록된다(배치 log + inbox 행).
 *  - 이미 있는 업체는 **아무것도 바꾸지 않는다** — 완료는 완료로, "문자 보냄"은 그대로. 중복이라고만 센다.
 *    (고객이 사진을 아직 안 줘서 열려 있는 업체에 같은 목록이 또 와도 보냈다는 표시가 사라지면 또 보낼 수 있다)
 *  - 없는 업체만 새로 넣는다.
 *  - 이번 목록에 없는 열린 업체는 **손대지 않고 알려만 준다**(관리부가 끝낸 것일 수 있으니 사람이 [완료]로).
 *    자동으로 완료 처리하지 않는 이유: 관리부가 한 구역·추가분만 올린 목록을 전체로 오해하면 멀쩡한 업체가 완료돼 버린다.
 *  - 같은 업체 판정은 목록 종류(일반/CMS)까지 같아야 하고, 임대 코드가 같으면 같은 업체, 아니면 이름 비교키가 같으면 같은 업체.
 */
import type { MergedTarget } from "./parser.ts";
import { contactVendorKey } from "./vendorKey.ts";

export type ExistingTarget = {
  id: string; vendor: string; lease_code?: string | null; list_kind?: string | null;
  sent_at?: string | null; done_at?: string | null;
};
export type DupState = "완료" | "문자보냄" | "대기";
export type IngestPlan = {
  fresh: MergedTarget[];
  dupes: { vendor: string; state: DupState; existingId: string }[];
  /** 이번 목록 종류의 열린 기존 업체 중 목록에 없는 곳 — 알림만 */
  missingOpen: ExistingTarget[];
  kinds: string[];
};

const kindOf = (k?: string | null) => (k === "CMS" ? "CMS" : "");
const nameKey = (kind: string, vendor: string) => `${kind}|${contactVendorKey(vendor)}`;
const codeKey = (kind: string, code?: string | null) => (code ? `${kind}|code:${code}` : "");

export function planIngest(existing: ExistingTarget[], merged: MergedTarget[]): IngestPlan {
  const byName = new Map<string, ExistingTarget>();
  const byCode = new Map<string, ExistingTarget>();
  for (const t of existing) {
    const kind = kindOf(t.list_kind);
    if (!byName.has(nameKey(kind, t.vendor))) byName.set(nameKey(kind, t.vendor), t);
    if (t.lease_code && !byCode.has(codeKey(kind, t.lease_code))) byCode.set(codeKey(kind, t.lease_code), t);
  }
  const fresh: MergedTarget[] = [];
  const dupes: IngestPlan["dupes"] = [];
  const matched = new Set<string>();
  for (const t of merged) {
    const hit = t.leaseCodes.map((c) => byCode.get(codeKey(t.listKind, c))).find(Boolean) || byName.get(nameKey(t.listKind, t.vendor));
    if (hit) {
      matched.add(hit.id);
      dupes.push({ vendor: t.vendor, state: hit.done_at ? "완료" : hit.sent_at ? "문자보냄" : "대기", existingId: hit.id });
    } else {
      fresh.push(t);
    }
  }
  const kinds = [...new Set(merged.map((t) => t.listKind))];
  const missingOpen = existing.filter((t) => !t.done_at && kinds.includes(kindOf(t.list_kind)) && !matched.has(t.id));
  return { fresh, dupes, missingOpen, kinds };
}

/** 배치 제목("10월 마감")이나 만든 날에서 달을 읽는다 */
export function batchMonthOf(batch: { title?: string | null; created_at: string }): number {
  return Number(String(batch.title || "").match(/(\d{1,2})월/)?.[1] || batch.created_at.slice(5, 7));
}

/** 머리글의 달(ym "2026-10")이 지금 목록과 다르면 새 달 목록을 만든다. 달 정보가 없는 목록(CMS 등)은 지금 목록에 넣는다 */
export function needsNewBatch(headerYm: string | undefined, batch: { title?: string | null; created_at: string } | null): boolean {
  if (!batch) return true;
  if (!headerYm) return false;
  const m = Number(headerYm.slice(5));
  return !!m && m !== batchMonthOf(batch);
}

/** 사람이 읽는 한 줄 — inbox note·푸시 본문·배치 log 에 같이 쓴다 */
export function summarizePlan(plan: IngestPlan, opts: { team: string; total: number; newBatch: boolean }): string {
  const done = plan.dupes.filter((d) => d.state === "완료").length;
  const sent = plan.dupes.filter((d) => d.state === "문자보냄").length;
  const wait = plan.dupes.length - done - sent;
  const missing = plan.missingOpen.map((t) => t.vendor);
  const kinds = plan.kinds.map((k) => (k === "CMS" ? "CMS" : "일반")).join("+");
  return [
    `${opts.team}팀 ${kinds} ${opts.total}곳`,
    `신규 ${plan.fresh.length}`,
    `중복 ${plan.dupes.length}${plan.dupes.length ? `(완료 ${done}·문자보냄 ${sent}·대기 ${wait})` : ""}`,
    missing.length ? `목록에 없는 열린 곳 ${missing.length}(${missing.slice(0, 6).join(", ")}${missing.length > 6 ? " 외" : ""})` : "",
    opts.newBatch ? "새 달 목록 생성" : "",
  ].filter(Boolean).join(" · ");
}
