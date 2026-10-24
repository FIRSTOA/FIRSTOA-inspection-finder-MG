/**
 * 카운터 문자전송 화면 단순화(2026-10-24) — 보이는 방식만 바꾸고 숫자·이력은 예전과 같아야 한다.
 * (1) historyOf 는 예전 CounterSms.tsx 안의 코드와 결과가 같다
 * (2) 신규 = 목록 생성 2분 뒤 추가된 카드, 옛 카드(added_at 없음)는 신규 아님
 * (3) 상태 줄 보냄·완료 = 예전 sentCount·doneCount
 * (4) 변경 이력 최신이 위, 신규 이름은 같은 at 의 카드
 * (5) 주 단추 1개 + 더보기, 주의 배지 우선순위
 */
import { describe, expect, it } from "vitest";
import { contactVendorKey } from "../supabase/functions/_shared/counter-sms/vendorKey.ts";
import { historyOf, isNewTarget, logLines, logWhen, md, mdt, moreActions, primaryAction, sortTargets, statusLine, warnBadge, type ViewBatch, type ViewTarget } from "../src/counterSmsView";

// edab3b2 의 CounterSms.tsx:605-614 를 글자 그대로 옮긴 기준 구현
function legacyHistoryOf(t: ViewTarget, batch: ViewBatch | null) {
  const listedAt = t.added_at || batch?.created_at || "";
  const key = contactVendorKey(t.vendor);
  const again = (batch?.log || [])
    .filter((e) => e.mode !== "remove" && (e.skipped || []).some((name) => contactVendorKey(name) === key) && (!listedAt || e.at > listedAt))
    .map((e) => e.at);
  const afterDone = t.done_at ? again.filter((at) => at > (t.done_at as string)) : [];
  const afterSent = t.sent_at && !t.done_at ? again.filter((at) => at > (t.sent_at as string)) : [];
  return { listedAt, again, afterDone, afterSent };
}

const batch: ViewBatch = {
  title: "10월 마감",
  created_at: "2026-10-01T01:00:00.000Z",
  log: [
    { at: "2026-10-05T02:00:00.000Z", by: "자동 · 관리부 목록(박지은)", mode: "auto", added: 1, skipped: ["S 가나상사", "다라기업"], kept: 2, missing: ["마바유통"] },
    { at: "2026-10-10T03:00:00.000Z", by: "박지은", mode: "sync", added: 0, skipped: ["가나상사"], dropped: ["마바유통"], kept: 1 },
    { at: "2026-10-12T04:00:00.000Z", by: "김철수", mode: "remove", added: 0, skipped: [], removed: ["사아물산"] },
    { at: "2026-10-20T05:00:00.000Z", by: "자동 · 관리부 목록", mode: "auto", added: 0, skipped: ["가나상사", "다라기업"], kept: 2, missing: [] },
  ],
};
const targets: ViewTarget[] = [
  { id: "1", vendor: "가나상사", team: "C", sent_at: "2026-10-03T00:00:00.000Z", done_at: "2026-10-11T00:00:00.000Z", added_at: "2026-10-01T01:00:10.000Z" },
  { id: "2", vendor: "다라기업", team: "C", sent_at: "2026-10-06T00:00:00.000Z", done_at: null, added_at: "2026-10-01T01:00:20.000Z" },
  { id: "3", vendor: "자차상회", team: "C", sent_at: null, done_at: null, added_at: "2026-10-05T02:00:00.000Z", added_by: "자동" },
  { id: "4", vendor: "옛카드", team: "D", sent_at: null, done_at: null },
  { id: "5", vendor: "다라기업", team: "D", sent_at: null, done_at: null, added_at: "2026-10-01T01:01:30.000Z" },
];

describe("historyOf 이동", () => {
  it("예전 구현과 모든 카드에서 같은 결과", () => {
    for (const b of [batch, null, { ...batch, log: null }]) {
      for (const t of targets) expect(historyOf(t, b)).toEqual(legacyHistoryOf(t, b));
    }
  });
  it("완료 뒤·보낸 뒤 다시 올라옴을 나눈다", () => {
    expect(historyOf(targets[0], batch).afterDone).toEqual(["2026-10-20T05:00:00.000Z"]);
    expect(historyOf(targets[1], batch).afterSent).toEqual(["2026-10-20T05:00:00.000Z"]);
  });
});

