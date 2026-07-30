/**
 * 웹앱 일정 → 네이버 캘린더 등록.
 * 네이버 캘린더 API는 '일정 등록(createSchedule)'만 제공하므로 단방향(웹앱 → 네이버)이다.
 * 시간지정 일정은 KST를 UTC로 변환해 보내야 시간이 밀리지 않는다.
 */
const NAVER_CLIENT_ID = (process.env.NAVER_CLIENT_ID || "").trim();
const NAVER_CLIENT_SECRET = (process.env.NAVER_CLIENT_SECRET || "").trim();
const NAVER_REFRESH_TOKEN = (process.env.NAVER_REFRESH_TOKEN || "").trim();
const CALENDAR_ID = (process.env.NAVER_CALENDAR_ID || "").trim(); // 비우면 개인 기본 캘린더

async function getAccessToken() {
  const url = "https://nid.naver.com/oauth2.0/token?grant_type=refresh_token"
    + `&client_id=${encodeURIComponent(NAVER_CLIENT_ID)}`
    + `&client_secret=${encodeURIComponent(NAVER_CLIENT_SECRET)}`
    + `&refresh_token=${encodeURIComponent(NAVER_REFRESH_TOKEN)}`;
  const response = await fetch(url);
  const data = await response.json();
  return data.access_token;
}

const esc = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const pad = (n) => String(n).padStart(2, "0");
const ymd = (date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;

// KST 날짜·시각 → UTC iCal 스탬프 (네이버는 시간대 없는 값을 거부한다)
function toUtcStamp(dateStr, hm) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hour, minute] = hm.split(":").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, hour, minute) - 9 * 3600 * 1000);
  return `${utc.getUTCFullYear()}${pad(utc.getUTCMonth() + 1)}${pad(utc.getUTCDate())}T${pad(utc.getUTCHours())}${pad(utc.getUTCMinutes())}00Z`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용됩니다." });
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return res.status(400).json({ error: "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 없습니다." });
  if (!NAVER_REFRESH_TOKEN) return res.status(400).json({ error: "NAVER_REFRESH_TOKEN 환경변수가 없습니다. 콜백 인증을 먼저 진행하세요." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { title, date, location, description, startTime, endTime } = body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "날짜(YYYY-MM-DD)가 필요합니다." });
    const timed = /^\d{2}:\d{2}$/.test(startTime || "") && /^\d{2}:\d{2}$/.test(endTime || "");

    const token = await getAccessToken();
    if (!token) return res.status(400).json({ error: "액세스 토큰 발급 실패 — 연결이 만료됐을 수 있습니다(재인증 필요)." });

    let dtStart;
    let dtEnd;
    if (timed) {
      dtStart = `DTSTART:${toUtcStamp(date, startTime)}`;
      dtEnd = `DTEND:${toUtcStamp(date, endTime)}`;
    } else {
      const next = new Date(`${date}T00:00:00`);
      next.setDate(next.getDate() + 1);
      dtStart = `DTSTART;VALUE=DATE:${date.replace(/-/g, "")}`;
      dtEnd = `DTEND;VALUE=DATE:${ymd(next)}`;   // 종일 일정은 DTEND가 다음 날 (iCal 규칙)
    }

    const vevent = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//firstoa-cs//KO", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
      `UID:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@firstoa`,
      "SEQUENCE:0", dtStart, dtEnd, "PRIORITY:1",
      `SUMMARY:${esc(title || "일정")}`,
      location ? `LOCATION:${esc(location)}` : "",
      description ? `DESCRIPTION:${esc(description)}` : "",
      "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");

    const form = (CALENDAR_ID ? `calendarId=${encodeURIComponent(CALENDAR_ID)}&` : "")
      + `scheduleIcalString=${encodeURIComponent(vevent)}`;
    const response = await fetch("https://openapi.naver.com/calendar/createSchedule.json", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const text = await response.text();
    if (!response.ok) return res.status(502).json({ error: "네이버 등록 실패", detail: text.slice(0, 500) });
    return res.status(200).json({ ok: true, result: text.slice(0, 500) });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
}
