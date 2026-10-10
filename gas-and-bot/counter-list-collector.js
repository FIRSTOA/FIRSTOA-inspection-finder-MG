/**
 * 마감 목록 수집기 — 관리부가 마감 카톡방에 올린 목록을 그대로 Supabase(counter_sms_inbox)에 넣는다 (2026-10-10)
 *
 * 왜: 카운터 문자 탭은 사람이 카톡 글을 복사해 붙여넣어야 했다. 봇 폰은 방 글을 알림으로 "읽기"만 하면 되고,
 *     읽기는 답장 세션(알림 답장 통로)과 무관해서 방이 조용해 세션이 죽어도 동작한다. 폰이 켜져 있고 이 방 알림이 켜져 있으면 된다.
 *     앱은 counter_sms_inbox 에 새 글이 있으면 "관리부 목록 도착"을 띄우고 [목록 맞추기]로 바로 넣는다.
 *
 * 설치: 메신저봇R에서 새 스크립트로 저장(기존 점검AS 폴러와 별개 파일). ROOMS 에 마감방 이름을 정확히 적는다.
 *       봇 폰에서 그 방의 알림을 켜 둘 것(알림 끄기 상태면 글이 안 들어온다).
 * 확인: 마감방에 "【수도권C】" 로 시작하는 글을 올리면 Supabase counter_sms_inbox 에 행이 생긴다. 로그 "[마감수집] 저장 …".
 * 주의: 안드로이드 알림은 아주 긴 글을 자를 수 있다. 저장된 text 가 끝까지 들어왔는지 처음 몇 번은 확인하고,
 *       잘리면 관리부에 "구역별로 나눠 올려 달라"고 하거나 앱에서 붙여넣기로 보완한다(앱은 둘 다 받는다).
 */
const SUPABASE_URL  = "https://kkdiihazgzesbqxjytqv.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw";
// 마감 목록이 올라오는 방 이름(카톡 방 제목 그대로, 공백까지). 여러 개면 쉼표로 늘린다.
const ROOMS = ["마감방"];
// 목록으로 볼 글: 머리글 【수도권C】·[수도권C]·【CSS】, 또는 CMS 결제일("CMS.15")이 든 글, 또는 "숫자, 숫자등급업체명" 블록이 2개 이상
const HEAD_RE  = /^\s*[【\[]\s*(수도권\s*[A-Ea-e]|CSS|지방)\s*[】\]]/;
const CMS_RE   = /CMS\s*[.·-]?\s*\d{1,2}/i;
const BLOCK_RE = /(^|\n)\s*\d+\s*,\s*\d*[A-Za-z]*[가-힣(]/g;
// ================================================

const REST = SUPABASE_URL + "/rest/v1";
const bot = BotManager.getCurrentBot();

function roomKey(s) { return String(s || "").replace(/\s+/g, ""); }
function isListRoom(room) {
  var k = roomKey(room);
  for (var i = 0; i < ROOMS.length; i++) if (roomKey(ROOMS[i]) === k) return true;
  return false;
}
function looksLikeList(text) {
  var t = String(text || "");
  if (HEAD_RE.test(t)) return true;
  if (CMS_RE.test(t) && BLOCK_RE.test(t)) return true;
  var m = t.match(BLOCK_RE);
  return !!(m && m.length >= 2 && t.length >= 120);
}

function saveInbox(room, sender, text) {
  org.jsoup.Jsoup.connect(REST + "/counter_sms_inbox")
    .header("apikey", SUPABASE_ANON)
    .header("Authorization", "Bearer " + SUPABASE_ANON)
    .header("Content-Type", "application/json")
    .header("Prefer", "return=minimal")
    .requestBody(JSON.stringify({ room: String(room), sender: String(sender || ""), text: String(text), received_at: new Date().toISOString() }))
    .ignoreContentType(true).followRedirects(true).timeout(20000)
    .method(org.jsoup.Connection.Method.POST)
    .execute();
}

function onMessage(msg) {
  try {
    var room = String(msg.room);
    if (!isListRoom(room)) return;
    var text = String(msg.content || "");
    if (!looksLikeList(text)) return;
    var sender = String(msg.author ? msg.author.name : (msg.sender || ""));
    // 통신은 알림 스레드 밖에서 — 점검AS 폴러가 겪은 스레드 충돌을 피한다
    new java.lang.Thread(function () {
      try { saveInbox(room, sender, text); Log.i("[마감수집] 저장 " + room + " · " + text.length + "자 · " + sender); }
      catch (e) { Log.e("[마감수집] 저장 실패: " + e); }
    }).start();
  } catch (e) { Log.e("[마감수집] 오류: " + e); }
}
bot.addListener(Event.MESSAGE, onMessage);
Log.i("[마감수집] 시작 — 방: " + ROOMS.join(", "));
