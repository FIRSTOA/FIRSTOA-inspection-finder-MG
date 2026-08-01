/**
 * 원본층 → 통합층: 각 영업 시트를 통합시트의 카테고리별 탭으로 가져와 중복제거 병합.
 * 통합 탭은 사람이 그대로 읽는 정규 DB이며, 인덱스(_idx_*)는 여기서 파생된다.
 */

function syncAllToMaster(skipCats) {
  const skip = Array.isArray(skipCats) ? skipCats : [];
  const res = {};
  for (const cat in CONFIG) {
    if (skip.indexOf(cat) !== -1) { res[cat] = { ok: true, skipped: '이번 실행 제외' }; continue; }
    res[cat] = syncCategoryToMaster(cat);
  }
  Logger.log('syncAllToMaster: ' + JSON.stringify(res));
  return res;
}

function syncCategoryToMaster(cat) {
  const cfg = CONFIG[cat];
  if (!cfg) return { ok: false, error: '알 수 없는 카테고리: ' + cat };
  if (cfg.kakaoOnly || (!cfg.ssId && !cfg.ssNameLatest)) {
    return { ok: true, skipped: '카톡 전용 (시트 원본 없음)' };
  }

  const masterSs = SpreadsheetApp.openById(MASTER_SS_ID);
  const tabName = MASTER_TABS[cat] || cat;
  const sheet = ensureMasterTab_(masterSs, cat, tabName);
  const headerCols = masterHeaders_(cat);

  const toSupa = !!SUPABASE_SHEET_TABLE[cat];   // 시트소스 → Supabase 미러(전체교체)
  // 불만처럼 시트+카톡 혼합인데 Supabase는 카톡 증분 테이블인 경우: 시트행만 증분 insert(중복무시).
  const toSupaInc = !toSupa && !!SUPABASE_TABLE[cat];
  const supaRows = [];

  // 시트 미러는 매번 전체 교체하므로, 카톡으로 적재된 행은 따로 보존한다.
  const preserved = loadRowsBySourcePrefix_(sheet, '카톡');

  let src;
  try {
    src = openSpreadsheet(cfg);
  } catch (e) {
    return { ok: false, error: '원본 열기 실패: ' + e };
  }

  // 원본 시트 목록: sheets(이름) 우선, 없으면 gid로 해석
  const sources = [];
  if (cfg.sheets && cfg.sheets.length) {
    for (const nm of cfg.sheets) sources.push({ name: nm, sheet: src.getSheetByName(nm) });
  } else if (cfg.gid != null) {
    for (const s of src.getSheets()) {
      if (s.getSheetId() === cfg.gid) sources.push({ name: s.getName(), sheet: s });
    }
  }

  // 시트 원본을 복제 (중복 제거 X). 업체명 없는 행은 제외 (인덱스/검색도 어차피 제외함).
  const sheetRows = [];
  for (const srcItem of sources) {
    const sheetName = srcItem.name;
    const sh = srcItem.sheet;
    if (!sh) { Logger.log('  시트 없음: ' + sheetName); continue; }

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow <= cfg.headerRow) continue;

    const rawHeaders = sh.getRange(cfg.headerRow, 1, 1, lastCol).getValues()[0];
    const hmap = {};
    for (let c = 0; c < rawHeaders.length; c++) {
      const k = normalizeHeader_(rawHeaders[c]);
      if (k && hmap[k] === undefined) hmap[k] = c;
    }
    const colIdx = name => {
      const i = hmap[normalizeHeader_(name)];
      return i === undefined ? -1 : i;
    };

    const vIdx = colIdx(cfg.vendorCol);
    const fIdx = cfg.vendorColFallback ? colIdx(cfg.vendorColFallback) : -1;
    if (vIdx === -1 && fIdx === -1) {
      Logger.log('  vendorCol 못찾음: ' + cfg.vendorCol);
      continue;
    }

    const data = sh.getRange(cfg.headerRow + 1, 1, lastRow - cfg.headerRow, lastCol).getValues();

    for (const row of data) {
      let vendor = vIdx !== -1 ? String(row[vIdx] || '').trim() : '';
      if (!vendor && fIdx !== -1) vendor = String(row[fIdx] || '').trim();
      if (!vendor) continue;

      const obj = {};
      for (const colName of cfg.displayCols) {
        const idx = colIdx(colName);
        let v = idx === -1 ? '' : row[idx];
        if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
        obj[colName] = v;
      }

      const key = dupKey_(cat, vendor, obj);
      const outRow = cfg.displayCols.map(c => (obj[c] == null ? '' : obj[c]));
      outRow.push(vendor, '시트:' + sheetName, '', new Date(), key);
      sheetRows.push(outRow);

      if (toSupa || toSupaInc) {
        // 원본 한 줄 전체(모든 열) → _raw. 헤더 중복은 첫 헤더 우선. Date 는 yyyy-MM-dd 문자열.
        const rawObj = {};
        for (let c = 0; c < rawHeaders.length; c++) {
          const h = String(rawHeaders[c] == null ? '' : rawHeaders[c]).replace(/\s+/g, ' ').trim();  // 줄바꿈/중복공백 → 공백1
          if (!h || rawObj[h] !== undefined) continue;
          let rv = row[c];
          if (rv instanceof Date) rv = Utilities.formatDate(rv, 'Asia/Seoul', 'yyyy-MM-dd');
          rawObj[h] = (rv == null ? '' : rv);
        }
        supaRows.push(buildSupaRow_(cat, obj, vendor, '시트:' + sheetName, '', key, rawObj));
      }
    }
  }

  // 전체 교체: 데이터 영역 비우고 [시트행 + 보존 카톡행] 기록
  const curLast = sheet.getLastRow();
  if (curLast > 1) sheet.getRange(2, 1, curLast - 1, headerCols.length).clearContent();

  const allRows = sheetRows.concat(preserved);
  if (allRows.length) {
    const BATCH = 10000;
    for (let i = 0; i < allRows.length; i += BATCH) {
      const slice = allRows.slice(i, i + BATCH);
      sheet.getRange(2 + i, 1, slice.length, headerCols.length).setValues(slice);
    }
  }

  // 혼합 카테고리: 보존된 카톡행도 Supabase 미러에 포함 (마스터 탭 전체를 그대로 반영).
  if (toSupa) {
    for (let p = 0; p < preserved.length; p++) supaRows.push(buildSupaRowFromArray_(cat, preserved[p]));
  }
  // 시트소스 → Supabase 미러 전체교체 (실패해도 시트 적재엔 영향 없음). 빈 결과면 보호상 스킵.
  if (toSupa && supaRows.length) supabaseReplaceAll_(SUPABASE_SHEET_TABLE[cat], supaRows);
  // 불만 등: 시트행만 증분 insert(중복 자동무시). 카톡행은 appendKakaoRecords_ 가 이미 적재 → 제외.
  // delete-all 안 하므로 카톡 적재분 안 깨짐. supaRows 엔 현재 시트행만 들어있음(보존행 미추가).
  else if (toSupaInc && supaRows.length) supabaseInsertIgnore_(SUPABASE_TABLE[cat], supaRows);

  Logger.log(cat + ' → ' + tabName + ': 시트 ' + sheetRows.length + '행 + 카톡 ' + preserved.length + '행 = ' + allRows.length);
  return { ok: true, tab: tabName, sheetRows: sheetRows.length, kakaoRows: preserved.length, total: allRows.length };
}

