/**
 * 카테고리 양식(불만·재계약·초과조정) 저장 성공 신호 — api.ts sendCategoryForm → 창 이벤트 → CategoryForm.
 * App.tsx 를 거치지 않으려고 창 이벤트로 잇는다(설계안 recontract-next-check §2, App.tsx 0줄).
 * 재계약 + 다음확인일이 날짜면 "일정 만들까요?" 제안을 기기에 함께 남긴다 — 보낸 직후 화면을 떠나도 다음 진입 때 다시 묻는다(R4).
 */
import { saveScheduleOffer, shouldOfferSchedule } from "./recontractSchedule";

export const CATEGORY_SENT_EVENT = "field:category-sent";

export type CategorySentDetail = {
  schemaKey: string;
  form: Record<string, string>;
  author: string;
  dupKey: string;
  text: string;
  testMode: boolean;
};

/** 저장·방 큐가 끝난 뒤 부른다. 신호 실패가 전송 결과를 바꾸면 안 되므로 여기서 던지지 않는다(저장·카톡은 이미 끝남). */
export function emitCategorySent(detail: CategorySentDetail): void {
  try {
    if (shouldOfferSchedule(detail)) {
      saveScheduleOffer({ dupKey: detail.dupKey, form: { ...detail.form }, author: detail.author, text: detail.text, testMode: detail.testMode, at: Date.now() });
    }
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<CategorySentDetail>(CATEGORY_SENT_EVENT, { detail }));
  } catch (e) {
    console.warn("양식 전송 신호 실패(전송은 정상)", e);
  }
}

/** 구독 — 해제 함수를 돌려준다(useEffect 정리용). */
export function onCategorySent(fn: (detail: CategorySentDetail) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (e: Event) => { const d = (e as CustomEvent<CategorySentDetail>).detail; if (d) fn(d); };
  window.addEventListener(CATEGORY_SENT_EVENT, handler);
  return () => window.removeEventListener(CATEGORY_SENT_EVENT, handler);
}
