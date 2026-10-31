/**
 * naver-calendar-sync ① 연결된 일정(미러·수입) — 네이버 쪽 변화 → 웹앱 as_tickets PATCH 본문 계산(순수 함수).
 * Deno(엣지)·Vite(테스트) 둘 다 읽으므로 외부 import 없이 둔다.
 *
 * 앱에서 이미 완료한 일정(status=완료)은 네이버가 미완료여도 되돌리지 않는다 — 날짜·시간·제목도 손대지 않고,
 * status 는 "완료로 올리기"만 있고 내리기는 없다. 물류(납품철수교체)는 일정리스트에서만 완료하고 네이버는 영업부가
 * 그대로 두므로(2026-10-31 사용자 결정 (나)안) 이 보존이 깨지면 완료한 물류가 다음 동기화에 다시 열린다.
 */
export type LinkedTicketLite = { status: string; date: string; time: string; assignee?: string; calendarTitle?: string; vendor?: string };
export type LinkedEventLite = { date: string; time: string; title: string; completed: boolean };

export function linkedTicketPatch(t: LinkedTicketLite, ev: LinkedEventLite, calKind: string): Record<string, string> {
  const patchBody: Record<string, string> = {};
  if (t.status !== "완료") {
    const newTime = ev.time || t.time;
    if (t.date !== ev.date || (t.time || "") !== (newTime || "")) {
      patchBody.date = ev.date;
      patchBody.time = newTime;
    }
    if (ev.title) {
      const assignee = String(t.assignee || "");
      // 제목 머리: 3명까지는 저장값 그대로, 4명 이상은 "김A 외 n명"(src/assignees.ts titleAssigneeLabel 과 같은 규칙)
      const names = assignee.split(/[,，/·・]/).map((n) => n.trim()).filter((n, i, a) => n && a.indexOf(n) === i);
      const head = names.length > 3 ? `${names[0]} 외 ${names.length - 1}명` : assignee;
      const stripped = head && ev.title.startsWith(`${head}-`) ? ev.title.slice(head.length + 1) : ev.title;
      const current = (t.calendarTitle || "").trim() || String(t.vendor || "");
      if (stripped.trim() && stripped.trim() !== current.trim()) patchBody.calendarTitle = stripped.trim().slice(0, 200);
    }
  }
  // 영업부가 네이버에서 완료 체크(X-NAVER-COMPLETED) → 웹앱 상태도 완료. 반대 방향(완료→미완료)은 없다.
  if ((ev.completed || calKind === "done") && t.status !== "완료") patchBody.status = "완료";
  return patchBody;
}
