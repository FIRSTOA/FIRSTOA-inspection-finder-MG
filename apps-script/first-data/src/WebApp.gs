/**
 * 웹앱 진입점 - 인덱스(_idx_*)에서 검색/상세조회만 담당.
 * 출력 포맷은 기존 v10과 동일 (프론트엔드 호환).
 */

function doGet(e) {
  const action0 = (e.parameter.action || 'console').toLowerCase();

  // 메신저봇 polling: 웹앱 보내기로 적재된 양식을 카톡방에 게시하기 위해 가져감
  if (action0 === 'pull') return webappPullKakao_(e);
  if (action0 === 'ack') return webappAck_(e);   // 봇이 전송 성공한 id 통보 → 큐에서 삭제

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
    else if (action === 'inspforms') result = getInspectionFormsByVendor(q);
    else if (action === 'ping') result = { ok: true, time: new Date().toISOString(), indexInfo: getIndexMeta() };
    else result = { error: 'Invalid action: ' + action };
  } catch (err) {
    result = { error: err.toString() };
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

// 사진 → 양식 변환 (inspection-finder 프론트가 base64 이미지를 POST). CORS: 단순요청(text/plain)로 호출.
function doPost(e) {
  var result;
  try {
    var data = {};
    try { data = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { data = {}; }
    var action = String(data.action || '').toLowerCase();
    if (action === 'vision') result = visionExtractForm(data.image, data.kind || 'inspection');
    else if (action === 'save') result = webappSaveInspection_(data);
    else result = { error: 'Invalid POST action: ' + action };
  } catch (err) {
    result = { error: err.toString() };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
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

// ── 원본 시트 연동 상태 점검 (원본DB/홈 화면용). 무거우니 10분 캐시. ──
// 각 비(非)카톡전용 카테고리의 원본 스프레드시트를 실제로 열어보고, 설정된 탭이 있는지 확인한다.
function getConnectionStatus() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('conn_status_v2');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }

  const cats = {};
  CATEGORIES.forEach(function (cat) {
    const cfg = CONFIG[cat] || {};
    if (cfg.kakaoOnly || (!cfg.ssId && !cfg.ssNameLatest)) { cats[cat] = { status: 'kakao' }; return; }
    try {
      const src = openSpreadsheet(cfg);
      let okTab = true, missing = [];
      if (cfg.sheets && cfg.sheets.length) {
        missing = cfg.sheets.filter(function (nm) { return !src.getSheetByName(nm); });
        okTab = missing.length < cfg.sheets.length;   // 하나라도 있으면 연동으로 본다
      } else if (cfg.gid != null) {
        okTab = src.getSheets().some(function (s) { return s.getSheetId() === cfg.gid; });
        if (!okTab) missing = ['gid=' + cfg.gid];
      }
      if (okTab) cats[cat] = { status: 'connected', name: src.getName(), missing: missing };
      else cats[cat] = { status: 'broken', error: '대상 탭 없음: ' + missing.join(', ') };
    } catch (e) {
      cats[cat] = { status: 'broken', error: String(e).slice(0, 160) };
    }
  });

  const res = { checkedAt: new Date().toISOString(), cats: cats };
  try { cache.put('conn_status_v2', JSON.stringify(res), 600); } catch (e) {}
  return res;
}

// ── 업로드 이력 로그 (누가/언제/무엇을/몇 건 올렸는지 — 중복 작업 방지) ──
const UPLOAD_LOG_TAB = '_upload_log';

function logUpload(entry) {
  try {
    entry = entry || {};
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    let sh = ss.getSheetByName(UPLOAD_LOG_TAB);
    if (!sh) {
      sh = ss.insertSheet(UPLOAD_LOG_TAB); sh.hideSheet();
      sh.getRange(1, 1, 1, 9).setValues([['시각', '카테고리', '지역', '방이름', '추출', '추가', '중복', '상태', '올린사람']]);
    }
    let who = '';
    try { who = Session.getActiveUser().getEmail() || ''; } catch (e) {}
    sh.appendRow([
      new Date(), String(entry.category || ''), String(entry.team || ''), String(entry.roomName || ''),
      Number(entry.parsed || 0), Number(entry.added || 0), Number(entry.skipped || 0),
      String(entry.status || ''), who
    ]);
    return { ok: true };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

function getUploadLog(limit) {
  try {
    limit = Number(limit || 40);
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    const sh = ss.getSheetByName(UPLOAD_LOG_TAB);
    if (!sh || sh.getLastRow() < 2) return { ok: true, rows: [] };
    const last = sh.getLastRow();
    const start = Math.max(2, last - limit + 1);
    const data = sh.getRange(start, 1, last - start + 1, 9).getValues();
    const rows = data.map(function (r) {
      return {
        time: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
        category: String(r[1] || ''), team: String(r[2] || ''), roomName: String(r[3] || ''),
        parsed: Number(r[4] || 0), added: Number(r[5] || 0), skipped: Number(r[6] || 0),
        status: String(r[7] || ''), who: String(r[8] || '')
      };
    }).reverse();   // 최신순
    return { ok: true, rows: rows };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

// ── 카톡 방 이름 → (카테고리, 지역) 매핑표. 일괄 자동 업로드의 라우팅 기준. ──
// 방 이름이 바뀌거나 새 방이 생기면 _room_map 숨김시트에 한 줄 추가/수정하면 된다.
const ROOM_MAP_TAB = '_room_map';
const ROOM_MAP_SEED = [
  ['강북A as', 'AS', 'A'], ['강서B as', 'AS', 'B'], ['강남C as', 'AS', 'C'], ['경기D as', 'AS', 'D'],
  ['강북A 점검방', '점검', 'A'], ['강서B 점검방', '점검', 'B'], ['강남C 점검방', '점검', 'C'], ['경기D 점검방', '점검', 'D'],
  ['신)CD불만고객방', '불만', 'CD'],
  ['강서B 미수 보증금미입금 보고방', '미수', 'B'], ['강남C 미수 보증금 보고방', '미수', 'C'],
  ['강북A/초과사용 계약종료체크', '재계약', 'A'], ['강서B/초과사용 계약종료체크', '재계약', 'B'],
  ['강남C/초과사용 계약종료체크', '재계약', 'C'], ['경기D/초과사용 계약종료체크', '재계약', 'D']
];

function ensureRoomMap_() {
  const ss = SpreadsheetApp.openById(MASTER_SS_ID);
  let sh = ss.getSheetByName(ROOM_MAP_TAB);
  if (!sh) {
    sh = ss.insertSheet(ROOM_MAP_TAB); sh.hideSheet();
    sh.getRange(1, 1, 1, 3).setValues([['방이름', '카테고리', '지역']]);
    sh.getRange(2, 1, ROOM_MAP_SEED.length, 3).setValues(ROOM_MAP_SEED);
  }
  return sh;
}

function getRoomMap() {
  try {
    const sh = ensureRoomMap_();
    const last = sh.getLastRow();
    if (last < 2) return { ok: true, rows: [] };
    const data = sh.getRange(2, 1, last - 1, 3).getValues();
    const rows = data.filter(function (r) { return String(r[0] || '').trim(); })
      .map(function (r) { return { roomName: String(r[0]).trim(), category: String(r[1]).trim(), team: String(r[2]).trim() }; });
    return { ok: true, rows: rows };
  } catch (err) { return { ok: false, error: err.toString() }; }
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

// ── 대용량 업로드 청크 처리 ──────────────────────────────────────────────
// google.script.run은 인자 전체를 한 번에 POST하므로 큰 TXT는 게이트웨이가 HTTP 413으로
// 거부한다. 클라이언트가 파일을 청크로 쪼개 _upload_tmp에 적재한 뒤, 서버에서 조립해
// 기존 모드별 적재 함수로 넘긴다. 청크 셀 앞뒤에 '!' 센티넬을 붙인다: 앞 센티넬은 '='로
// 시작하는 청크가 수식으로 해석되는 것을 막고, 뒤 센티넬은 시트가 셀 끝 줄바꿈·공백을
// 잘라내 경계가 어긋나는 것을 막는다. 읽을 때 양 끝 한 글자씩 떼어내 원본을 정확히 복원한다.
const UPLOAD_STASH_TAB = '_upload_tmp';

function uploadStashBegin() {
  try {
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    let sh = ss.getSheetByName(UPLOAD_STASH_TAB);
    if (!sh) { sh = ss.insertSheet(UPLOAD_STASH_TAB); sh.hideSheet(); }
    sh.clearContents();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

function uploadStashChunk(index, chunk) {
  try {
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    let sh = ss.getSheetByName(UPLOAD_STASH_TAB);
    if (!sh) { sh = ss.insertSheet(UPLOAD_STASH_TAB); sh.hideSheet(); }
    sh.appendRow([Number(index), '!' + String(chunk) + '!']);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

function readStashedUpload_() {
  const ss = SpreadsheetApp.openById(MASTER_SS_ID);
  const sh = ss.getSheetByName(UPLOAD_STASH_TAB);
  if (!sh || sh.getLastRow() < 1) return '';
  const data = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  return data
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(r => String(r[1]).slice(1, -1))   // 앞뒤 '!' 센티넬 제거
    .join('');
}

// 레거시 업로드 화면(action=upload)용: 청크 조립 후 ingestKakaoTxt로 적재.
function ingestKakaoUploadStashed(roomType, teamLabel) {
  try {
    const content = readStashedUpload_();
    if (!content || !content.trim()) return { ok: false, error: '업로드 내용이 비어있습니다.' };
    return ingestKakaoTxt(roomType, content, teamLabel || '');
  } catch (err) {
    return { ok: false, error: err.toString() };
  } finally {
    try {
      const ss = SpreadsheetApp.openById(MASTER_SS_ID);
      const sh = ss.getSheetByName(UPLOAD_STASH_TAB);
      if (sh) sh.clearContents();
    } catch (e) {}
  }
}

// 청크 조립 후 모드별 적재 함수로 디스패치. mode: 'asform' | 'inspectform' | 그 외(AI)
function ingestStashedUpload(mode, area, team) {
  try {
    const content = readStashedUpload_();
    if (!content || !content.trim()) return { ok: false, error: '업로드 내용이 비어있습니다.' };
    if (mode === 'asform') return ingestASFormsUpload(content, team || '');
    if (mode === 'inspectform') return ingestInspectFormsUpload(content, team || '');
    return kakaoEnqueue(area, team || '', content);
  } catch (err) {
    return { ok: false, error: err.toString() };
  } finally {
    try {
      const ss = SpreadsheetApp.openById(MASTER_SS_ID);
      const sh = ss.getSheetByName(UPLOAD_STASH_TAB);
      if (sh) sh.clearContents();
    } catch (e) {}
  }
}

// ── 증분 업로드 커서 (양식 모드 전용): 방별로 "마지막으로 처리한 끝부분"을 앵커로 기억 ──
// key = area|team|mode. anchor = 지난번 처리한 텍스트의 마지막 N글자.
// 카톡 내보내기는 맨 위 "저장한 날짜" 줄이 매번 바뀌므로 앞부분 비교는 못 쓴다.
// 대신 끝부분 앵커를 새 파일에서 찾아(lastIndexOf) 그 뒤만 보내게 한다(append-only 가정).
// 못 찾으면(다른 내보내기 등) 클라이언트가 전체 재전송. 중복은 _dupKey가 받쳐준다.
const UPLOAD_CURSOR_TAB = '_upload_cursor';

function getUploadCursor(key) {
  try {
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    const sh = ss.getSheetByName(UPLOAD_CURSOR_TAB);
    if (!sh || sh.getLastRow() < 2) return { ok: true, anchor: '' };
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for (const r of data) {
      if (String(r[0]) === String(key)) {
        let a = String(r[1] || '');
        if (a.charAt(0) === '!') a = a.slice(1);   // 저장 시 붙인 센티넬 제거 → 원본 앵커 복원
        return { ok: true, anchor: a };
      }
    }
    return { ok: true, anchor: '' };
  } catch (err) { return { ok: false, error: err.toString(), anchor: '' }; }
}

function setUploadCursor(key, anchor) {
  try {
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    let sh = ss.getSheetByName(UPLOAD_CURSOR_TAB);
    if (!sh) {
      sh = ss.insertSheet(UPLOAD_CURSOR_TAB); sh.hideSheet();
      sh.getRange(1, 1, 1, 2).setValues([['key', 'anchor']]);
    }
    // 앞에 '!' 센티넬: 앵커가 '='·'+'·'@' 등으로 시작해도 수식으로 해석되지 않게. 조회 시 떼어낸다.
    const row = [String(key), '!' + String(anchor || '')];
    const last = sh.getLastRow();
    if (last >= 2) {
      const keys = sh.getRange(2, 1, last - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) {
        if (String(keys[i][0]) === String(key)) {
          sh.getRange(i + 2, 1, 1, 2).setValues([row]);
          return { ok: true, updated: true };
        }
      }
    }
    sh.appendRow(row);
    return { ok: true, inserted: true };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

// 전체 vendor 인덱스를 한 번만 읽어 청크 캐시에 보관 → prefix 타이핑마다 시트 재읽기 방지.
// CacheService는 키당 100KB(UTF-8 바이트) 제한이라, 한글(3바이트) 안전선으로 25000자 단위 분할.
function loadVendorIndexRows_() {
  const cache = CacheService.getScriptCache();
  const cntStr = cache.get('vidx_n_v1');
  if (cntStr) {
    const n = Number(cntStr);
    const keys = [];
    for (let i = 0; i < n; i++) keys.push('vidx_v1_' + i);
    const got = cache.getAll(keys);
    let ok = true;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const s = got['vidx_v1_' + i];
      if (s == null) { ok = false; break; }
      parts.push(s);
    }
    if (ok) { try { return JSON.parse(parts.join('')); } catch (e) {} }
  }

  const ss = SpreadsheetApp.openById(INDEX_SS_ID);
  const sheet = ss.getSheetByName(INDEX_VENDORS);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const lastRow = sheet.getLastRow();
  const totalCols = 1 + SEARCH_CATEGORIES.length + 1;
  const data = sheet.getRange(2, 1, lastRow - 1, totalCols).getValues();

  try {
    const json = JSON.stringify(data);
    const CHUNK = 25000;
    const toPut = {};
    let n = 0;
    for (let i = 0; i < json.length; i += CHUNK) { toPut['vidx_v1_' + n] = json.slice(i, i + CHUNK); n++; }
    cache.putAll(toPut, VINDEX_CACHE_SEC);
    cache.put('vidx_n_v1', String(n), VINDEX_CACHE_SEC);
  } catch (e) {}

  return data;
}

function searchVendorsFromIndex(query) {
  if (!query || query.length < 1) return { results: [], total: 0 };

  const data = loadVendorIndexRows_();
  if (data === null) {
    return { results: [], total: 0, error: '인덱스 미생성. rebuildIndex 실행 필요' };
  }

  const totalCols = 1 + SEARCH_CATEGORIES.length + 1;
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
  return { results: matched, total: matched.length };
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
    'AS': '작성일',
    '점검': '작성일',
    '초과': '날짜',
    '불만': '날짜',
    '미수': '입력일',
    'PC확장성': '날짜',
    '복합기확장성': '등록일',
    '업체정보': '종료일',
    '재계약': '날짜'
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
