/**
 * 메신저봇R "점검AS" - Supabase outbox 폴링 → 지역별 방에 자동 게시.
 * ★ 이 파일이 봇 폰 실물과 같은 기준본 — 통짜 붙여넣기로 교체한다.
 *
 *  흐름:
 *   - pull  : GET  /rest/v1/outbox?select=id,room,text,created_at&order=created_at.asc
 *   - send  : bot.send(room, text) → 실패 시 세션답장 폴백(방별 최근 수신 메시지 reply)
 *   - ack   : DELETE /rest/v1/outbox?id=in.(...)  ← 전송 성공분만 삭제(무유실)
 *   - "봇테스트" 수신 시 "봇 살아있음 OK" 응답(상시 헬스체크)
 *
 *  2026-09-29 (크래시 → 봇 저절로 꺼짐 수리):
 *   ① 폴링은 inspPoller 스레드 한 곳에서만. 메시지 수신(onMessage)이 pollOnce를 직접 부르던 것을 없애고
 *      깨우기 신호(wakePoll)만 준다 — 두 스레드가 동시에 JS를 돌리면 GraalJS 내부 오류
 *      (ArrayIndexOutOfBoundsException: join 스택 pop index=-1)로 CrashLog가 뜨고 봇이 꺼졌다.
 *   ② 스레드 사이 JS 실행을 자물쇠(ReentrantLock)로 줄 세운다. HTTP 통신(자바 Jsoup)은 자물쇠 밖에서.
 *   ③ 배열 join 대신 문자열 더하기 — join이 그 내부 오류의 진원지였다.
 *   ④ 세션 없는 방(재컴파일 뒤 그 방에서 받은 메시지 0건)은 10분에 1번만 재시도·로그 —
 *      같은 [전송실패] 토스트가 7초마다 뜨던 것. 그 방에서 메시지가 오면 바로 다시 보낸다.
 *   ⑤ 12시간 지난 심박("🤖 … 카톡봇 대기 중")은 보내지 않고 지운다.
 *   ⑥ sentIds — 보냈는데 삭제(ack)만 실패한 글 기억 → 두 번 올라가지 않게.
 *   ⑦ 방 활동 보고(room_activity, 30분에 1번) — 심박 크론이 조용한 방에만 봇 줄을 보내게. 폴링 스레드가 보낸다.
 *   WakeLock 코드는 폰에서 검증된 그대로(App.getContext → xfl → Api 순, "power", 1=PARTIAL_WAKE_LOCK).
 *
 *  2026-10-10 ⑧ 마감 목록 수집 — 관리부가 마감방에 올린 카운터 목록(【수도권C】…, [수도권C]…CMS.15)을 그대로
 *      counter_sms_inbox 에 넣는다. FIELD 카운터 문자 탭이 "관리부 목록 도착"으로 띄우고 [목록 맞추기]로 넣는다.
 *      어느 방이 마감방인지는 이 파일에 적지 않는다 — FIELD 관리 탭 → 카톡방 매핑 → 업무 종류 "마감"(room_map)을
 *      10분마다 읽는다(앱·노트북 실행기와 한 곳에서 관리). onMessage 는 글을 큐에만 넣고(통신 없음) 폴링 스레드가
 *      flushLists 로 보낸다 — ①②와 같은 규칙. 봇 폰에서 그 방의 알림이 켜져 있어야 글이 들어온다.
 */

