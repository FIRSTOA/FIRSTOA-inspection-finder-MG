/**
 * 키맨(담당자) 변경 관리 (2026-08-27, 대표님 요청)
 * 취지: 키맨이 바뀐 직후에 인사드리고 신경 쓰는 모습을 보여주면 나중 재계약·친밀도에서 확실히 다르다.
 * 그래서 ① 변경 즉시 지역 점검방에도 공유(api.ts) ② FIELD 점검·AS 화면에서 90일 내 변경을 띄운다(KeymanCard)
 *      ③ 인사 완료 여부를 남긴다(contact_changes.greeting_*).
 */
import { selectRows } from "./supabase";
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
