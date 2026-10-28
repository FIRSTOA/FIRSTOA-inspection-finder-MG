// OKR 엑셀 내려받기(2026-10-28, 설계 docs/tasks/okr-excel-export-2026-10-28.md 구현 B) — 읽기 → 순수 변환(okrExcel.ts) → exceljs → 다운로드.
// OkrHub 가 [엑셀]을 누를 때만 이 모듈을 동적 import 한다(exceljs 도 그 안에서 지연 로드 — OKR 첫 화면 번들 영향 없음).
// 원칙: 화면과 같은 로더(분기 행·월 행·월 파트 종합 행·주차 getOkrReports 병렬). 하나라도 실패하면 파일을 만들지 않는다(반쪽 파일 금지, R6).
//       명단(fetchMembers)만 실패하면 보고자만으로 셈하고 요약에 한 줄(kpiData 와 같은 처리).
import { fetchMembers } from "./authors";
import { rosterFromMembers, type RosterMember } from "./kpi/kpiCompute";
import {
  OKR_LEGACY_UNTIL, getOkrCycle, getOkrReports, listOkrCycles, listOkrResultIndex, monthsOfQuarter, quarterCycleId, resolveWeekCycleId, weeksOfMonth,
  type OkrReport,
} from "./okr";
import { buildOkrWorkbookData, judgmentTone, type OkrExcelInput, type OkrExcelSheet, type OkrJudgmentTone } from "./okrExcel";
import { kstDate } from "./visits";

// ── 순수 함수(tests/okrExcelExport.test.ts). 파일명은 okrExcel.okrExcelFileName(buildOkrWorkbookData 가 채움) ──
/** 옛 구조(OKR_LEGACY_UNTIL 까지 = 2026 3분기 이전) 분기는 분기 행·층 행이 없어 내보내지 않는다(Q3) — topFilterItems 의 legacy 와 같은 기준 */
export const canExportOkrQuarter = (year: number, quarter: number) => monthsOfQuarter(year, quarter)[2].id > OKR_LEGACY_UNTIL;
/** 아이폰·카톡 인앱 브라우저는 blob 다운로드가 안 될 수 있다(R2) — 안내 문구, 해당 없으면 "" */
export function downloadAdvice(userAgent: string): string {
  if (/KAKAOTALK/i.test(userAgent)) return "카톡 안 브라우저는 파일이 안 받아질 수 있어요 — PC 에서 받는 걸 권장합니다(폰이면 크롬·사파리로 열기)";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "아이폰은 파일이 '파일' 앱에 저장되거나 미리보기로 열려요 — PC 에서 받는 걸 권장합니다";
  return "";
}
/** 그 달 1일~말일(명단 범위, R5) */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

// ── 읽기 ──
/** 보는 분기 전체 재료. 주차는 화면 규칙(resolveWeekCycleId — 옛 id 행이 있으면 그 행)으로 읽고 정식 id(…-Wn)로 바꿔 담는다 */
export async function loadOkrExcelInput(year: number, quarter: number, by: string): Promise<OkrExcelInput> {
  if (!canExportOkrQuarter(year, quarter)) throw new Error("8·9월(옛 구조) 분기는 엑셀로 받을 수 없습니다");
  const today = kstDate();
  const months = monthsOfQuarter(year, quarter);
  const [cycles, resultIds] = await Promise.all([listOkrCycles(), listOkrResultIndex()]);
  // 오늘 이후 시작 주차는 읽지 않는다(Q6 — 넣지 않을 행)
  const weekPlan = months.flatMap((m) => weeksOfMonth(m.year, m.month).filter((w) => w.start <= today)
    .map((w) => ({ monthId: m.id, id: w.id, readId: resolveWeekCycleId(m.year, m.month, w.weekNo, cycles, resultIds) })));
  const [quarterCycle, monthCycles, monthRows, weekLists, members] = await Promise.all([
    getOkrCycle(quarterCycleId(year, quarter)),
    Promise.all(months.map((m) => getOkrCycle(m.id))),
    Promise.all(months.map((m) => getOkrReports(m.id, ""))),
    Promise.all(weekPlan.map((w) => getOkrReports(w.readId))),
    // 명단은 실패해도 파일은 만든다 — 요약 위 블록에 "명단을 못 읽어 보고자만 셈"(rosterFailed) + 완료 토스트에도
    fetchMembers().then((rows) => ({ rows, error: "" }), (e: unknown) => ({ rows: null, error: (e as Error).message || "명단 읽기 실패" })),
  ]);
  const weekReports: Record<string, OkrReport[]> = Object.fromEntries(months.map((m) => [m.id, [] as OkrReport[]]));
  weekPlan.forEach((w, i) => { for (const r of weekLists[i]) weekReports[w.monthId].push({ ...r, cycle_id: w.id }); });
  const rosterOf = (y: number, m: number): RosterMember[] | null => (members.rows ? rosterFromMembers(members.rows, monthRange(y, m)) : null);
  return {
    year, quarter, today, now: new Date().toISOString(), by,
    quarterCycle,
    months: months.map((m, i) => ({ id: m.id, year: m.year, month: m.month, cycle: monthCycles[i], reports: monthRows[i], weekReports: weekReports[m.id], roster: rosterOf(m.year, m.month) })),
    rosterFailed: !!members.error,
  };
}

