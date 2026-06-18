/**
 * 메신저봇R - 웹앱 저장 양식을 지역별 방에 자동 게시. (버전 36, 멀티룸, 운영본)
 *
 *  - 각 방에서 온 메시지 객체를 방이름별로 저장(rooms) → 그 방으로 reply
 *  - 폴링 시 "봇이 세션 가진 방 목록"을 서버에 보내 보낼 수 있는 방 메시지만 받아 전송
 *    (세션 없는 방 메시지는 서버 큐에 'N'으로 남아 재시도 → 유실 방지)
 *  - 재컴파일 시 낡은 폴링 스레드 정리 후 새로 시작
 *
 *  ★ 봇이 알림 받을 방들(테스트 전용방 / 운영 시 8개 방)에 들어가 있어야 하고,
 *    각 방에서 메시지가 한 번씩 와야 세션이 잡힌다(그 방에 새 메시지 올 때마다 자동 갱신).
 *  ★ 한가한 방은 세션이 만료될 수 있음 — 활성 방(점검방/AS방)은 트래픽이 있어 늘 신선.
 */

// ===================== 설정 =====================
const WEBAPP_URL    = "https://script.google.com/macros/s/AKfycbzoubwDNWFpiR7h9YTEfQBTM2wE69GeqXI4fjVJQ-wPdEsQ9thxASo2J4ydytaPXyoO/exec";
const BOT_TOKEN     = "firstoa2026";
const POLL_INTERVAL = 10000;           // 10초
// ================================================

const bot = BotManager.getCurrentBot();
var rooms = {};   // 방이름 -> 마지막 메시지 객체(세션)

function onMessage(msg) {
  try { rooms[String(msg.room)] = msg; } catch (e) {}
}
bot.addListener(Event.MESSAGE, onMessage);

function knownRoomsParam() {
  var names = [];
  for (var k in rooms) { if (rooms.hasOwnProperty(k)) names.push(k); }
  return names.join("\n");
}

function pullAndSend() {
  var known = knownRoomsParam();
  if (!known) return;
  var url = WEBAPP_URL + "?action=pull&token=" + encodeURIComponent(BOT_TOKEN)
          + "&rooms=" + encodeURIComponent(known);
  var res = org.jsoup.Jsoup.connect(url)
    .ignoreContentType(true).followRedirects(true).timeout(15000).execute();
  var data = JSON.parse(res.body());
  if (data && data.ok && data.items && data.items.length > 0) {
    for (var i = 0; i < data.items.length; i++) {
      var it = data.items[i];
      var m = rooms[it.room];
      if (m) m.reply(it.text);
    }
  }
}

function startPolling() {
  var threads = java.lang.Thread.getAllStackTraces().keySet().toArray();
  for (var i in threads) {
    if (String(threads[i].getName()) === "inspPoller") {
      try { threads[i].interrupt(); } catch (e) {}
    }
  }
  var t = new java.lang.Thread(function () {
    while (true) {
      try { pullAndSend(); } catch (e) {}
      try { java.lang.Thread.sleep(POLL_INTERVAL); } catch (e) { break; }
    }
  });
  t.setName("inspPoller");
  t.setDaemon(true);
  t.start();
}

function onStartCompile() { startPolling(); }
startPolling();
