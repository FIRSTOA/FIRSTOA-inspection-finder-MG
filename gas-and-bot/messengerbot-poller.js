/**
 * 메신저봇R - 웹앱 저장 양식을 지역별 방에 자동 게시. (버전 0.7.39a+, 멀티룸, 무유실)
 *
 *  방식(ack 기반 무유실):
 *   - pull: 대기 중 전체를 {id, room, text}로 받음(서버는 삭제 안 함)
 *   - bot.send(room, text) 성공(true)한 것만 ack → 서버가 그 id 삭제
 *   - 실패(false: 봇이 그 방 멤버 아님/일시 오류)한 건 큐에 남아 다음 폴링에 재시도 → 유실 0
 *   - 방 활동(onMessage) 시 폴링 즉시 깨움 → 지연 최소
 *
 *  ★ 봇이 알림 보낼 방들(테스트 전용방 / 운영 8개 방)의 멤버여야 함.
 *    v39 bot.send 는 방 활동 없이도 멤버 방엔 전송됨(v36의 세션 식음 문제 해결).
 *  ★ v39에서 컴파일 모드 에러 시 인터프리터 모드 사용(패치노트 권장).
 */

// ===================== 설정 =====================
const WEBAPP_URL    = "https://script.google.com/macros/s/AKfycbzoubwDNWFpiR7h9YTEfQBTM2wE69GeqXI4fjVJQ-wPdEsQ9thxASo2J4ydytaPXyoO/exec";
const BOT_TOKEN     = "firstoa2026";
const POLL_INTERVAL = 7000;            // 7초 (백업 폴링 주기)
// ================================================

const bot = BotManager.getCurrentBot();
var wakePoll = false;
var lastPull = 0;

function onMessage(msg) {
  try { if (java.lang.System.currentTimeMillis() - lastPull > 2000) wakePoll = true; } catch (e) {}
}
bot.addListener(Event.MESSAGE, onMessage);

function httpGet(qs) {
  return org.jsoup.Jsoup.connect(WEBAPP_URL + qs)
    .ignoreContentType(true).followRedirects(true).timeout(20000).execute().body();
}

function pollOnce() {
  lastPull = java.lang.System.currentTimeMillis();
  var data = JSON.parse(httpGet("?action=pull&token=" + encodeURIComponent(BOT_TOKEN)));
  if (!data || !data.ok || !data.items || !data.items.length) return;
  var acked = [];
  for (var i = 0; i < data.items.length; i++) {
    var it = data.items[i];
    var r = false;
    try { r = bot.send(it.room, it.text); } catch (e) {}
    if (r === true) { acked.push(it.id); Log.i("[게시] " + it.room); }
  }
  if (acked.length) {
    try { httpGet("?action=ack&token=" + encodeURIComponent(BOT_TOKEN) + "&ids=" + encodeURIComponent(acked.join(","))); } catch (e) {}
  }
}

function startPolling() {
  var threads = java.lang.Thread.getAllStackTraces().keySet().toArray();
  for (var i in threads) {
    var nm = String(threads[i].getName());
    if (nm === "inspPoller" || nm === "sendTest") { try { threads[i].interrupt(); } catch (e) {} }
  }
  var t = new java.lang.Thread(function () {
    while (true) {
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
  Log.i("[봇] 시작");
}
function onStartCompile() { startPolling(); }
startPolling();
