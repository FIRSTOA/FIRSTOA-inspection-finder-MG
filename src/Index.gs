/**
 * 통합층 → 인덱스층: 통합 탭을 읽어 _idx_vendors / _idx_data / _idx_meta 재생성.
 * 인덱스는 통합 탭에서 파생되는 검색 캐시이므로, 통합 탭이 단일 진실원천이다.
 */

// 전체 파이프라인: 시트 → 마스터 → 인덱스
function refreshAll() {
  const sync = syncAllToMaster();
  const index = rebuildIndex();
  return { sync: sync, index: index };
}

// 기본 인덱스 재생성은 통합 탭 기준
function rebuildIndex() {
  return rebuildIndexFromMaster();
}

function rebuildIndexFromMaster() {
  const startTime = new Date();
  const masterSs = SpreadsheetApp.openById(MASTER_SS_ID);
  const indexSs = SpreadsheetApp.openById(INDEX_SS_ID);

  const vendorCounts = {};
  const vendorMeta = {};
  const dataRows = [];
  const catCounts = {};
  for (const c of CATEGORIES) catCounts[c] = 0;

  for (const cat of CATEGORIES) {
    const cfg = CONFIG[cat];
    const tabName = MASTER_TABS[cat] || cat;
    const sheet = masterSs.getSheetByName(tabName);
    if (!sheet || sheet.getLastRow() < 2) continue;

    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    const vIdx = headers.indexOf('_업체명');
    if (vIdx === -1) continue;

    const dateField = (cfg.metaFields && cfg.metaFields.date) || '';
    const regionField = (cfg.metaFields && cfg.metaFields.region) || '';
    const dCol = dateField ? headers.indexOf(dateField) : -1;
    const rCol = regionField ? headers.indexOf(regionField) : -1;

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();

    for (const row of data) {
      const vendor = String(row[vIdx] || '').trim();
      if (!vendor) continue;

      if (!vendorCounts[vendor]) {
        vendorCounts[vendor] = {};
        for (const c of CATEGORIES) vendorCounts[vendor][c] = 0;
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
      dataRows.push([vendor, cat, JSON.stringify(obj)]);

      const dateStr = dCol !== -1 ? safeDate(row[dCol]) : '';
      const regionStr = rCol !== -1 ? String(row[rCol] || '').trim() : '';
      if (!vendorMeta[vendor]) vendorMeta[vendor] = {};
      const cur = vendorMeta[vendor][cat];
      if (!cur || (dateStr && dateStr > cur.d)) {
        vendorMeta[vendor][cat] = { d: dateStr, r: regionStr };
      }
    }
  }

  writeIndexSheets_(indexSs, vendorCounts, vendorMeta, dataRows, catCounts, startTime, 'master');

  const elapsed = (new Date() - startTime) / 1000;
  Logger.log('rebuildIndexFromMaster 완료 (' + elapsed + '초)');
  return {
    ok: true,
    vendors: Object.keys(vendorCounts).length,
    dataRows: dataRows.length,
    elapsed: elapsed,
    catCounts: catCounts
  };
}

function writeIndexSheets_(indexSs, vendorCounts, vendorMeta, dataRows, catCounts, startTime, type) {
  const vendors = Object.keys(vendorCounts).sort();

  let vSheet = indexSs.getSheetByName(INDEX_VENDORS);
  if (!vSheet) vSheet = indexSs.insertSheet(INDEX_VENDORS);
  vSheet.clear();

  const headerRow = ['vendor'].concat(CATEGORIES).concat(['meta']);
  vSheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);

  if (vendors.length > 0) {
    const rows = vendors.map(v => {
      const counts = vendorCounts[v];
      const r = [v];
      for (const c of CATEGORIES) r.push(counts[c] || 0);
      r.push(JSON.stringify(vendorMeta[v] || {}));
      return r;
    });
    vSheet.getRange(2, 1, rows.length, headerRow.length).setValues(rows);
    vSheet.getRange(2, headerRow.length, rows.length, 1).setNumberFormat('@');
  }

  let dSheet = indexSs.getSheetByName(INDEX_DATA);
  if (!dSheet) dSheet = indexSs.insertSheet(INDEX_DATA);
  dSheet.clear();
  dSheet.getRange(1, 1, 1, 3).setValues([['vendor', 'category', 'data']]);

  if (dataRows.length > 0) {
    const BATCH = 50000;
    for (let i = 0; i < dataRows.length; i += BATCH) {
      const slice = dataRows.slice(i, i + BATCH);
      dSheet.getRange(2 + i, 1, slice.length, 3).setValues(slice);
    }
  }

  let mSheet = indexSs.getSheetByName(INDEX_META);
  if (!mSheet) mSheet = indexSs.insertSheet(INDEX_META);
  mSheet.clear();

  const elapsed = (new Date() - startTime) / 1000;
  const metaRows = [
    ['lastUpdate', new Date().toISOString()],
    ['lastUpdateType', type],
    ['vendorCount', vendors.length],
    ['dataRowCount', dataRows.length],
    ['elapsedSec', elapsed]
  ];
  for (const c of CATEGORIES) metaRows.push(['count_' + c, catCounts[c] || 0]);
  mSheet.getRange(1, 1, metaRows.length, 2).setValues(metaRows);

  try {
    CacheService.getScriptCache().removeAll(['fast_search_v6_', 'fast_detail_v7_']);
  } catch (e) {}
}
