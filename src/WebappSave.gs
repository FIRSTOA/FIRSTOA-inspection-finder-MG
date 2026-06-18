/**
 * 웹앱(inspection-finder) [📤 보내기] 수신 → 점검/AS 탭 분기 적재 + 지역별 방 라우팅.
 *
 *  분기 로직(구분 값 기준):
 *    - 구분에 "점검" 포함 → 점검 탭 적재
 *    - 구분에 "AS"  포함 → AS  탭 적재
 *    - 점검+AS 둘 다     → 두 탭 모두 적재
 *  카톡 라우팅(지역 A/B/C/D 기준):
 *    - 점검방: 항상 게시
 *    - AS방 : 구분에 AS 포함 시 추가 게시
 *  (둘 다 카톡 업로드와 동일 파서·동일 _dupKey 중복방어 재사용)
 *
 *  ※ WebApp.gs 라우팅:
 *      doPost: else if (action === 'save') result = webappSaveInspection_(data);
 *      doGet : if (action0 === 'pull') return webappPullKakao_(e);
 */

// ===================== 설정 =====================
var WEBAPP_BOT_TOKEN  = 'firstoa2026';        // 메신저봇 polling 인증값(봇과 동일)
var WEBAPP_OUTBOX_TAB = '_webapp_outbox';     // 카톡 발신 큐 [시각, 방, 메시지, 전송여부]

// 방 이름은 코드가 아니라 _room_map 숨김시트에서 읽는다(카테고리|지역 → 방이름).
// → 방 이름이 바뀌거나 새 방이 생기면 그 시트만 고치면 됨(코드 수정/재배포 불필요).
var TEST_ROOM = '테스트 전용방';   // E·빈값·미지원 지역 fallback, 그리고 TEST_MODE 대상
var TEST_MODE = true;             // true: 지역 상관없이 전부 TEST_ROOM 으로. 실서비스 전환 시 false.
// ================================================

// 웹앱 보내기 1건 적재 + 라우팅
function webappSaveInspection_(data) {
  try {
    var text = String((data && data.text) || '');
    if (!text.trim()) return { ok: false, error: '내용이 비어있습니다.' };

    var hasInspect = isInspectForm_(text);
    var hasAS = isASForm_(text);
    if (!hasInspect && !hasAS) {
      return { ok: false, error: '구분에 점검/AS가 없어 저장 대상이 아닙니다. (mode=' + (data.mode || '?') + ')' };
    }

    var dateStr = '';
    if (data.ts) {
      var d = new Date(data.ts);
      if (!isNaN(d.getTime())) dateStr = Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
    }
    var msg = { date: dateStr, author: String(data.author || ''), text: text };
    var regionFallback = String(data.region || '');

    var tabs = [], anyNew = false, region = '';

    // 점검 탭
    if (hasInspect) {
      var recI = extractInspectForms_([msg], regionFallback);
      if (recI.length) {
        var rI = appendKakaoRecords_('점검', '웹앱', '', recI);
        tabs.push('점검(' + (rI.added > 0 ? '신규' : '중복') + ')');
        if (rI.added > 0) anyNew = true;
        region = region || String(recI[0].obj['지역'] || '');
      }
    }
    // AS 탭
    if (hasAS) {
      var recA = extractASFormsFull_([msg], regionFallback);
      if (recA.length) {
        var rA = appendKakaoRecords_('AS', 'AS', '', recA);
        tabs.push('AS(' + (rA.added > 0 ? '신규' : '중복') + ')');
        if (rA.added > 0) anyNew = true;
        region = region || String(recA[0].obj['지역'] || '');
      }
    }

    if (!tabs.length) return { ok: false, error: '업체명을 찾지 못했습니다.' };

    // 카톡 라우팅 (새로 저장된 건일 때만)
    var rooms = [];
    if (anyNew) {
      rooms = resolveRooms_(region, hasAS);
      for (var i = 0; i < rooms.length; i++) webappEnqueue_(rooms[i], text);
    }

    return {
      ok: true,
      message: anyNew ? ('저장 완료 — 게시 대기: ' + rooms.join(', ')) : '이미 저장된 내용입니다(중복).',
      tabs: tabs.join(' + '),
      region: region,
      rooms: rooms,
      testMode: TEST_MODE
    };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// _room_map 시트 → { '카테고리|지역': '방이름' } 인덱스. (getRoomMap/ensureRoomMap_ 는 WebApp.gs)
function roomIndex_() {
  var idx = {};
  try {
    var gm = getRoomMap();
    if (gm && gm.rows) {
      gm.rows.forEach(function (r) {
        idx[r.category + '|' + String(r.team).trim().toUpperCase()] = r.roomName;
      });
    }
  } catch (e) {}
  return idx;
}

// 지역 + AS여부 → 보낼 방 목록(중복 제거). 방 이름은 _room_map 시트에서 조회.
function resolveRooms_(region, hasAS) {
  if (TEST_MODE) return [TEST_ROOM];
  var key = String(region || '').trim().toUpperCase();
  var idx = roomIndex_();
  var inspectRoom = idx['점검|' + key];
  if (!inspectRoom) return [TEST_ROOM];          // 미지원 지역(E·빈값 등)
  var rooms = [inspectRoom];                      // 점검방은 항상
  if (hasAS) {
    var asRoom = idx['AS|' + key];
    if (asRoom) rooms.push(asRoom);              // AS방은 AS 포함 시
  }
  return rooms;
}

// 카톡 발신 큐 적재
function webappEnqueue_(room, text) {
  var ss = SpreadsheetApp.openById(MASTER_SS_ID);
  var sh = ss.getSheetByName(WEBAPP_OUTBOX_TAB);
  if (!sh) {
    sh = ss.insertSheet(WEBAPP_OUTBOX_TAB); sh.hideSheet();
    sh.getRange(1, 1, 1, 4).setValues([['시각', '방', '메시지', '전송여부']]);
  }
  sh.appendRow([new Date(), String(room), String(text), 'N']);
}

// 메신저봇 polling: GET ?action=pull&token=...&rooms=방1\n방2  → 봇이 아는 방의 미전송분만 반환(+Y표시)
function webappPullKakao_(e) {
  if (!e || !e.parameter || e.parameter.token !== WEBAPP_BOT_TOKEN) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // 봇이 세션 가진 방 목록(없으면 전체 대상)
  var allow = null;
  if (e.parameter.rooms) {
    allow = {};
    String(e.parameter.rooms).split('\n').forEach(function (r) { var k = r.trim(); if (k) allow[k] = true; });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.openById(MASTER_SS_ID);
    var sh = ss.getSheetByName(WEBAPP_OUTBOX_TAB);
    var items = [];
    if (sh && sh.getLastRow() >= 2) {
      var values = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
      for (var i = 0; i < values.length; i++) {
        if (values[i][3] !== 'N') continue;
        var room = String(values[i][1]);
        if (allow && !allow[room]) continue;   // 봇이 못 보내는 방은 'N'으로 남겨 재시도
        items.push({ room: room, text: String(values[i][2]) });
        sh.getRange(i + 2, 4).setValue('Y');
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, items: items }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
