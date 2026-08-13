/**
 * 거래처 코드 번역 — 이름 퍼지 매칭을 "한 번의 번역"으로 바꾸는 공용 헬퍼.
 *
 * 2층 키 구조: 거래처 코드(업체) ← 자산기번/시리얼(기기).
 *  - vendor_match_alias: 임대리스트 별칭들의 vendorMatchKey → 코드 (SQL vendor_match_key_가
 *    TS vendorMatchKey와 완전 동일하게 만든 테이블 — supabase/vendor-master.sql)
 *  - workin_vendor_code: 워킨맵 지점 id → 코드 (시리얼>자산>이름 순 자동 + 수동 확정)
 *
 * 소비자(뱃지·이력·재계약 매칭)는 "코드 일치 우선, 실패 시 기존 이름 매칭 폴백"으로 쓴다
 * — 코드가 없어도 오늘과 똑같이 동작하고, 코드가 있으면 정확해진다.
 */
import { selectAllRows } from "./supabase";
import { vendorMatchKey } from "./ids";

const CACHE_MS = 10 * 60_000;

// 별칭 키 → 코드. 같은 키가 여러 코드로 이어지면(프랜차이즈 등) 오폭 방지를 위해 번역 포기(null).
let aliasCache: { at: number; promise: Promise<Map<string, string | null>> } | null = null;

export function getAliasCodeMap(): Promise<Map<string, string | null>> {
  if (aliasCache && Date.now() - aliasCache.at < CACHE_MS) return aliasCache.promise;
  const promise = selectAllRows<{ akey: string; code: string }>("vendor_match_alias", "select=akey,code&order=akey.asc")
    .then((rows) => {
      const map = new Map<string, string | null>();
      for (const { akey, code } of rows) {
        const prev = map.get(akey);
        if (prev === undefined) map.set(akey, code);
        else if (prev !== code) map.set(akey, null); // 모호 — 자동 번역 금지
      }
      return map;
    });
  aliasCache = { at: Date.now(), promise };
  promise.catch(() => { aliasCache = null; });
  return promise;
}

// 워킨맵 지점 id → 코드
let placeCache: { at: number; promise: Promise<Map<number, string>> } | null = null;

export function getWorkinCodeMap(): Promise<Map<number, string>> {
  if (placeCache && Date.now() - placeCache.at < CACHE_MS) return placeCache.promise;
  const promise = selectAllRows<{ place_id: number; code: string }>("workin_vendor_code", "select=place_id,code&order=place_id.asc")
    .then((rows) => new Map(rows.map((r) => [Number(r.place_id), r.code])));
  placeCache = { at: Date.now(), promise };
  promise.catch(() => { placeCache = null; });
  return promise;
}

export function clearWorkinCodeCache() { placeCache = null; }

/** 자유 표기 업체명 → 거래처 코드. 정확 일치 후 접두 축소(WalkingMap lookupVendor와 같은 규칙). */
export function translateVendor(alias: Map<string, string | null>, name: string): string | null {
  const key = vendorMatchKey(name);
  if (!key) return null;
  const exact = alias.get(key);
  if (exact !== undefined) return exact;
  for (let len = key.length - 1; len >= 4; len--) {
    const hit = alias.get(key.slice(0, len));
    if (hit !== undefined) return hit;
  }
  return null;
}
