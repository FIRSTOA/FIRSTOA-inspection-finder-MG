/**
 * 지원 부서 시트(영업팀 reception_sales · 경영지원 reception_mgmt) 기입 경로 — 2026-10-19.
 *
 * 기존 appendViaSheetsApi(머리 이름 매칭)와 따로 둔 이유: 경영 시트는 '자산번호' 머리가 두 곳(T·BB)이고
 * 3행에 도우미 머리가 있어 이름 매칭이 틀린 열·행을 잡는다. 여기서는 dept-sheet-spec.ts 의 열 번호로 쓰고
 * 5행 머리를 먼저 검증한다. 실패하면 throw — 호출부(index.ts)는 GAS 로 폴백하지 않고 실패로 기록해
 * retry_pending 이 다시 시도한다.
 *
 * 순서: 잠금 → 5행 머리 검증 → (갱신 잡이면 갱신만) → 마지막 행·순번 → 지문 중복검사 → 행 위치
 *       → 대상 행 수식 읽기 → 앱 값 기입(수식 칸 건너뜀) → 임대리스트 값 고정(6행 원본 열 번호)
 */
import {
  acquireLock, batchGetValues, batchSetValues, batchUpdate, FIELD_SHEETS, gapi, getValues,
  quoteTitle, releaseLock, segmentsOf, spreadsheetMeta,
} from "./sheets-api.ts";
import {
  buildAppendValues, buildLeaseValues, buildUpdateValues, colLetter, DEPT_SHEET_SPECS, type DeptSheetCategory,
  type DeptSheetSpec, fingerprintCols, isDeptSheetCategory, lastFilledRow, nextSeq, normFingerprint, pickData,
  verifyDeptHeaders,
} from "./dept-sheet-spec.ts";

export type DeptSheetRequest = {
  category: string;
  jobId: string;
  author: string;
  submittedAt: string;
  payload: { data?: Record<string, unknown> } & Record<string, unknown>;
};
export type DeptSheetResult = { row: number; sheet: string; seq: number | null; updated?: boolean; duplicate?: boolean };
type Env = { rest: string; headers: Record<string, string> };

const LEASE_TAB = "임대리스트";

