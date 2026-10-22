import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { myLedgerCounts, type WorkLedger } from "../src/myWorkCount";
import { countableEvents, mergeExpansionIntoEvents, mergeFieldIntoEvents, toExpansionRows, toFieldRows, type ExpansionRaw, type FieldRaw } from "../src/workCount";
import type { ActivityEvent } from "../src/operations";

const TEAM: Record<string, string> = { 한왕주: "C", 이호준: "A", 팀장님: "팀장" };
const teamOf = (a: string) => TEAM[a] || "";
const FIVE = Array.from({ length: 5 }, (_, i) => `모델명: SL-X3220NR\n시리얼넘버: 0A6XBJ${i}000${i}\n자산기번: C10${i}0`).join("\n");
const field = (id: number, day: string, author: string, vendor: string, raw: string, at = `${day}T02:00:00+00:00`): FieldRaw =>
  ({ id, 작성일: day, 작성자: author, 지역: "", _출처: "카톡:웹앱", 업체명: vendor, _업체명: vendor, 모델명: "", 시리얼넘버: "", 자산기번: "", _원문: raw, created_at: at });
const pc = (id: number, at: string, author: string, vendor: string): ExpansionRaw => ({ id, 날짜: at, 작성자: author, _업체명: vendor, 지역: "C" });

// 같은 행 묶음 — 10월 한왕주(5대 업체 AS 겸 점검, 같은 기기 재전송, 다른 날 같은 업체 AS, 확장성 같은 날 재전송) + 다른 사람·팀장
const JEOM: FieldRaw[] = [
  field(1, "2026-10-14", "한왕주", "파트라", FIVE),
  field(2, "2026-10-14", "한왕주", "파트라", FIVE, "2026-10-14T02:05:00+00:00"), // 재전송 → 0
  field(3, "2026-10-21", "한왕주", "한국에스엠에이", "모델명: SL-X4220RX\n시리얼넘버: 28S3B1BH10006QE\n자산기번: D0090"),
  field(4, "2026-10-21", "이호준", "다른업체", FIVE),
  field(5, "2026-10-21", "팀장님", "파트라", FIVE),
];
const AS: FieldRaw[] = [
  field(11, "2026-10-14", "한왕주", "파트라", "모델명: SL-X3220NR\n시리얼넘버: 0A6XBJ00000\n자산기번: C1000"),
  field(12, "2026-10-20", "한왕주", "반석정밀공업", "모델명: HP-8710\n시리얼넘버: CN888B3100\n자산기번: x7251"),
  field(13, "2026-10-21", "한왕주", "반석정밀공업", "모델명: HP-8710\n시리얼넘버: CN888B3100\n자산기번: x7251"),
];
const PC: ExpansionRaw[] = [
  pc(21, "2026-10-16T02:13:14+00:00", "한왕주", "에스에이치파트너스"), pc(22, "2026-10-16T02:14:20+00:00", "한왕주", "에스에이치파트너스"),
  pc(23, "2026-10-21", "한왕주", "델타엔지니어링"), pc(24, "2026-09-30T16:00:00+00:00", "한왕주", "10월1일KST"),
];
const ledger: WorkLedger = {
  field: [...toFieldRows("jeomgeom", JEOM, teamOf), ...toFieldRows("as_records", AS, teamOf)],
  expansion: toExpansionRows("pc_expansion", PC, teamOf),
};

// 순위표(TeamRanking) 사람 값 — loadWorkEvents 의 합치기 + countableEvents + METRICS 셈(점검 = machineCount 합, AS = 개수, 확장성 = 개수)
function rankingValues(author: string, from: string, to: string) {
  const evs: ActivityEvent[] = countableEvents(mergeFieldIntoEvents(mergeExpansionIntoEvents([], ledger.expansion), ledger.field))
    .filter((e) => e.author === author && e.activityDate >= from && e.activityDate <= to);
  return {
    inspection: evs.filter((e) => e.category === "inspection").reduce((n, e) => n + (e.machineCount || 1), 0),
    as: evs.filter((e) => e.category === "as").length,
    expansion: evs.filter((e) => e.category === "expansion_it" || e.category === "expansion_copier").length,
  };
}

describe("주간현황판 [내 현황] 점검·AS·확장성 = 순위표·팀 현황과 같은 원본·같은 함수", () => {
  it("기기 5대 업체 AS 겸 점검 → 점검 5대 · AS 1건(재전송은 다시 안 셈)", () => {
    expect(myLedgerCounts(ledger, "한왕주", "2026-10-14", "2026-10-14")).toEqual({ inspection: 5, as: 1, expansion: 0 });
  });

  it("10월 한 달: 내 현황 = 순위표 사람 값", () => {
    const mine = myLedgerCounts(ledger, "한왕주", "2026-10-01", "2026-10-31");
    expect(mine).toEqual({ inspection: 6, as: 3, expansion: 3 });
    expect(mine).toEqual(rankingValues("한왕주", "2026-10-01", "2026-10-31"));
    expect(myLedgerCounts(ledger, "이호준", "2026-10-01", "2026-10-31")).toEqual(rankingValues("이호준", "2026-10-01", "2026-10-31"));
  });

  it("일별로 나눠 센 합 = 한 달 값(주·월 표의 칸이 합계와 맞는다)", () => {
    const days = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const total = days.map((d) => myLedgerCounts(ledger, "한왕주", d, d)).reduce((a, b) => ({ inspection: a.inspection + b.inspection, as: a.as + b.as, expansion: a.expansion + b.expansion }));
    expect(total).toEqual(myLedgerCounts(ledger, "한왕주", "2026-10-01", "2026-10-31"));
  });

  it("작성자가 비면 전원 합이 아니라 0", () => {
    expect(myLedgerCounts(ledger, "", "2026-10-01", "2026-10-31")).toEqual({ inspection: 0, as: 0, expansion: 0 });
  });

  it("WorkDashboard 가 visit_logs 대신 myLedgerCounts 로 점검·AS·확장성을 덮는다", () => {
    const src = readFileSync("src/WorkDashboard.tsx", "utf8");
    expect(src).toMatch(/myLedgerCounts\(/);
    expect(src).toMatch(/loadFieldRows\(range\.start, range\.end\)/);
    expect(src).toMatch(/loadExpansionRows\(range\.start, range\.end\)/);
    expect(src).toMatch(/sum\.count\.inspection = fromLedger\.inspection/);
  });
});
