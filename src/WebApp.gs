/**
 * 웹앱 진입점 - 인덱스(_idx_*)에서 검색/상세조회만 담당.
 * 출력 포맷은 기존 v10과 동일 (프론트엔드 호환).
 */

function doGet(e) {
  const action0 = (e.parameter.action || 'console').toLowerCase();

  // 관리 콘솔 (메인 화면)
  if (action0 === 'console') {
    return HtmlService.createHtmlOutputFromFile('Console')
      .setTitle('퍼스트전산 통합 DB')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // 카톡 TXT 업로드 화면 (HTML)
  if (action0 === 'upload') {
    return HtmlService.createHtmlOutputFromFile('Upload')
      .setTitle('카톡 TXT 업로드')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  let result;
  try {
    const action = action0;
    const q = (e.parameter.q || '').trim();

    if (action === 'search') result = searchVendorsFromIndex(q);
    else if (action === 'detail') result = getVendorDetailFromIndex(q);
    else if (action === 'ping') result = { ok: true, time: new Date().toISOString(), indexInfo: getIndexMeta() };
    else result = { error: 'Invalid action: ' + action };
  } catch (err) {
    result = { error: err.toString(), stack: err.stack };
  }

  const json = JSON.stringify(result);
  const callback = e.parameter.callback;
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// 업로드 화면용: 지원 카톡방 유형 목록 (AS는 전용 양식 파서로 별도 처리)
function getKakaoRoomTypes() {
  const list = Object.keys(KAKAO_SOURCES).map(k => ({ type: k, mode: KAKAO_SOURCES[k].mode }));
  list.unshift({ type: '점검', mode: 'inspectform' });
  list.unshift({ type: 'AS', mode: 'asform' });
  return list;
}

// 관리 콘솔용 데이터: 마스터 링크 + 카테고리별 원본/통합 링크·건수 + 카톡방 목록
function getConsoleData() {
  const masterSs = SpreadsheetApp.openById(MASTER_SS_ID);
  const masterUrl = 'https://docs.google.com/spreadsheets/d/' + MASTER_SS_ID + '/edit';
  const meta = getIndexMeta();

  // 카톡 입력을 받는 카테고리 집합 (AI 방 + 양식 방 AS·점검)
  const kakaoCats = {};
  for (const k in KAKAO_SOURCES) kakaoCats[KAKAO_SOURCES[k].category] = true;
  kakaoCats['AS'] = true;
  kakaoCats['점검'] = true;

  const categories = CATEGORIES.map(function (cat) {
    const cfg = CONFIG[cat] || {};
    const tabName = MASTER_TABS[cat] || cat;
    const tab = masterSs.getSheetByName(tabName);
    const tabUrl = tab ? masterUrl + '#gid=' + tab.getSheetId() : '';

    let srcUrl = '';
    if (!cfg.kakaoOnly) {
      try { srcUrl = 'https://docs.google.com/spreadsheets/d/' + resolveSsId(cfg) + '/edit'; } catch (e) {}
    }

    let sheets = [];
    if (cfg.sheets && cfg.sheets.length) sheets = cfg.sheets.slice();
    else if (cfg.gid != null) sheets = ['gid=' + cfg.gid];

    // 건수: 검색 인덱스 카운트(count_*)가 우선. 검색 제외 카테고리(임대현황표·해지방어·경영지원)는
    // 인덱스에 없으므로 통합 탭 행수(헤더 1행 제외)로 대체해 데이터 통합 웹앱에 그대로 보이게 한다.
    let count = Number(meta['count_' + cat] || 0);
    if (!count && tab && tab.getLastRow() > 1) count = tab.getLastRow() - 1;

    return {
      cat: cat,
      kakaoOnly: !!cfg.kakaoOnly,
      hasKakao: !!kakaoCats[cat],   // 카톡으로 데이터가 들어오는가
      hasSheet: !cfg.kakaoOnly,     // 원본 시트가 있는가
      tabName: tabName,
      tabUrl: tabUrl,
      count: count,
      srcUrl: srcUrl,
      sheets: sheets
    };
  });

  return {
    master: { name: masterSs.getName(), url: masterUrl },
    categories: categories,
    kakaoTypes: getKakaoRoomTypes(),
    user: (function () { try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; } })()
  };
}

// 업로드 화면에서 호출 (google.script.run). TXT 내용을 받아 적재.
function ingestKakaoUpload(roomType, teamLabel, content) {
  try {
    if (!content || !String(content).trim()) return { ok: false, error: '파일 내용이 비어있습니다.' };
    return ingestKakaoTxt(roomType, String(content), teamLabel || '');
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

function searchVendorsFromIndex(query) {
  if (!query || query.length < 1) return { results: [], total: 0 };

  const cache = CacheService.getScriptCache();
  const cacheKey = 'fast_search_v6_' + query;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const ss = SpreadsheetApp.openById(INDEX_SS_ID);
  const sheet = ss.getSheetByName(INDEX_VENDORS);
  if (!sheet || sheet.getLastRow() < 2) {
    return { results: [], total: 0, error: '인덱스 미생성. rebuildIndex 실행 필요' };
  }

  const lastRow = sheet.getLastRow();
  const totalCols = 1 + SEARCH_CATEGORIES.length + 1;
  const data = sheet.getRange(2, 1, lastRow - 1, totalCols).getValues();
  const lowerQ = query.toLowerCase();

  const matched = [];
  for (let i = 0; i < data.length; i++) {
    const v = String(data[i][0] || '');
    if (v.toLowerCase().indexOf(lowerQ) !== -1) {
      let meta = {};
      try { meta = JSON.parse(String(data[i][totalCols - 1] || '{}')); } catch (e) { meta = {}; }

      const counts = {};
      for (let c = 0; c < SEARCH_CATEGORIES.length; c++) {
        counts[SEARCH_CATEGORIES[c]] = Number(data[i][1 + c]) || 0;
      }

      matched.push({ vendor: v, counts: counts, meta: meta });
      if (matched.length >= 50) break;
    }
  }

  matched.sort((a, b) => a.vendor.localeCompare(b.vendor));
  const response = { results: matched, total: matched.length };
  cache.put(cacheKey, JSON.stringify(response), CACHE_DURATION_SEC);
  return response;
}

function getVendorDetailFromIndex(vendorName) {
  if (!vendorName) return { error: 'vendor required' };

  const cache = CacheService.getScriptCache();
  const cacheKey = 'fast_detail_v7_' + vendorName.substring(0, 200);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const ss = SpreadsheetApp.openById(INDEX_SS_ID);
  const sheet = ss.getSheetByName(INDEX_DATA);
  if (!sheet || sheet.getLastRow() < 2) {
    return { error: '인덱스 미생성. rebuildIndex 실행 필요' };
  }

  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();

  const result = { vendor: vendorName };
  for (const cat in CONFIG) result[cat] = [];

  for (const row of data) {
    if (String(row[0]).trim() !== vendorName) continue;
    const cat = String(row[1]);
    if (!result[cat]) continue;
    try {
      result[cat].push(JSON.parse(row[2]));
    } catch (e) {}
  }

  const sortByDate = {
    'AS': 'AS날짜',
    '점검': '작성일',
    '초과': '날짜',
    '불만': '날짜',
    '미수': '입력일',
    'PC확장성': '날짜',
    '복합기확장성': '등록일',
    '업체정보': '종료일'
  };

  for (const cat in sortByDate) {
    if (result[cat] && result[cat].length > 1) {
      const dKey = sortByDate[cat];
      result[cat].sort((a, b) => String(b[dKey] || '').localeCompare(String(a[dKey] || '')));
    }
  }

  try { cache.put(cacheKey, JSON.stringify(result), CACHE_DURATION_SEC); } catch (e) {}
  return result;
}

function getIndexMeta() {
  try {
    const ss = SpreadsheetApp.openById(INDEX_SS_ID);
    const sheet = ss.getSheetByName(INDEX_META);
    if (!sheet) return { built: false };

    const lastRow = sheet.getLastRow();
    if (lastRow < 1) return { built: false };

    const data = sheet.getRange(1, 1, lastRow, 2).getValues();
    const meta = {};
    for (const row of data) {
      if (row[0]) meta[row[0]] = row[1];
    }
    return meta;
  } catch (e) {
    return { error: e.toString() };
  }
}