// 통합 탭에서 _출처가 특정 접두사로 시작하는 기존 행을 그대로 읽어온다 (전체 교체 시 보존용).
function loadRowsBySourcePrefix_(sheet, prefix) {
  const out = [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return out;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const sIdx = headers.indexOf('_출처');
  if (sIdx === -1) return out;

  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (const row of data) {
    if (String(row[sIdx] || '').indexOf(prefix) === 0) out.push(row);
  }
  return out;
}

function ensureMasterTab_(ss, cat, tabName) {
  let sheet = ss.getSheetByName(tabName);
  const headerCols = masterHeaders_(cat);

  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.getRange(1, 1, 1, headerCols.length).setValues([headerCols]);
    sheet.setFrozenRows(1);
    sheet.getRange(2, headerCols.length, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
    return sheet;
  }

  // 헤더가 비어있으면 채워준다
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headerCols.length).setValues([headerCols]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // 헤더(displayCols)가 바뀌었으면 기존 데이터를 이름 기준으로 재정렬 (컬럼 추가/순서 변경 안전 반영)
  const curCols = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const same = curCols.length === headerCols.length && headerCols.every((h, i) => curCols[i] === h);
  if (!same) reconcileHeaders_(sheet, curCols, headerCols);
  return sheet;
}

// 기존 데이터를 헤더 이름 기준으로 새 헤더 순서에 맞춰 재배치 (신규 컬럼은 빈칸)
function reconcileHeaders_(sheet, oldHeaders, newHeaders) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const data = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];

  const idx = {};
  oldHeaders.forEach((h, i) => { if (h && idx[h] === undefined) idx[h] = i; });

  const remapped = data.map(row =>
    newHeaders.map(h => {
      const i = idx[h];
      return (i === undefined || i >= row.length) ? '' : row[i];
    })
  );

  sheet.clear();
  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
  sheet.setFrozenRows(1);
  if (remapped.length) {
    const BATCH = 10000;
    for (let i = 0; i < remapped.length; i += BATCH) {
      const slice = remapped.slice(i, i + BATCH);
      sheet.getRange(2 + i, 1, slice.length, newHeaders.length).setValues(slice);
    }
  }
  Logger.log('헤더 재정렬: "' + sheet.getName() + '" ' + oldHeaders.length + '→' + newHeaders.length + '열, ' + remapped.length + '행');
}

function loadDupKeys_(sheet) {
  const map = {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return map;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const kIdx = headers.indexOf('_dupKey');
  if (kIdx === -1) return map;

  const vals = sheet.getRange(2, kIdx + 1, lastRow - 1, 1).getValues();
  for (const r of vals) {
    const k = String(r[0] || '');
    if (k) map[k] = true;
  }
  return map;
}
