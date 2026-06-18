/**
 * 해피콜 자동화 질의응답 봇 (v0.7.39a+)
 *   - 허용된 방에서 ? 또는 / 로 시작하는 메시지를 Make.com 웹훅에 전달
 *   - 웹훅 응답을 "키 : 값" 단위로 줄바꿈 정리해서 답장(msg.reply)
 *   - 들어온 메시지에 답장하는 방식이라 v39에서 안정적(발신큐 폴링 봇과 별개 봇으로 둬도 됨)
 */
const bot = BotManager.getCurrentBot();

// ===================== 설정 =====================
const WEBHOOK_URL   = 'https://hook.eu2.make.com/lt9wx6bw6sp8susiupzkb8y16q69kdpl';
const ALLOWED_ROOMS = ['해피콜 자동화(점검 및 AS)'];   // 처리할 방 (정확한 방 제목)
const FORMAT_KEYS   = ['등급', '지역', '업체명', '기종', '담당자', '방문일자', '처리내용', '특이사항', '대응방식 / 이력첨부'];
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

    var raw = String(response.text());

    // "키 : 값" 패턴 앞에 줄바꿈을 강제로 삽입
    var formatted = raw;
    for (var i = 0; i < FORMAT_KEYS.length; i++) {
      var re = new RegExp('\\s+' + FORMAT_KEYS[i] + '\\s*:\\s*', 'g');
      formatted = formatted.replace(re, '\n' + FORMAT_KEYS[i] + ' : ');
    }
    formatted = formatted.replace(/^\n+/, '');   // 맨 앞 줄바꿈 정리

    msg.reply(formatted);
  } catch (e) {
    msg.reply(String(e));
  }
}

bot.addListener(Event.MESSAGE, onMessage);
