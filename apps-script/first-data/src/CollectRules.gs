/**
 * 카톡 수집 판정 규칙 (순수 함수만 — GAS 서비스(SpreadsheetApp·UrlFetchApp 등)를 부르지 않는다).
 * 드라이브 수집(Drive.gs)·웹앱 GET(WebApp.gs)·봇 글 거르기(Kakao.gs)가 여기 함수를 쓴다.
 * tests/gasCollect.test.ts 가 이 파일을 그대로 읽어 node 에서 돌린다 → ES5 문법, 전역 상태 없음.
 * 설계: docs/tasks/kakao-collect-expand.md 3-1·3-2·3-6·3-7
 */

// 수집 처리 종류(kakao_collect_rooms.kinds 에 들어갈 수 있는 값). 순서 = 같은 파일을 처리하는 순서.
var COLLECT_KINDS = ['점검', 'AS', '물류', '불만', '미수', '재계약'];

// 봇 대화명 기본값 (app_config KAKAO_BOT_NICKS 가 비었을 때)
var COLLECT_DEFAULT_BOT_NICKS = ['Ai법인폰'];

// GET 으로 부르면 시트·트리거·데이터를 바꾸는(또는 아무 시트나 읽는) 동작 — FIELD_ADMIN_TOKEN 필요
var ADMIN_TOKEN_ACTIONS = [
  'ingestnow', 'retryheld', 'kakaoclear', 'celltrim', 'dedupe', 'seenreset', 'cursorreset',
  'roommapset', 'roommapdel', 'rebuildindex', 'indexfinalize', 'indexonly', 'photoarchive',
  'contactpeek'
];

/**
 * 처리 종류 한 개 표기 정리. "as"·"A/S"·"점 검" 같은 표기를 표준 이름으로. 모르는 값은 ''.
 */
function collectNormKind_(v) {
  var s = String(v == null ? '' : v).replace(/\s+/g, '');
  if (!s) return '';
  if (/^a\/?s$/i.test(s)) return 'AS';
  if (s === '점검') return '점검';
  if (s === '물류' || s === '납품') return '물류';
  if (s === '불만' || s === '불만접수') return '불만';
  if (s === '미수' || s === '미수방문') return '미수';
  if (s === '재계약' || s === '계약갱신') return '재계약';
  // '초과조정' 은 표시용 — 재계약 처리가 "초과업체조정" 양식을 이미 함께 잡으므로 따로 처리하지 않는다
  return '';
}

/**
 * kinds 값 해석. 배열(["점검","AS"])·Postgres 배열 글("{점검,AS}")·쉼표 글("점검,AS") 모두 받는다.
 * 결과는 중복 없는 표준 이름 배열이고, 순서는 COLLECT_KINDS 순서(점검 → AS → 물류 → …)로 고정한다.
 */
function collectParseKinds_(v) {
  var parts;
  if (Object.prototype.toString.call(v) === '[object Array]') parts = v;
  else parts = String(v == null ? '' : v).replace(/^\s*\{|\}\s*$/g, '').split(/[,，\/|]/);
  var have = {};
  for (var i = 0; i < parts.length; i++) {
    var raw = String(parts[i] == null ? '' : parts[i]).replace(/^\s*"|"\s*$/g, '');
    var k = collectNormKind_(raw);
    if (k) have[k] = true;
  }
  // 글로 받은 "A/S" 는 위 split 에서 'A','S' 로 갈라진다 → 원래 글 전체로 한 번 더 본다
  if (Object.prototype.toString.call(v) !== '[object Array]' && /a\s*\/\s*s/i.test(String(v || ''))) have['AS'] = true;
  var out = [];
  for (var j = 0; j < COLLECT_KINDS.length; j++) if (have[COLLECT_KINDS[j]]) out.push(COLLECT_KINDS[j]);
  return out;
}

/**
 * 표시용 kinds 원래 값 목록(초과조정처럼 처리하지 않는 값도 그대로). 관리 카드 칩에 쓴다.
 */
function collectKindLabels_(v) {
  var parts = Object.prototype.toString.call(v) === '[object Array]' ? v
    : String(v == null ? '' : v).replace(/^\s*\{|\}\s*$/g, '').split(/[,，|]/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var s = String(parts[i] == null ? '' : parts[i]).replace(/^\s*"|"\s*$/g, '').trim();
    if (s && out.indexOf(s) === -1) out.push(s);
  }
  return out;
}

/** 불리언 칸 해석(true/'true'/'t'/1). 값이 없으면 기본값. */
function collectBool_(v, dflt) {
  if (v === true || v === false) return v;
  if (v == null || v === '') return !!dflt;
  var s = String(v).trim().toLowerCase();
  if (s === 'true' || s === 't' || s === '1' || s === 'y' || s === 'yes') return true;
  if (s === 'false' || s === 'f' || s === '0' || s === 'n' || s === 'no') return false;
  return !!dflt;
}

