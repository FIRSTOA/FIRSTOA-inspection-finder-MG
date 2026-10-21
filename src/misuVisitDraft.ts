/**
 * 미수 방문이력 작성기 — 화면 보조 순수 로직(초안 보관 봉투·업체 후보 만들기·사진 칸 → photos).
 * 네트워크 없음. 저장은 misuVisitApi.ts, 화면은 MisuVisitForm.tsx. 판정·문장은 misuVisit.ts(고치지 않고 가져다 씀).
 */
import {
  formatMisuAmount, kstParts, matchMisuVendor, PHOTO_SLOTS, suggestNextRound,
  type MisuPhoto, type MisuPhotoSlot, type MisuRoundSuggestion, type MisuVisit, type MisuVisitDraft,
} from "./misuVisit";
import type { MisuVendorOption } from "./MisuVisitForm.view";
import type { MisuMasterVendor, MisuSheetVendor } from "./misuVisitApi";

const s = (v: unknown) => String(v ?? "").trim();

// ───────── 초안 봉투(localStorage) ─────────
export const MISU_DRAFT_KEY = "field_misu_visit_draft_v1";
export const MISU_PHOTO_MODE = "misu-visit"; // photoStore 모드 — App 공용 사진함의 "misu" 와 겹치지 않게
const DRAFT_MAX_AGE_MS = 7 * 24 * 3600_000;

