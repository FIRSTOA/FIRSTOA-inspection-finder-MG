/**
 * 미수 [보완 기록 쓰기] — 조회 › 미수 [방문 이력]에서 필드 › 미수 작성기로 넘기는 순수 로직(창 이벤트 + localStorage).
 * 흐름: 조회 화면이 requestMisuSupplement(visit) → 값을 localStorage 에 10분간 두고 창 이벤트 발송
 *       → App 이 화면을 필드 › 미수로 바꿈 → 작성기(MisuVisitForm)가 마운트·이벤트 때 값을 읽어 보완 초안을 시작.
 * 보완 기록은 원 기록을 고친 "전체본"으로 저장된다(effectiveMisuVisits 가 보완본을 통째로 대체) — 그래서 원 기록 전체를 복사해 채운다.
 */
import { emptyMisuVisitDraft, PHOTO_SLOTS, type MisuPhoto, type MisuPhotoSlot, type MisuVisit, type MisuVisitDraft } from "./misuVisit";
import type { MisuVendorOption } from "./MisuVisitForm.view";

export const MISU_SUPPLEMENT_EVENT = "field:misu-supplement";
export const MISU_SUPPLEMENT_KEY = "field_misu_supplement_v1";
export const MISU_SUPPLEMENT_MAX_AGE_MS = 10 * 60_000;

export type MisuSupplementPayload = {
  visitId: string;
  vendor: string;
  company_code: string;
  site_code: string;
  lease_seq: string;
  region: string;
  visit_round: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const s = (v: unknown) => String(v ?? "").trim();

export function buildSupplementPayload(v: Pick<MisuVisit, "id" | "vendor" | "company_code" | "site_code" | "lease_seq" | "region" | "visit_round">): MisuSupplementPayload {
  return {
    visitId: s(v.id), vendor: s(v.vendor), company_code: s(v.company_code), site_code: s(v.site_code),
    lease_seq: s(v.lease_seq), region: s(v.region), visit_round: s(v.visit_round),
  };
}

/** 이벤트·저장값에서 꺼낸 값이 쓸 만한가(id 필수) — 아니면 null */
export function parseSupplementPayload(raw: unknown): MisuSupplementPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!s(r.visitId)) return null;
  return {
    visitId: s(r.visitId), vendor: s(r.vendor), company_code: s(r.company_code), site_code: s(r.site_code),
    lease_seq: s(r.lease_seq), region: s(r.region), visit_round: s(r.visit_round),
  };
}

export function writeSupplementRequest(storage: StorageLike | null | undefined, payload: MisuSupplementPayload, now = Date.now()): boolean {
  if (!storage) return false;
  try { storage.setItem(MISU_SUPPLEMENT_KEY, JSON.stringify({ v: 1, savedAt: now, payload })); return true; } catch { return false; }
}

/** 10분이 지났거나 깨진 값은 무시(null). 읽기만 한다 — 지우기는 clearSupplementRequest. */
export function readSupplementRequest(storage: StorageLike | null | undefined, now = Date.now()): MisuSupplementPayload | null {
  if (!storage) return null;
  let raw: string | null = null;
  try { raw = storage.getItem(MISU_SUPPLEMENT_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as { v?: number; savedAt?: number; payload?: unknown };
    if (env?.v !== 1 || typeof env.savedAt !== "number") return null;
    if (now - env.savedAt > MISU_SUPPLEMENT_MAX_AGE_MS || env.savedAt - now > 60_000) return null;
    return parseSupplementPayload(env.payload);
  } catch {
    return null;
  }
}

export function clearSupplementRequest(storage: StorageLike | null | undefined): void {
  try { storage?.removeItem(MISU_SUPPLEMENT_KEY); } catch { /* 저장소 없음 — 10분 뒤 어차피 무시됨 */ }
}

/** 조회 화면 → 작성기. 값 저장 + 창 이벤트(받는 쪽이 아직 없어도 작성기가 열릴 때 저장값을 읽는다). */
export function requestMisuSupplement(visit: MisuVisit): void {
  if (typeof window === "undefined") return;
  const payload = buildSupplementPayload(visit);
  if (!payload.visitId) return;
  writeSupplementRequest(window.localStorage, payload);
  window.dispatchEvent(new CustomEvent(MISU_SUPPLEMENT_EVENT, { detail: payload }));
}

/** 원 기록 전체를 복사한 새 초안. id 는 새로, supplement_of = 원 id. 앨범·문장·방·사진 확인 상태는 새로 만든다. */
export function buildSupplementDraft(original: MisuVisit, now: Date = new Date()): MisuVisitDraft {
  const copy = JSON.parse(JSON.stringify(original)) as MisuVisit;
  const { id: _id, created_at: _c, _hidden: _h, _hidden_by: _hb, _hidden_at: _ha, ...rest } = copy; // id 는 emptyMisuVisitDraft 가 새로 만든다
  void _id; void _c; void _h; void _hb; void _ha;
  return emptyMisuVisitDraft({
    ...rest,
    visited_at: now.toISOString(),
    supplement_of: original.id,
    album_id: "", missing: [], text_body: "", room: "",
    dun_methods: Array.isArray(rest.dun_methods) ? rest.dun_methods : [],
    photos: Array.isArray(rest.photos) ? rest.photos : [],
    photo_skips: rest.photo_skips || {},
    rules_ack: rest.rules_ack || {},
  }, now);
}

/** 원 기록 → 작성기 업체 칸 */
export function supplementVendorOption(original: Pick<MisuVisit, "vendor" | "company_code" | "lease_seq" | "region">): MisuVendorOption {
  const team = /^[A-E]$/.test(s(original.region)) ? s(original.region) : undefined;
  return {
    key: s(original.company_code) || s(original.vendor), name: s(original.vendor), source: "master", team,
    companyCode: s(original.company_code) || undefined, leaseSeq: s(original.lease_seq) || undefined,
  };
}

/** 원 기록 사진 → 작성기 칸(이미 올라간 주소만) */
export function supplementSlotMeta(photos: MisuPhoto[] | null | undefined): Partial<Record<MisuPhotoSlot, { url: string; w?: number; h?: number }>> {
  const out: Partial<Record<MisuPhotoSlot, { url: string; w?: number; h?: number }>> = {};
  for (const p of photos || []) {
    if (!p || !PHOTO_SLOTS.includes(p.slot) || !/^https?:\/\//.test(s(p.url))) continue;
    out[p.slot] = { url: s(p.url), ...(p.w ? { w: p.w } : {}), ...(p.h ? { h: p.h } : {}) };
  }
  return out;
}
