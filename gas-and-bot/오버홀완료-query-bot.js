/**
 * 오버홀 완료방 질의응답 봇 (v0.7.39a+)
 *   - 허용된 방에서 "날짜" 로 시작하는 메시지를 Make.com 웹훅에 전달
 *   - 웹훅 응답을 그대로 답장(msg.reply)
 *   - 들어온 메시지에 답장하는 방식이라 v39에서 안정적(다른 봇들과 별개 봇으로 둬도 됨)
 */
const bot = BotManager.getCurrentBot();

// ===================== 설정 =====================
const WEBHOOK_URL   = 'https://hook.eu2.make.com/oigtwb54zpkq7c1rwrkp386pxk09t8dc';
const ALLOWED_ROOMS = ['오버홀 완료방'];   // 처리할 방 (정확한 방 제목)
const TRIGGER       = '날짜';               // 이 글자로 시작하는 메시지만 처리
// ================================================

function onMessage(msg) {
  // "날짜" 로 시작하는 메시지만 처리
  if (!msg.content.startsWith(TRIGGER)) return;
  // 허용된 방만
  if (ALLOWED_ROOMS.indexOf(msg.room) === -1) return;

  try {
    var response = org.jsoup.Jsoup.connect(WEBHOOK_URL)
      .header('Content-Type', 'application/json')
      .requestBody(JSON.stringify({
        msg: msg.content,
        room: msg.room,
        sender: msg.author.name
      }))
      .ignoreContentType(true)
      .ignoreHttpErrors(true)
      .timeout(60000)
      .post();

    msg.reply(String(response.text()));
  } catch (e) {
    msg.reply(String(e));
  }
}

bot.addListener(Event.MESSAGE, onMessage);
