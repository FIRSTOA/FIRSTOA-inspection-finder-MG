/**
 * 주간현황판 [내 현황]의 점검·AS·확장성 숫자(2026-10-23 "모든 숫자 통일").
 * 왜: 내 현황은 방문 장부(visit_logs)의 work_kinds 로 점검(machine_count 합)·AS(방문 행 수)·확장성(방문 행 수)을 셌다.
 *     홈·팀 현황·순위표·조회 탭은 jeomgeom/as_records·pc_expansion/mfp_expansion 표 원본(workCount countField/countExpansion)이라
 *     같은 사람·같은 달이 화면마다 달랐다(한왕주 10월: 점검 101 vs 91, AS 26 vs 29, 확장성 18 vs 17).
 * 규칙: 점검(대)·AS(건)·확장성(건)은 workCount 의 함수 그대로(작성자 = 보는 사람, KST 기간). 방문 수·기기 대수·시간·동선은 방문 장부 그대로.
 *   예) 기기 5대 있는 곳에 AS 겸 점검 → 방문 1회 · 기기 5대 · 점검 5대 · AS 1건
 * 2026-10-24 3단계: 미수·불만·재계약·초과조정·담당자 변경·물류(납품/반출/교체/셋팅 = 물류 칸, 기타 = 여분·마감 칸)도 양식 원본 표
 *   (formCount.countForms — 순위표·팀 현황·홈과 같은 함수). 방문 장부 work_kinds 로 세던 값은 원본을 못 읽었을 때만 남는다.
 */
import { countExpansion, countField, type ExpansionRow, type FieldRow } from "./workCount";
import { countForms, withFieldLogistics, type FormKind, type FormSet } from "./formCount";

/** 기간 안 원본 행(전 직원) — expansionSource.loadFieldRows / loadExpansionRows / loadFormRows 결과(forms 없으면 양식 숫자는 방문 장부 그대로) */
export type WorkLedger = { field: FieldRow[]; expansion: ExpansionRow[]; forms?: FormSet };
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

/** 내 현황 양식 칸 — 물류(여분·마감 제외)·기타(여분·마감)·재계약(곳)·불만(곳)·초과조정·미수·담당자 변경. 원본을 못 읽은 종류는 null */
export type FormCounts = { logistics: number | null; logisticsEtc: number | null } & Record<Exclude<FormKind, "logistics">, number | null>;
export const EMPTY_FORM_COUNTS: FormCounts = { logistics: null, logisticsEtc: null, recontract: null, complaint: null, overage: null, misu: null, contact_change: null };

/**
 * 한 사람·한 기간(KST, 양끝 포함)의 양식 건수 — 순위표 사람 값(mergeFormsIntoEvents → countFormEvents / rankingLogisticsCount)과 같은 함수.
 * 물류 원본 = 물류 양식 표 + 점검·AS 양식의 여분·마감·세팅(withFieldLogistics, 팀 현황·순위표와 같다).
 */
export function myFormCounts(ledger: WorkLedger, author: string, from: string, to: string): FormCounts {
  if (!ledger.forms) return { ...EMPTY_FORM_COUNTS };
  const forms = withFieldLogistics(ledger.forms, ledger.field);
  // 작성자가 비면 countForms 범위가 '전원'이 된다 — 내 현황에서는 0(읽은 종류만)
  const one = (kind: FormKind, part?: "main" | "etc") => (!forms[kind] ? null : !author.trim() ? 0 : countForms(kind, forms[kind] || [], from, to, { author, ...(part ? { part } : {}) }));
  return {
    logistics: one("logistics", "main"), logisticsEtc: one("logistics", "etc"),
    recontract: one("recontract"), complaint: one("complaint"), overage: one("overage"), misu: one("misu"), contact_change: one("contact_change"),
  };
}
