/**
 * 키맨(담당자) 변경 관리 (2026-08-27, 대표님 요청)
 * 취지: 키맨이 바뀐 직후에 인사드리고 신경 쓰는 모습을 보여주면 나중 재계약·친밀도에서 확실히 다르다.
 * 그래서 ① 변경 즉시 지역 점검방에도 공유(api.ts) ② FIELD 점검·AS 화면에서 90일 내 변경을 띄운다(KeymanCard)
 *      ③ 인사 완료 여부를 남긴다(contact_changes.greeting_*).
 */
import { invokeEdgeFunction, selectRows } from "./supabase";
import { vendorMatchKey } from "./ids";

export type ContactChange = {
  id: string;
  created_at: string;
  change_date: string;
  author: string;
  company: string;
  region: string;
  category: string;
  reason: string;
  grade: string;
  before_text: string;
  after_text: string;
  notes: string;
  photo_link: string;
  greeting_done: boolean;
  greeting_by: string;
  greeting_at: string | null;
};

/** 사람이 바뀐 건인가 — 주소·전화만 바뀐 건은 인사 대상이 아니다 */
export function isKeymanChange(row: Pick<ContactChange, "category" | "reason">): boolean {
  const text = `${row.category || ""} ${row.reason || ""}`;
  if (/주소/.test(row.category || "")) return false;
  return /키맨|담당|대표|소장|점장|팀장|과장|부장|실장|사장|이사|인사|퇴사|입사|교체|변경자/.test(text);
}

/** 변경일로부터 며칠 지났나 (음수는 0으로) */
export function daysSince(value: string): number {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

/** 두 업체명이 같은 곳인가 — 지점 표기·괄호·공백 차이를 흡수한다 (통합이력과 같은 기준) */
export function sameVendor(a: string, b: string): boolean {
  const ka = vendorMatchKey(a || "");
  const kb = vendorMatchKey(b || "");
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return ka.length >= 4 && kb.length >= 4 && (ka.includes(kb) || kb.includes(ka));
}

/** 이 업체의 최근 변경 이력 (기본 90일) — 최신순 */
export async function recentChangesFor(vendor: string, days = 90): Promise<ContactChange[]> {
  const name = String(vendor || "").trim();
  if (vendorMatchKey(name).length < 2) return [];
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = await selectRows<ContactChange>(
    "contact_changes",
    `select=*&change_date=gte.${from}&order=change_date.desc,created_at.desc&limit=500`,
  );
  return rows.filter((row) => sameVendor(row.company, name));
}

/**
 * 담당자변경 시트("키맨체크" 탭) → 앱으로 가져오기.
 * 변경은 웹앱뿐 아니라 카톡방 메신저봇+Make로도 시트에 직접 쌓인다 — 시트가 최종 저장소라서 이쪽을 읽어야 전부 보인다.
 * 이미 있는 건은 건드리지 않고(인사 완료 표시 보존) 없는 건만 넣는다.
 */
export type SheetPullResult = { inserted: number; read: number; greetingSynced: number };

export async function pullContactSheet(days = 400): Promise<SheetPullResult> {
  const res = await invokeEdgeFunction<{ ok?: boolean; inserted?: number; read?: number; greetingSynced?: number; error?: string }>(
    "contact-sheet-pull", { days },
  );
  if (res.error) throw new Error(res.error);
  return { inserted: res.inserted || 0, read: res.read || 0, greetingSynced: res.greetingSynced || 0 };
}

const PULL_STAMP = "firstoa.contactSheetPulledAt";

/** 화면을 열 때 조용히 최신화 — 브라우저당 1시간에 한 번만 부른다(시트 API·비용 절약) */
export async function maybePullContactSheet(): Promise<SheetPullResult | null> {
  if (typeof window === "undefined") return null;
  try {
    const last = Number(window.localStorage.getItem(PULL_STAMP) || 0);
    if (Date.now() - last < 60 * 60_000) return null;
    window.localStorage.setItem(PULL_STAMP, String(Date.now())); // 먼저 찍어 중복 호출을 막는다
    return await pullContactSheet(400);
  } catch { return null; }
}
