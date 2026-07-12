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
  inspection: "점검", as: "AS", delivery: "납품/반출/교체/셋팅", etc: "기타",
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

export type WeeklyNote = { goals: Record<string, number>; review: string; growth: string; challenge: string; special: string; learning: string; request: string; praise: string };
export const EMPTY_WEEKLY_NOTE: WeeklyNote = { goals: {}, review: "", growth: "", challenge: "", special: "", learning: "", request: "", praise: "" };

export async function getWeeklyNote(author: string, weekStart: string): Promise<WeeklyNote> {
  const rows = await selectRows<Record<string, unknown>>("weekly_notes", `select=*&author=eq.${encodeURIComponent(author)}&week_start=eq.${weekStart}&limit=1`);
  if (!rows.length) return { ...EMPTY_WEEKLY_NOTE };
  const r = rows[0];
  return { goals: (r.goals as Record<string, number>) || {}, review: String(r.review || ""), growth: String(r.growth || ""), challenge: String(r.challenge || ""), special: String(r.special || ""), learning: String(r.learning || ""), request: String(r.request || ""), praise: String(r.praise || "") };
}

export async function saveWeeklyNote(author: string, weekStart: string, note: WeeklyNote): Promise<void> {
  await upsertRow("weekly_notes", { author, week_start: weekStart, ...note, updated_at: new Date().toISOString() }, "author,week_start");
}