export type MisuSlotSaved = { url: string; w?: number; h?: number; lowRes?: boolean };
export type MisuDraftEnvelope = {
  v: 1;
  savedAt: number;
  draft: MisuVisitDraft;
  vendor: MisuVendorOption | null;
  slots: Partial<Record<MisuPhotoSlot, MisuSlotSaved>>; // 이미 올라간 칸 주소(파일은 photoStore)
  kakaoSent: boolean; // 앞선 시도에서 카톡까지 나감 → 재시도(dup) 때 다시 안 보냄
  recorded: boolean; // 방문집계·운영현황 기록 끝
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readMisuDraft(storage: StorageLike | null | undefined, now = Date.now()): MisuDraftEnvelope | null {
  if (!storage) return null;
  let raw: string | null = null;
  try { raw = storage.getItem(MISU_DRAFT_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as MisuDraftEnvelope;
    if (env?.v !== 1 || !env.draft || !s(env.draft.id) || typeof env.savedAt !== "number") return null;
    if (now - env.savedAt > DRAFT_MAX_AGE_MS) return null;
    return { ...env, slots: env.slots || {}, kakaoSent: !!env.kakaoSent, recorded: !!env.recorded, vendor: env.vendor || null };
  } catch {
    return null;
  }
}

/** 저장 공간 부족 등으로 못 쓰면 false — 화면은 계속 동작(메모리 상태). */
export function writeMisuDraft(storage: StorageLike | null | undefined, env: MisuDraftEnvelope): boolean {
  if (!storage) return false;
  try { storage.setItem(MISU_DRAFT_KEY, JSON.stringify(env)); return true; } catch { return false; }
}
export function clearMisuDraft(storage: StorageLike | null | undefined): void {
  try { storage?.removeItem(MISU_DRAFT_KEY); } catch { /* 지울 게 없거나 저장소 없음 — 다음 열 때 7일 만료로 정리됨 */ }
}

/** 손댄 흔적이 있는가(빈 폼은 보관하지 않는다) */
export function isMisuDraftTouched(d: MisuVisitDraft, vendor: MisuVendorOption | null, photoCount: number): boolean {
  return !!vendor || photoCount > 0 || d.no_contact || !!s(d.contact_name) || !!s(d.contact_title) || !!d.open_status
    || (d.dun_methods || []).length > 0 || !!s(d.dun_reply) || d.return_requested || !!d.judgment || !!s(d.judgment_reason)
    || Object.values(d.photo_skips || {}).some((v) => !!s(v));
}

// ───────── 업체 후보 ─────────
/** 이 업체의 지난 기록(거래처코드 > 임순 > 정규화 이름) */
export function visitsForVendor(visits: MisuVisit[], ref: { company_code?: string; lease_seq?: string; vendor?: string }): MisuVisit[] {
  return visits.filter((v) => !!matchMisuVendor(ref, v));
}

function shortDate(iso: string): string {
  const p = iso ? kstParts(iso) : null;
  return p ? p.date.slice(5) : "";
}

export function sheetVendorToOption(v: MisuSheetVendor, visits: MisuVisit[] = []): MisuVendorOption {
  const amt = formatMisuAmount(v.months, v.balance).split(" · ");
  const mine = visitsForVendor(visits, { company_code: v.companyCode, lease_seq: v.leaseSeq, vendor: v.name });
  const sug = mine.length ? suggestNextRound(mine) : null;
  return {
    key: v.key, name: v.name, source: "misu", team: v.team || undefined,
    months: v.months ? amt.find((x) => x.endsWith("개월")) : undefined,
    balance: v.balance ? amt.find((x) => x.endsWith("원")) : undefined,
    companyCode: v.companyCode || undefined, leaseSeq: v.leaseSeq || undefined, csChecked: v.csChecked,
    visitCount: sug?.count || 0, lastRound: sug?.lastRound || undefined, lastVisitDate: sug ? shortDate(sug.lastVisitedAt) || undefined : undefined,
  };
}

export function masterVendorToOption(v: MisuMasterVendor, visits: MisuVisit[] = []): MisuVendorOption {
  const mine = visitsForVendor(visits, { company_code: v.companyCode, vendor: v.name });
  const sug = mine.length ? suggestNextRound(mine) : null;
  return {
    key: v.key, name: v.name, source: "master", companyCode: v.companyCode || undefined,
    visitCount: sug?.count || 0, lastRound: sug?.lastRound || undefined, lastVisitDate: sug ? shortDate(sug.lastVisitedAt) || undefined : undefined,
  };
}

const normQ = (v: string) => s(v).replace(/\s+/g, "").toLowerCase();

/**
 * 목록 좁히기: 검색어가 없으면 내 팀(A~E)만, 있으면 전 팀에서 이름·거래처코드로.
 * 정렬: CS체크 → 미수 개월 많은 순 → 잔액 많은 순.
 */
export function filterMisuVendors(list: MisuSheetVendor[], query: string, team: string): MisuSheetVendor[] {
  const q = normQ(query);
  const t = /^[A-E]$/.test(team) ? team : "";
  const picked = list.filter((v) => (q ? normQ(v.name).includes(q) || (!!v.companyCode && v.companyCode.includes(q)) : !t || v.team === t));
  return [...picked].sort((a, b) => Number(b.csChecked) - Number(a.csChecked) || (Number(b.months) || 0) - (Number(a.months) || 0) || (Number(b.balance) || 0) - (Number(a.balance) || 0));
}

/** "지난 방문 1건 · 마지막 1차 안내(10-02 · 이민구)" / 기록 없으면 "지난 방문 기록 없음 — 1차 안내부터" */
export function misuRoundHint(sug: MisuRoundSuggestion | null, indexState: "ready" | "error" | "loading" | "missing"): string {
  if (indexState === "loading") return "지난 방문 기록을 확인하는 중입니다";
  if (indexState === "error") return "지난 방문 기록을 불러오지 못했습니다 — 차수를 직접 확인해 주세요";
  if (indexState === "missing") return "";
  if (!sug || !sug.count) return "지난 방문 기록 없음 — 1차 안내부터";
  const who = s(sug.lastAuthor);
  return `지난 방문 ${sug.count}건 · 마지막 ${sug.lastRound || "-"}(${[shortDate(sug.lastVisitedAt), who].filter(Boolean).join(" · ")})`;
}

// ───────── 사진 칸 → photos ─────────
export type MisuSlotRuntime = { url?: string; w?: number; h?: number; hasFile: boolean };

/**
 * 칸 상태 → 행의 photos. pendingOk 면 아직 안 올라간 파일 칸을 "pending:<칸>" 임시 주소로 넣는다
 * (검증·미리보기에서 '사진 있음'으로 보이게 — 저장 직전엔 pendingOk=false 로 실제 주소만).
 */
export function slotsToPhotos(slots: Partial<Record<MisuPhotoSlot, MisuSlotRuntime>>, pendingOk: boolean): MisuPhoto[] {
  const out: MisuPhoto[] = [];
  for (const slot of PHOTO_SLOTS) {
    const st = slots[slot];
    if (!st) continue;
    if (s(st.url)) out.push({ slot, url: s(st.url), ...(st.w ? { w: st.w } : {}), ...(st.h ? { h: st.h } : {}) });
    else if (pendingOk && st.hasFile) out.push({ slot, url: `pending:${slot}` });
  }
  return out;
}