describe("신규·상태 줄", () => {
  it("목록 생성 2분 넘게 뒤 추가된 카드만 신규", () => {
    expect(targets.map((t) => isNewTarget(t, batch))).toEqual([false, false, true, false, false]);
  });
  it("보냄·완료는 예전 셈과 같고 신규 수 = 마지막 신규 log 의 added", () => {
    const s = statusLine(batch, targets);
    expect(s).toMatchObject({ title: "10월 마감", total: 5, sent: 2, done: 1, fresh: 1, sentPct: 40 });
    expect(s.sent).toBe(targets.filter((t) => t.sent_at).length);
  });
});

describe("변경 이력", () => {
  it("최신이 위, 한 줄 요약과 이름 묶음", () => {
    const lines = logLines(batch, targets);
    expect(lines.map((l) => l.mode)).toEqual(["자동 반영", "카드 삭제", "목록 맞춤", "자동 반영"]);
    const first = lines[3];
    expect(first.who).toBe("자동");
    expect(first.summary).toBe("10-05 11:00 자동 · 신규 1 · 중복 2 · 목록에 없는 열린 곳 1");
    expect(first.groups.find((g) => g.key === "added")?.names).toEqual(["자차상회"]);
    expect(first.groups.find((g) => g.key === "missing")?.hint).toBeTruthy();
    expect(lines[1].summary).toBe("10-12 13:00 김철수 · 삭제 1");
    expect(lines[2].groups.map((g) => g.label)).toEqual(["유지", "빠져서 완료"]);
  });
  it("log 가 없으면 빈 목록", () => {
    expect(logLines({ title: "", created_at: "" }, [])).toEqual([]);
  });
});

describe("카드 단추·배지", () => {
  it("주 단추는 단계마다 1개, 더보기는 예전 단추 조건과 같다", () => {
    const photo = ["C"];
    expect(primaryAction(targets[2], photo)).toBe("send");
    expect(moreActions(targets[2], photo)).toEqual(["photo", "remove"]);
    expect(primaryAction(targets[1], photo)).toBe("photo");
    expect(moreActions(targets[1], photo)).toEqual(["done", "unsend", "remove"]);
    expect(primaryAction(targets[1], ["D"])).toBe("done");
    expect(moreActions(targets[1], ["D"])).toEqual(["unsend", "remove"]);
    expect(primaryAction(targets[0], photo)).toBeNull();
    expect(moreActions(targets[0], photo)).toEqual(["undone", "remove"]);
  });
  it("주의 배지는 우선순위 1개", () => {
    expect(warnBadge(historyOf(targets[0], batch))?.kind).toBe("afterDone");
    expect(warnBadge(historyOf(targets[1], batch))?.kind).toBe("afterSent");
    expect(warnBadge(historyOf(targets[4], batch))).toMatchObject({ kind: "again", label: "다시 올라옴 2회" });
    expect(warnBadge(historyOf(targets[2], batch))).toBeNull();
  });
  it("정렬: 처리 순 / 추가된 날짜순", () => {
    expect(sortTargets(targets, "stage").map((t) => t.id)).toEqual(["3", "4", "5", "2", "1"]);
    expect(sortTargets(targets, "added", batch).map((t) => t.id)).toEqual(["3", "5", "2", "1", "4"]);
  });
});

describe("시각은 한국 시각(KST)", () => {
  it("UTC 자정 넘김도 한국 날짜·시각으로 보인다", () => {
    expect(md("2026-10-22T16:30:00.000Z")).toBe("10/23");
    expect(mdt("2026-10-22T16:30:00.000Z")).toBe("10/23 01:30");
    expect(logWhen("2026-10-23T04:19:00.000Z")).toBe("10-23 13:19");
    expect(logLines({ title: "", created_at: "", log: [{ at: "2026-10-22T16:30:00.000Z", by: "박지은", mode: "merge", added: 0, skipped: ["가나"] }] }, [])[0].when).toBe("10-23 01:30");
    expect(md("")).toBe("");
  });
});