// ===================== 설정 =====================
const SUPABASE_URL  = "https://kkdiihazgzesbqxjytqv.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw";
const POLL_INTERVAL = 7000;
const RETRY_MS      = 10 * 60 * 1000; // 세션 없는 방 재시도 간격
const LIST_ROOMS_REFRESH_MS = 10 * 60 * 1000; // 마감방 이름(room_map '마감') 다시 읽는 간격
// 마감 목록으로 볼 글: 머리글 【수도권C】·[수도권C]·【CSS】, 또는 CMS 결제일("CMS.15")이 든 글, 또는 "번호, 번호등급업체명" 줄이 2개 이상
const LIST_HEAD_RE  = /^\s*[【\[]\s*(수도권\s*[A-Ea-e]|CSS|지방)\s*[】\]]/;
const LIST_CMS_RE   = /CMS\s*[.·-]?\s*\d{1,2}/i;
const LIST_BLOCK_RE = /(^|\n)\s*\d+\s*,\s*\d*[A-Za-z]*\s*[가-힣(]/;   // g 플래그 없음 — test()의 lastIndex 꼬임 방지
// ================================================

const REST = SUPABASE_URL + "/rest/v1";
const bot = BotManager.getCurrentBot();
var wakePoll = false;
var lastPull = 0;
var sessions = {};   // 방별 최근 메시지 세션 — bot.send 실패 시 이걸로 답장
var sentIds = {};    // 보냈는데 삭제만 실패한 글 기억 — 재발송 방지
var sentOrder = [];
var _seenQueue = {}; // 메시지가 온 방 — 폴링 스레드가 room_activity에 보고
var _seenAt = {};    // 방별 활동 보고 스로틀 (30분)
var _failedAt = {};  // 방(공백 제거)별 마지막 전송 실패 시각 — 세션 없는 방은 RETRY_MS마다 1번만
var _listQueue = [];                   // 마감방에서 받은 목록 글 — 폴링 스레드가 counter_sms_inbox 로 보낸다(⑧)
var _listRooms = { names: [], at: 0 }; // room_map '마감' 방 이름 캐시(⑧)
var _polling = false;
var _lock = new java.util.concurrent.locks.ReentrantLock(); // 스레드 사이 JS 실행 줄 세우기

function nowMs() { return java.lang.System.currentTimeMillis(); }
function roomKey(room) { return String(room || "").replace(/\s+/g, ""); }
function joinStr(arr, sep) { var s = ""; for (var i = 0; i < arr.length; i++) s += (i ? sep : "") + arr[i]; return s; }
function withLock(fn) {
  var got = false;
  try { got = _lock.tryLock(3000, java.util.concurrent.TimeUnit.MILLISECONDS); } catch (e) {}
  try { return fn(); } finally { if (got) { try { _lock.unlock(); } catch (e) {} } }
}

var _wakeLock = null;
function acquireWakeLock() {
  if (_wakeLock !== null) { try { if (_wakeLock.isHeld()) return; } catch (e) {} }
  var ctx = null;
  try { ctx = App.getContext(); } catch (e) {}                                              // 메신저봇R
  if (!ctx) { try { ctx = com.xfl.msgbot.application.MainApplication.Companion.getContext(); } catch (e) {} } // 구앱(xfl)
  if (!ctx) { try { ctx = Api.getContext(); } catch (e) {} }
  if (!ctx) { Log.i("[WakeLock] 컨텍스트 못 얻음 → 화면 켜두기 필요"); return; }
  try {
    var pm = ctx.getSystemService("power");          // Context.POWER_SERVICE = "power"
    _wakeLock = pm.newWakeLock(1, "firstoa:poller"); // 1 = PARTIAL_WAKE_LOCK
    _wakeLock.setReferenceCounted(false);
    _wakeLock.acquire();
    Log.i("[WakeLock] 획득 — CPU 유지");
  } catch (e) { Log.e("[WakeLock] 실패: " + e); }
}

// 방 활동 보고 — 사람 메시지가 있는 방은 심박(아침 봇 줄) 대상에서 빠진다. 방마다 30분에 1번. 실패해도 무시.
function reportSeen(room) {
  try {
    if (!room) return;
    var key = String(room);
    var t = nowMs();
    if (_seenAt[key] && t - _seenAt[key] < 30 * 60 * 1000) return;
    _seenAt[key] = t;
    org.jsoup.Jsoup.connect(REST + "/room_activity")
      .header("apikey", SUPABASE_ANON)
      .header("Authorization", "Bearer " + SUPABASE_ANON)
      .header("Content-Type", "application/json")
      .header("Prefer", "resolution=merge-duplicates")
      .requestBody(JSON.stringify({ room: key, last_at: new Date().toISOString(), source: "message" }))
      .ignoreContentType(true).followRedirects(true).timeout(15000)
      .method(org.jsoup.Connection.Method.POST)
      .execute();
  } catch (e) {}
}
function flushSeen() { // 폴링 스레드에서 — 알림 스레드(onMessage)는 통신을 하지 않는다
  var rooms = withLock(function () { var out = []; for (var k in _seenQueue) out.push(k); _seenQueue = {}; return out; }) || [];
  for (var i = 0; i < rooms.length; i++) { try { reportSeen(rooms[i]); } catch (e) {} }
}

function onMessage(msg) {
  var room = String(msg.room);
  withLock(function () {
    Log.i("[방인식] '" + room + "' (" + room.length + "자)");
    sessions[room] = msg;
    _seenQueue[room] = true;
    // ⑧ 마감방 목록 글은 큐에만 — 방 목록을 아직 못 읽었으면 일단 담아 두고 폴링 스레드가 거른다
    if ((!_listRooms.at || isListRoom(room)) && looksLikeList(msg.content)) {
      var who = ""; try { who = String(msg.author && msg.author.name ? msg.author.name : (msg.sender || "")); } catch (e) {}
      _listQueue.push({ room: room, sender: who, text: String(msg.content) });
    }
    if (_failedAt[roomKey(room)]) delete _failedAt[roomKey(room)]; // 이 방 세션이 생겼다 — 밀린 글 바로 시도
    if (msg.content == "봇테스트") {
      try { Log.i("[에코] " + msg.reply("봇 살아있음 OK")); } catch (e) { Log.e("[에코실패] " + e); }
    }
  });
  wakePoll = true; // 폴링 스레드를 깨운다 — 여기서 pollOnce를 직접 부르지 않는다(스레드 충돌 방지)
}
bot.addListener(Event.MESSAGE, onMessage);

function httpGet(path) {
  return org.jsoup.Jsoup.connect(REST + path)
    .header("apikey", SUPABASE_ANON)
    .header("Authorization", "Bearer " + SUPABASE_ANON)
    .ignoreContentType(true).followRedirects(true).timeout(20000)
    .execute().body();
}

function httpDelete(path) {
  org.jsoup.Jsoup.connect(REST + path)
    .header("apikey", SUPABASE_ANON)
    .header("Authorization", "Bearer " + SUPABASE_ANON)
    .ignoreContentType(true).followRedirects(true).timeout(20000)
    .method(org.jsoup.Connection.Method.DELETE)
    .execute();
}

function httpPostJson(path, json) {
  org.jsoup.Jsoup.connect(REST + path)
    .header("apikey", SUPABASE_ANON)
    .header("Authorization", "Bearer " + SUPABASE_ANON)
    .header("Content-Type", "application/json")
    .header("Prefer", "return=minimal")
    .requestBody(json)
    .ignoreContentType(true).followRedirects(true).timeout(20000)
    .method(org.jsoup.Connection.Method.POST)
    .execute();
}

// ⑧ 마감 목록 수집 ---------------------------------------------------------
function countListBlocks(t) { var m = t.match(/(^|\n)\s*\d+\s*,\s*\d*[A-Za-z]*\s*[가-힣(]/g); return m ? m.length : 0; }
function looksLikeList(text) {
  var t = String(text || "");
  if (LIST_HEAD_RE.test(t)) return true;
  if (LIST_CMS_RE.test(t) && LIST_BLOCK_RE.test(t)) return true;
  return countListBlocks(t) >= 2 && t.length >= 120;
}
function isListRoom(room) {
  var k = roomKey(room);
  for (var i = 0; i < _listRooms.names.length; i++) if (roomKey(_listRooms.names[i]) === k) return true;
  return false;
}
// room_map 에서 category='마감' 인 방 이름을 10분마다 — 폴링 스레드에서만(통신은 자물쇠 밖, 해석은 안)
function ensureListRooms() {
  var t = nowMs();
  if (_listRooms.at && t - _listRooms.at < LIST_ROOMS_REFRESH_MS) return;
  var body;
  try { body = httpGet("/room_map?select=region,room&category=eq." + encodeURIComponent("마감")); }
  catch (e) { Log.e("[마감수집] 방 목록 조회 실패: " + e); if (_listRooms.at) _listRooms.at = t - LIST_ROOMS_REFRESH_MS + 60000; return; }
  withLock(function () {
    var rows = []; try { rows = JSON.parse(body) || []; } catch (e) { rows = []; }
    var names = [];
    for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].room) names.push(String(rows[i].room));
    var changed = joinStr(names, "|") !== joinStr(_listRooms.names, "|");
    _listRooms = { names: names, at: t };
    if (changed || !names.length) Log.i("[마감수집] 마감방(관리 탭 카톡방 매핑): " + (names.length ? joinStr(names, ", ") : "없음 — FIELD 관리 탭에서 업무 종류 '마감'을 등록하세요"));
  });
}
// 큐에 쌓인 목록 글을 마감방 것만 counter_sms_inbox 로 — 폴링 스레드에서만
function flushLists() {
  ensureListRooms();
  var jobs = withLock(function () {
    if (!_listQueue.length) return [];
    if (!_listRooms.at) { if (_listQueue.length > 20) _listQueue = _listQueue.slice(-20); return []; } // 방 목록을 아직 못 읽음 — 다음 폴링에
    var out = [];
    for (var i = 0; i < _listQueue.length; i++) {
      var it = _listQueue[i];
      if (!isListRoom(it.room)) continue;
      out.push({ room: it.room, len: it.text.length, sender: it.sender, json: JSON.stringify({ room: it.room, sender: it.sender, text: it.text, received_at: new Date().toISOString() }) });
    }
    _listQueue = [];
    return out;
  }) || [];
  for (var j = 0; j < jobs.length; j++) {
    try { httpPostJson("/counter_sms_inbox", jobs[j].json); Log.i("[마감수집] 저장 " + jobs[j].room + " · " + jobs[j].len + "자 · " + jobs[j].sender); }
    catch (e) { Log.e("[마감수집] 저장 실패(" + jobs[j].room + "): " + e); }
  }
}
// --------------------------------------------------------------------------

