// 필드 🔍 시트 표시용 작은 판정들(2026-10-25) — TabSearch.view.tsx·field/FieldSearchSheet.tsx 가 쓴다(컴포넌트 파일엔 컴포넌트만: fast refresh 규칙).
// 설계: docs/tasks/tab-search-icon-merge-2026-10-25.md 4-3·5절.
import { TAB_SPECS, type TabKey, type TabLine } from "./tabSearch";

/** 카톡 상태 — off: 그 탭에 수집 방이 없음(안내 없음) · disabled: 스위치 꺼짐 · error: 조회 실패 */
export type KakaoStatus = "off" | "loading" | "done" | "disabled" | "error";

/** 카톡 줄인가 — source 가 없으면 FIELD(기존 줄 호환) */
export const isKakaoLine = (line: Pick<TabLine, "source">): boolean => line.source === "kakao";

/** 양식 모양(kind_guess form:*)인데 표에 없어 남은 카톡 글 — GAS 적재 누락 신호라 배지로 따로 보인다 */
export const isFormLeft = (line: Pick<TabLine, "kindGuess">): boolean => !!line.kindGuess?.startsWith("form:");

/** 카톡 줄 아래 작은 글씨 — "표에 없는 대화 · 방 이름" */
export function kakaoNote(line: Pick<TabLine, "detail">): string {
  return ["표에 없는 대화", line.detail].filter(Boolean).join(" · ");
}

/** 시트 머리 글 — 제목 "{탭 이름} 이력 검색", 안내 한 줄(점검·AS·청정기는 옛 거래처검색 안내) */
export function sheetHeading(tab: TabKey): { title: string; sub: string } {
  const spec = TAB_SPECS[tab];
  if (tab === "inspection") return { title: "점검·AS 이력 검색", sub: "업체를 찾아 최근 점검·AS 양식을 불러옵니다." };
  if (tab === "air") return { title: "청정기 이력 검색", sub: "청정기 거래처를 찾아 지난 양식을 불러옵니다." };
  return { title: `${spec.label} 이력 검색`, sub: spec.question };
}
