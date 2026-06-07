/**
 * 폴백: 통합 탭을 거치지 않고 원본 시트에서 바로 인덱스를 만드는 v10 경로.
 * 통합 탭 도입 전 동작을 보존한다. 평상시에는 refreshAll()을 사용.
 */

function rebuildIndexFromSourcesFast() {
  return rebuildIndexFromSources_(SLOW_CATEGORIES);
}

function rebuildIndexFromSources() {
  return rebuildIndexFromSources_([]);
}

function rebuildIndexFromSources_(skipCats) {
  const startTime = new Date();
  const isPartial = skipCats && skipCats.length > 0;
  const indexSs = SpreadsheetApp.openById(INDEX_SS_ID);

  const preservedCounts = {};
  const preservedMeta = {};
  const preservedDataRows = [];

  if (isPartial) {
    const skipSet = {};
    for (const c of skipCats) skipSet[c] = true;

    const vSh = indexSs.getSheetByName(INDEX_VENDORS);
    if (vSh && vSh.getLastRow() >= 2) {
      const totalCols = 1 + SEARCH_CATEGORIES.length + 1;
      const vdata = vSh.getRange(2, 1, vSh.getLastRow() - 1, totalCols).getValues();
      for (const row of vdata) {
        const vendor = String(row[0] || '').trim();
        if (!vendor) continue;

        let meta = {};
        try { meta = JSON.parse(String(row[totalCols - 1] || '{}')); } catch (e) {}

        for (let c = 0; c < SEARCH_CATEGORIES.length; c++) {
          const cat = SEARCH_CATEGORIES[c];
          if (!skipSet[cat]) continue;

          const cnt = Number(row[1 + c]) || 0;
          if (cnt > 0) {
            if (!preservedCounts[vendor]) preservedCounts[vendor] = {};
            preservedCounts[vendor][cat] = cnt;
          }
          if (meta[cat]) {
            if (!preservedMeta[vendor]) preservedMeta[vendor] = {};
            preservedMeta[vendor][cat] = meta[cat];
          }
        }
      }
    }

    const dSh = indexSs.getSheetByName(INDEX_DATA);
    if (dSh && dSh.getLastRow() >= 2) {
      const ddata = dSh.getRange(2, 1, dSh.getLastRow() - 1, 3).getValues();
      for (const row of ddata) {
        const cat = String(row[1] || '');
        if (skipSet[cat]) preservedDataRows.push(row);
      }
    }
  }

  const vendorCounts = {};
  const dataRows = [];
  const catCounts = {};
  for (const c of SEARCH_CATEGORIES) catCounts[c] = 0;
  const vendorMeta = {};

  for (const vendor in preservedCounts) {
    if (!vendorCounts[vendor]) {
      vendorCounts[vendor] = {};
      for (const c of SEARCH_CATEGORIES) vendorCounts[vendor][c] = 0;
    }
    for (const cat in preservedCounts[vendor]) {
      vendorCounts[vendor][cat] = preservedCounts[vendor][cat];
      catCounts[cat] = (catCounts[cat] || 0) + preservedCounts[vendor][cat];
    }
  }
  for (const vendor in preservedMeta) vendorMeta[vendor] = preservedMeta[vendor];
  for (const row of preservedDataRows) dataRows.push(row);

  const skipSet = {};
  for (const c of (skipCats || [])) skipSet[c] = true;

  for (const cat in CONFIG) {
    if (skipSet[cat]) continue;
    if (SEARCH_CATEGORIES.indexOf(cat) === -1) continue;  // 검색 제외 카테고리는 인덱스에 적재하지 않음

    const cfg = CONFIG[cat];
    let ss;
    try {
      ss = openSpreadsheet(cfg);
    } catch (e) {
      Logger.log('스킵: ' + cat + ' - ' + e);
      continue;
    }

    for (const sheetName of cfg.sheets) {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) continue;

      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow <= cfg.headerRow) continue;

      const headers = sheet.getRange(cfg.headerRow, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
      const vIdx = headers.indexOf(cfg.vendorCol);
      const fIdx = cfg.vendorColFallback ? headers.indexOf(cfg.vendorColFallback) : -1;
      if (vIdx === -1 && fIdx === -1) continue;

      const data = sheet.getRange(cfg.headerRow + 1, 1, lastRow - cfg.headerRow, lastCol).getValues();

      for (const row of data) {
        let vendor = vIdx !== -1 ? String(row[vIdx] || '').trim() : '';
        if (!vendor && fIdx !== -1) vendor = String(row[fIdx] || '').trim();
        if (!vendor) continue;

        if (!vendorCounts[vendor]) {
          vendorCounts[vendor] = {};
          for (const c of SEARCH_CATEGORIES) vendorCounts[vendor][c] = 0;
        }
        vendorCounts[vendor][cat]++;
        catCounts[cat]++;

        const obj = {};
        for (const colName of cfg.displayCols) {
          const idx = headers.indexOf(colName);
          if (idx === -1) continue;
          let v = row[idx];
          if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
          obj[colName] = v;
        }
        if (cfg.sheets.length > 1) obj['_시트'] = sheetName;
        dataRows.push([vendor, cat, JSON.stringify(obj)]);

        const mf = cfg.metaFields;
        if (mf) {
          const dIdx = headers.indexOf(mf.date);
          const rIdx = mf.region ? headers.indexOf(mf.region) : -1;
          const dateStr = dIdx !== -1 ? safeDate(row[dIdx]) : '';
          const regionStr = rIdx !== -1 ? String(row[rIdx] || '').trim() : '';

          if (!vendorMeta[vendor]) vendorMeta[vendor] = {};
          const cur = vendorMeta[vendor][cat];
          if (!cur || (dateStr && dateStr > cur.d)) {
            vendorMeta[vendor][cat] = { d: dateStr, r: regionStr };
          }
        }
      }
    }
  }

  writeIndexSheets_(indexSs, vendorCounts, vendorMeta, dataRows, catCounts, startTime, isPartial ? 'partial' : 'full');

  const elapsed = (new Date() - startTime) / 1000;
  return {
    ok: true,
    vendors: Object.keys(vendorCounts).length,
    dataRows: dataRows.length,
    elapsed: elapsed,
    catCounts: catCounts
  };
}