/**
 * Supabase kakao_collect_rooms 한 줄 → 수집 경로(route).
 * route = {roomName, kinds, team, category(첫 kind — 옛 코드 호환), enabled, export, structured, keepRaw, source}
 * 방 이름이 없으면 null.
 */
function collectRouteFromTableRow_(row) {
  if (!row) return null;
  var name = String(row.room == null ? '' : row.room).trim();
  if (!name) return null;
  var kinds = collectParseKinds_(row.kinds);
  return {
    roomName: name,
    kinds: kinds,
    labels: collectKindLabels_(row.kinds),
    team: String(row.region == null ? '' : row.region).trim(),
    category: kinds.length ? kinds[0] : '',
    enabled: collectBool_(row.enabled, true),
    export: collectBool_(row['export'], true),
    structured: collectBool_(row.structured, true),
    keepRaw: collectBool_(row.keep_raw, false),
    source: 'supabase'
  };
}

/**
 * 옛 _room_map 시트 한 줄(방이름·카테고리·지역) → 수집 경로. 시트는 방 하나에 분류 하나뿐이고
 * 원문 보관 설정이 없다 → keepRaw=false (비상용이라 새 동작을 켜지 않는다).
 */
function collectRouteFromSheetRow_(roomName, category, team) {
  var name = String(roomName == null ? '' : roomName).trim();
  if (!name) return null;
  var kinds = collectParseKinds_(category);
  return {
    roomName: name,
    kinds: kinds,
    team: String(team == null ? '' : team).trim(),
    category: kinds.length ? kinds[0] : String(category || '').trim(),
    enabled: true,
    export: true,
    structured: true,
    keepRaw: false,
    source: 'sheet'
  };
}

/** 처리 종류 → 적재 방식. 점검·AS = 양식 파서, 물류 = 물류 라벨 파서, 그 밖 = AI 대기열. */
function collectModeForKind_(kind) {
  if (kind === 'AS') return 'asform';
  if (kind === '점검') return 'inspectform';
  if (kind === '물류') return 'logisticsform';
  return 'ai';
}

/**
 * 파일 하나를 어떻게 처리할지 정한다.
 *  - route 없음·꺼짐·처리할 것 없음 → {held:true, reason}
 *  - 아니면 {held:false, steps:[{kind, mode}], raw:bool}
 *    structured=false 면 steps 는 비고 raw 만 할 수 있다. 둘 다 없으면 held.
 */
function collectPlan_(route) {
  if (!route) return { held: true, reason: '미등록', steps: [], raw: false };
  if (!route.enabled) return { held: true, reason: '꺼짐', steps: [], raw: false };
  var steps = [];
  if (route.structured) {
    for (var i = 0; i < route.kinds.length; i++) {
      steps.push({ kind: route.kinds[i], mode: collectModeForKind_(route.kinds[i]) });
    }
  }
  var raw = !!route.keepRaw;
  if (!steps.length && !raw) return { held: true, reason: '처리 종류 없음', steps: [], raw: false };
  return { held: false, reason: '', steps: steps, raw: raw };
}

/** app_config KAKAO_BOT_NICKS 값(쉼표 목록) → 대화명 배열. 비면 기본값. */
function parseBotNicks_(value) {
  var out = [];
  var parts = String(value == null ? '' : value).split(/[,，\n]/);
  for (var i = 0; i < parts.length; i++) {
    var s = parts[i].trim();
    if (s) out.push(s);
  }
  return out.length ? out : COLLECT_DEFAULT_BOT_NICKS.slice();
}

/** 대화명 비교용 정리: 앞뒤·가운데 공백 제거, 끝의 "님" 제거, 소문자. */
function normNick_(name) {
  return String(name == null ? '' : name).replace(/\s+/g, '').replace(/님$/, '').toLowerCase();
}

/** 작성자가 봇 대화명 목록에 있는가 (정확히 같은 이름만 — 부분 일치는 사람 글을 뺄 수 있어 쓰지 않는다). */
function isBotAuthorIn_(author, nicks) {
  var a = normNick_(author);
  if (!a) return false;
  for (var i = 0; i < (nicks || []).length; i++) {
    if (a === normNick_(nicks[i])) return true;
  }
  return false;
}

/** 메시지 배열에서 봇 글을 뺀다. 결과 {messages, botSkipped}. */
function splitBotMessages_(messages, nicks) {
  var keep = [], n = 0;
  for (var i = 0; i < (messages || []).length; i++) {
    if (isBotAuthorIn_(messages[i] && messages[i].author, nicks)) n++;
    else keep.push(messages[i]);
  }
  return { messages: keep, botSkipped: n };
}

