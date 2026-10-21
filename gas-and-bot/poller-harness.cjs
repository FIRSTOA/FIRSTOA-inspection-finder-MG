// 실행: node gas-and-bot/poller-harness.cjs gas-and-bot/supabase-outbox-poller.js  (봇 스크립트를 고치면 폰에 올리기 전에 한 번 돌린다)
// 메신저봇R 환경 흉내 — 봇 스크립트의 JS 논리만 Node에서 실제로 돌려 본다(자바·Jsoup·BotManager는 가짜).
const fs = require("fs");
const vm = require("vm");
const src = fs.readFileSync(process.argv[2], "utf8");

const logs = [];
const deletes = [];
const posts = [];
let outbox = [];
let clock = 1_700_000_000_000 + 3 * 3600_000; // KST 2023-11-15 10:13 — 야간(22~08시) 밖에서 시작
const sendable = new Set(); // bot.send가 성공하는 방(메신저봇 자체 세션)

class FakeLock { constructor() { this.held = 0; } tryLock() { this.held++; return true; } lock() { this.held++; } unlock() { this.held--; } }
const builder = (url, method) => {
  const b = { _url: url, _method: "GET", _body: "" };
  for (const m of ["header", "ignoreContentType", "followRedirects", "timeout"]) b[m] = () => b;
  b.requestBody = (x) => { b._body = x; return b; };
  b.method = (m) => { b._method = String(m); return b; };
  b.execute = () => {
    if (b._method === "DELETE") { deletes.push(b._url); const ids = decodeURIComponent(b._url.split("id=in.(")[1].slice(0, -1)).split(","); outbox = outbox.filter((r) => !ids.includes(String(r.id))); return { body: () => "" }; }
    if (b._method === "POST") { posts.push({ url: b._url, body: b._body }); return { body: () => "" }; }
    return { body: () => JSON.stringify(outbox) };
  };
  return b;
};
const sandbox = {
  BotManager: { getCurrentBot: () => ({ send: (room) => sendable.has(room), addListener: (ev, fn) => { sandbox.__onMessage = fn; } }) },
  Event: { MESSAGE: "message" },
  Log: { i: (m) => logs.push("I " + m), e: (m) => logs.push("E " + m) },
  App: { getContext: () => null },
  java: {
    lang: { System: { currentTimeMillis: () => clock }, Thread: Object.assign(function (fn) { this.fn = fn; this.setName = () => {}; this.setDaemon = () => {}; this.start = () => { sandbox.__loop = fn; }; }, { getAllStackTraces: () => ({ keySet: () => ({ toArray: () => [] }) }), sleep: () => { throw new Error("stop"); } }) },
    util: {
      concurrent: { locks: { ReentrantLock: FakeLock }, TimeUnit: { MILLISECONDS: "ms" } },
      // ⑨ 야간 판정용 — clock 을 KST 로 본 시(時)
      TimeZone: { getTimeZone: () => "Asia/Seoul" },
      Calendar: { HOUR_OF_DAY: 11, getInstance: () => ({ get: () => new Date(clock + 9 * 3600_000).getUTCHours() }) },
    },
  },
  org: { jsoup: { Jsoup: { connect: (url) => builder(url) }, Connection: { Method: { DELETE: "DELETE", POST: "POST" } } } },
  JSON, Date, String, RegExp, Error, Object, Array,
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const ctx = sandbox;
const poll = () => vm.runInContext("pollOnce(); flushSeen();", ctx);
const iso = (ms) => new Date(ms).toISOString().replace("Z", "000+00:00"); // 서버처럼 마이크로초 6자리

// ── 시나리오 ──
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); console.error(logs.join("\n")); process.exit(1); } console.log("ok  ", msg); };
assert(logs.some((l) => l.includes("폴링 시작 (")), "시작 로그");

// 1) 세션 있는 방(A)은 게시·삭제, 세션 없는 방(B)은 실패 1번만 로그, 하루 지난 심박(C)은 보내지 않고 삭제
sendable.add("강남C 점검방");
outbox = [
  { id: 1, room: "강남C 점검방", text: "양식1", created_at: iso(clock - 60_000) },
  { id: 2, room: "신)AB불만고객", text: "양식2", created_at: iso(clock - 60_000) },
  { id: 3, room: "경기D 미수 보증금 미입금보고방", text: "🤖 09/28 카톡봇 대기 중 [봇점검]", created_at: iso(clock - 20 * 3600_000) },
  { id: 4, room: "경기D 미수 보증금 미입금보고방", text: "🤖 09/29 카톡봇 대기 중 [봇점검]", created_at: iso(clock - 3600_000) },
];
poll();
assert(deletes.length === 1 && deletes[0].endsWith("id=in.(1,3)"), "1·3만 삭제(3은 심박 폐기): " + deletes[0]);
assert(outbox.map((r) => r.id).join() === "2,4", "2·4는 남음");
assert(logs.filter((l) => l.startsWith("E [전송실패]")).length === 2, "실패 로그는 방마다 1번(2건)");
assert(logs.some((l) => l.includes("[심박 폐기]")), "심박 폐기 로그");

