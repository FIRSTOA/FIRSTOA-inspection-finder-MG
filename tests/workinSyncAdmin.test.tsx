// 워킨맵 동기화 관리 카드(앱 쪽 P1-4) — 서버 렌더로 상태·미리보기 표·스위치 꺼짐 비활성, 그리고 교체 막기 순수 함수
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import WorkinSyncAdmin, { WorkinDryTable } from "../src/WorkinSyncAdmin";
import {
  REPLACE_BLOCKED_MESSAGE, canReplaceScope, dryRows, nextPullKst, pullSummary, scopeOptions, syncedCountInScope,
  type PullResponse, type SyncStatus,
} from "../src/workinSync";

const status = (enabled: boolean): SyncStatus => ({
  ok: true, enabled, accountsConfigured: [1, 2],
  accounts: [{ account_no: 1, label: "CD팀", paused: false, fail_count: 0, last_ok_at: "2026-10-31T00:00:00Z", last_error: "" },
    { account_no: 2, label: "AB팀", paused: true, fail_count: 3, last_ok_at: null, last_error: "로그인 실패" }],
  works: [
    { account_no: 1, work_id: "a".repeat(24), name: "C 4Q 분기점검", team: "C", year: 2026, quarter: 4, kind: "quarter", status: "target", place_count: 412, override_skip: false, first_pulled_at: null, last_pulled_at: null, last_error: "" },
    { account_no: 2, work_id: "b".repeat(24), name: "영업확장성리스트_박P_워킨맵표현", team: null, year: null, quarter: null, kind: null, status: "excluded", place_count: 80, override_skip: false, first_pulled_at: null, last_pulled_at: null, last_error: "" },
  ],
  openReviews: { unmatched: 2, downgrade: 1 },
});

const dry: PullResponse = {
  ok: false, dryRun: true, kst: "2026년 4분기", picked: 2, accountErrors: [], warnings: [],
  results: [
    { workId: "a".repeat(24), name: "C 4Q 분기점검", account: 1, result: "dry",
      stats: { remote: 412, matched: 400, byExtId: 0, byNumberName: 380, byNameAddress: 20, changed: 17, labelChanges: 12, memoAdds: 5, fresh: 3, inserted: 0, ambiguous: 1, missing: 0, downgrades: 0, keptLocalNewer: 0, linkedOnly: 383 },
      colorCheck: { histogram: { G5: 30, G1: 300, G12: 2 }, firstMatchSame: 390, firstMatchDiff: 10 }, stop: null },
    { workId: "c".repeat(24), name: "D 4Q 매월점검", account: 1, result: "stopped", stop: { reason: "shrunk", detail: "응답 10곳 < 평소 200곳의 절반" } },
  ],
};

describe("WorkinSyncAdmin 렌더", () => {
  it("계정·워크·확인 필요 수가 나온다", () => {
    const html = renderToString(createElement(WorkinSyncAdmin, { initial: { status: status(true), reviews: [] } }));
    expect(html).toContain("워킨맵 동기화");
    expect(html).toContain("CD팀");
    expect(html).toContain("멈춤(로그인 3회 실패)");
    expect(html).toContain("C 4Q 분기점검");
    expect(html).toContain("확인 필요 3");
    expect(html).not.toMatch(/PASSWORD=|id_token|refresh_token/);
  });

  it("스위치가 꺼져 있으면 [지금 동기화]가 비활성이고 안내가 보인다", () => {
    const html = renderToString(createElement(WorkinSyncAdmin, { initial: { status: status(false), reviews: [] } }));
    expect(html).toMatch(/<button[^>]*aria-label="지금 동기화"[^>]*disabled=""/);
    expect(html).toContain("WORKINMAP_SYNC_ENABLED 를 켠 뒤에");
  });

  it("스위치가 켜져 있으면 [지금 동기화]가 눌린다", () => {
    const html = renderToString(createElement(WorkinSyncAdmin, { initial: { status: status(true), reviews: [] } }));
    const btn = html.match(/<button[^>]*aria-label="지금 동기화"[^>]*>/)?.[0] || "";
    expect(btn).toContain("지금 동기화");
    expect(btn).not.toContain('disabled=""');
  });

  it("미리보기 표: 워크별 짝·새 장소·바뀔 곳·색 검증·가드 사유", () => {
    const html = renderToString(createElement(WorkinDryTable, { res: dry }));
    expect(html).toContain("C 4Q 분기점검");
    expect(html).toContain(">400<");
    expect(html).toContain("처음 짝 색 같음 390 · 다름 10 (G1:300 G5:30 G12:2)");
    expect(html).toContain("평소의 절반 미만 — 응답 10곳");
    expect((html.match(/<tr>/g) || []).length).toBe(3); // 머리 1 + 워크 2
  });
});

describe("workinSync 순수 함수", () => {
  const rows = [
    { team: "C", quarter: 4, kind: "quarter", ext_id: "abc" },
    { team: "C", quarter: 4, kind: "quarter", ext_id: null },
    { team: "C", quarter: 4, kind: "monthly", ext_id: "" },
    { team: "A", quarter: 4, kind: "quarter" },
  ];
  it("ext_id 가 하나라도 있는 범위는 교체 금지", () => {
    expect(canReplaceScope(rows, { team: "C", quarter: 4, kind: "quarter" })).toBe(false);
    expect(syncedCountInScope(rows, { team: "C", quarter: 4, kind: "quarter" })).toBe(1);
    expect(canReplaceScope(rows, { team: "C", quarter: 4, kind: "monthly" })).toBe(true);
    expect(canReplaceScope(rows, { team: "A", quarter: 4, kind: "quarter" })).toBe(true);
    expect(canReplaceScope(rows, { team: "C", quarter: 3, kind: "quarter" })).toBe(true);
    expect(REPLACE_BLOCKED_MESSAGE).toContain("추가만 가능");
  });
  it("다음 자동 시각(KST 09·12·15·18)", () => {
    expect(nextPullKst(new Date("2026-10-31T23:30:00Z"))).toBe("오늘 09:00"); // KST 08:30
    expect(nextPullKst(new Date("2026-10-31T00:00:00Z"))).toBe("오늘 09:00"); // KST 09:00 정각
    expect(nextPullKst(new Date("2026-10-31T00:01:00Z"))).toBe("오늘 12:00");
    expect(nextPullKst(new Date("2026-10-31T09:30:00Z"))).toBe("내일 09:00"); // KST 18:30
  });
  it("범위 고르기: 대상이고 건너뛰기 아닌 워크만", () => {
    const opts = scopeOptions(status(true).works);
    expect(opts.map((o) => o.value)).toEqual(["current", "a".repeat(24)]);
  });
  it("요약 한 줄", () => {
    expect(pullSummary(dry)).toBe("미리보기(쓰기 0) · 2026년 4분기 워크 2개 · 짝 400곳 · 바뀔 곳 17 · 새 장소 3 · 중단·오류 1개");
    expect(pullSummary({ ok: true, skipped: "busy" })).toContain("건너뛰었습니다");
    expect(dryRows(undefined)).toEqual([]);
  });
});
