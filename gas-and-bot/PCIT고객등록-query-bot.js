/**
 * PC/IT/피씨/확장성 고객등록및영업 방 질의응답 봇 (v0.7.39a+)
 *   - 허용된 방에서 ? 또는 / 로 시작하는 메시지를 Make.com 웹훅에 전달
 *   - 웹훅 응답을 그대로 답장(msg.reply)
 *   - 들어온 메시지에 답장하는 방식이라 v39에서 안정적(다른 봇들과 별개 봇으로 둬도 됨)
 */
const bot = BotManager.getCurrentBot();

// ===================== 설정 =====================
const WEBHOOK_URL   = 'https://hook.eu2.make.com/lbqm3gagamu44myc3vwocc7rm4qrb95r';
const ALLOWED_ROOMS = ['PC/IT/피씨/확장성고객등록및영업'];   // 처리할 방 (정확한 방 제목)
// ================================================

function onMessage(msg) {
  // ? 또는 / 로 시작하는 메시지만 처리
  if (!msg.content.startsWith('?') && !msg.content.startsWith('/')) return;
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
