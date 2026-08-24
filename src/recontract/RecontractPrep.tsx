/**
 * 재계약 준비 탭 — 이카운트 분석 화면 하나로 통합 (사용자 확정).
 * 이번 분기 방문 대상(워킨맵 재계약 S/SS) 목록과 이카운트 붙여넣기 분석이 AnalyzeView 안에 있다.
 * 옛 방문 대상 전용 화면·ProposalSheet는 git 이력에 남아 있다 (2026-08-25 제거).
 */
import AnalyzeView from "./AnalyzeView";

export default function RecontractPrep({ author = "" }: { author?: string }) {
  return <AnalyzeView author={author} />;
}
