/**
 * 마감 문자 — 업체별 연락처 규칙 (팀 공유, counter_sms_contact_rules).
 *  · block  : 이 번호로는 보내지 말 것 (담당 아님·퇴사·연락 거부) — 사유·기록자·날짜를 남긴다
 *  · prefer : 새 마감 담당자 연락처 — 다음 마감에 그 업체가 다시 올라오면 이 번호를 먼저 고른다
 * 같은 업체를 분기마다 2~3번 보내다 보면 "이 사람한테 보내도 되나?"를 매번 다시 확인하던 것(2026-09-16 요청).
 * 테이블이 아직 없으면(SQL 미실행) 조용히 빈 규칙으로 동작한다.
 */
import { deleteRows, selectRows, upsertRow } from "./supabase";
import { vendorMatchKey } from "./ids";

export type ContactRuleKind = "block" | "prefer";
export type ContactRule = {
  id: string;
  vendor_key: string;
  vendor: string;
  phone: string;
  kind: ContactRuleKind;
  name: string;
  memo: string;
  updated_by: string;
  updated_at: string;
};

const TABLE = "counter_sms_contact_rules";

/** 업체 비교키 — 파서가 붙인 등급 접두("N 주식회사 무암")·순번·법인표기를 벗긴다. 이름 표기가 조금 달라도 같은 업체로 잇기 위해 */
export function contactVendorKey(vendor: string): string {
  const raw = String(vendor || "").trim();
  const stripped = raw.replace(/^(?:SS|NN|V|S|N)\s+/i, "");
  return vendorMatchKey(stripped) || vendorMatchKey(raw) || stripped.toLowerCase();
}

export function normalizePhone(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

export async function loadContactRules(): Promise<ContactRule[]> {
  return selectRows<ContactRule>(TABLE, "select=*&order=updated_at.desc").catch(() => [] as ContactRule[]);
}

export async function saveContactRule(input: { id?: string; vendor: string; phone: string; kind: ContactRuleKind; name?: string; memo?: string; author: string }): Promise<ContactRule> {
  const row: ContactRule = {
    id: input.id || `ccr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    vendor_key: contactVendorKey(input.vendor),
    vendor: String(input.vendor || "").trim(),
    phone: normalizePhone(input.phone),
    kind: input.kind,
    name: String(input.name || "").trim(),
    memo: String(input.memo || "").trim(),
    updated_by: input.author || "미지정",
    updated_at: new Date().toISOString(),
  };
  await upsertRow(TABLE, row, "vendor_key,phone");
  return row;
}

export async function removeContactRule(id: string): Promise<void> {
  await deleteRows(TABLE, `id=eq.${encodeURIComponent(id)}`);
}

export function rulesForVendor(rules: ContactRule[], vendor: string): ContactRule[] {
  const key = contactVendorKey(vendor);
  return key ? rules.filter((rule) => rule.vendor_key === key) : [];
}

export type ContactChoice = { phone: string; label: string; blocked?: ContactRule; preferred?: ContactRule };

/** 파싱된 번호 + 규칙의 새 담당 번호를 한 목록으로 — 보낼 수 있는 번호가 앞, 그중 새 담당이 맨 앞, 차단은 뒤 */
export function contactChoices(phones: string[], labels: Record<string, string>, rules: ContactRule[]): ContactChoice[] {
  const byPhone = new Map<string, ContactRule[]>();
  for (const rule of rules) {
    const phone = normalizePhone(rule.phone);
    if (!phone) continue;
    const list = byPhone.get(phone) || [];
    list.push(rule);
    byPhone.set(phone, list);
  }
  const seen = new Set<string>();
  const out: ContactChoice[] = [];
  const push = (raw: string) => {
    const phone = normalizePhone(raw);
    if (!phone || seen.has(phone)) return;
    seen.add(phone);
    const found = byPhone.get(phone) || [];
    out.push({
      phone,
      label: labels[raw] || labels[phone] || found.find((rule) => rule.name)?.name || "",
      blocked: found.find((rule) => rule.kind === "block"),
      preferred: found.find((rule) => rule.kind === "prefer"),
    });
  };
  rules.filter((rule) => rule.kind === "prefer").forEach((rule) => push(rule.phone));
  phones.forEach(push);
  return out.sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked) || Number(!!b.preferred) - Number(!!a.preferred));
}

/** 기본 선택 번호 — 새 담당 → 차단 아닌 첫 번호 → 없음 */
export function pickDefaultPhone(choices: ContactChoice[]): string {
  return (choices.find((choice) => choice.preferred && !choice.blocked) || choices.find((choice) => !choice.blocked))?.phone || "";
}

/** "9/16 이민구" 식 기록 꼬리표 */
export function ruleStamp(rule: ContactRule): string {
  const d = String(rule.updated_at || "").slice(0, 10);
  const short = d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "";
  return [short, rule.updated_by].filter(Boolean).join(" ");
}