/** 이 GET 동작이 관리 토큰을 요구하는가 */
function actionNeedsToken_(action) {
  return ADMIN_TOKEN_ACTIONS.indexOf(String(action || '').toLowerCase()) !== -1;
}

/**
 * 관리 토큰 검사. 기대값(스크립트 속성)이 비어 있으면 무조건 거부(잠긴 쪽으로 실패).
 * 길이와 상관없이 끝까지 비교한다(글자 하나씩 맞춰 보는 시간 차 공격 완화).
 */
function checkAdminToken_(expected, given) {
  var e = String(expected == null ? '' : expected);
  var g = String(given == null ? '' : given);
  if (!e.trim() || !g) return false;
  var diff = e.length ^ g.length;
  var n = Math.max(e.length, g.length);
  for (var i = 0; i < n; i++) {
    diff |= (e.charCodeAt(i % e.length) ^ g.charCodeAt(i % (g.length || 1)));
  }
  return diff === 0;
}

/** 수집 로그 상태 글 분류: 'import'(구조 적재 성공) / 'raw'(원문 보관 성공) / 'held'(확인필요·실패) / 'other' */
function collectLogKind_(cat, status) {
  var c = String(cat || ''), s = String(status || '');
  if (c === '원문') return /^원문 실패/.test(s) ? 'other' : 'raw';
  if (/^확인필요/.test(s) || /^실패/.test(s) || c === '확인필요' || c === '오류') return 'held';
  if (/^건너뜀/.test(s)) return 'other';
  return 'import';
}

/**
 * 관리 카드용 방별 수집 요약.
 *  rooms   : 수집 경로 배열(collectRouteFrom*_ 결과)
 *  logRows : [{ts(ms), cat, room, status}] — _upload_log 최근 줄(순서 상관없음)
 *  heldFiles: 확인필요 폴더의 파일 이름 배열
 *  lastRun : 스크립트 속성 kakao_last_ingest 를 JSON 으로 읽은 값(없으면 null)
 * 결과 {rooms:[{room, kinds, region, enabled, export, structured, keep_raw, last_import_at, last_raw_at, held}],
 *       held_total, held_names, unregistered, last_run}  — *_at 은 ms 숫자(없으면 null).
 * 방별 held = 그 방의 마지막 구조 적재 뒤에 쌓인 확인필요·실패 줄 수.
 * unregistered = 로그에 확인필요로 나온 방 이름 중 매핑에 없는 것(최근 순, 최대 10).
 */
function summarizeCollectStatus_(rooms, logRows, heldFiles, lastRun) {
  var byRoom = {};
  var rows = (logRows || []).slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var name = String(r.room || '').trim();
    if (!name) continue;
    var st = byRoom[name] || (byRoom[name] = { imp: null, raw: null, held: 0, lastHeldTs: 0 });
    var k = collectLogKind_(r.cat, r.status);
    if (k === 'import') { st.imp = r.ts; st.held = 0; }
    else if (k === 'raw') st.raw = r.ts;
    else if (k === 'held') { st.held++; st.lastHeldTs = r.ts || 0; }
  }
  var known = {};
  var outRooms = [];
  for (var j = 0; j < (rooms || []).length; j++) {
    var rt = rooms[j];
    if (!rt || !rt.roomName) continue;
    known[rt.roomName] = true;
    var s = byRoom[rt.roomName] || { imp: null, raw: null, held: 0 };
    outRooms.push({
      room: rt.roomName, kinds: (rt.labels && rt.labels.length ? rt.labels : rt.kinds).slice(), region: rt.team,
      enabled: rt.enabled, export: rt['export'], structured: rt.structured, keep_raw: rt.keepRaw,
      last_import_at: s.imp == null ? null : s.imp,
      last_raw_at: s.raw == null ? null : s.raw,
      held: s.held
    });
  }
  var unreg = [];
  for (var nm in byRoom) {
    if (!Object.prototype.hasOwnProperty.call(byRoom, nm)) continue;
    if (known[nm] || !byRoom[nm].held) continue;
    if (/\.txt$/i.test(nm)) continue; // 방 이름을 못 읽은 파일(파일 이름으로 기록됨)
    unreg.push({ name: nm, ts: byRoom[nm].lastHeldTs });
  }
  unreg.sort(function (a, b) { return b.ts - a.ts; });
  var files = heldFiles || [];
  return {
    rooms: outRooms,
    held_total: files.length,
    held_names: files.slice(0, 10),
    unregistered: unreg.slice(0, 10).map(function (u) { return u.name; }),
    last_run: lastRun || null
  };
}
