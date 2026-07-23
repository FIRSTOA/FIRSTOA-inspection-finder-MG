import { AUTHOR_BOOK, AUTHOR_TEAMS, type AuthorTeam } from "./authors";
import { md5 } from "./md5";
import { insertRow, selectRows, updateRows } from "./supabase";

export type ActivityKind =
  | "inspection"
  | "as"
  | "logistics"
  | "expansion_it"
  | "expansion_copier"
  | "contact_change"
  | "complaint"
  | "misu"
  | "overage"
  | "recontract"
  | "replacement";

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  inspection: "점검",
  as: "AS",
  logistics: "물류",
  expansion_it: "확장성 IT",
  expansion_copier: "확장성 복합기",
  contact_change: "담당자·주소 변경",
  complaint: "불만",
  misu: "미수",
  overage: "초과조정",
  recontract: "재계약",
  replacement: "교체양식",
};

export type ActivityEventDraft = {
  activityDate: string;
  author: string;
  team?: string;
  category: ActivityKind;
  vendor: string;
  quantity?: number;
  machineCount?: number;
  sourceText?: string;
  metadata?: Record<string, unknown>;
};

export type ActivityEvent = ActivityEventDraft & {
  id: string;
  createdAt: string;
  status: "active" | "cancelled";
  cancelledAt?: string;
  cancelledBy?: string;
};

export type LogisticsKind = "납품" | "교체" | "세팅" | "이전" | "철수" | "여분" | "마감" | "기타";
export const LOGISTICS_KINDS: LogisticsKind[] = ["납품", "교체", "세팅", "이전", "철수", "여분", "마감", "기타"];

export function normalizeLogisticsKind(value: string): LogisticsKind {
  const text = String(value || "").replace(/\s+/g, "");
  if (/여분/.test(text)) return "여분";
  if (/마감/.test(text)) return "마감";
  if (/철수/.test(text)) return "철수";
  if (/교체/.test(text)) return "교체";
  if (/이전/.test(text)) return "이전";
  if (/세팅|셋팅/.test(text)) return "세팅";
  if (/납품|배송/.test(text)) return "납품";
  return "기타";
}

export function logisticsKindForEvent(event: ActivityEvent): LogisticsKind {
  const metadataValue = String(event.metadata?.logisticsCategory || "");
  const sourceValue = event.sourceText?.match(/^구분\s*[:：]\s*(.+)$/m)?.[1] || "";
  return normalizeLogisticsKind(metadataValue || sourceValue);
}

function normalizeTeam(value: string): string {
  const match = String(value || "").toUpperCase().match(/(?:수도권|지역|팀)?\s*([ABCD])(?:팀)?/);
  return match?.[1] || "";
}

export function teamForAuthor(author: string): string {
  const clean = author.trim();
  for (const team of AUTHOR_TEAMS) {
    if (AUTHOR_BOOK[team].includes(clean)) return team === "팀장" ? "팀장" : team;
  }
  return "미지정";
}

export function activityTeam(author: string, sourceText = "", explicit = ""): string {
  const direct = normalizeTeam(explicit);
  if (direct) return direct;
  const field = sourceText.match(/^(?:수도권지역|지역)\s*[:：]\s*([^\n\r]+)/m)?.[1] || "";
  return normalizeTeam(field) || teamForAuthor(author);
}

export async function saveActivityEvent(draft: ActivityEventDraft): Promise<"new" | "dup"> {
  if (!draft.author.trim() || !draft.category) return "dup";
  const quantity = Math.max(0, Number(draft.quantity) || 0);
  const machineCount = Math.max(0, Number(draft.machineCount) || 0);
  const team = draft.team || activityTeam(draft.author, draft.sourceText || "");
  const sourceText = String(draft.sourceText || "");
  const vendor = draft.vendor.trim();
  const dupKey = md5([
    draft.activityDate,
    draft.author,
    draft.category,
    vendor,
    quantity,
    machineCount,
    sourceText,
  ].join("|"));
  return insertRow("activity_events", {
    activity_date: draft.activityDate,
    author: draft.author.trim(),
    team,
    category: draft.category,
    vendor,
    quantity,
    machine_count: machineCount,
    source_text: sourceText || null,
    metadata: draft.metadata || {},
    "_dupKey": dupKey,
  });
}

type DbActivityEvent = {
  id: string;
  created_at: string;
  activity_date: string;
  author: string;
  team: string;
  category: ActivityKind;
  vendor: string;
  quantity?: number;
  machine_count?: number;
  source_text?: string;
  metadata?: Record<string, unknown>;
  status?: "active" | "cancelled";
  cancelled_at?: string;
  cancelled_by?: string;
};

export async function getActivityEvents(start: string, end: string): Promise<ActivityEvent[]> {
  const rows = await selectRows<DbActivityEvent>(
    "activity_events",
    `select=*&activity_date=gte.${start}&activity_date=lte.${end}&order=activity_date.desc,created_at.desc`,
  );
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    activityDate: row.activity_date,
    author: row.author,
    team: row.team || teamForAuthor(row.author),
    category: row.category,
    vendor: row.vendor || "",
    quantity: row.quantity || 0,
    machineCount: row.machine_count || 0,
    sourceText: row.source_text || "",
    metadata: row.metadata || {},
    status: row.status === "cancelled" ? "cancelled" : "active",
    cancelledAt: row.cancelled_at || "",
    cancelledBy: row.cancelled_by || "",
  }));
}

export async function setActivityEventCancelled(id: string, cancelled: boolean, author: string): Promise<void> {
  await updateRows("activity_events", `id=eq.${encodeURIComponent(id)}`, {
    status: cancelled ? "cancelled" : "active",
    cancelled_at: cancelled ? new Date().toISOString() : null,
    cancelled_by: cancelled ? author.trim() : null,
  });
}

export async function setActivityEventsCancelledBySource(sourceText: string, author: string, activityDate: string, cancelled: boolean, cancelledBy: string): Promise<void> {
  if (!sourceText.trim()) return;
  const query = `source_text=eq.${encodeURIComponent(sourceText)}&author=eq.${encodeURIComponent(author)}&activity_date=eq.${activityDate}`;
  await updateRows("activity_events", query, {
    status: cancelled ? "cancelled" : "active",
    cancelled_at: cancelled ? new Date().toISOString() : null,
    cancelled_by: cancelled ? cancelledBy : null,
  });
}

export const OPERATIONS_TEAMS: Array<Exclude<AuthorTeam, "팀장">> = ["A", "B", "C", "D"];
