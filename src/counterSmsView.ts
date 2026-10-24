/**
 * 카운터 문자전송 화면의 "보이는 방식" 순수 함수(2026-10-24 단순화, docs/tasks/counter-sms-simplify.md).
 * 숫자·저장 로직은 CounterSms.tsx 그대로 — 여기선 이미 읽어 온 batch·카드로 상태 줄·신규·변경 이력·카드 단추만 정한다.
 */
import { contactVendorKey } from "../supabase/functions/_shared/counter-sms/vendorKey.ts";

export type ViewLogEntry = {
  at: string; by: string; added: number; skipped: string[]; dropped?: string[]; kept?: number;
  mode?: "sync" | "merge" | "remove" | "auto"; removed?: string[]; missing?: string[];
};
export type ViewBatch = { title: string; created_at: string; log?: ViewLogEntry[] | null };
export type ViewTarget = {
  id: string; vendor: string; team: string;
  sent_at: string | null; done_at?: string | null; added_at?: string | null; added_by?: string | null;
};

/** 목록이 처음 생긴 뒤 이만큼 지나 들어온 카드를 "신규"로 본다(첫 목록 등록이 몇십 초 걸려도 신규로 안 치게) */
export const NEW_AFTER_MS = 2 * 60_000;

/** 저장된 ISO(UTC)를 한국 시각 "YYYY-MM-DDTHH:mm" 로 — 한국은 서머타임이 없어 +9시간 고정. 읽을 수 없으면 원문 그대로 */
export function kstIso(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t + 9 * 3600_000).toISOString().slice(0, 16);
}
export const md = (iso?: string | null) => { if (!iso) return ""; const k = kstIso(iso); return `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`; };
export const mdt = (iso?: string | null) => (iso ? `${md(iso)} ${kstIso(iso).slice(11, 16)}` : "");
/** 변경 이력 줄의 시각 "10-23 13:19"(KST) */
export const logWhen = (iso?: string | null) => (iso ? kstIso(iso).slice(5, 16).replace("T", " ") : "");

/**
 * 카드 이력 — 예전 CounterSms.tsx 안의 historyOf 를 그대로 옮겼다(결과 동일, tests/counterSmsView.test.ts).
 * 목록에 오른 때 = added_at(없으면 목록 생성 시각), 다시 오른 때 = log 항목의 skipped 이름이 이 업체인 시각.
 */
export function historyOf(t: ViewTarget, batch: ViewBatch | null) {
  const listedAt = t.added_at || batch?.created_at || "";
  const key = contactVendorKey(t.vendor);
  const again = (batch?.log || [])
    .filter((e) => e.mode !== "remove" && (e.skipped || []).some((name) => contactVendorKey(name) === key) && (!listedAt || e.at > listedAt))
    .map((e) => e.at);
  const afterDone = t.done_at ? again.filter((at) => at > (t.done_at as string)) : [];
  const afterSent = t.sent_at && !t.done_at ? again.filter((at) => at > (t.sent_at as string)) : [];
  return { listedAt, again, afterDone, afterSent };
}
export type CardHistory = ReturnType<typeof historyOf>;

/** 신규 = 이번 목록이 생긴 뒤 2분 넘게 지나 (자동·수동으로) 추가된 카드. added_at 이 없는 옛 카드는 신규가 아니다 */
export function isNewTarget(t: ViewTarget, batch: ViewBatch | null): boolean {
  if (!t.added_at || !batch?.created_at) return false;
  const a = Date.parse(t.added_at); const c = Date.parse(batch.created_at);
  if (Number.isNaN(a) || Number.isNaN(c)) return false;
  return a - c > NEW_AFTER_MS;
}

export type StatusLine = { title: string; total: number; sent: number; done: number; fresh: number; sentPct: number };
/** 머리 한 줄 — 두 등급 합. 보냄·완료는 예전 sentCount·doneCount 와 같은 셈 */
export function statusLine(batch: ViewBatch, targets: ViewTarget[]): StatusLine {
  const sent = targets.filter((t) => t.sent_at).length;
  const done = targets.filter((t) => t.done_at).length;
  const fresh = targets.filter((t) => isNewTarget(t, batch)).length;
  return { title: batch.title, total: targets.length, sent, done, fresh, sentPct: targets.length ? Math.round((sent / targets.length) * 100) : 0 };
}

export type LogGroup = { key: "added" | "skipped" | "kept" | "dropped" | "missing" | "removed"; label: string; count: number; names: string[]; hint?: string };
export type LogLine = { id: string; when: string; who: string; mode: string; groups: LogGroup[]; summary: string };

