import { md5 } from "./md5";
import { insertRow, selectRows, upsertRow } from "./supabase";

export type WorkKind = "inspection" | "as" | "delivery" | "etc" | "pc" | "misu" | "bulman" | "recontract" | "overage";

export type VisitDraft = {
  visited: boolean;
  vendor: string;
  author: string;
  workDate: string;
  arrivalTime: string;
  machineCount: number;
  grade: string;
  contractEnded: boolean;
  workKinds: WorkKind[];
  minutes: Partial<Record<WorkKind, number>>;
  salesIt: "" | "1차" | "2차";
  salesCopier: "" | "1차" | "2차";
  commute: "" | "귀사" | "직퇴";
  note: string;
};

export type VisitRow = VisitDraft & {
  id: string;
  created_at: string;
};

export const WORK_LABELS: Record<WorkKind, string> = {
  inspection: "점검", as: "AS", delivery: "납품/반출/교체/셋팅", etc: "기타(여분,마감)",
  pc: "PC·IT 홍보", misu: "미수", bulman: "불만", recontract: "재계약", overage: "초과조정",
};

export function kstDate(d = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function weekRange(date = kstDate()): { start: string; end: string } {
  const d = new Date(`${date}T12:00:00+09:00`);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  const start = kstDate(d);
  d.setDate(d.getDate() + 6);
  return { start, end: kstDate(d) };
}

export async function saveVisit(draft: VisitDraft, sourceText: string): Promise<"new" | "dup"> {
  if (!draft.vendor.trim() || !draft.author.trim()) return "dup";
  const minutes = Object.fromEntries(Object.entries(draft.minutes).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]));
  const dup = md5([draft.workDate, draft.author, draft.vendor, sourceText].join("|"));
  return insertRow("visit_logs", {
    work_date: draft.workDate, author: draft.author, vendor: draft.vendor.trim(), visited: draft.visited,
    arrival_time: draft.arrivalTime || null, machine_count: Math.max(0, Number(draft.machineCount) || 0),
    grade: draft.grade || null, contract_ended: draft.contractEnded,
    work_kinds: draft.workKinds, minutes, sales_it: draft.salesIt || null, sales_copier: draft.salesCopier || null,
    commute: draft.commute || null, note: draft.note || null, _dupKey: dup,
  });
}

type DbVisit = { id: string; created_at: string; work_date: string; author: string; vendor: string; visited: boolean; arrival_time?: string; machine_count?: number; grade?: string; contract_ended?: boolean; work_kinds?: WorkKind[]; minutes?: Partial<Record<WorkKind, number>>; sales_it?: VisitDraft["salesIt"]; sales_copier?: VisitDraft["salesCopier"]; commute?: VisitDraft["commute"]; note?: string };

export async function getVisits(author: string, start: string, end: string): Promise<VisitRow[]> {
  if (!author) return [];
  const q = `select=*&author=eq.${encodeURIComponent(author)}&work_date=gte.${start}&work_date=lte.${end}&order=work_date.asc,arrival_time.asc,created_at.asc`;
  const rows = await selectRows<DbVisit>("visit_logs", q);
  return rows.map((r) => ({
    id: r.id, created_at: r.created_at, workDate: r.work_date, author: r.author, vendor: r.vendor,
    visited: r.visited, arrivalTime: r.arrival_time || "", machineCount: r.machine_count || 0,
    grade: r.grade || "", contractEnded: Boolean(r.contract_ended), workKinds: r.work_kinds || [],
    minutes: r.minutes || {}, salesIt: r.sales_it || "", salesCopier: r.sales_copier || "",
    commute: r.commute || "", note: r.note || "",
  }));
}

export const OFFICE_LABELS = {
  repairItem: "수리품", machineRepair: "기계수리", overhaul: "기계오버홀", shippingPrep: "출고준비",
  training: "교육참여", wasteCard: "폐카불량", schedule: "스케줄", phoneClose: "전화마감",
  cleanup: "정리정돈", vehicleCleanup: "차량정리",
} as const;
export type OfficeKind = keyof typeof OFFICE_LABELS;
export type OfficeValues = Record<OfficeKind, { count: number; minutes: number }>;
export type OfficeLog = { workDate: string; author: string; returnTime: string; values: OfficeValues };

export function emptyOfficeValues(): OfficeValues {
  return Object.fromEntries(Object.keys(OFFICE_LABELS).map((k) => [k, { count: 0, minutes: 0 }])) as OfficeValues;
}

export async function getOfficeLogs(author: string, start: string, end: string): Promise<OfficeLog[]> {
  if (!author) return [];
  const rows = await selectRows<Record<string, unknown>>("office_logs", `select=*&author=eq.${encodeURIComponent(author)}&work_date=gte.${start}&work_date=lte.${end}&order=work_date.asc`);
  return rows.map((r) => ({ workDate: String(r.work_date), author: String(r.author), returnTime: String(r.return_time || ""), values: { ...emptyOfficeValues(), ...((r.values as OfficeValues) || {}) } }));
}

export async function saveOfficeLog(log: OfficeLog): Promise<void> {
  await upsertRow("office_logs", { work_date: log.workDate, author: log.author, return_time: log.returnTime || null, values: log.values, updated_at: new Date().toISOString() }, "author,work_date");
}

