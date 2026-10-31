import { useEffect, useState } from "react";
import { countRows } from "./supabase";

/**
 * 워킨맵 목록 카드 위 한 줄 — 워킨맵 동기화 확인 큐 미처리 건수(2026-10-31, 설계 workinmap-sync v2 P1-4).
 * 0건이면 아무것도 그리지 않는다. 조회 실패(SQL 실행 전이라 표가 없는 경우 포함)도 줄을 숨기고 콘솔에만 남긴다 —
 * 이 줄은 안내일 뿐 저장·성공 표시가 아니고, 처리 화면(관리 › 기타 설정 › 워킨맵 동기화)이 실패를 따로 보여 준다.
 */
export default function WorkinSyncReviewLine() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    countRows("workin_sync_review", "resolved_at=is.null")
      .then((n) => { if (alive) setCount(n); })
      .catch((e: unknown) => { console.warn("워킨맵 동기화 확인 큐 수 조회 실패", e instanceof Error ? e.message : e); });
    return () => { alive = false; };
  }, []);
  if (count <= 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-800">
      워킨맵 동기화 확인 필요 {count}건 — 관리 › 기타 설정 › 워킨맵 동기화에서 처리하세요.
    </div>
  );
}
