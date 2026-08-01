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

// 방 이름은 코드가 아니라 _room_map 숨김시트에서 읽는다(카테고리|지역 → 방이름).
// TEST_MODE / TEST_ROOM 도 코드가 아니라 _webapp_config 숨김시트에서 읽는다.
// → 시트 셀만 고치면 전환/방이름 변경 가능(코드 수정·재배포 불필요).
var WEBAPP_CONFIG_TAB = '_webapp_config';

// 설정 시트 읽기(없으면 기본값으로 생성). { TEST_MODE, TEST_ROOM, ... }
function webappConfig_() {
  var ss = SpreadsheetApp.openById(MASTER_SS_ID);
  var sh = ss.getSheetByName(WEBAPP_CONFIG_TAB);
  if (!sh) {
    sh = ss.insertSheet(WEBAPP_CONFIG_TAB); sh.hideSheet();
    sh.getRange(1, 1, 3, 2).setValues([
      ['설정', '값'],
      ['TEST_MODE', 'true'],            // true=전부 테스트방 / false=실서비스(지역별 방)
      ['TEST_ROOM', '테스트 전용방']     // 테스트/미지원지역 fallback 방
    ]);
    sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 200);
  }
  var cfg = {};
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
      if (String(r[0]).trim()) cfg[String(r[0]).trim()] = String(r[1]).trim();
    });
  }
  return cfg;
}
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
      testMode: String(webappConfig_()['TEST_MODE'] || 'true').toLowerCase() === 'true'
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

// 지역 + AS여부 → 보낼 방 목록(중복 제거). TEST_MODE/방이름 모두 시트에서 조회.
function resolveRooms_(region, hasAS) {
  var cfg = webappConfig_();
  var testRoom = cfg['TEST_ROOM'] || '테스트 전용방';
  var testMode = String(cfg['TEST_MODE'] || 'true').toLowerCase() === 'true';
  if (testMode) return [testRoom];

  var key = String(region || '').trim().toUpperCase();
  var idx = roomIndex_();
  var inspectRoom = idx['점검|' + key];
  if (!inspectRoom) return [testRoom];           // 미지원 지역(E·빈값 등)
  var rooms = [inspectRoom];                      // 점검방은 항상
  if (hasAS) {
    var asRoom = idx['AS|' + key];
    if (asRoom) rooms.push(asRoom);              // AS방은 AS 포함 시
  }
  return rooms;
}

// 카톡 발신 큐 적재
function webappEnqueue_(room, text) {
  outboxSheet_().appendRow([Utilities.getUuid(), new Date(), String(room), String(text)]);
}

// 발신 큐는 통합시트(큼=느림) 대신 전용 작은 스프레드시트에 둔다 → 봇 폴링이 빠름.
// 스키마: [id, 시각, 방, 메시지]. 배달 확인(ack)된 건만 삭제(무유실).
function outboxSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('WEBAPP_OUTBOX_SS_ID');
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('점검알림_발신큐');
    props.setProperty('WEBAPP_OUTBOX_SS_ID', ss.getId());
  }
  var sh = ss.getSheets()[0];
  if (sh.getName() !== 'outbox') sh.setName('outbox');
  if (String(sh.getRange(1, 1).getValue()) !== 'id') {   // 헤더 없거나 구버전 → 초기화
    sh.clear();
    sh.getRange(1, 1, 1, 4).setValues([['id', '시각', '방', '메시지']]);
  }
  return sh;
}

// 봇이 bot.send 성공한 id들을 통보 → 그 행만 삭제 (무유실 핵심)
function webappAck_(e) {
  if (!e || !e.parameter || e.parameter.token !== WEBAPP_BOT_TOKEN) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var ids = {};
  String(e.parameter.ids || '').split(',').forEach(function (x) { var k = x.trim(); if (k) ids[k] = true; });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = outboxSheet_();
    var last = sh.getLastRow();
    var deleted = 0;
    if (last >= 2) {
      var col = sh.getRange(2, 1, last - 1, 1).getValues();   // id 열
      for (var i = col.length - 1; i >= 0; i--) {
        if (ids[String(col[i][0])]) { sh.deleteRow(i + 2); deleted++; }
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, deleted: deleted }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// 메신저봇 polling: GET ?action=pull&token=...  → 대기 중 전체를 {id, room, text}로 반환(삭제 안 함).
// 봇이 bot.send 성공한 것만 action=ack 로 통보 → 그때 삭제(무유실).
function webappPullKakao_(e) {
  if (!e || !e.parameter || e.parameter.token !== WEBAPP_BOT_TOKEN) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = outboxSheet_();
    var items = [];
    var last = sh.getLastRow();
    if (last >= 2) {
      var values = sh.getRange(2, 1, last - 1, 4).getValues();   // id, 시각, 방, 메시지
      for (var i = 0; i < values.length; i++) {
        items.push({ id: String(values[i][0]), room: String(values[i][2]), text: String(values[i][3]) });
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, items: items }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
