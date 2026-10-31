/**
 * 방문 판단 안내글 — 화면에 붙이는 짧은 문구(구현 C, 2026-10-31). 순수 함수만.
 * 설계: docs/tasks/as-reception-visit-advice-2026-10-31.md 5장.
 *  - visitAdviceNote: runVisitAdviceFor 결과 → 접수 결과 메시지 꼬리
 *  - visitAdviceLogLabel: visit_advice_log 한 행 → 접수 상세의 상태 한 줄
 */
import type { VisitAdviceRunResult } from "./visitAdviceData";
import { kstDate } from "./visits";

const kstHm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/** "10:00"(오늘) 또는 "11/2 10:00"(다른 날). 읽을 수 없는 값이면 "" */
export function kstWhen(iso: string | null | undefined, now: Date = new Date()): string {
  const d = iso ? new Date(iso) : null;
  if (!d || !Number.isFinite(d.getTime())) return "";
  const day = kstDate(d);
  if (day === kstDate(now)) return kstHm(d);
  const [, m, dd] = day.split("-");
  return `${Number(m)}/${Number(dd)} ${kstHm(d)}`;
}

/**
 * 접수 결과 메시지 꼬리. off·no-task·exists·ignored 는 "" (표시 없음).
 * queued: 즉시면 " + 방문 판단 글 대기(1분 안)", 보류면 " + 방문 판단 글 10:00 예정"(다른 날이면 "11/2 10:00").
 * error: 표 없음이면 " · 방문 판단 표 없음(SQL 실행 전)", 아니면 " · 방문 판단 글 실패(접수는 정상)".
 */
export function visitAdviceNote(result: VisitAdviceRunResult | null | undefined, now: Date = new Date()): string {
  if (!result) return "";
  if (result.status === "error") return result.tableMissing ? " · 방문 판단 표 없음(SQL 실행 전)" : " · 방문 판단 글 실패(접수는 정상)";
  if (result.status !== "queued") return "";
  if (result.immediate) return " + 방문 판단 글 대기(1분 안)";
  const when = kstWhen(result.dueAt, now);
  return when ? ` + 방문 판단 글 ${when} 예정` : " + 방문 판단 글 대기";
}

export type VisitAdviceLogRow = { status?: string | null; reason?: string | null; due_at?: string | null; sent_at?: string | null; error?: string | null };

/** 접수 상세 한 줄: "대기 10:00" / "보냄 12:01" / "할 일 없음" / "실패" … 행이 없으면 "" */
export function visitAdviceLogLabel(row: VisitAdviceLogRow | null | undefined, now: Date = new Date()): string {
  if (!row || !row.status) return "";
  switch (row.status) {
    case "queued": { const w = kstWhen(row.due_at, now); return w ? `대기 ${w}` : "대기"; }
    case "missing": return "판정 대기(자동 보충)";
    case "sent": { const w = kstWhen(row.sent_at, now); return w ? `보냄 ${w}` : "보냄"; }
    case "skipped":
      if (row.reason === "cancelled" || row.reason === "deleted") return "안 보냄(접수 취소·삭제)";
      if (row.reason === "stale") return "안 보냄(오래 밀림)";
      return "할 일 없음";
    case "error": return "실패";
    default: return row.status;
  }
}
