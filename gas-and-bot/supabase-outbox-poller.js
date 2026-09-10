/**
 * 메신저봇R - Supabase outbox 폴링 → 지역별 방에 자동 게시 (GAS 미경유, v0.7.39a+).
 *
 *  흐름:
 *   - pull  : GET  /rest/v1/outbox?select=id,room,text&order=created_at.asc
 *   - send  : bot.send(room, text) 성공(true)한 것만 id 수집
 *   - ack   : DELETE /rest/v1/outbox?id=in.(id1,id2,...)  ← 전송 성공분만 삭제(무유실)
 *   - 실패분은 큐에 남아 다음 폴링 재시도
 *   - WakeLock 으로 화면 꺼도 CPU 유지(Doze 방지), 메시지 오면 즉시 폴링
 *
 *  2026-09-10 갱신 (이 파일 전체를 붙여넣으면 됨):
 *   ① sentIds — 보냈는데 삭제(ack)만 실패한 메시지 기억 → 재발송 방지 (포스터 2번 발송 수리)
 *   ② reportSeen — 방에 사람 메시지가 오면 room_activity에 보고(30분에 1번) →
 *      심박 크론이 "20시간 조용한 방"에만 봇 줄을 보냄 = 활발한 방엔 아침 봇 메시지 없음
 *
 *  ★ 봇이 알림 보낼 방(테스트 전용방 / 운영 방)의 멤버여야 함.
 */

// ===================== 설정 =====================
const SUPABASE_URL  = "https://kkdiihazgzesbqxjytqv.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw";
const POLL_INTERVAL = 7000;   // 7초
// ================================================

const REST = SUPABASE_URL + "/rest/v1";
const bot = BotManager.getCurrentBot();
var wakePoll = false;
var lastPull = 0;
var sentIds = {};    // 보냈는데 삭제만 실패한 메시지 기억 — 재발송 방지 (2026-09-02 포스터 2번 발송 수리)
var sentOrder = [];
var _seenAt = {};    // 방별 활동 보고 스로틀 (30분)

// ---- WakeLock: CPU가 얼지(Doze) 않게 ----
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
// 방마다 30분에 1번만 보내 트래픽·배터리 부담 없음. 실패해도 무시(심박이 예전처럼 돌 뿐).
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

function pollOnce() {
  lastPull = java.lang.System.currentTimeMillis();
  var body = httpGet("/outbox?select=id,room,text&order=created_at.asc");
  var items = JSON.parse(body);
  if (!items || !items.length) return;
  var acked = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (sentIds[it.id]) { acked.push(it.id); continue; }  // 이미 보낸 것 — 삭제만 다시
    var r = false;
    try { r = bot.send(it.room, it.text); } catch (e) {}
    if (r === true) {
      sentIds[it.id] = true; sentOrder.push(it.id);
      if (sentOrder.length > 200) delete sentIds[sentOrder.shift()];
      acked.push(it.id); Log.i("[게시] " + it.room);
    }
  }
  if (acked.length) {
    // PostgREST in 필터: id=in.(uuid1,uuid2,...)
    try { httpDelete("/outbox?id=in.(" + acked.join(",") + ")"); } catch (e) { Log.e("[ack] " + e); }
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
