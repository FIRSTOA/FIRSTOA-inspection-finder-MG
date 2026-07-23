import { AUTHOR_BOOK, AUTHOR_TEAMS, type AuthorTeam } from "./authors";
import { md5 } from "./md5";
import { insertRow, selectRows } from "./supabase";

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
};

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
  }));
}

export const OPERATIONS_TEAMS: Array<AuthorTeam | "미지정"> = ["팀장", "A", "B", "C", "D", "미지정"];
