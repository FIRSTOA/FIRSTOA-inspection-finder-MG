/**
 * 웹앱 진입점 - 인덱스(_idx_*)에서 검색/상세조회만 담당.
 * 출력 포맷은 기존 v10과 동일 (프론트엔드 호환).
 */

function doGet(e) {
  // 콘솔/업로드 HTML 화면은 2026-08 제거 — 관리 기능은 CS 웹앱(관리 탭)에서 한다.
  const action0 = (e.parameter.action || 'ping').toLowerCase();

  // 메신저봇 polling: 웹앱 보내기로 적재된 양식을 카톡방에 게시하기 위해 가져감
  if (action0 === 'pull') return webappPullKakao_(e);
  if (action0 === 'ack') return webappAck_(e);   // 봇이 전송 성공한 id 통보 → 큐에서 삭제

  let result;
  try {
    const action = action0;
    const q = (e.parameter.q || '').trim();

    if (action === 'search') result = searchVendorsFromIndex(q);
    else if (action === 'detail') result = getVendorDetailFromIndex(q);
    else if (action === 'inspforms') result = getInspectionFormsByVendor(q);
    else if (action === 'ping') result = { ok: true, time: new Date().toISOString(), indexInfo: getIndexMeta() };
    else if (action === 'adminstatus') result = { ok: true, queue: kakaoQueueStatus(), drive: getDriveInboxInfo() };  // CS 웹앱 관리 탭용
    else if (action === 'kakaoclear') result = kakaoClearFinished_();  // 끝난 수집 작업 정리 (CS 웹앱 관리 탭)
    else if (action === 'ingestnow') result = ingestFromDriveFolder();  // 드라이브 수집 즉시 실행 (CS 웹앱 관리 탭)
    else if (action === 'retryheld') result = retryHeldFiles();          // 확인필요 파일을 수집함으로 되돌림
    else if (action === 'cellreport') result = sheetCellReport();      // 통합시트 셀 사용 현황(1,000만 한도)
    else if (action === 'celltrim') result = trimSheetCells(e.parameter.keep); // 빈 격자 잘라 셀 되돌리기
    else if (action === 'contactpeek') result = contactSheetPeek(e.parameter.id, e.parameter.tab); // 담당자변경 시트 구조 확인
    else if (action === 'uploadlog') result = readUploadLog(e.parameter.limit); // 최근 수집 로그(실패 원인 확인)
    else if (action === 'dedupe') result = dedupeMasterByRaw(e.parameter.cat || '점검'); // 원문 같은 중복행 정리(첫 행만 남김)
    else if (action === 'seenreset') result = resetSeenRoom(e.parameter.room || ''); // 메시지 지문 초기화 → 그 방 전체 재해석
    else if (action === 'cursorlist') result = listUploadCursors();     // 수집 앵커(증분 기준점) 목록
    else if (action === 'cursorreset') result = resetUploadCursor(e.parameter.key || ''); // 앵커 초기화 → 다음 업로드는 파일 전체 재처리
    else if (action === 'roommap') result = getRoomMap();               // 수집 방 매핑 목록
    else if (action === 'roommapset') result = setRoomMapRow_(e.parameter.room, e.parameter.category, e.parameter.team);
    else if (action === 'roommapdel') result = delRoomMapRow_(e.parameter.room);
    else if (action === 'rebuildindex') {  // 통합이력 인덱스 원격 복구: 업체정보 동기화(즉시) → 인덱스(22분 뒤) 2단계 예약
      for (const t of ScriptApp.getProjectTriggers()) {  // 이전 1회성 잔재 정리
        const h = t.getHandlerFunction();
        if (h === 'syncBizThenIndex' || h === 'bizInfoStep' || h === 'indexStep') ScriptApp.deleteTrigger(t);
      }
      ScriptApp.newTrigger('bizInfoStep').timeBased().after(1000).create();
      ScriptApp.newTrigger('indexChunkStart').timeBased().after(15 * 60 * 1000).create();
      result = { ok: true, scheduled: 'bizInfoStep(즉시) → indexChunkStart(+15분, 조각 체인)', trigger: ensureIndexTrigger_() };
    }
    else if (action === 'indexfinalize') {  // 조각 재료가 이미 완성된 경우 병합만 재시도
      ScriptApp.newTrigger('indexFinalizeStep').timeBased().after(1000).create();
      result = { ok: true, scheduled: 'indexFinalizeStep(즉시)' };
    }
    else if (action === 'indexonly') {  // 인덱스만 바로 (마스터가 이미 최신일 때) — 조각 체인 시작
      result = indexChunkStart();
    }
    else if (action === 'lastruns') {  // 복구 단계 실행 결과 확인
      const props = PropertiesService.getScriptProperties();
      result = {
        ok: true,
        bizInfoStep: JSON.parse(props.getProperty('run_bizInfoStep') || 'null'),
        indexChunk: JSON.parse(props.getProperty('run_indexChunk') || 'null'),
        indexFinalize: JSON.parse(props.getProperty('run_indexFinalize') || 'null'),
        cursor: JSON.parse(props.getProperty('idx_cursor') || 'null'),
        indexInfo: getIndexMeta(),
      };
    }
    else if (action === 'booksearch') result = bookSearchProxy_(q);   // CS 웹앱 독서탭 책 검색 (리디 프록시, 키 불필요)
    else if (action === 'bookresolve') result = bookResolveBatch_(e.parameter.titles);   // 추천 도서 표지 일괄 해석 (서버 캐시 6시간)
    else if (action === 'quizgen') result = copierQuizGen_(e.parameter.date, e.parameter.brand);   // 복합기 데일리 퀴즈 AI 생성 (일·브랜드별 1회 캐시)
    else if (action === 'quizbank') result = copierQuizBank_(e.parameter.brand);   // 복합기 자유연습 문제은행 적립
    else if (action === 'photoarchive') result = photoArchiveRun_(e.parameter.limit, e.parameter.days);   // 오래된 사진 → 이 계정 드라이브 이관 (엣지/크론 경유)
    else if (action === 'reportview') return reportViewHtml_(e.parameter.f, e.parameter.v);   // 고객 리포트 뷰어 (문자 링크 → 흰 배경 HTML — 스토리지·엣지는 HTML 서빙 불가)
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
// ── 업로드 이력 로그 (누가/언제/무엇을/몇 건 올렸는지 — 중복 작업 방지) ──
const UPLOAD_LOG_TAB = '_upload_log';

/**
 * 통합시트 셀 사용 현황. 구글 스프레드시트는 통합문서당 셀 1,000만 개가 한도라
 * 넘으면 "셀 개수가 한도를 초과합니다"로 모든 적재가 실패한다(2026-08-27 수집 중단 원인).
 * 빈 행·빈 열도 셀로 계산되므로, 데이터보다 훨씬 큰 격자를 잡고 있는 탭이 범인이다.
 */
function sheetCellReport() {
  try {
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    let total = 0, waste = 0;
    const rows = ss.getSheets().map(function (sh) {
      const mr = sh.getMaxRows(), mc = sh.getMaxColumns();
      const lr = sh.getLastRow(), lc = sh.getLastColumn();
      const cells = mr * mc, used = lr * lc;
      total += cells; waste += (cells - used);
      return { tab: sh.getName(), maxRows: mr, maxCols: mc, lastRow: lr, lastCol: lc, cells: cells, empty: cells - used };
    });
    rows.sort(function (a, b) { return b.cells - a.cells; });
    return { ok: true, totalCells: total, emptyCells: waste, limit: 10000000, tabs: rows };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

/** 데이터 아래·오른쪽의 빈 격자를 잘라 셀을 되돌린다(빈 칸만 삭제하므로 데이터는 그대로). */
function trimSheetCells(keepRows) {
  try {
    const pad = Math.max(10, parseInt(keepRows, 10) || 200);
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    let freed = 0;
    const detail = [];
    ss.getSheets().forEach(function (sh) {
      const mr = sh.getMaxRows(), mc = sh.getMaxColumns();
      const lr = Math.max(1, sh.getLastRow()), lc = Math.max(1, sh.getLastColumn());
      let f = 0;
      const keepR = Math.min(mr, lr + pad);
      if (mr > keepR) { sh.deleteRows(keepR + 1, mr - keepR); f += (mr - keepR) * mc; }
      const mc2 = sh.getMaxColumns();
      if (mc2 > lc) { sh.deleteColumns(lc + 1, mc2 - lc); f += (mc2 - lc) * Math.min(mr, keepR); }
      if (f) detail.push({ tab: sh.getName(), freed: f });
      freed += f;
    });
    return { ok: true, freedCells: freed, tabs: detail };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

/**
 * 담당자변경 시트 훑어보기 (구조 파악용) — 헤더와 최근 몇 줄만 돌려준다.
 * 담당자 변경은 웹앱뿐 아니라 카톡방 메신저봇+Make로도 시트에 직접 쌓인다.
 * 앱(Supabase)은 웹앱분만 알고 있어 시트분이 안 보였다 → 시트를 읽어 역방향으로 채우기 위한 첫 단계.
 */
function contactSheetPeek(sheetId, tabName) {
  try {
    const ss = SpreadsheetApp.openById(String(sheetId || '').trim());
    const sheets = ss.getSheets().map(function (sh) { return { name: sh.getName(), gid: sh.getSheetId(), rows: sh.getLastRow(), cols: sh.getLastColumn() }; });
    const sheet = tabName ? ss.getSheetByName(String(tabName)) : ss.getSheets()[0];
    if (!sheet) return { ok: true, title: ss.getName(), sheets: sheets, note: '탭을 못 찾음' };
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const headers = lastRow ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
    const from = Math.max(2, lastRow - 4);
    const sample = lastRow >= 2 ? sheet.getRange(from, 1, Math.min(5, lastRow - 1), lastCol).getValues()
      .map(function (row) { return row.map(function (v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v).slice(0, 40); }); }) : [];
    return { ok: true, title: ss.getName(), sheets: sheets, tab: sheet.getName(), lastRow: lastRow, headers: headers, sample: sample };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

/** 최근 수집 로그 (관리탭·진단용) */
function readUploadLog(limit) {
  try {
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    const sh = ss.getSheetByName(UPLOAD_LOG_TAB);
    if (!sh || sh.getLastRow() < 2) return { ok: true, rows: [] };
    const n = Math.min(parseInt(limit, 10) || 15, 100);
    const start = Math.max(2, sh.getLastRow() - n + 1);
    const data = sh.getRange(start, 1, sh.getLastRow() - start + 1, 8).getValues();
    return { ok: true, rows: data.map(function (r) {
      return { t: String(r[0]), cat: String(r[1]), team: String(r[2]), room: String(r[3]),
               parsed: r[4], added: r[5], skipped: r[6], status: String(r[7]) };
    }).reverse() };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

/**
 * 보조 탭은 쓰는 열만 남긴다. insertSheet는 1000행×26열 격자를 잡는데, 2열만 쓰는 탭이 12만 행이 되면
 * 빈 셀 300만 개를 먹어 통합문서 셀 한도(1,000만)를 터뜨린다(2026-08-27 수집 전면 중단 원인).
 */
function narrowSheet_(sh, cols) {
  try { const mc = sh.getMaxColumns(); if (mc > cols) sh.deleteColumns(cols + 1, mc - cols); } catch (e) {}
  return sh;
}

function logUpload(entry) {
  try {
    entry = entry || {};
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    let sh = ss.getSheetByName(UPLOAD_LOG_TAB);
    if (!sh) {
      sh = ss.insertSheet(UPLOAD_LOG_TAB); sh.hideSheet(); narrowSheet_(sh, 9);
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

// 수집 방 매핑 추가/수정 — CS 웹앱 관리 탭에서 호출. 방이름은 카톡 내보내기의
// "○○ 님과 카카오톡 대화" 줄과 정확히 일치해야 라우팅된다.
function setRoomMapRow_(room, category, team) {
  const name = String(room || '').trim();
  const cat = String(category || '').trim();
  if (!name || !cat) return { ok: false, error: '방이름과 카테고리는 필수입니다.' };
  if (!CONFIG[cat]) return { ok: false, error: '알 수 없는 카테고리: ' + cat };
  const sh = ensureRoomMap_();
  const last = sh.getLastRow();
  for (let r = 2; r <= last; r++) {
    if (String(sh.getRange(r, 1).getValue()).trim() === name) {
      sh.getRange(r, 2, 1, 2).setValues([[cat, String(team || '').trim()]]);
      return { ok: true, updated: true };
    }
  }
  sh.appendRow([name, cat, String(team || '').trim()]);
  return { ok: true, added: true };
}

function delRoomMapRow_(room) {
  const name = String(room || '').trim();
  if (!name) return { ok: false, error: '방이름이 필요합니다.' };
  const sh = ensureRoomMap_();
  const last = sh.getLastRow();
  for (let r = 2; r <= last; r++) {
    if (String(sh.getRange(r, 1).getValue()).trim() === name) {
      sh.deleteRow(r);
      return { ok: true, removed: true };
    }
  }
  return { ok: false, error: '해당 방이 없습니다: ' + name };
}

// 업로드 화면에서 호출 (google.script.run). TXT 내용을 받아 적재.
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

/**
 * 수집 앵커 목록. 앵커는 "직전 업로드 파일의 마지막 300자"로, 다음 업로드에서 그 뒤만 처리한다(증분).
 * 첫 업로드가 부분 내보내기였으면 그 앞 기간은 앵커에 막혀 영구히 안 들어온다 — 그때 초기화가 필요하다.
 * (2026-08-26 실사고: D 점검방 2023-11~2026-01 3,846건이 이 이유로 누락)
 */
function listUploadCursors() {
  try {
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    const sh = ss.getSheetByName(UPLOAD_CURSOR_TAB);
    if (!sh || sh.getLastRow() < 2) return { ok: true, rows: [] };
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    return { ok: true, rows: data.map(function (r) {
      var a = String(r[1] || ''); if (a.charAt(0) === '!') a = a.slice(1);
      return { key: String(r[0]), anchorLen: a.length, anchorTail: a.slice(-60) };
    }) };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

/**
 * 메시지 지문(_kakao_seen) 초기화. 파서를 고친 뒤 "옛 메시지를 다시 읽히고 싶을 때"만 쓴다.
 * 지우면 다음 업로드에서 그 방 전체를 다시 해석한다(중복은 _dupKey가 막는다) — 대신 오래 걸린다.
 * room 값: AI 방은 '불만'·'미수'처럼 방 종류, 점검·AS는 '점검|D'·'AS|C' 형식.
 */
function resetSeenRoom(room) {
  try {
    if (!room) return { ok: false, error: 'room 값이 필요합니다 (예: 점검|D)' };
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    const sh = ss.getSheetByName(KAKAO_SEEN_TAB);
    if (!sh || sh.getLastRow() < 2) return { ok: true, removed: 0 };
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    const keep = data.filter(function (r) { return String(r[0]) !== String(room); });
    const removed = data.length - keep.length;
    sh.getRange(2, 1, data.length, 2).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, 2).setValues(keep);
    return { ok: true, room: room, removed: removed };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

/** 앵커 삭제 → 다음 업로드는 파일 전체를 처리한다. 중복은 _dupKey 로 걸러지므로 안전하다. */
function resetUploadCursor(key) {
  try {
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    const sh = ss.getSheetByName(UPLOAD_CURSOR_TAB);
    if (!sh || sh.getLastRow() < 2) return { ok: true, removed: 0 };
    const last = sh.getLastRow();
    const data = sh.getRange(2, 1, last - 1, 2).getValues();
    const keep = data.filter(function (r) { return key ? String(r[0]) !== String(key) : false; });
    const removed = data.length - keep.length;
    sh.getRange(2, 1, data.length, 2).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, 2).setValues(keep);
    return { ok: true, removed: removed, key: key || '(전체)' };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

function setUploadCursor(key, anchor) {
  try {
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    let sh = ss.getSheetByName(UPLOAD_CURSOR_TAB);
    if (!sh) {
      sh = ss.insertSheet(UPLOAD_CURSOR_TAB); sh.hideSheet(); narrowSheet_(sh, 2);
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


/**
 * 독서탭 책 검색 프록시 — 리디북스 공개 검색 API를 서버에서 대신 호출한다.
 * (브라우저 직접 호출은 CORS로 막히고, 구글 도서 무키 호출은 공용 쿼터가 자주 마름)
 */
function bookSearchProxy_(q) {
  var query = String(q || '').trim();
  if (!query) return { books: [] };
  try {
    var res = UrlFetchApp.fetch('https://search-api.ridibooks.com/search?keyword=' + encodeURIComponent(query) + '&what=base&where=book&site=ridi-store&start=0&limits=8', {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (res.getResponseCode() !== 200) return { books: [], error: 'ridi ' + res.getResponseCode() };
    var data = JSON.parse(res.getContentText());
    var books = (data.books || []).slice(0, 8).map(function (b) {
      var authors = (b.authors_info || []).map(function (a) { return a && a.name; }).filter(String).join(', ');
      return {
        title: String(b.title || '').replace(/^개정판\s*\|\s*/, '').trim(),
        authors: authors,
        thumbnail: b.b_id ? 'https://img.ridicdn.net/cover/' + b.b_id + '/large' : '',
      };
    }).filter(function (b) { return b.title; });
    return { books: books };
  } catch (err) {
    return { books: [], error: String(err) };
  }
}


/**
 * 추천 도서 표지 일괄 해석 — "제목1||제목2||..."를 받아 리디 검색을 병렬(fetchAll)로
 * 돌리고 결과를 6시간 서버 캐시. 프론트가 책마다 왕복하던 것을 1회로 줄인다.
 */
function bookResolveBatch_(titlesParam) {
  var titles = String(titlesParam || '').split('||').map(function (t) { return t.trim(); }).filter(String).slice(0, 12);
  if (!titles.length) return { books: {} };
  var cache = CacheService.getScriptCache();
  var out = {};
  var need = [];
  titles.forEach(function (entry) {
    var t = entry.split('@@')[0];
    var hit = cache.get('bookr3:' + t);
    if (hit) { try { out[t] = JSON.parse(hit); return; } catch (err) { } }
    need.push(entry);
  });
  if (need.length) {
    var requests = need.map(function (entry) {
      var t = entry.split('@@')[0];
      return {
        url: 'https://search-api.ridibooks.com/search?keyword=' + encodeURIComponent(t) + '&what=base&where=book&site=ridi-store&start=0&limits=8',
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      };
    });
    var responses = UrlFetchApp.fetchAll(requests);
    responses.forEach(function (res, i) {
      var entry = need[i];
      var parts = entry.split('@@');
      var t = parts[0];
      var authorHint = (parts[1] || '').split(/[\s,]+/)[0];
      var v = { cover: '', authors: '' };
      try {
        if (res.getResponseCode() === 200) {
          var books = (JSON.parse(res.getContentText()).books) || [];
          var compact = t.replace(/\s/g, '');
          // 저자 힌트가 맞는 책 > 제목 정확 일치 > 제목 시작 일치 > 첫 결과
          var byAuthor = null, exact = null, starts = null;
          for (var k = 0; k < books.length; k++) {
            var bt = String(books[k].title || '').replace(/\s/g, '');
            var authors = (books[k].authors_info || []).map(function (a) { return a && a.name; }).join(',');
            if (!byAuthor && authorHint && authors.indexOf(authorHint) !== -1 && bt.indexOf(compact.slice(0, 4)) !== -1) byAuthor = books[k];
            if (!exact && (bt === compact || bt.indexOf(compact + '(') === 0 || bt.indexOf(compact + ':') === 0)) exact = books[k];
            if (!starts && bt.indexOf(compact) === 0) starts = books[k];
          }
          // 저자 힌트가 있는데 저자가 안 맞으면 정확 일치만 인정 — 엉뚱한 표지보다 빈 표지가 낫다
          var best = byAuthor || exact || (authorHint ? null : (starts || books[0]));
          if (best) {
            v.cover = best.b_id ? 'https://img.ridicdn.net/cover/' + best.b_id + '/large' : '';
            v.authors = (best.authors_info || []).map(function (a) { return a && a.name; }).filter(String).join(', ');
          }
        }
      } catch (err) { }
      out[t] = v;
      try { cache.put('bookr3:' + t, JSON.stringify(v), 21600); } catch (err) { }
    });
  }
  return { books: out };
}