// ── 쓰기(exceljs) — WalkingMap exportExcel 의 머리행 서식·1행 고정·자동 필터 패턴 ──
// 판정 채움색(임시 — 설계서 부록 A 디자인실 색이 오면 맞춘다): 미흡·미착수 연한 빨강 · 부분달성 연한 노랑 · 완료 연한 초록 · 해당없음 회색 · 미작성 연한 주황
const TONE_FILL: Record<Exclude<OkrJudgmentTone, "">, string> = { alert: "FFFEE2E2", partial: "FFFEF9C3", done: "FFDCFCE7", na: "FFE2E8F0", missing: "FFFFEDD5" };
const HEAD_FILL = "FF0F172A";

async function writeWorkbook(sheets: OkrExcelSheet[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default;
  const workbook = new ExcelJS.Workbook();
  for (const s of sheets) {
    const header = s.headerRow !== false;
    const sheet = workbook.addWorksheet(s.name, header ? { views: [{ state: "frozen", ySplit: 1 }] } : {});
    const offset = header ? 1 : 0; // rows[i] → 엑셀 행 i + 1 + offset
    if (header) sheet.addRow(s.columns.map((c) => c.header));
    for (const row of s.rows) sheet.addRow(s.columns.map((_, i) => row[i] ?? null));
    s.columns.forEach((c, i) => {
      const column = sheet.getColumn(i + 1);
      column.width = c.width;
      column.alignment = c.kind === "long" ? { wrapText: true, vertical: "top" } : { vertical: "top" };
    });
    // 칸 단위 서식(빈 행 제외) — % 표시·판정 채움
    s.rows.forEach((row, ri) => {
      const xr = sheet.getRow(ri + 1 + offset);
      s.columns.forEach((c, ci) => {
        const v = row[ci];
        if (v === null || v === undefined || v === "") return;
        const cell = xr.getCell(ci + 1);
        if (c.kind === "pct" && typeof v === "number") cell.numFmt = '0"%"';
        if (c.kind === "judgment") { const tone = judgmentTone(v); if (tone) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE_FILL[tone] } }; }
      });
    });
    const headStyle = (r: number) => sheet.getRow(r).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
    if (header) headStyle(1);
    for (const r of s.subHeaderRows ?? []) headStyle(r + 1 + offset);
    for (const r of s.boldRows ?? []) sheet.getRow(r + 1 + offset).eachCell((cell) => { cell.font = { ...(cell.font || {}), bold: true }; });
    if (header && s.columns.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    // 안내(notes) — 표 아래 한 줄 띄우고 회색 글(빈 줄이 있어 자동 필터 범위에 안 섞인다)
    if (s.notes?.length) {
      sheet.addRow([]);
      for (const n of s.notes) sheet.addRow([n]).getCell(1).font = { italic: true, color: { argb: "FF64748B" } };
    }
  }
  return workbook.xlsx.writeBuffer();
}

function saveBlob(buffer: ArrayBuffer, fileName: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 아이폰 사파리는 click 직후 revoke 하면 빈 파일·무반응(R2) — 늦춰서 놓는다
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** [엑셀] 한 번 — 읽기 → 변환 → 쓰기 → 다운로드. 실패는 throw(호출부가 토스트) */
export async function downloadOkrExcel(year: number, quarter: number, by: string): Promise<{ fileName: string; weekRows: number; rosterFailed: boolean }> {
  const input = await loadOkrExcelInput(year, quarter, by);
  const data = buildOkrWorkbookData(input);
  const buffer = await writeWorkbook(data.sheets);
  saveBlob(buffer, data.fileName);
  return { fileName: data.fileName, weekRows: data.weekRowCount, rosterFailed: !!input.rosterFailed };
}
