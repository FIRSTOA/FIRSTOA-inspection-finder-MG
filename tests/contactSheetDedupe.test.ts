import { describe, expect, it } from "vitest";
import { contentKey, dedupePayload, sameDayKey } from "../supabase/functions/contact-sheet-pull/dedupe.ts";

// 2026-10-31 실사고: 키맨체크 시트 '청현세무회계컨설팅'(접수자 '프로') 행의 날짜 칸이 수식(오늘)이라 매일 자정 새 건으로 13건.
const chung = (date: string) => ({ company: "청현세무회계컨설팅", change_date: date, category: "남주현 대리님", before_text: "010 8039 5570", after_text: "", author: "프로" });

describe("contact-sheet-pull 내용 기반 중복 차단", () => {
  it("날짜만 다른 같은 내용 행은 넣지 않는다(청현세무 수식 날짜)", () => {
    const r = dedupePayload([chung("2026-10-31")], [chung("2026-10-30")]);
    expect(r.kept).toHaveLength(0);
    expect(r.removedSameContent).toBe(1);
  });
  it("업체+날짜+변경후 같으면 규칙 1(공백 차이 무시)", () => {
    const r = dedupePayload([{ company: "가나상사 ", change_date: "2026-10-30", after_text: "김 A", author: "박영현", category: "키맨", before_text: "" }],
      [{ company: "가나상사", change_date: "2026-10-30", after_text: "김A", author: "다른사람", category: "담당자", before_text: "x" }]);
    expect(r.removedSameDay).toBe(1);
  });
  it("내용이 하나라도 다르면 새 건(변경후 다른 두 번째 변경)", () => {
    const a = { company: "가나상사", change_date: "2026-09-01", category: "키맨", before_text: "김A", after_text: "이B", author: "박영현" };
    const b = { ...a, change_date: "2026-10-20", before_text: "이B", after_text: "최C" };
    const r = dedupePayload([b], [a]);
    expect(r.kept).toHaveLength(1);
  });
  it("payload 안끼리도 같은 규칙으로 하나만", () => {
    const r = dedupePayload([chung("2026-10-30"), chung("2026-10-31")], []);
    expect(r.kept).toHaveLength(1);
  });
  it("키는 공백을 지운 값", () => {
    expect(sameDayKey({ company: "a b", change_date: "d", after_text: " c " })).toBe("ab|d|c");
    expect(contentKey({ company: "a", category: "b", before_text: "c", after_text: "", author: "e" })).toBe("a|b|c||e");
  });
});