/** UNFORMATTED_VALUE 읽기 — 6행 원본 열 번호가 '₩ 14'·'1900. 1. 8' 같은 서식이 붙어 있어 표시값으로는 숫자를 못 얻는다 */
async function getRaw(spreadsheetId: string, range: string): Promise<unknown[][]> {
  const data = await gapi(`/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
  return (data.values as unknown[][]) || [];
}

/** 임대리스트에서 순번 행을 아래→위로 찾아 머리·값을 돌려준다(복합기 fillLeaseValues 와 같은 소스). 못 찾으면 null */
async function readLeaseRow(spreadsheetId: string, no: string): Promise<{ headers: string[]; values: string[] } | null> {
  const T = quoteTitle(LEASE_TAB);
  const leaseCol = await getValues(spreadsheetId, `${T}!A2:A`);
  let leaseRow = 0;
  for (let i = leaseCol.length - 1; i >= 0; i--) {
    if (String(leaseCol[i][0] || "").trim() === no) { leaseRow = i + 2; break; }
  }
  if (!leaseRow) return null;
  // 행 전체를 읽는다 — 범위를 자르면 뒤쪽 열(79열 업체명 등)이 잘린다(복합기 실사고)
  const got = await batchGetValues(spreadsheetId, [`${T}!1:1`, `${T}!${leaseRow}:${leaseRow}`]);
  return { headers: got.get(`${T}!1:1`)?.[0] || [], values: got.get(`${T}!${leaseRow}:${leaseRow}`)?.[0] || [] };
}

function stringifyData(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return out;
}

function specOf(category: string): { spec: DeptSheetSpec; spreadsheetId: string; sheetId: number } {
  if (!isDeptSheetCategory(category)) throw new Error(`부서 시트 종류가 아닙니다: ${category}`);
  const config = FIELD_SHEETS[category];
  if (!config) throw new Error(`FIELD_SHEETS 에 ${category} 설정이 없습니다`);
  return { spec: DEPT_SHEET_SPECS[category as DeptSheetCategory], ...config };
}

/** 접수 1건을 부서 시트에 한 줄 적는다(갱신 잡이면 그 행의 처리 열만 고친다). 실패는 throw */
export async function appendDeptRow(request: DeptSheetRequest, env: Env): Promise<DeptSheetResult> {
  const { spec, spreadsheetId, sheetId } = specOf(request.category);
  const data = stringifyData(request.payload?.data || {});

  const lockToken = await acquireLock(env.rest, env.headers);
  try {
    const meta = await spreadsheetMeta(spreadsheetId);
    const sheetMeta = meta.sheets.get(sheetId);
    if (!sheetMeta) throw new Error(`${spec.label} 시트 탭(gid ${sheetId})을 찾지 못했습니다`);
    const title = sheetMeta.title;
    const T = quoteTitle(title);
    const lastL = colLetter(spec.lastCol);

    // 1) 머리 검증 + 본문 판단 열(A 순번, 마커 B·D·E)을 한 번에 읽는다
    const headerRange = `${T}!A${spec.headerRow}:${lastL}${spec.headerRow}`;
    const colRange = (col: number) => `${T}!${colLetter(col)}${spec.dataStart}:${colLetter(col)}`;
    const readCols = [1, ...spec.markerCols];
    const first = await batchGetValues(spreadsheetId, [headerRange, ...readCols.map(colRange)]);
    verifyDeptHeaders(spec, first.get(headerRange)?.[0] || []);
    const colVals = new Map<number, string[]>();
    readCols.forEach((col) => colVals.set(col, (first.get(colRange(col)) || []).map((r) => String(r[0] ?? ""))));
    const aCol = colVals.get(1) || [];

    // 2) 갱신 잡: 행 번호 + A열 순번 확인, 밀렸으면 순번으로 아래→위 검색. 어떤 경우에도 새 행 금지
    const isUpdateJob = String(data["_updateOnly"] || "") === "1" || !!data["_updateRow"];
    if (isUpdateJob) {
      const values = buildUpdateValues(spec, data);
      if (!Object.keys(values).length) throw new Error("갱신할 값이 없습니다(진행상황·처리자·처리내용 모두 빈 값)");
      const seq = String(data["_updateKeyValue"] || data["_findKeyValue"] || pickData(data, "seq")).trim();
      const updateRow = Number(data["_updateRow"] || 0);
      const aAt = (row: number) => String(aCol[row - spec.dataStart] ?? "").replace(/[,\s]/g, "");
      let target = 0;
      if (seq) {
        if (updateRow >= spec.dataStart && aAt(updateRow) === seq) target = updateRow;
        else {
          for (let r = spec.dataStart + aCol.length - 1; r >= spec.dataStart; r--) {
            if (aAt(r) === seq) { target = r; break; }
          }
        }
        if (!target) throw new Error(`갱신 대상 행 없음: A열 순번 ${seq} (행 ${updateRow || "?"}) — 새 행을 만들지 않습니다`);
      } else {
        // 순번을 모르면(재시도 크론이 기입해 seq 를 화면이 못 받은 경우) 행 번호 + 순(L/K열)·접수자(E열)로 확인
        if (updateRow < spec.dataStart) throw new Error("갱신 대상 행 번호가 없습니다");
        const leaseCol = spec.columns.find((c) => c.key === "leaseNo")?.col || 0;
        const check = await batchGetValues(spreadsheetId, [`${T}!${colLetter(leaseCol)}${updateRow}`, `${T}!E${updateRow}`]);
        const sheetLease = String(check.get(`${T}!${colLetter(leaseCol)}${updateRow}`)?.[0]?.[0] ?? "").trim();
        const sheetAuthor = String(check.get(`${T}!E${updateRow}`)?.[0]?.[0] ?? "").trim();
        const wantLease = pickData(data, "leaseNo");
        const wantAuthor = String(data["receiptAuthor"] || "").trim();
        const ok = (wantLease || wantAuthor) && (!wantLease || sheetLease === wantLease) && (!wantAuthor || sheetAuthor === wantAuthor);
        if (!ok) throw new Error(`갱신 대상 행 확인 실패: 행 ${updateRow} 순 '${sheetLease}' 접수자 '${sheetAuthor}' — 새 행을 만들지 않습니다`);
        target = updateRow;
      }
      await batchSetValues(spreadsheetId, segmentsOf(target, title, values));
      const seqNum = Number(aAt(target));
      return { row: target, sheet: title, seq: Number.isFinite(seqNum) && seqNum > 0 ? seqNum : null, updated: true };
    }

    // 3) 마지막 데이터 행·순번. 사람 기재와 병행하므로 쓸 때마다 다시 센다
    const lastFilled = lastFilledRow(spec.dataStart, spec.markerCols.map((col) => colVals.get(col) || []));
    const seq = nextSeq(aCol);
    const submittedAt = new Date(request.submittedAt || Date.now());
    const probe = buildAppendValues(spec, { data, author: request.author, submittedAt, seq });

    // 4) 지문 중복검사 — 재시도가 같은 접수를 또 붙이는 사고(2026-09-02 "자산운용별내") 방어.
    //    실제로 쓰는 값 3개 이상이 최근 80행의 한 행과 모두 같으면 그 행을 돌려준다
    const fpCols = fingerprintCols(spec, probe);
    if (fpCols.length && lastFilled >= spec.dataStart) {
      const from = Math.max(spec.dataStart, lastFilled - 80);
      const fpRange = (col: number) => `${T}!${colLetter(col)}${from}:${colLetter(col)}${lastFilled}`;
      const fp = await batchGetValues(spreadsheetId, fpCols.map(fpRange));
      const cell = (col: number, row: number) => String(fp.get(fpRange(col))?.[row - from]?.[0] ?? "");
      for (let r = lastFilled; r >= from; r--) {
        if (fpCols.every((col) => normFingerprint(cell(col, r)) === normFingerprint(probe[col]))) {
          const seqNum = Number(String(aCol[r - spec.dataStart] ?? "").replace(/[,\s]/g, ""));
          return { row: r, sheet: title, seq: Number.isFinite(seqNum) && seqNum > 0 ? seqNum : null, duplicate: true };
        }
      }
    }

    // 5) 행 위치: 마커 열 마지막 값 아래 첫 행(행 재사용). 시트 끝을 넘으면 행 삽입 + 위 행 수식 복사
    let row = lastFilled ? lastFilled + 1 : spec.dataStart;
    if (row > sheetMeta.maxRows) {
      const previousRow = Math.max(spec.dataStart, lastFilled);
      await batchUpdate(spreadsheetId, [{
        insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: previousRow, endIndex: previousRow + 1 }, inheritFromBefore: true },
      }]);
      row = previousRow + 1;
      sheetMeta.maxRows += 1;
      const scanFrom = Math.max(spec.dataStart, row - 30);
      const formulas = await getValues(spreadsheetId, `${T}!A${scanFrom}:${lastL}${row - 1}`, "FORMULA");
      const copyRequests: unknown[] = [];
      for (let col = 0; col < spec.lastCol; col++) {
        let src = 0;
        for (let r = formulas.length - 1; r >= 0; r--) {
          if (String(formulas[r]?.[col] || "").startsWith("=")) { src = scanFrom + r; break; }
        }
        if (!src) continue;
        copyRequests.push({
          copyPaste: {
            source: { sheetId, startRowIndex: src - 1, endRowIndex: src, startColumnIndex: col, endColumnIndex: col + 1 },
            destination: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: col, endColumnIndex: col + 1 },
            pasteType: "PASTE_FORMULA",
          },
        });
      }
      await batchUpdate(spreadsheetId, copyRequests);
    }

    // 6) 대상 행의 수식 칸 — 앱 값·고정 문구·fallback 은 수식 칸에 쓰지 않는다(시트 담당자 수식 보존)
    const rowFormula = (await getValues(spreadsheetId, `${T}!A${row}:${lastL}${row}`, "FORMULA"))[0] || [];
    const formulaCols = new Set<number>();
    rowFormula.forEach((v, i) => { if (String(v).startsWith("=")) formulaCols.add(i + 1); });

    // 7) 임대리스트 값(순이 있을 때만). 못 찾거나 읽기 실패면 lease 열은 그대로 두고 fallback(업체명·지역·등급·주소)만 쓴다
    const leaseNo = pickData(data, "leaseNo");
    let leaseValues: Record<number, string> = {};
    if (leaseNo) {
      try {
        const lease = await readLeaseRow(spreadsheetId, leaseNo);
        if (lease) {
          const idxRow = (await getRaw(spreadsheetId, `${T}!A${spec.indexRow}:${lastL}${spec.indexRow}`))[0] || [];
          let overrides: Record<string, string> = {};
          try { overrides = JSON.parse(String(data["leaseFix"] || "{}")) || {}; } catch { overrides = {}; }
          leaseValues = buildLeaseValues(spec, idxRow, lease.headers, lease.values, overrides);
        }
      } catch (leaseError) {
        console.error(`${spec.label} 임대리스트 조회 실패(앱 값으로 대체):`, (leaseError as Error).message);
        leaseValues = {};
      }
    }
    const leaseFilled = Object.keys(leaseValues).length > 0;
    const appValues = buildAppendValues(spec, { data, author: request.author, submittedAt, seq }, { formulaCols, leaseFilled });
    // A열이 수식이면 순번을 쓰지 않았다 — 기입 뒤 표시값을 읽어 돌려준다
    const wroteSeq = appValues[1] !== undefined;

    // lease 값이 app 값보다 우선(같은 열에 겹치는 일은 없지만, 겹치면 임대리스트 고정이 이긴다)
    await batchSetValues(spreadsheetId, segmentsOf(row, title, { ...appValues, ...leaseValues }));

    let seqOut: number | null = wroteSeq ? seq : null;
    if (!wroteSeq) {
      const shown = (await getValues(spreadsheetId, `${T}!A${row}`))[0]?.[0] || "";
      const n = Number(String(shown).replace(/[,\s]/g, ""));
      seqOut = Number.isFinite(n) && n > 0 ? n : null;
    }
    return { row, sheet: title, seq: seqOut };
  } finally {
    await releaseLock(env.rest, env.headers, lockToken);
  }
}

/** 처리 저장(갱신 전용) — appendDeptRow 의 갱신 경로를 강제한다. 어떤 경우에도 새 행을 만들지 않는다 */
export function updateDeptRow(request: DeptSheetRequest, env: Env): Promise<DeptSheetResult> {
  const data = { ...(request.payload?.data || {}), _updateOnly: "1" };
  return appendDeptRow({ ...request, payload: { ...request.payload, data } }, env);
}
