/**
 * 메신저봇R(릴리즈 41) "점검AS" - Supabase outbox 폴링 → 지역별 방에 자동 게시.
 * ★ 이 파일이 봇 폰 실물과 같은 기준본 — 통짜 붙여넣기로 교체한다.
 *
 *  흐름:
 *   - pull  : GET  /rest/v1/outbox?select=id,room,text&order=created_at.asc
 *   - send  : bot.send(room, text) → 실패 시 세션답장 폴백(방별 최근 수신 메시지 reply)
 *   - ack   : DELETE /rest/v1/outbox?id=in.(...)  ← 전송 성공분만 삭제(무유실)
 *   - "봇테스트" 수신 시 "봇 살아있음 OK" 응답(상시 헬스체크)
 *
 *  2026-09-10 갱신:
 *   ① sentIds — 보냈는데 삭제(ack)만 실패한 메시지 기억 → 재발송 방지(포스터 2번 발송 수리)
 *   ② reportSeen — 방에 사람 메시지가 오면 room_activity에 보고(30분에 1번) →
 *      심박 크론이 "20시간 조용한 방"에만 봇 줄을 보냄 = 활발한 방엔 아침 봇 메시지 없음
 */

// ===================== 설정 =====================
const SUPABASE_URL  = "https://kkdiihazgzesbqxjytqv.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw";
const POLL_INTERVAL = 7000;
// ================================================

const REST = SUPABASE_URL + "/rest/v1";
const bot = BotManager.getCurrentBot();
var wakePoll = false;
var lastPull = 0;
var sessions = {}; // 방별 최근 메시지 세션 — bot.send 실패 시 이걸로 답장
var sentIds = {};  // 보냈는데 삭제만 실패한 메시지 기억 — 재발송 방지
var sentOrder = [];
var _seenAt = {};  // 방별 활동 보고 스로틀 (30분)

var _wakeLock = null;
function acquireWakeLock() {
  if (_wakeLock !== null) { try { if (_wakeLock.isHeld()) return; } catch (e) {} }
  var ctx = null;
  try { ctx = com.xfl.msgbot.application.MainApplication.Companion.getContext(); } catch (e) {}
  if (!ctx) { try { ctx = Api.getContext(); } catch (e) {} }
  if (!ctx) { Log.i("[WakeLock] 컨텍스트 못 얻음 → 화면 켜두기 필요"); return; }
  try {
    var pm = ctx.getSystemService(android.content.Context.POWER_SERVICE);
    _wakeLock = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "firstoa:poller");
    _wakeLock.setReferenceCounted(false);
    _wakeLock.acquire();
    Log.i("[WakeLock] 획득 — CPU 유지");
  } catch (e) { Log.e("[WakeLock] 실패: " + e); }
}

// 방 활동 보고 — 사람 메시지가 있는 방은 심박(아침 봇 줄) 대상에서 빠진다.
// 방마다 30분에 1번만 보내므로 트래픽·배터리 부담 없음. 실패해도 무시(심박이 예전처럼 돌 뿐).
function reportSeen(room) {
  try {
    if (!room) return;
    var key = String(room);
    var nowMs = java.lang.System.currentTimeMillis();
    if (_seenAt[key] && nowMs - _seenAt[key] < 30 * 60 * 1000) return;
    _seenAt[key] = nowMs;
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

function onMessage(msg) {
  Log.i("[방인식] '" + msg.room + "' (" + msg.room.length + "자)");
  sessions[msg.room] = msg;
  if (msg.content == "봇테스트") {
    try { Log.i("[에코] " + msg.reply("봇 살아있음 OK")); } catch (e) { Log.e("[에코실패] " + e); }
  }
  try {
    if (java.lang.System.currentTimeMillis() - lastPull > 2000) {
      wakePoll = true;
      try { pollOnce(); } catch (e) {}
    }
  } catch (e) {}
  try { reportSeen(msg.room); } catch (e) {}
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

function findSession(room) {
  if (sessions[room]) return sessions[room];
  var want = String(room).replace(/\s+/g, "");
  for (var k in sessions) {
    if (String(k).replace(/\s+/g, "") === want) return sessions[k];
  }
  return null;
}

function pollOnce() {
  lastPull = java.lang.System.currentTimeMillis();
  var body;
  try { body = httpGet("/outbox?select=id,room,text&order=created_at.asc"); }
  catch (e) { Log.e("[폴링] 서버 접속 실패: " + e); return; }
  var items = JSON.parse(body);
  if (!items || !items.length) return;
  var acked = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (sentIds[it.id]) { acked.push(it.id); continue; }  // 이미 보낸 것 — 삭제만 다시
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
      acked.push(it.id); Log.i("[게시] " + it.room);
    } else {
      var keys = [];
      for (var k in sessions) keys.push("'" + k + "'");
      Log.e("[전송실패] 원하는 방: '" + it.room + "' / 보유 세션: " + (keys.length ? keys.join(", ") : "없음(재컴파일 후 이 방에서 받은 메시지 0건)"));
    }
  }
  if (acked.length) {
    try { httpDelete("/outbox?id=in.(" + acked.join(",") + ")"); }
    catch (e) { Log.e("[ack 실패] " + e); }
  }
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
      try { pollOnce(); } catch (e) {}
      var waited = 0;
      while (waited < POLL_INTERVAL) {
        if (wakePoll) { wakePoll = false; break; }
        try { java.lang.Thread.sleep(300); } catch (e) { return; }
        waited += 300;
      }
    }
  });
  t.setName("inspPoller"); t.setDaemon(true); t.start();
  Log.i("[봇] Supabase outbox 폴링 시작");
}
function onStartCompile() { startPolling(); }
startPolling();
