/**
 * 자동 일정 등록 때 "그 달 같은 업체의 열린 매월점검 일정" 처리 — 2026-10-26.
 * 규칙(2026-09-24 제이엘케이 중복 방지)은 같은 달 같은 업체를 두 번 만들지 않는 것. 그런데
 * 날짜가 지난 '배정' 매월점검(10/22 한왕주 석촌점·권's 미방문)은 일정리스트(날짜별)에도 홈 미처리(CS 접수만)에도
 * 안 보여 사용자가 찾을 수 없는 행이 되어 그 달 재등록을 계속 막았다. 그래서:
 *  - 지난 날짜(date < 오늘)의 열린 행 → 새로 만들지 않고 그 행을 고른 날짜·등록자·팀으로 옮긴다(move)
 *  - 오늘·미래에 이미 열린 행 → 건너뛴다(skip) — 같은 날 같은 업체 포함
 *  - 없으면 새로 만든다(new)
 * 색인·옮김 대상은 자동 일정 화면이 만든 행(source autoplan/manual/workin)만.
 * 안내 문구는 업체명을 「」로 감싼다 — "…위메이크홀딩스, 주식회사 휴메이크"처럼 이름 속 쉼표가 목록 구분과 섞이지 않게.
 */
import { vendorMatchKey } from "./ids";

export type OpenCheckTicket = { id: string; vendor: string; date: string; assignee?: string | null; team?: string | null; source?: string | null };
export type SkippedPick = { name: string; open: OpenCheckTicket };
export type MovedPick = { name: string; from: OpenCheckTicket; date: string; assignee: string };
export type RegisterPlan = { kind: "new" } | { kind: "skip"; open: OpenCheckTicket } | { kind: "move"; open: OpenCheckTicket };

/** 자동 일정 화면이 만든 행의 source — 그 밖(빈 문자열=웹 캘린더 '확인용 표시', naver 등)은 관리 대상이 아니라 건너뛰지도 옮기지도 않는다(2026-10-27 사용자 결정) */
export const AUTO_SCHEDULE_SOURCES = ["autoplan", "manual", "workin"] as const;
export const isAutoScheduleRow = (row: { source?: string | null }) => (AUTO_SCHEDULE_SOURCES as readonly string[]).includes(String(row.source ?? ""));

/** 업체 비교키 → 그 달 열린 점검 일정들(날짜순). vendorOf 는 원본 vendor 에서 업체명을 꺼낸다 */
export function indexOpenChecks(rows: OpenCheckTicket[], vendorOf: (raw: string) => string = (v) => v): Map<string, OpenCheckTicket[]> {
  const map = new Map<string, OpenCheckTicket[]>();
  for (const row of rows) {
    if (!isAutoScheduleRow(row)) continue; // 확인용 표시 등은 색인 제외
    const key = vendorMatchKey(vendorOf(row.vendor) || row.vendor);
    if (!key) continue; // 빈 키끼리 엉뚱하게 겹치지 않게
    const list = map.get(key) || [];
    list.push(row);
    list.sort((a, b) => a.date.localeCompare(b.date));
    map.set(key, list);
  }
  return map;
}

/** 이 업체를 어떻게 등록할지 — 오늘·미래 열린 행이 있으면 건너뜀, 지난 열린 행만 있으면 옮김, 없으면 새로 */
export function planRegister(vendorName: string, index: Map<string, OpenCheckTicket[]>, today: string): RegisterPlan {
  const rows = index.get(vendorMatchKey(vendorName)) || [];
  const current = rows.find((r) => r.date >= today);
  if (current) return { kind: "skip", open: current };
  const stale = rows.find((r) => r.date < today);
  if (stale) return { kind: "move", open: stale };
  return { kind: "new" };
}

/** 등록·옮김 뒤 색인 갱신 — 같은 등록 안에서 같은 업체가 또 나오면 건너뛰게 */
export function markPlanned(index: Map<string, OpenCheckTicket[]>, vendorName: string, row: OpenCheckTicket) {
  const key = vendorMatchKey(vendorName);
  if (!key) return;
  const list = (index.get(key) || []).filter((r) => r.id !== row.id);
  list.push(row);
  list.sort((a, b) => a.date.localeCompare(b.date));
  index.set(key, list);
}

type Upsert = (table: string, row: Record<string, unknown>, onConflict: string) => Promise<void>;

/** 지난 미완료 일정을 고른 날짜로 옮긴다 — 같은 id 행을 날짜·담당·팀만 바꿔 upsert(새 행 없음, 나머지 칸 유지) */
export async function moveOpenCheck(open: OpenCheckTicket, target: { date: string; assignee: string; team: string }, upsert: Upsert): Promise<OpenCheckTicket> {
  await upsert("as_tickets", { id: open.id, date: target.date, assignee: target.assignee, team: target.team, updated_at: new Date().toISOString() }, "id");
  return { ...open, date: target.date, assignee: target.assignee, team: target.team };
}

const md = (date: string) => { const [, m, d] = date.split("-"); return m && d ? `${Number(m)}/${Number(d)}` : date; };
const who = (name?: string | null) => String(name || "").trim() || "담당 없음";

/** 옮긴 곳 안내 — 「업체」 10/22 미완료 일정을 10/27로 옮김(담당 한왕주→이민구) */
export function moveNotice(moved: MovedPick[]): string {
  if (!moved.length) return "";
  return `지난 미완료 일정 ${moved.length}곳은 옮김 — ${moved.map(({ name, from, date, assignee }) => {
    const before = who(from.assignee);
    return `「${name}」 자동 일정이 만든 ${md(from.date)} 미완료 일정을 ${md(date)}로 옮김(담당 ${before === assignee ? assignee : `${before}→${assignee}`})`;
  }).join(" / ")}`;
}

/** 건너뜀 안내 — 업체마다: 「업체」 이미 10/27 한왕주 점검 일정 있음(예정) */
export function skipNotice(skipped: SkippedPick[], today: string): string {
  if (!skipped.length) return "";
  const lines = skipped.map(({ name, open }) => `「${name}」 이미 자동 일정이 만든 ${md(open.date)} ${who(open.assignee)} 점검 일정 있음(${open.date === today ? "오늘" : "예정"})`);
  return `새로 만들지 않은 ${skipped.length}곳 — ${lines.join(" / ")}. 같은 달에 같은 곳을 두 번 만들지 않습니다 — 날짜·담당을 바꾸려면 일정리스트에서 그 날짜의 일정을 고치세요.`;
}
