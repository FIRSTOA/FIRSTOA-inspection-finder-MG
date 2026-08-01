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

// ── 분리 트리거용: 한 실행에 한 가지 일만 해서 30분 한도를 넘지 않게 한다 ──
// (refreshLease/refreshDaily는 한 번에 동기화+인덱스를 다 해 대용량에서 타임아웃 → 아래로 쪼갬)
function syncBizInfoOnly() { return { 업체정보: syncCategoryToMaster('업체정보') }; }       // 21k행
function syncLeaseStatusOnly() { return { 임대현황표: syncCategoryToMaster('임대현황표') }; } // 27k행
function syncNonLeaseOnly() { return syncAllToMaster(LEASE_CATEGORIES); }                  // 임대 제외 전체(가벼움)
function refreshIndexOnly() { return rebuildIndex(); }                                      // 인덱스만 단독

// [진단] 불만 원본시트 헤더 덤프 — Supabase displayCols 정합용. 실행 후 로그 확인.
function _dumpBulmanHeaders() {
  var cfg = CONFIG['불만'];
  var ss = SpreadsheetApp.openById(cfg.ssId);
  var sh = ss.getSheetByName(cfg.sheets[0]);
  if (!sh) { Logger.log('시트 없음: ' + cfg.sheets[0]); return; }
  var hdr = sh.getRange(cfg.headerRow, 1, 1, sh.getLastColumn()).getValues()[0];
  var clean = hdr.map(function (h) { return String(h == null ? '' : h).replace(/\s+/g, ' ').trim(); }).filter(String);
  Logger.log('불만 시트 헤더(' + clean.length + '개): ' + JSON.stringify(clean));
  Logger.log('데이터 행수: ' + (sh.getLastRow() - cfg.headerRow));
}

// [1회 실행] 검색 인덱스(_idx_*) 은퇴: 검색이 Supabase RPC로 이전됐으므로 더 이상 불필요.
//   - refreshIndexOnly(6시)·warmVendorIndexCache(4시간) 트리거 제거
//   - _idx_vendors/_idx_data/_idx_meta 탭 삭제
//   ※ 적재(통합탭+Supabase 미러/증분)·미러 동기화(0/2/4시)는 그대로 유지 — 영향 없음.
function retireSearchIndex() {
  var removed = [];
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'refreshIndexOnly' || fn === 'warmVendorIndexCache') {
      ScriptApp.deleteTrigger(triggers[i]); removed.push(fn);
    }
  }
  var ss = SpreadsheetApp.openById(INDEX_SS_ID);
  var deleted = [];
  [INDEX_VENDORS, INDEX_DATA, INDEX_META].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh) { ss.deleteSheet(sh); deleted.push(name); }
  });
  var msg = '트리거 제거: ' + (removed.join(', ') || '없음') + ' / 탭 삭제: ' + (deleted.join(', ') || '없음');
  Logger.log(msg);
  return { ok: true, removedTriggers: removed, deletedTabs: deleted, msg: msg };
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
    const c = CacheService.getScriptCache();
    const keys = ['vidx_n_v1'];
    const n = Number(c.get('vidx_n_v1') || 0);
    for (let i = 0; i < n; i++) keys.push('vidx_v1_' + i);
    c.removeAll(keys);
  } catch (e) {}
}
