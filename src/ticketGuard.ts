/**
 * 쓰기 전에 꼭 읽어야 하는 조회 — 실패하면 빈 배열로 넘어가지 말고 멈춘다(2026-10-24 위험 점검 B1·B2).
 * `.catch(() => [])` 로 삼키면 "없음"과 "모름"이 같아져서, 중복 방지 검사가 꺼진 채 일정이 하나 더 생기거나
 * (ServiceReception 접수→일정) 기존 메모 없이 PATCH 가 나가 메모가 지워졌다(App finishTicket).
 * 호출부는 이미 try/catch 로 오류를 알림(notify/showToast)에 띄우므로 여기선 사람이 읽을 문장으로 다시 던지기만 한다.
 */
export async function readOrStop<T>(query: Promise<T[]>, what: string): Promise<T[]> {
  try {
    return await query;
  } catch (e) {
    throw new Error(`${what} 확인을 못 해서 멈췄어요 — 저장하지 않았습니다. 잠시 뒤 다시 시도해 주세요. (${(e as Error)?.message || String(e)})`);
  }
}