export type GoalStatus = "todo" | "doing" | "done" | "failed" | "carried";
export type GoalItem = { id: string; title: string; target: string; result: string; status: GoalStatus; reason: string; nextAction: string };
export type BottleneckItem = { title: string; cause: string; solution: string };
export type WeeklyNote = { goals: Record<string, number>; goalItems: GoalItem[]; bottlenecks: BottleneckItem[]; thisWeekGoal: string; thisWeekResult: string; nextWeekGoal: string; review: string; growth: string; challenge: string; special: string; learning: string; request: string; praise: string };
export const emptyBottlenecks = (): BottleneckItem[] => Array.from({ length: 3 }, () => ({ title: "", cause: "", solution: "" }));
export const EMPTY_WEEKLY_NOTE: WeeklyNote = { goals: {}, goalItems: [], bottlenecks: emptyBottlenecks(), thisWeekGoal: "", thisWeekResult: "", nextWeekGoal: "", review: "", growth: "", challenge: "", special: "", learning: "", request: "", praise: "" };

function normalizeBottlenecks(value: unknown): BottleneckItem[] {
  const rows = Array.isArray(value) ? value : [];
  return emptyBottlenecks().map((empty, i) => ({ ...empty, ...(rows[i] as Partial<BottleneckItem> || {}) }));
}

export async function getWeeklyNote(author: string, weekStart: string): Promise<WeeklyNote> {
  const rows = await selectRows<Record<string, unknown>>("weekly_notes", `select=*&author=eq.${encodeURIComponent(author)}&week_start=eq.${weekStart}&limit=1`);
  if (!rows.length) return { ...EMPTY_WEEKLY_NOTE };
  const r = rows[0];
  return { goals: (r.goals as Record<string, number>) || {}, goalItems: (r.goal_items as GoalItem[]) || [], bottlenecks: normalizeBottlenecks(r.bottlenecks), thisWeekGoal: String(r.this_week_goal || ""), thisWeekResult: String(r.this_week_result || ""), nextWeekGoal: String(r.next_week_goal || ""), review: String(r.review || ""), growth: String(r.growth || ""), challenge: String(r.challenge || ""), special: String(r.special || ""), learning: String(r.learning || ""), request: String(r.request || ""), praise: String(r.praise || "") };
}

export async function saveWeeklyNote(author: string, weekStart: string, note: WeeklyNote): Promise<void> {
  const { goalItems, ...rest } = note;
  const { thisWeekGoal, thisWeekResult, nextWeekGoal, ...fields } = rest;
  await upsertRow("weekly_notes", { author, week_start: weekStart, ...fields, this_week_goal: thisWeekGoal, this_week_result: thisWeekResult, next_week_goal: nextWeekGoal, goal_items: goalItems, updated_at: new Date().toISOString() }, "author,week_start");
}

export type WeeklyNoteRow = WeeklyNote & { author: string; weekStart: string };
export async function getWeeklyNotes(start: string, end: string): Promise<WeeklyNoteRow[]> {
  const rows = await selectRows<Record<string, unknown>>("weekly_notes", `select=*&week_start=gte.${start}&week_start=lte.${end}&order=week_start.desc,author.asc`);
  return rows.map((r) => ({ author: String(r.author), weekStart: String(r.week_start), goals: (r.goals as Record<string, number>) || {}, goalItems: (r.goal_items as GoalItem[]) || [], bottlenecks: normalizeBottlenecks(r.bottlenecks), thisWeekGoal: String(r.this_week_goal || ""), thisWeekResult: String(r.this_week_result || ""), nextWeekGoal: String(r.next_week_goal || ""), review: String(r.review || ""), growth: String(r.growth || ""), challenge: String(r.challenge || ""), special: String(r.special || ""), learning: String(r.learning || ""), request: String(r.request || ""), praise: String(r.praise || "") }));
}

export type LevelGoal = {
  id: string;
  category: string;
  grade?: string;
  title: string;
  currentLevel: string;
  targetLevel: string;
  budget: string;
  reflectedBudget?: string;
  month1: string;
  month2: string;
  month3: string;
  progress: number;
  resultMerged?: boolean;
};
export type QuarterlyPlan = { author: string; year: number; quarter: number; goals: LevelGoal[] };
export async function getQuarterlyPlan(author: string, year: number, quarter: number): Promise<QuarterlyPlan> {
  const rows = await selectRows<Record<string, unknown>>("quarterly_plans", `select=*&author=eq.${encodeURIComponent(author)}&year=eq.${year}&quarter=eq.${quarter}&limit=1`);
  return rows.length ? { author, year, quarter, goals: (rows[0].goals as LevelGoal[]) || [] } : { author, year, quarter, goals: [] };
}
export async function saveQuarterlyPlan(plan: QuarterlyPlan): Promise<void> {
  await upsertRow("quarterly_plans", { author: plan.author, year: plan.year, quarter: plan.quarter, goals: plan.goals, updated_at: new Date().toISOString() }, "author,year,quarter");
}

export const GOLDEN_CATEGORIES = ["매출증대/안정", "효율성", "비용절감", "자기개발", "소통", "AI"] as const;
export const GOLDEN_QUESTIONS = ["지난 기간 나의 성과", "타인의 성과에 내가 기여한 것", "성장을 위한 학습·발견한 지식", "다음 도전을 위한 지원 요청"] as const;
export type GoldenCard = { author: string; year: number; quarter: number; answers: Record<string, Record<string, string>> };
export async function getGoldenCard(author: string, year: number, quarter: number): Promise<GoldenCard> {
  const rows = await selectRows<Record<string, unknown>>("golden_cards", `select=*&author=eq.${encodeURIComponent(author)}&year=eq.${year}&quarter=eq.${quarter}&limit=1`);
  return rows.length ? { author, year, quarter, answers: (rows[0].answers as GoldenCard["answers"]) || {} } : { author, year, quarter, answers: {} };
}
export async function saveGoldenCard(card: GoldenCard): Promise<void> {
  await upsertRow("golden_cards", { author: card.author, year: card.year, quarter: card.quarter, answers: card.answers, updated_at: new Date().toISOString() }, "author,year,quarter");
}
