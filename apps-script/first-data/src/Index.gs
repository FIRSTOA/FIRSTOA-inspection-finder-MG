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
// 원격 복구용 — 한 실행에 묶으면 30분 한도를 넘겨서 두 단계로 분리, 결과는 Script Properties에 기록
function recordRun_(name, fn) {
  const p = PropertiesService.getScriptProperties();
  const started = new Date().toISOString();
  try {
    const out = fn();
    p.setProperty('run_' + name, JSON.stringify({ ok: true, started: started, ended: new Date().toISOString(), out: JSON.stringify(out).slice(0, 300) }));
    return out;
  } catch (e) {
    p.setProperty('run_' + name, JSON.stringify({ ok: false, started: started, ended: new Date().toISOString(), error: String(e).slice(0, 300) }));
    throw e;
  }
}
function bizInfoStep() { return recordRun_('bizInfoStep', function () { return syncCategoryToMaster('업체정보'); }); }
function indexStep() { return recordRun_('indexStep', function () { return rebuildIndex(); }); }
// (구) 한 방에 처리 — 타임아웃 이력 있어 사용하지 않음
function syncBizThenIndex() {
  const sync = { 업체정보: syncCategoryToMaster('업체정보') };
  const index = rebuildIndex();
  return { sync: sync, index: index };
}
// 매일 인덱스 재생성 트리거 보장 (없으면 오전 6시로 추가) — admin 액션에서 호출
function ensureIndexTrigger_() {
  // 일일 재생성도 조각 체인(indexChunkStart)으로 — 통짜 실행(refreshIndexOnly)은 타임아웃 이력
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'refreshIndexOnly') ScriptApp.deleteTrigger(t);
  }
  const exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'indexChunkStart'; });
  if (!exists) ScriptApp.newTrigger('indexChunkStart').timeBased().everyDays(1).atHour(6).create();
  return { ensured: true, existed: exists };
}

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

// ══ 조각 실행 인덱스 재생성 ══════════════════════════════════════════════
// 마스터가 커져(업체정보 2.2만행 정상화 후) 한 실행짜리 rebuildIndex가 스프레드시트
// 서비스 타임아웃으로 죽는다 → 한 실행이 "최대 4분/8천행"만 처리하고 다음 조각을
// 1회성 트리거로 예약하는 체인으로 전환. 집계는 _idx_tmp_counts 탭에 카테고리별로
// 쌓았다가 마지막 조각에서 병합해 _idx_vendors/_idx_meta를 쓴다.
var IDX_CHUNK_ROWS = 8000;
var IDX_TMP_TAB = '_idx_tmp_counts';

function indexChunkStart() {
  const p = PropertiesService.getScriptProperties();
  p.setProperty('idx_cursor', JSON.stringify({ cat: 0, offset: 0, started: new Date().toISOString() }));
  const ss = SpreadsheetApp.openById(INDEX_SS_ID);
  let d = ss.getSheetByName(INDEX_DATA); if (!d) d = ss.insertSheet(INDEX_DATA);
  d.clear(); d.getRange(1, 1, 1, 3).setValues([['vendor', 'category', 'data']]);
  let t = ss.getSheetByName(IDX_TMP_TAB); if (!t) t = ss.insertSheet(IDX_TMP_TAB);
  t.clear(); t.getRange(1, 1, 1, 4).setValues([['vendor', 'category', 'count', 'meta']]);
  scheduleIndexChunk_();
  return { ok: true, started: true };
}

function scheduleIndexChunk_() {
  ScriptApp.newTrigger('indexChunkStep').timeBased().after(1000).create();
}

function indexChunkStep() {
  return recordRun_('indexChunk', indexChunkStep_);
}

