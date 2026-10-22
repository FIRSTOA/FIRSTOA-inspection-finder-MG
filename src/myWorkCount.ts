/**
 * 주간현황판 [내 현황]의 점검·AS·확장성 숫자(2026-10-23 "모든 숫자 통일").
 * 왜: 내 현황은 방문 장부(visit_logs)의 work_kinds 로 점검(machine_count 합)·AS(방문 행 수)·확장성(방문 행 수)을 셌다.
 *     홈·팀 현황·순위표·조회 탭은 jeomgeom/as_records·pc_expansion/mfp_expansion 표 원본(workCount countField/countExpansion)이라
 *     같은 사람·같은 달이 화면마다 달랐다(한왕주 10월: 점검 101 vs 91, AS 26 vs 29, 확장성 18 vs 17).
 * 규칙: 점검(대)·AS(건)·확장성(건)은 workCount 의 함수 그대로(작성자 = 보는 사람, KST 기간). 방문 수·기기 대수·시간·동선은 방문 장부 그대로.
 *   예) 기기 5대 있는 곳에 AS 겸 점검 → 방문 1회 · 기기 5대 · 점검 5대 · AS 1건
 */
import { countExpansion, countField, type ExpansionRow, type FieldRow } from "./workCount";

/** 기간 안 원본 행(전 직원) — expansionSource.loadFieldRows / loadExpansionRows 결과 */
export type WorkLedger = { field: FieldRow[]; expansion: ExpansionRow[] };
export type LedgerCounts = { inspection: number; as: number; expansion: number };
export const EMPTY_LEDGER: WorkLedger = { field: [], expansion: [] };

/** 한 사람·한 기간(KST, 양끝 포함)의 점검 대수 / AS 건수 / 확장성 건수 — 순위표 사람 값과 같은 함수 */
export function myLedgerCounts(ledger: WorkLedger, author: string, from: string, to: string): LedgerCounts {
  // 작성자가 비면 workCount 범위가 '전원'이 된다 — 내 현황에서는 0
  if (!author.trim()) return { inspection: 0, as: 0, expansion: 0 };
  const scope = { author, from, to };
  return {
    inspection: countField(ledger.field, { ...scope, kind: "inspection" }),
    as: countField(ledger.field, { ...scope, kind: "as" }),
    expansion: countExpansion(ledger.expansion, scope),
  };
}
