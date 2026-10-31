import { useEffect, useState } from "react";
import { selectRows } from "./supabase";
import { visitAdviceLogLabel, type VisitAdviceLogRow } from "./visitAdviceNote";

/**
 * 서비스접수 상세(CS 접수·CS 방문이관된 IT 접수)에 "방문 판단 글: 대기 10:00 / 보냄 12:01 / 할 일 없음 / 실패" 한 줄.
 * 조회 1회(표 이름은 visitAdviceData.VISIT_ADVICE_TABLE 과 같음 — 큰 모듈을 끌어오지 않게 글자로 둔다). 표가 없거나(SQL 실행 전) 실패하면 아무것도 안 그린다(부가 정보라 접수 상세를 막지 않는다).
 */
export default function VisitAdviceStatusLine({ receptionId }: { receptionId: string }) {
  const [row, setRow] = useState<VisitAdviceLogRow | null>(null);
  useEffect(() => {
    let alive = true;
    if (!receptionId) return;
    selectRows<VisitAdviceLogRow>("visit_advice_log", `select=status,reason,due_at,sent_at,error&reception_id=eq.${encodeURIComponent(receptionId)}&limit=1`)
      .then((rows) => { if (alive) setRow(rows[0] || null); })
      .catch((e) => { console.warn("[방문 판단] 상태 조회 실패(표시 생략)", e); });
    return () => { alive = false; };
  }, [receptionId]);
  const label = visitAdviceLogLabel(row);
  if (!label) return null;
  return (
    <div className="mt-1 text-[10px] font-bold text-slate-500" title={row?.error || undefined}>
      방문 판단 글: <span className={row?.status === "error" ? "text-rose-600" : row?.status === "sent" ? "text-emerald-700" : "text-slate-700"}>{label}</span>
    </div>
  );
}
