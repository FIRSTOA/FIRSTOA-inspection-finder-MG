/**
 * 메신저봇R - 웹앱 [보내기]로 저장된 점검양식을 방에 자동 게시. (버전 36 운영 확정본)
 *
 *  핵심:
 *   - 이 버전엔 msg.replier 가 없어 대상 방 메시지 객체(savedMsg)를 저장 → savedMsg.reply(text) 로 전송
 *   - 재컴파일 시 낡은 폴링 스레드를 interrupt 로 정리하고 현재 컨텍스트로 새로 시작(stale 방지)
 *   - 15초 간격 폴링(GAS 실행시간 한도 고려)
 *
 *  ★ 설치 후: 봇 ON → 대상 방(TARGET_ROOM)에 메시지 1개 보내 세션을 잡아줄 것.
 *  ★ 실제 운영 시: TARGET_ROOM 을 실제 점검방 이름으로 변경.
 */

// ===================== 설정 =====================
const WEBAPP_URL    = "https://script.google.com/macros/s/AKfycbzoubwDNWFpiR7h9YTEfQBTM2wE69GeqXI4fjVJQ-wPdEsQ9thxASo2J4ydytaPXyoO/exec";
const BOT_TOKEN     = "firstoa2026";
const TARGET_ROOM   = "메모장";        // ← 운영 시 점검방 이름으로 변경(카톡방 제목과 정확히 동일)
const POLL_INTERVAL = 15000;           // 폴링 주기(ms). 15초
// ================================================

const bot = BotManager.getCurrentBot();
var savedMsg = null;   // 대상 방에서 온 마지막 메시지 객체(= 그 방으로 보낼 수 있는 세션)

function onMessage(msg) {
  try {
    if (String(msg.room) === TARGET_ROOM) savedMsg = msg;
  } catch (e) {}
}
bot.addListener(Event.MESSAGE, onMessage);

function pullAndSend() {
  if (!savedMsg) return;   // 방 세션이 아직 없으면 큐를 건드리지 않음(메시지 보존)
  var url = WEBAPP_URL + "?action=pull&token=" + encodeURIComponent(BOT_TOKEN);
  var res = org.jsoup.Jsoup.connect(url)
    .ignoreContentType(true).followRedirects(true).timeout(15000).execute();
  var data = JSON.parse(res.body());
  if (data && data.ok && data.messages && data.messages.length > 0) {
    for (var i = 0; i < data.messages.length; i++) savedMsg.reply(data.messages[i]);
  }
}

/** 재컴파일 대비: 낡은 스레드 정리(interrupt) 후 현재 컨텍스트로 새 스레드 시작 */
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
