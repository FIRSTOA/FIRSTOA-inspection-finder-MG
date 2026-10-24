/**
 * 조회 실패를 "0건"으로 보이지 않게 (2026-10-24 위험 점검 10번)
 *
 * 왜: 고객 리포트·자동 일정이 조회 실패를 `.catch(() => [])` 로 삼켜 "AS 0건·점검 0건" 리포트가 고객에게 나갈 수 있었다.
 * 규칙: 실패는 이름표와 함께 모은다 → 하나라도 실패하면 화면은 "불러오지 못했습니다 — 다시 시도", 보내기·저장 단추는 막는다.
 */

export type LoadFailure = { label: string; message: string };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? "")) || "알 수 없는 오류";

/** 실패를 삼키지 않고 failures 에 적는다. 실패면 null — 부른 쪽은 null 을 0건으로 쓰지 말고 failures 를 본다 */
export async function tryLoad<T>(label: string, promise: Promise<T>, failures: LoadFailure[]): Promise<T | null> {
  try { return await promise; }
  catch (e) { failures.push({ label, message: errText(e) }); return null; }
}

/** 화면에 띄울 한 줄 — "불러오지 못했습니다 — 다시 시도해 주세요 (점검 기록: timeout)" */
export function failureMessage(failures: LoadFailure[], what = "자료"): string {
  if (!failures.length) return "";
  const detail = failures.map((f) => `${f.label}: ${f.message}`).join(" · ");
  return `${what}를 불러오지 못했습니다 — 다시 시도해 주세요 (${detail})`;
}

/** 건수 표기 — 실패면 "—"(0건처럼 보이지 않게) */
export function countLabel(count: number, failed: boolean): string {
  return failed ? "—" : `${count}건`;
}

export type ReportViewKind = "idle" | "loading" | "error" | "ready";

/** 고객 리포트 화면 상태 — 실패면 리포트 본문(건수)을 그리지 않고 보내기·저장·인쇄 단추를 막는다 */
export function reportViewState(input: { hasReport: boolean; loading: boolean; error: string }): { kind: ReportViewKind; canSend: boolean } {
  if (input.loading) return { kind: "loading", canSend: false };
  if (input.error) return { kind: "error", canSend: false };
  if (input.hasReport) return { kind: "ready", canSend: true };
  return { kind: "idle", canSend: false };
}
