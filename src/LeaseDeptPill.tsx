// 임대리스트 검색 결과 줄의 부서명/현장명 알약(C4) — 복합기 AS(ServiceReception)·지원 3종(DeptReceptionForm.view) 공용.
// 값이 없으면 그리지 않는다. 부서명으로 걸린 줄은 노란 테두리로 "왜 걸렸나"를 보여 준다.
import { deptPillText } from "./leaseDept";

export default function LeaseDeptPill({ dept, matched }: { dept: string; matched?: boolean }) {
  if (!dept) return null;
  return (
    <span title={matched ? `부서명 일치: ${dept}` : dept}
      className={`min-w-0 max-w-[45%] shrink truncate rounded-full border bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 ${matched ? "border-amber-400" : "border-transparent"}`}>
      {deptPillText(dept)}
    </span>
  );
}
