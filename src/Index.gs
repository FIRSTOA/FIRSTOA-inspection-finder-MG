/**
 * 통합층 → 인덱스층: 통합 탭을 읽어 _idx_vendors / _idx_data / _idx_meta 재생성.
 * 인덱스는 통합 탭에서 파생되는 검색 캐시이므로, 통합 탭이 단일 진실원천이다.
 */

// 전체 파이프라인: 시트 → 마스터 → 인덱스 (수동 전체 실행용)
function refreshAll() {
  const sync = syncAllToMaster();
  const index = rebuildIndex();
  return { sync: sync, index: index };
}

// 매일 자동: 대용량 임대 시트는 건너뛰고 동기화 후 인덱스 재생성
// (임대 데이터는 마스터에 남아 있어 검색에는 계속 포함됨)
function refreshDaily() {
  const sync = syncAllToMaster(LEASE_CATEGORIES);
  const index = rebuildIndex();
  return { sync: sync, index: index };
}

// 주 1회(월요일) 자동: 임대리스트·임대현황표만 원본 재동기화 후 인덱스 재생성
function refreshLease() {
  const sync = {};
  for (const cat of LEASE_CATEGORIES) sync[cat] = syncCategoryToMaster(cat);
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
  for (const c of SEARCH_CATEGORIES) catCounts[c] = 0;

  for (const cat of SEARCH_CATEGORIES) {
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

    // 점검/AS는 검색 후보에 기종·작성자·댓수(_원문 모델명 수)도 노출하므로 meta에 추가 캡처
    const isInsp = (cat === '점검' || cat === 'AS');
    const mCol = isInsp ? headers.indexOf('모델명') : -1;
    const aCol = isInsp ? headers.indexOf('작성자') : -1;
    const wCol = isInsp ? headers.indexOf('_원문') : -1;

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();

    for (const row of data) {
      const vendor = String(row[vIdx] || '').trim();
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
      dataRows.push([vendor, cat, JSON.stringify(obj)]);

      const dateStr = dCol !== -1 ? safeDate(row[dCol]) : '';
      const regionStr = rCol !== -1 ? String(row[rCol] || '').trim() : '';
      if (!vendorMeta[vendor]) vendorMeta[vendor] = {};
      const cur = vendorMeta[vendor][cat];
      if (!cur || (dateStr && dateStr > cur.d)) {
        const meta = { d: dateStr, r: regionStr };
        if (isInsp) {
          meta.model = mCol !== -1 ? String(row[mCol] || '').trim() : '';
          meta.author = aCol !== -1 ? String(row[aCol] || '').trim() : '';
          const won = wCol !== -1 ? String(row[wCol] || '') : '';
          const cnt = (won.match(/모델명/g) || []).length;
          meta.count = cnt > 0 ? cnt : 1;
        }
        vendorMeta[vendor][cat] = meta;
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

  const headerRow = ['vendor'].concat(SEARCH_CATEGORIES).concat(['meta']);
  vSheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);

  if (vendors.length > 0) {
    const rows = vendors.map(v => {
      const counts = vendorCounts[v];
      const r = [v];
      for (const c of SEARCH_CATEGORIES) r.push(counts[c] || 0);
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
  for (const c of SEARCH_CATEGORIES) metaRows.push(['count_' + c, catCounts[c] || 0]);
  mSheet.getRange(1, 1, metaRows.length, 2).setValues(metaRows);

  try {
    CacheService.getScriptCache().removeAll(['fast_search_v6_', 'fast_detail_v7_']);
  } catch (e) {}
}