/** 변경 이력 — batch.log 만 원천, 최신이 위. 한 줄 요약 + [보기]로 펼칠 업체명 묶음 */
export function logLines(batch: ViewBatch | null, targets: ViewTarget[]): LogLine[] {
  const log = batch?.log || [];
  return log.map((e, i) => {
    const groups: LogGroup[] = [];
    if (e.mode === "remove") {
      const r = e.removed || [];
      groups.push({ key: "removed", label: "삭제", count: r.length, names: r });
    } else {
      if (e.added > 0) {
        const names = targets.filter((t) => t.added_at === e.at).map((t) => t.vendor);
        groups.push({ key: "added", label: "신규", count: e.added, names });
      }
      if (e.mode === "sync") {
        if (e.kept !== undefined) groups.push({ key: "kept", label: "유지", count: e.kept, names: e.skipped || [] });
      } else if ((e.skipped || []).length) {
        groups.push({ key: "skipped", label: "중복", count: e.skipped.length, names: e.skipped });
      }
      if ((e.dropped || []).length) groups.push({ key: "dropped", label: "빠져서 완료", count: e.dropped!.length, names: e.dropped! });
      if ((e.missing || []).length) groups.push({ key: "missing", label: "목록에 없는 열린 곳", count: e.missing!.length, names: e.missing!, hint: "관리부가 끝낸 곳이면 카드 ⋯ 에서 완료" });
    }
    const who = e.mode === "auto" || /^자동/.test(e.by || "") ? "자동" : (e.by || "미지정");
    const mode = e.mode === "auto" ? "자동 반영" : e.mode === "sync" ? "목록 맞춤" : e.mode === "remove" ? "카드 삭제" : "추가";
    const when = logWhen(e.at);
    const summary = [`${when} ${who}`, ...(groups.length ? groups.map((g) => `${g.label} ${g.count}`) : ["변경 없음"])].join(" · ");
    return { id: `${e.at}-${i}`, when, who, mode, groups, summary };
  }).reverse();
}

export type CardAction = "send" | "photo" | "done" | "unsend" | "undone" | "remove";
/** 카드의 주 단추 1개 — 안 보냄=문자 보내기 / 보냄=카운터 전송(사진 팀) 또는 완료 / 완료=없음 */
export function primaryAction(t: ViewTarget, photoTeams: string[]): CardAction | null {
  if (t.done_at) return null;
  if (t.sent_at) return photoTeams.includes(t.team) ? "photo" : "done";
  return "send";
}
/** ⋯ 더보기 — 예전 카드 단추와 같은 조건(완료·전송 취소는 보낸 카드, 완료 취소는 보낸 뒤 완료된 카드, 카운터 전송은 열린 사진 팀 카드). 주 단추와 겹치는 건 뺀다 */
export function moreActions(t: ViewTarget, photoTeams: string[]): CardAction[] {
  const primary = primaryAction(t, photoTeams);
  const out: CardAction[] = [];
  if (t.sent_at && !t.done_at) out.push("done", "unsend");
  if (t.sent_at && t.done_at) out.push("undone");
  if (!t.done_at && photoTeams.includes(t.team)) out.push("photo");
  out.push("remove");
  return out.filter((a) => a !== primary);
}

export type WarnBadge = { kind: "afterDone" | "afterSent" | "again"; label: string; title: string; tone: "red" | "orange" | "gray" };
/** 주의 배지는 1개만 — 완료 뒤 다시 올라옴 > 보낸 뒤 다시 올라옴 > 다시 올라옴 n회 */
export function warnBadge(h: CardHistory): WarnBadge | null {
  if (h.afterDone.length) return { kind: "afterDone", tone: "red", label: `완료 뒤 다시 올라옴 ${md(h.afterDone[h.afterDone.length - 1])}`, title: `완료한 뒤 관리부 목록에 또 올라옴: ${h.afterDone.map(mdt).join(", ")} — 관리부에 완료 사실을 알리거나 사진을 다시 확인하세요` };
  if (h.afterSent.length) return { kind: "afterSent", tone: "orange", label: `보낸 뒤 다시 올라옴 ${md(h.afterSent[h.afterSent.length - 1])}`, title: `문자를 보낸 뒤 목록에 또 올라옴: ${h.afterSent.map(mdt).join(", ")} — 고객 회신이 아직이면 다시 보내지 말고 확인 전화` };
  if (h.again.length) return { kind: "again", tone: "gray", label: `다시 올라옴 ${h.again.length}회`, title: `목록에 다시 올라옴: ${h.again.map(mdt).join(", ")}` };
  return null;
}

const stageOf = (t: ViewTarget) => (t.done_at ? 2 : t.sent_at ? 1 : 0);
/** stage = 안 보냄 → 보냄 → 완료(예전 순서) / added = 최근 추가된 카드가 위(같으면 처리 순) */
export function sortTargets<T extends ViewTarget>(rows: T[], by: "stage" | "added", batch?: ViewBatch | null): T[] {
  const copy = [...rows];
  if (by === "stage") return copy.sort((a, b) => stageOf(a) - stageOf(b));
  const at = (t: T) => t.added_at || batch?.created_at || "";
  return copy.sort((a, b) => (at(a) === at(b) ? stageOf(a) - stageOf(b) : at(a) < at(b) ? 1 : -1));
}
