// 공통 화면 부품 — Tailwind 클래스 문자열 묶음(로직 없음). 감사 보고서 docs/tasks/ui-tidy-audit-2026-10-24.md 2절.
// 규칙: 카드는 UI.card 1종, 카드 안 그룹은 카드 대신 구분선(border-t / divide), 라이트 화면에 rounded-2xl 금지,
//       글자 11px 미만 금지, 폰 단추는 min-h-11(PC 표·칩 안에서만 lg:min-h-9), 선택 색은 slate-900(어두운 바탕은 white).
export const UI = {
  // 카드 1종: 테두리 한 겹, 그림자 없음(뜬 것은 팝오버·모달만)
  card: "overflow-hidden rounded-xl border border-slate-200 bg-white",
  // 카드 머리 1종: 제목 + 설명 + 오른쪽 단추. 화면 맨 위 한 번만 다크 머리(heroHead)
  head: "flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 lg:px-5",
  title: "text-sm font-black text-slate-950 lg:text-[15px]",
  desc: "mt-0.5 text-[11px] font-semibold text-slate-400",
  heroHead: "bg-[#1E252F] px-4 py-3 lg:px-5 lg:py-4", // 화면당 1개
  heroBar: "flex flex-wrap items-center gap-2 bg-[#151A23] px-4 py-2.5", // 선택: 다크 상태줄
  // 페이지 머리 패턴(2026-10-24): 라이트 배경, 제목+한 줄 설명은 왼쪽, 액션 단추는 오른쪽. 다크 배너 없음. 카드(UI.card) 맨 위에 둔다.
  pageHead: "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4 lg:px-5",
  pageTitle: "text-base font-black text-slate-950 lg:text-lg",
  pageDesc: "mt-0.5 text-[11px] font-semibold leading-4 text-slate-500",
  pageActions: "flex shrink-0 flex-wrap items-center gap-1.5",
  // 페이지 머리 아래 탭 줄(밑줄형). 폰은 가로 스크롤 한 줄
  pageTabs: "flex overflow-x-auto border-b border-slate-100 px-2 lg:px-3",
  pageTab: (on: boolean) => `relative flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 text-sm font-black transition ${on ? "text-slate-950 after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-full after:bg-blue-600" : "text-slate-400 hover:text-slate-700"}`,
  // 콘텐츠 카드 안 첫 줄(검색칸 자리): 흰 배경 + 아래 구분선
  toolbar: "border-b border-slate-100 p-3 lg:px-4",
  body: "p-4 lg:p-5",
  section: "border-t border-slate-100 p-4 lg:p-5", // 카드 안 구분은 카드 아니고 선
  gap: "space-y-4", // 화면 세로 간격 통일

  // KPI: 카드 한 장 안의 한 줄(grid divide-x). 금액은 truncate 대신 줄바꿈(break-keep)
  kpiRow: "grid divide-x divide-slate-100",
  kpiCell: "min-w-0 px-2 py-3 text-center sm:px-3 sm:py-4",
  kpiValue: "break-keep text-sm font-black tabular-nums leading-5 text-slate-950 sm:text-lg",
  kpiLabel: "mt-1 text-[11px] font-bold text-slate-400",

  // 칩 1종: 선택 = slate-900 하나로 통일. 폰 min-h-11, PC min-h-9
  chip: (on: boolean) => `inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-3.5 text-[12px] font-black transition lg:min-h-9 ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`,
  chipDark: (on: boolean) => `inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-3.5 text-[12px] font-black transition lg:min-h-9 ${on ? "bg-white text-slate-950" : "bg-white/10 text-slate-300 hover:bg-white/20"}`,
  // 묶음 막대(분할 선택): 바깥 알약 + 안쪽 단추
  seg: "flex rounded-full bg-slate-100 p-1",
  segBtn: (on: boolean) => `inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-3 text-[12px] font-black transition lg:min-h-9 ${on ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`,

  // 단추 2종: 파랑(주 동작) / 흰 테두리(보조). 위험은 보조 + 글자색(rose)
  btn: "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40 lg:min-h-9",
  btnGhost: "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 lg:min-h-9",
  btnIcon: "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-50 lg:min-h-9 lg:min-w-9",

  // 입력 1종(border-slate-300), 라벨 1종. inputIcon = 왼쪽에 돋보기 아이콘이 들어가는 입력
  input: "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10",
  inputIcon: "h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-8 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10",
  label: "text-[11px] font-semibold text-slate-500",
  // 줄 머리 라벨(칩 줄 앞의 작은 이름: 기간·팀·정렬)
  rowLabel: "w-full shrink-0 text-[11px] font-black text-slate-400 sm:w-9",
  rowLabelInline: "w-9 shrink-0 text-[11px] font-black text-slate-400", // 칩 줄 앞에 같은 줄로 붙는 라벨

  // 배지 1종 + 상태색(정상 초록·주의 노랑·실패 빨강·비활성 회색)
  badge: "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-black",
  tone: { ok: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-700", bad: "bg-rose-50 text-rose-700", off: "bg-slate-100 text-slate-500" },

  // 안내줄(알림 띠) 1종
  note: (t: "ok" | "warn" | "bad" | "info") => `rounded-lg border px-4 py-2.5 text-xs font-bold ${{ ok: "border-emerald-200 bg-emerald-50 text-emerald-800", warn: "border-amber-200 bg-amber-50 text-amber-800", bad: "border-rose-200 bg-rose-50 text-rose-700", info: "border-blue-100 bg-blue-50 text-blue-700" }[t]}`,
};
