// 필드 헤더 🔍 단추 이름(2026-10-25) — App 이 바로 읽는 아주 작은 모듈.
// tabSearch.tabKeyOf 를 App 에서 정적으로 부르면 entity360(무거움)이 첫 화면 묶음에 끌려온다 — 그래서 같은 대응을 여기 따로 둔다.
// 두 곳이 어긋나지 않게 tests/fieldSearchSheet.test.ts 가 모든 탭에서 tabKeyOf 와 비교한다.
// 설계: docs/tasks/tab-search-icon-merge-2026-10-25.md 5절 1.

/** 필드 mode(·확장성 하위 탭) → 🔍 단추 aria-label. null = 단추 없음(검색할 표가 없는 탭) */
export function searchIconLabel(mode: string, pcSubTab?: string): string | null {
  switch (mode) {
    case "inspection": case "blank-report": case "samsung-note": return "거래처검색"; // 점검·AS — 옛 이름 유지
    case "air-purifier": return "청정기 이력 검색";
    case "logistics": return "물류 이력 검색";
    case "pc": return pcSubTab === "it" ? "IT 확장성 이력 검색" : pcSubTab === "copier" ? "복합기 확장성 이력 검색" : null;
    case "contact-change": return "담당자/주소 변경 이력 검색";
    case "bulman": return "불만 이력 검색";
    case "misu": return "미수 이력 검색";
    case "overage-adjust": return "초과조정 이력 검색";
    case "recontract": return "재계약 이력 검색";
    case "replacement": return "교체 이력 검색";
    case "praise": return "칭찬 이력 검색";
    default: return null;
  }
}

/** 헤더 아이콘 한 칸 폭(h-10 w-10 = 40px)·사이(gap-1 = 4px) — 390px 넘침 검사용 */
export const HEADER_ICON_PX = 40;
export const HEADER_ICON_GAP_PX = 4;
/** 필드 헤더 오른쪽 아이콘 수 — 📷·📝 는 점검·AS·청정기만(App 조건 그대로), 🗂️ 는 늘, 🔍 는 searchIconLabel 이 있을 때 */
export function headerIconCount(mode: string, pcSubTab?: string): number {
  const formMode = mode === "inspection" || mode === "air-purifier" || mode === "blank-report";
  return 1 + (searchIconLabel(mode, pcSubTab) ? 1 : 0) + (formMode ? 2 : 0);
}