// 2) 7초 뒤 다시 폴링 — 세션 없는 방은 10분 안이라 조용히 건너뜀
clock += 7000; const before = logs.length;
poll();
assert(logs.length === before, "10분 안 재시도 없음(로그 0줄)");
assert(deletes.length === 1, "삭제 요청 없음");

// 3) 그 방에서 메시지가 오면(세션 생김) 바로 보냄 — onMessage는 pollOnce를 직접 부르지 않고 깨우기만
let replied = 0;
ctx.__onMessage({ room: "신)AB불만고객", content: "안녕", reply: () => { replied++; return true; } });
assert(ctx.wakePoll === true, "onMessage는 wakePoll만 켠다");
assert(deletes.length === 1, "onMessage 안에서 폴링(삭제)하지 않음");
poll();
assert(replied === 1 && outbox.map((r) => r.id).join() === "4", "세션답장으로 2번 보내고 삭제, 4(오늘 심박)는 세션 없어 대기");
assert(posts.length === 1 && posts[0].url.endsWith("/room_activity") && JSON.parse(posts[0].body).room === "신)AB불만고객", "room_activity 보고는 폴링 스레드가 1번");

// 4) 10분 지나면 세션 없는 방도 한 번 더 시도(실패 로그 1번)
clock += 11 * 60_000; const b2 = logs.filter((l) => l.startsWith("E [전송실패]")).length;
poll();
assert(logs.filter((l) => l.startsWith("E [전송실패]")).length === b2 + 1, "10분 뒤 재시도 로그 1번");

// 5) 봇테스트 응답 + 같은 방 30분 안 재보고 없음
ctx.__onMessage({ room: "신)AB불만고객", content: "봇테스트", reply: (t) => t === "봇 살아있음 OK" });
poll();
assert(logs.some((l) => l.includes("[에코] true")), "봇테스트 → 봇 살아있음 OK");
assert(posts.length === 1, "30분 안 같은 방 활동 보고는 1번만");

// 6) ack 실패 뒤 재폴링에서 두 번 보내지 않는다(sentIds)
sendable.add("강서B 점검방");
outbox.push({ id: 5, room: "강서B 점검방", text: "양식5", created_at: iso(clock) });
const realBuilder = ctx.org.jsoup.Jsoup.connect;
const botObj = vm.runInContext("bot", ctx); // 스크립트의 const bot은 샌드박스 속성이 아니라 렉시컬 바인딩
let sent5 = 0; const origSend = botObj.send; botObj.send = (room, text) => { if (text === "양식5") sent5++; return origSend(room, text); };
ctx.org.jsoup.Jsoup.connect = (url) => { const b = realBuilder(url); const ex = b.execute; b.execute = () => { if (b._method === "DELETE") throw new Error("network"); return ex(); }; return b; };
poll();
ctx.org.jsoup.Jsoup.connect = realBuilder;
poll();
assert(sent5 === 1, "삭제 실패 후 재폴링에서 재발송 없음(sentIds)");
assert(!outbox.some((r) => r.id === 5), "다음 폴링에서 삭제만 다시");
// 7) ⑨ 야간(22:00~08:00 KST)에는 꺼내지도 보내지도 않고 서버에 남긴다 → 08:00 지나면 보냄
sendable.add("강남C 점검방");
const kstHour = () => new Date(clock + 9 * 3600_000).getUTCHours();
while (kstHour() !== 23) clock += 3600_000; // 밤 11시로
const d0 = deletes.length, getsBefore = logs.length;
outbox.push({ id: 7, room: "강남C 점검방", text: "밤 양식", created_at: iso(clock) });
let sent7 = 0; const send7 = botObj.send; botObj.send = (room, text) => { if (text === "밤 양식") sent7++; return send7(room, text); };
poll();
assert(sent7 === 0 && deletes.length === d0 && outbox.some((r) => r.id === 7), "야간 23시: 보내지 않고 서버에 남김");
assert(logs.slice(getsBefore).some((l) => l.includes("[야간]")), "야간 로그");
while (kstHour() !== 7) clock += 3600_000; // 아침 7시도 금지
poll();
assert(sent7 === 0 && outbox.some((r) => r.id === 7), "야간 07시: 아직 보내지 않음");
clock += 3600_000; // 08시
poll();
assert(sent7 === 1 && !outbox.some((r) => r.id === 7), "08시: 밀린 글 보내고 삭제");
console.log("ALL OK —", logs.length, "log lines");
