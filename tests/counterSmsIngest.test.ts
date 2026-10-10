import { describe, expect, it } from "vitest";
import { mergeTargets, parseBlocks } from "../src/counterSmsParser";
import { batchMonthOf, needsNewBatch, planIngest, summarizePlan, type ExistingTarget } from "../supabase/functions/_shared/counter-sms/ingest.ts";

const KEYS = ["X7-시리즈", "CLX-9201", "DOCUCENTRE", "MFC"];
const block = (n: number, grade: string, name: string, code: string) => `${n}, ${n}${grade}${name}-매월마감\n010-1234-${String(1000 + n).slice(-4)} 담당자\n${code} / SL-X7400LXR / SERIAL${n} / A${n}\n서울 어딘가 ${n}\n`;
const list = (...blocks: string[]) => `【수도권C】\n26-10\n\n[강남구]\n${blocks.join("\n")}`;
const five = [block(1, "N", "가나상사", "10001"), block(2, "V", "(주)다라", "10002"), block(3, "S", "마바법인", "10003"), block(4, "N", "사아물산", "10004"), block(5, "SS", "자차기업", "10005")];
const merged = (text: string) => mergeTargets(parseBlocks(text, KEYS));
const asExisting = (text: string, patch: Record<string, Partial<ExistingTarget>> = {}): ExistingTarget[] =>
  merged(text).map((t, i) => ({ id: `t${i + 1}`, vendor: t.vendor, lease_code: t.leaseCodes[0] || null, list_kind: t.listKind, sent_at: null, done_at: null, ...(patch[t.leaseCodes[0] || ""] || {}) }));

describe("관리부 목록 자동 반영 — 계획(사용자 시나리오 2026-10-10)", () => {
  it("오늘 5곳 처음 올라오면 전부 신규", () => {
    const plan = planIngest([], merged(list(...five)));
    expect(plan.fresh).toHaveLength(5);
    expect(plan.dupes).toHaveLength(0);
    expect(plan.missingOpen).toHaveLength(0);
  });

  it("2곳 완료·3곳 남은 상태에서 내일 똑같은 5곳이 오면 — 신규 0, 완료 2는 완료로, 3곳은 중복(대기)", () => {
    const existing = asExisting(list(...five), { "10001": { done_at: "2026-10-10T05:00:00Z" }, "10002": { done_at: "2026-10-10T06:00:00Z", sent_at: "2026-10-10T04:00:00Z" } });
    const plan = planIngest(existing, merged(list(...five)));
    expect(plan.fresh).toHaveLength(0);
    expect(plan.dupes.map((d) => d.state)).toEqual(["완료", "완료", "대기", "대기", "대기"]);
    expect(plan.missingOpen).toHaveLength(0);
  });

  it("완료 2곳 빼고 새 2곳이 더해져 5곳이 오면 — 신규 2, 중복 3, 완료된 곳은 '목록에 없는 열린 곳'에 안 뜬다", () => {
    const existing = asExisting(list(...five), { "10001": { done_at: "2026-10-10T05:00:00Z" }, "10002": { done_at: "2026-10-10T06:00:00Z" } });
    const incoming = list(five[2], five[3], five[4], block(6, "N", "카타신규", "10006"), block(7, "V", "파하신규", "10007"));
    const plan = planIngest(existing, merged(incoming));
    expect(plan.fresh.map((t) => t.vendor)).toEqual(["N 카타신규", "V 파하신규"]);
    expect(plan.dupes).toHaveLength(3);
    expect(plan.missingOpen).toHaveLength(0);
  });

  it("문자는 보냈는데 아직 완료 못 한 곳은 '문자보냄' 중복 — 계획은 기존 행을 바꾸는 항목을 아예 갖지 않는다", () => {
    const existing = asExisting(list(...five), { "10003": { sent_at: "2026-10-10T07:00:00Z" } });
    const plan = planIngest(existing, merged(list(...five)));
    expect(plan.dupes.find((d) => d.existingId === "t3")?.state).toBe("문자보냄");
    expect(Object.keys(plan)).toEqual(["fresh", "dupes", "missingOpen", "kinds"]); // 갱신·삭제 목록이 없다 = 보냈다는 표시가 사라질 길이 없다
  });

  it("관리부가 일부만 올리면 빠진 열린 곳은 완료시키지 않고 알려만 준다", () => {
    const existing = asExisting(list(...five), { "10001": { done_at: "2026-10-10T05:00:00Z" } });
    const plan = planIngest(existing, merged(list(five[1], five[2])));
    expect(plan.fresh).toHaveLength(0);
    expect(plan.missingOpen.map((t) => t.lease_code)).toEqual(["10004", "10005"]); // 완료된 10001 은 빠지고, 열린 4·5 만
    expect(summarizePlan(plan, { team: "C", total: 2, newBatch: false })).toContain("목록에 없는 열린 곳 2(");
  });

  it("이름 표기가 달라도 임대 코드가 같으면 같은 업체, CMS 목록은 일반과 따로", () => {
    const existing = asExisting(list(...five));
    const renamed = list(block(1, "N", "가나상사 2층", "10001"));
    expect(planIngest(existing, merged(renamed)).dupes).toHaveLength(1);
    const cms = `[수도권C]\n${block(1, "N", "가나상사", "10001")}CMS.15\n`;
    const plan = planIngest(existing, merged(cms));
    expect(plan.fresh).toHaveLength(1);           // 같은 업체라도 CMS 마감은 다른 카드
    expect(plan.missingOpen).toHaveLength(0);     // 일반 마감 열린 곳은 CMS 목록과 비교하지 않는다
  });

  it("달이 바뀐 머리글이면 새 목록, 달 정보 없는 목록은 지금 목록에", () => {
    const batch = { title: "10월 마감", created_at: "2026-10-10T03:43:19Z" };
    expect(batchMonthOf(batch)).toBe(10);
    expect(needsNewBatch("2026-10", batch)).toBe(false);
    expect(needsNewBatch("2026-11", batch)).toBe(true);
    expect(needsNewBatch(undefined, batch)).toBe(false);
    expect(needsNewBatch("2026-10", null)).toBe(true);
  });
});