function indexChunkStep_() {
  for (const tr of ScriptApp.getProjectTriggers()) {
    if (tr.getHandlerFunction() === 'indexChunkStep') ScriptApp.deleteTrigger(tr);
  }
  const p = PropertiesService.getScriptProperties();
  const cur = JSON.parse(p.getProperty('idx_cursor') || 'null');
  if (!cur) return { done: false, error: 'idx_cursor 없음 — indexChunkStart부터 실행' };
  const master = SpreadsheetApp.openById(MASTER_SS_ID);
  const idxSs = SpreadsheetApp.openById(INDEX_SS_ID);
  const dSheet = idxSs.getSheetByName(INDEX_DATA);
  const tSheet = idxSs.getSheetByName(IDX_TMP_TAB);
  const deadline = Date.now() + 4 * 60 * 1000; // 서비스 타임아웃 전에 스스로 끊는다
  let processed = 0;

  while (cur.cat < SEARCH_CATEGORIES.length && Date.now() < deadline) {
    const cat = SEARCH_CATEGORIES[cur.cat];
    const cfg = CONFIG[cat];
    const tabName = MASTER_TABS[cat] || cat;
    const sheet = master.getSheetByName(tabName);
    const lastRow = sheet ? sheet.getLastRow() : 0;
    if (!sheet || lastRow < 2 || cur.offset >= lastRow - 1) { cur.cat++; cur.offset = 0; continue; }

    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    const vIdx = headers.indexOf('_업체명');
    if (vIdx === -1) { cur.cat++; cur.offset = 0; continue; }
    const dateField = (cfg.metaFields && cfg.metaFields.date) || '';
    const regionField = (cfg.metaFields && cfg.metaFields.region) || '';
    const dCol = dateField ? headers.indexOf(dateField) : -1;
    const rCol = regionField ? headers.indexOf(regionField) : -1;
    const isInsp = (cat === '점검' || cat === 'AS');
    const mCol = isInsp ? headers.indexOf('모델명') : -1;
    const aCol = isInsp ? headers.indexOf('작성자') : -1;
    const wCol = isInsp ? headers.indexOf('_원문') : -1;
    const dispIdx = cfg.displayCols.map(function (c) { return headers.indexOf(c); });

    const take = Math.min(IDX_CHUNK_ROWS, lastRow - 1 - cur.offset);
    const data = sheet.getRange(2 + cur.offset, 1, take, lastCol).getValues();
    const outData = [];
    const counts = {};
    const metas = {};
    for (const row of data) {
      const vendor = String(row[vIdx] || '').trim();
      if (!vendor) continue;
      counts[vendor] = (counts[vendor] || 0) + 1;
      const obj = {};
      for (let ci = 0; ci < cfg.displayCols.length; ci++) {
        const idx = dispIdx[ci];
        if (idx === -1) continue;
        let v = row[idx];
        if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
        obj[cfg.displayCols[ci]] = v;
      }
      outData.push([vendor, cat, JSON.stringify(obj)]);
      const dateStr = dCol !== -1 ? safeDate(row[dCol]) : '';
      const curM = metas[vendor];
      if (!curM || (dateStr && dateStr > (curM.d || ''))) {
        const meta = { d: dateStr, r: rCol !== -1 ? String(row[rCol] || '').trim() : '' };
        if (isInsp) {
          meta.model = mCol !== -1 ? String(row[mCol] || '').trim() : '';
          meta.author = aCol !== -1 ? String(row[aCol] || '').trim() : '';
          const won = wCol !== -1 ? String(row[wCol] || '') : '';
          const cnt = (won.match(/모델명/g) || []).length;
          meta.count = cnt > 0 ? cnt : 1;
        }
        metas[vendor] = meta;
      }
    }
    if (outData.length) dSheet.getRange(dSheet.getLastRow() + 1, 1, outData.length, 3).setValues(outData);
    const tmpRows = Object.keys(counts).map(function (v) { return [v, cat, counts[v], JSON.stringify(metas[v] || null)]; });
    if (tmpRows.length) tSheet.getRange(tSheet.getLastRow() + 1, 1, tmpRows.length, 4).setValues(tmpRows);
    cur.offset += take;
    processed += take;
  }

  p.setProperty('idx_cursor', JSON.stringify(cur));
  if (cur.cat < SEARCH_CATEGORIES.length) {
    scheduleIndexChunk_();
    return { progress: { cat: SEARCH_CATEGORIES[cur.cat], offset: cur.offset, processedThisRun: processed } };
  }
  const summary = finalizeIndexFromTmp_(idxSs);
  p.deleteProperty('idx_cursor');
  return { done: true, summary: summary };
}

