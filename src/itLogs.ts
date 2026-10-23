/**
 * IT 학습 기록 — 기술 퀴즈 응시(it_quiz_attempts)·실습 기록(it_practice_logs).
 * 홈 KPI 가 기간별 건수를 읽고, IT 학습 화면이 쓴다. 표가 아직 없으면(SQL 실행 대기) ItLogsMissingError.
 */
import { insertRow, selectAllRows } from "./supabase";
import { kstDate } from "./visits";

export class ItLogsMissingError extends Error {
  name = "ItLogsMissingError";
  constructor(message = "IT 학습 기록 표가 아직 없습니다(SQL 실행 대기).") { super(message); }
}

// 표 없음: HTTP 404 · PGRST205(schema cache) · 42P01(undefined_table) 문구
export function isMissingTableError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /\(404\)|PGRST205|42P01|schema cache|does not exist/i.test(text);
}

function rethrow(error: unknown): never {
  if (error instanceof ItLogsMissingError) throw error;
  if (isMissingTableError(error)) throw new ItLogsMissingError();
  throw error;
}

type DatedRow = { author: string; date: string };

async function loadRows(table: string, from: string, to: string): Promise<DatedRow[]> {
  try {
    const rows = await selectAllRows<{ author: string | null; kst_date: string }>(
      table,
      `select=author,kst_date&kst_date=gte.${encodeURIComponent(from)}&kst_date=lte.${encodeURIComponent(to)}&order=kst_date.asc,id.asc`,
    );
    return rows.map((row) => ({ author: String(row.author ?? ""), date: String(row.kst_date ?? "") }));
  } catch (error) {
    return rethrow(error);
  }
}

export function loadItQuizAttempts(from: string, to: string): Promise<DatedRow[]> {
  return loadRows("it_quiz_attempts", from, to);
}

export function loadItPracticeLogs(from: string, to: string): Promise<DatedRow[]> {
  return loadRows("it_practice_logs", from, to);
}

export async function saveQuizAttempt(row: { author: string; level: string; total: number; score: number }): Promise<void> {
  try {
    await insertRow("it_quiz_attempts", { author: row.author, kst_date: kstDate(), level: row.level, total: row.total, score: row.score });
  } catch (error) {
    rethrow(error);
  }
}

export async function savePracticeLog(row: { author: string; title: string; memo: string; photoUrl?: string }): Promise<void> {
  try {
    await insertRow("it_practice_logs", { author: row.author, kst_date: kstDate(), title: row.title, memo: row.memo, photo_url: row.photoUrl || null });
  } catch (error) {
    rethrow(error);
  }
}

/** 같은 키는 한 번만 true — 완료 화면을 다시 그려도 중복 저장하지 않게 하는 가드. 실패하면 release 로 되돌린다. */
export function createOnceGuard() {
  const seen = new Set<string>();
  return {
    take(key: string): boolean {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    release(key: string) { seen.delete(key); },
  };
}
