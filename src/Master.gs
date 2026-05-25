/**
 * 원본층 → 통합층: 각 영업 시트를 통합시트의 카테고리별 탭으로 가져와 중복제거 병합.
 * 통합 탭은 사람이 그대로 읽는 정규 DB이며, 인덱스(_idx_*)는 여기서 파생된다.
 */

function syncAllToMaster() {
  const res = {};
  for (const cat in CONFIG) res[cat] = syncCategoryToMaster(cat);
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
  const existing = loadDupKeys_(sheet);

  let src;
  try {
    src = openSpreadsheet(cfg);
  } catch (e) {
    return { ok: false, error: '원본 열기 실패: ' + e };
  }

  const headerCols = masterHeaders_(cat);
  const newRows = [];

  // 원본 시트 목록: sheets(이름) 우선, 없으면 gid로 해석
  const sources = [];
  if (cfg.sheets && cfg.sheets.length) {
    for (const nm of cfg.sheets) sources.push({ name: nm, sheet: src.getSheetByName(nm) });
  } else if (cfg.gid != null) {
    for (const s of src.getSheets()) {
      if (s.getSheetId() === cfg.gid) sources.push({ name: s.getName(), sheet: s });
    }
  }

  for (const srcItem of sources) {
    const sheetName = srcItem.name;
    const sh = srcItem.sheet;
    if (!sh) {
      Logger.log('  시트 없음: ' + sheetName);
      continue;
    }

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow <= cfg.headerRow) continue;

    // 공백/줄바꿈 무시 매칭: 정규화 헤더 → 열 인덱스(최초 출현)
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
      if (existing[key]) continue;
      existing[key] = true;

      const outRow = cfg.displayCols.map(c => (obj[c] == null ? '' : obj[c]));
      outRow.push(vendor, '시트:' + sheetName, '', new Date(), key);
      newRows.push(outRow);
    }
  }

  if (newRows.length) {
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, newRows.length, headerCols.length).setValues(newRows);
  }

  Logger.log(cat + ' → ' + tabName + ': +' + newRows.length + '행');
  return { ok: true, tab: tabName, added: newRows.length };
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
  }
  return sheet;
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
