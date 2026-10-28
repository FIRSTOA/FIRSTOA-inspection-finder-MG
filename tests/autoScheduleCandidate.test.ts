/**
 * 자동 일정 후보 표시·정렬 (2026-10-28 사용자 보고 재현).
 * 실측: 워킨맵 id 1790043497516 "8N연세플러스의원-단순마감마감" — 3분기·G5·좌표 (0,0).
 * 10/29 일정(익일AS) "연세플러스의원-단순마감마감"이 기준 업체가 되어 고정 폴백 행이 만들어졌고,
 * 카드가 "마지막 null · 9999일 경과", 지도는 (0,0) 기준점 때문에 바다만 보였다. 점검 기록은 jeomgeom id 3763(2025-07-14) 있음.
 */
import { describe, expect, it } from "vitest";
import {
  NO_RECORD_DAYS, candidateDistance, checkIssueText, groupLastVisitText, hasValidCoords, lastVisitText, pickAnchorHit, sortCandidates, visitFromDates,
} from "../src/autoScheduleCandidate";
import { fieldTicketVendor, vendorMatchKey } from "../src/ids";

const row = (id: number, o: Partial<{ last_date: string | null; days_since: number; lat: number | null; lng: number | null; distance_km: number | null; history_error: boolean }> = {}) => ({
  id, last_date: null as string | null, days_since: NO_RECORD_DAYS, lat: 37.5 as number | null, lng: 127.0 as number | null, distance_km: null as number | null, ...o,
});

describe("마지막 점검 문구", () => {
  it("기록 없음(last_date null)이면 null·9999 를 찍지 않는다 — never_visited 가 틀려도", () => {
    const text = lastVisitText({ last_date: null, days_since: NO_RECORD_DAYS });
    expect(text).toBe("마지막 점검 기록 없음");
    expect(text).not.toMatch(/null|9999/);
  });
  it("기록 있음", () => {
    expect(lastVisitText({ last_date: "2025-07-14", days_since: 471 })).toBe("마지막 2025-07-14 · 471일 경과");
  });
  it("기록 조회 실패는 '없음'과 구분", () => {
    expect(lastVisitText({ last_date: null, days_since: NO_RECORD_DAYS, history_error: true })).toBe("마지막 점검 기록 확인 실패");
  });
  it("여러 기기 묶음 — 기록 있는 기기만으로 최근일·최소 경과일", () => {
    const ms = [{ last_date: null, days_since: NO_RECORD_DAYS }, { last_date: "2026-08-01", days_since: 88 }, { last_date: "2026-07-01", days_since: 119 }];
    expect(groupLastVisitText(ms)).toBe("마지막 2026-08-01 · 88일 경과");
    expect(groupLastVisitText([{ last_date: null, days_since: NO_RECORD_DAYS }])).toBe("마지막 점검 기록 없음");
  });
  it("등록 issue 문구", () => {
    expect(checkIssueText([{ last_date: null, days_since: NO_RECORD_DAYS }])).toBe("정기점검 (마지막 기록 없음)");
    expect(checkIssueText([{ last_date: "2025-07-14", days_since: 471 }])).toBe("정기점검 (마지막 2025-07-14 · 471일 경과)");
  });
});

describe("고정 폴백 행의 점검 기록", () => {
  it("워킨맵 이름 꼬리(-단순마감마감)를 떼면 점검 기록 업체명과 같은 키", () => {
    const vendor = fieldTicketVendor("8N연세플러스의원-단순마감마감").vendor;
    expect(vendorMatchKey(vendor)).toBe(vendorMatchKey("연세플러스의원"));
  });
  it("작성일 → 마지막·전전·경과일(KST 날짜 차)", () => {
    expect(visitFromDates(["2025-07-14", "2025-04-02 10:00", null], "2026-10-28")).toEqual({ last_date: "2025-07-14", prev_date: "2025-04-02", days_since: 471, never_visited: false });
    expect(visitFromDates([], "2026-10-28")).toEqual({ last_date: null, prev_date: null, days_since: NO_RECORD_DAYS, never_visited: true });
  });
});

describe("좌표", () => {
  it("(0,0)·null·한반도 밖은 못 쓰는 좌표", () => {
    expect(hasValidCoords(0, 0)).toBe(false);
    expect(hasValidCoords(null, 127)).toBe(false);
    expect(hasValidCoords(37.5, 0)).toBe(false);
    expect(hasValidCoords(37.4986, 127.0587)).toBe(true);
  });
  it("좌표가 엉터리면 RPC 거리(수천 km)는 버린다", () => {
    expect(candidateDistance({ lat: 0, lng: 0, distance_km: 14123.5 })).toBeNull();
    expect(candidateDistance({ lat: 37.5, lng: 127, distance_km: 1.2 })).toBe(1.2);
  });
  it("기준 업체: 이름 점수 같으면 좌표 있는 행·고른 분기 행 우선", () => {
    const q3 = { id: 1, latitude: 0, longitude: 0, quarter: 3 };
    const q4 = { id: 2, latitude: 37.5, longitude: 127.05, quarter: 4 };
    expect(pickAnchorHit([{ h: q3, score: 3 }, { h: q4, score: 3 }], 4)?.id).toBe(2);
    // 좌표 없는 행만 맞으면 그 행(지오코딩은 부른 쪽)
    expect(pickAnchorHit([{ h: q3, score: 3 }], 4)?.id).toBe(1);
    expect(pickAnchorHit([{ h: q3, score: 0 }], 4)).toBeUndefined();
  });
});

describe("후보 정렬", () => {
  it("기준 업체 없음(거리 null): 경과일 긴 순, 기록 없음(9999)은 맨 뒤", () => {
    const out = sortCandidates([row(1), row(2, { last_date: "2026-08-01", days_since: 88 }), row(3, { last_date: "2026-05-01", days_since: 180 })]);
    expect(out.map((r) => r.id)).toEqual([3, 2, 1]);
  });
  it("거리 우선, 좌표 없는 곳은 거리 있는 곳 뒤", () => {
    const out = sortCandidates([
      row(1, { lat: 0, lng: 0, distance_km: 14000, last_date: "2026-01-01", days_since: 300 }),
      row(2, { distance_km: 3.1, last_date: "2026-08-01", days_since: 88 }),
      row(3, { distance_km: 0.4 }),
    ]);
    expect(out.map((r) => r.id)).toEqual([3, 2, 1]);
  });
  it("고정한 기준 업체는 맨 위", () => {
    const out = sortCandidates([row(1, { distance_km: 0.2, last_date: "2026-08-01", days_since: 88 }), row(9, { distance_km: 0 })], 9);
    expect(out[0].id).toBe(9);
  });
});
