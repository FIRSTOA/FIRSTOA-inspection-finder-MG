/**
 * 네이버에서 사라진(href 목록에서 빠진) 일정이 웹앱 티켓에 걸려 있을 때 "지울지 / 옮긴 것으로 볼지 / 이번엔 미룰지" 판단(순수).
 *
 * 2026-10-31: 예전엔 계정 캘린더 목록 조회(PROPFIND)나 다른 캘린더 확인(GET)이 실패하면 "없음"으로 읽어
 * 티켓을 지울 수 있었다(8월 사고와 같은 계통 — 네이버 장애를 삭제로 오판). 이제 조회 실패는 "모름"이고,
 * 모르면 이번 회차엔 지우지 않고 state 행도 남겨 다음 1분 실행이 다시 본다. 손해는 삭제가 몇 분 늦는 것뿐.
 */
export type ProbeResult = "found" | "absent" | "error";

export type GoneDecision = "moved" | "delete" | "defer";

export function decideGoneTicket(input: { accountCals: string[] | null; probes: ProbeResult[] }): GoneDecision {
  if (input.accountCals === null) return "defer";          // 캘린더 목록을 못 받았다 — 다른 캘린더에 있는지 알 수 없음
  if (input.probes.includes("found")) return "moved";       // 다른 캘린더에 살아 있다
  if (input.probes.includes("error")) return "defer";       // 한 곳이라도 확인 실패 → 모름
  return "delete";                                          // 전부 '없음'으로 확인됐다
}

/** CalDAV GET 응답 → 판정. 2xx = 있음, 404/410 = 없음, 그 밖(5xx·타임아웃·네트워크) = 확인 실패 */
export function probeResultOf(res: { ok: boolean; status: number } | null): ProbeResult {
  if (!res) return "error";
  if (res.ok) return "found";
  if (res.status === 404 || res.status === 410) return "absent";
  return "error";
}