function finalizeIndexFromTmp_(idxSs) {
  const tSheet = idxSs.getSheetByName(IDX_TMP_TAB);
  const n = tSheet.getLastRow();
  const rows = n > 1 ? tSheet.getRange(2, 1, n - 1, 4).getValues() : [];
  const vendorCounts = {};
  const vendorMeta = {};
  const catCounts = {};
  for (const c of SEARCH_CATEGORIES) catCounts[c] = 0;
  for (const r of rows) {
    const vendor = String(r[0] || '');
    const cat = String(r[1] || '');
    const count = Number(r[2]) || 0;
    if (!vendor || !cat) continue;
    if (!vendorCounts[vendor]) { vendorCounts[vendor] = {}; for (const c of SEARCH_CATEGORIES) vendorCounts[vendor][c] = 0; }
    vendorCounts[vendor][cat] += count;
    catCounts[cat] = (catCounts[cat] || 0) + count;
    let meta = null;
    try { meta = JSON.parse(String(r[3] || 'null')); } catch (e) { meta = null; }
    if (meta) {
      if (!vendorMeta[vendor]) vendorMeta[vendor] = {};
      const curM = vendorMeta[vendor][cat];
      if (!curM || ((meta.d || '') > (curM.d || ''))) vendorMeta[vendor][cat] = meta;
    }
  }
  const vendors = Object.keys(vendorCounts).sort();
  let vSheet = idxSs.getSheetByName(INDEX_VENDORS);
  if (!vSheet) vSheet = idxSs.insertSheet(INDEX_VENDORS);
  vSheet.clear();
  const headerRow = ['vendor'].concat(SEARCH_CATEGORIES).concat(['meta']);
  vSheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
  if (vendors.length) {
    const out = vendors.map(function (v) {
      const r = [v];
      for (const c of SEARCH_CATEGORIES) r.push(vendorCounts[v][c] || 0);
      r.push(JSON.stringify(vendorMeta[v] || {}));
      return r;
    });
    vSheet.getRange(2, 1, out.length, headerRow.length).setValues(out);
    vSheet.getRange(2, headerRow.length, out.length, 1).setNumberFormat('@');
  }
  let mSheet = idxSs.getSheetByName(INDEX_META);
  if (!mSheet) mSheet = idxSs.insertSheet(INDEX_META);
  mSheet.clear();
  const dataCount = Math.max(0, idxSs.getSheetByName(INDEX_DATA).getLastRow() - 1);
  const metaRows = [
    ['lastUpdate', new Date().toISOString()],
    ['lastUpdateType', 'master-chunked'],
    ['vendorCount', vendors.length],
    ['dataRowCount', dataCount],
    ['elapsedSec', 0]
  ];
  for (const c of SEARCH_CATEGORIES) metaRows.push(['count_' + c, catCounts[c] || 0]);
  mSheet.getRange(1, 1, metaRows.length, 2).setValues(metaRows);
  try {
    const c = CacheService.getScriptCache();
    const keys = ['vidx_n_v1'];
    const nn = Number(c.get('vidx_n_v1') || 0);
    for (let i = 0; i < nn; i++) keys.push('vidx_v1_' + i);
    c.removeAll(keys);
  } catch (e) {}
  return { vendors: vendors.length, dataRows: dataCount };
}