function findSession(room) {
  if (sessions[room]) return sessions[room];
  var want = roomKey(room);
  for (var k in sessions) {
    if (roomKey(k) === want) return sessions[k];
  }
  return null;
}

// 한 번 폴링 — 서버에서 밀린 글을 받아 방마다 보내고, 보낸 것만 지운다. 폴링 스레드에서만 부른다.
function pollOnce() {
  if (_polling) return; // 겹침 방지
  _polling = true;
  try {
    lastPull = nowMs();
    var body;
    try { body = httpGet("/outbox?select=id,room,text,created_at&order=created_at.asc"); }
    catch (e) { Log.e("[폴링] 서버 접속 실패: " + e); return; }
    var acked = withLock(function () {
      var items;
      try { items = JSON.parse(body); } catch (e) { Log.e("[폴링] 응답 해석 실패: " + e); return []; }
      if (!items || !items.length) return [];
      var done = [];
      var t = nowMs();
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (sentIds[it.id]) { done.push(it.id); continue; } // 이미 보낸 것 — 삭제만 다시
        // 12시간 지난 심박은 보낼 의미가 없다 — 보내지 않고 지운다(세션 없는 방에 며칠씩 쌓여 실패 로그만 냈다)
        var created = Date.parse(String(it.created_at || "").replace(/(\.\d{3})\d+/, "$1"));
        var ageMs = created ? t - created : 0;
        if (/^🤖/.test(String(it.text || "")) && ageMs > 12 * 60 * 60 * 1000) { done.push(it.id); Log.i("[심박 폐기] " + it.room); continue; }
        var rk = roomKey(it.room);
        if (_failedAt[rk] && t - _failedAt[rk] < RETRY_MS) continue; // 세션 없는 방 — 10분 뒤에(또는 그 방 메시지가 오면) 다시
        var r = false;
        try { r = bot.send(it.room, it.text); } catch (e) { Log.e("[전송오류] " + e); }
        if (r !== true) {
          var s = findSession(it.room);
          if (s) {
            try { r = s.reply(it.text); Log.i("[세션답장] " + it.room + " → " + r); }
            catch (e) { Log.e("[세션답장 오류] " + e); }
          }
        }
        if (r === true) {
          sentIds[it.id] = true; sentOrder.push(it.id);
          if (sentOrder.length > 200) delete sentIds[sentOrder.shift()];
          delete _failedAt[rk];
          done.push(it.id); Log.i("[게시] " + it.room);
        } else {
          _failedAt[rk] = t;
          var names = ""; var n = 0;
          for (var k in sessions) names += (n++ ? ", " : "") + "'" + k + "'";
          Log.e("[전송실패] '" + it.room + "' — 재컴파일 뒤 이 방에서 받은 메시지가 없어 못 보냄. 그 방에 누가 글을 쓰면 바로 보냅니다(10분마다도 재시도). 보유 세션: " + (names || "없음"));
        }
      }
      return done;
    }) || [];
    if (acked.length) {
      try { httpDelete("/outbox?id=in.(" + joinStr(acked, ",") + ")"); }
      catch (e) { Log.e("[ack 실패] " + e); }
    }
  } finally { _polling = false; }
}

function startPolling() {
  acquireWakeLock();
  var threads = java.lang.Thread.getAllStackTraces().keySet().toArray();
  for (var i in threads) {
    var nm = String(threads[i].getName());
    if (nm === "inspPoller" || nm === "sendTest") { try { threads[i].interrupt(); } catch (e) {} }
  }
  var t = new java.lang.Thread(function () {
    while (true) {
      try { acquireWakeLock(); } catch (e) {}
      try { pollOnce(); } catch (e) { try { Log.e("[폴링 오류] " + e); } catch (e2) {} }
      try { flushSeen(); } catch (e) {}
      try { flushLists(); } catch (e) { try { Log.e("[마감수집] 오류: " + e); } catch (e2) {} }
      var waited = 0;
      while (waited < POLL_INTERVAL) {
        if (wakePoll) { wakePoll = false; break; }
        try { java.lang.Thread.sleep(300); } catch (e) { return; }
        waited += 300;
      }
    }
  });
  t.setName("inspPoller"); t.setDaemon(true); t.start();
  Log.i("[봇] Supabase outbox 폴링 시작 (2026-10-10판 — 마감 목록 수집 포함)");
}
function onStartCompile() { startPolling(); }
startPolling();
