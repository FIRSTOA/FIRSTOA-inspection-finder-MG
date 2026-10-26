/**
 * 재계약 보내기 성공 → 다음 확인일 일정 바로 만들기(2026-10-27 사용자 "날짜면 일정 만들기를 기본으로").
 * - 창(RecontractScheduleSheet)이 하던 [일정 만들기]와 같은 값·같은 함수(createRecontractSchedule)를 쓴다.
 * - 같은 업체 열린 재계약 일정이 있으면 만들지 않고 "duplicate" → 호출부가 기존 창(옮기기/새로/취소)을 띄운다.
 * - 실패(팀 모름·저장 실패 등)면 "failed" → 호출부가 창을 띄워 사람이 처리(24시간 제안은 남겨 둔다).
 * - 테스트 모드는 예전 규칙 그대로(창으로 묻기) — 여기서 "sheet" 를 돌려준다.
 * [취소]는 cancelRecontractSchedule: 일정리스트 행 삭제 + 네이버 일정 삭제(CsAsWorkspace 삭제와 같은 호출).
 */
import { deleteRows, invokeEdgeFunction, selectRows } from "./supabase";
import {
  assigneeForRecontract, buildRecontractSummary, createRecontractSchedule, defaultScheduleTitle, isYmd, shouldOfferSchedule,
  teamForRecontract, vendorOf, type NaverJob, type NaverState, type OpenRecontractTicket, type RecontractScheduleInput, type ScheduleOffer,
} from "./recontractSchedule";

export type AutoScheduleDeps = {
  today: string;
  book: Partial<Record<string, string[]>>;
  names: string[];
  /** 장소 기본값(임대리스트 주소) — 못 찾거나 실패하면 빈칸 */
  findAddress: (vendor: string) => Promise<string>;
  /** 작성일(YYYY-MM-DD, KST) — 내용 끝 "작성 이름 날짜" */
  writtenOn: string;
  create?: typeof createRecontractSchedule;
};

export type AutoScheduleOutcome =
  | { kind: "skip" }
  | { kind: "sheet" }
  | { kind: "duplicate"; existing: OpenRecontractTicket[] }
  | { kind: "created"; ticketId: string; date: string; naver: NaverState; naverError?: string; naverJob?: NaverJob }
  | { kind: "failed"; error: string };

/** 창의 처음 값과 같은 입력(팀·제목·장소·내용·담당). */
export function buildAutoScheduleInput(offer: ScheduleOffer, deps: Pick<AutoScheduleDeps, "book" | "names" | "writtenOn">, address: string): RecontractScheduleInput {
  const date = String(offer.form["다음확인일"] || "").trim();
  return {
    dupKey: offer.dupKey, form: offer.form, author: offer.author, testMode: offer.testMode,
    date,
    team: teamForRecontract(offer.form, offer.author, deps.book),
    title: defaultScheduleTitle(vendorOf(offer.form), offer.testMode),
    address,
    note: buildRecontractSummary(offer.form, offer.author, date, offer.text, deps.writtenOn),
    assignee: assigneeForRecontract(offer.form, offer.author, deps.names),
  };
}

export async function autoCreateRecontractSchedule(offer: ScheduleOffer, deps: AutoScheduleDeps): Promise<AutoScheduleOutcome> {
  if (!shouldOfferSchedule({ schemaKey: "recontract", form: offer.form })) return { kind: "skip" };
  if (offer.testMode) return { kind: "sheet" };
  let address = "";
  try { address = String(await deps.findAddress(vendorOf(offer.form)) || ""); } catch (e) { console.warn("장소 기본값 조회 실패(빈칸으로 만듦)", e); }
  const input = buildAutoScheduleInput(offer, deps, address);
  try {
    const r = await (deps.create || createRecontractSchedule)(input, "auto", deps.today);
    if (r.kind === "duplicate") return { kind: "duplicate", existing: r.existing };
    return { kind: "created", ticketId: r.ticketId, date: r.date, naver: r.naver, naverError: r.naverError, naverJob: r.naverJob };
  } catch (e) {
    return { kind: "failed", error: (e as Error).message || "알 수 없는 오류" };
  }
}

/** "재계약 확인 일정 11/15 만들었습니다" (+ 네이버 상태 꼬리). */
export function autoCreatedMessage(date: string, naver: NaverState): string {
  const md = isYmd(date) ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : date;
  const tail = naver === "failed" ? " — 네이버만 실패" : naver === "off" ? " — 네이버 꺼짐" : "";
  return `재계약 확인 일정 ${md} 만들었습니다${tail}`;
}

/** [취소] 누를 수 있는 시간 */
export const AUTO_UNDO_MS = 10_000;

export type CancelDeps = {
  select?: typeof selectRows;
  remove?: typeof deleteRows;
  invoke?: typeof invokeEdgeFunction;
};

/**
 * 자동으로 만든 일정 지우기. 일정리스트 삭제가 실패하면 throw(호출부가 오류 알림).
 * 네이버 삭제만 실패하면 throw 하지 않고 { naverError } — 네이버에서 직접 지우라고 알린다.
 */
export async function cancelRecontractSchedule(ticketId: string, deps: CancelDeps = {}): Promise<{ naverError?: string }> {
  const select = deps.select || selectRows;
  const remove = deps.remove || deleteRows;
  const invoke = deps.invoke || invokeEdgeFunction;
  const id = encodeURIComponent(ticketId);
  const rows = await select<{ id: string; naverUid?: string }>("as_tickets", `select=id,naverUid&id=eq.${id}&limit=1`);
  await remove("as_tickets", `id=eq.${id}`);
  const uid = String(rows[0]?.naverUid || "").trim();
  if (!uid) return {};
  try {
    await invoke("naver-calendar-push", { action: "caldav_delete", uid });
    return {};
  } catch (e) {
    return { naverError: (e as Error).message || "알 수 없는 오류" };
  }
}
