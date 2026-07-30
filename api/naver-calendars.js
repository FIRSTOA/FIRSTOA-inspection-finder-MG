/**
 * 연동된 네이버 계정이 접근할 수 있는 캘린더 목록을 보여준다.
 * 브라우저로 /api/naver-calendars 를 열면 캘린더 이름과 ID가 표로 나온다.
 * 여기서 회사 공유 캘린더의 ID를 골라 환경변수 NAVER_CALENDAR_ID에 넣으면
 * 이후 등록되는 일정이 그 캘린더로 들어간다 (비우면 개인 기본 캘린더).
 */
const NAVER_CLIENT_ID = (process.env.NAVER_CLIENT_ID || "").trim();
const NAVER_CLIENT_SECRET = (process.env.NAVER_CLIENT_SECRET || "").trim();
const NAVER_REFRESH_TOKEN = (process.env.NAVER_REFRESH_TOKEN || "").trim();
const CALENDAR_ID = (process.env.NAVER_CALENDAR_ID || "").trim();

export default async function handler(req, res) {
  const send = (body) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(
      '<!doctype html><meta charset="utf-8"/><body style="font-family:system-ui,sans-serif;padding:22px;line-height:1.7;max-width:820px;margin:auto;">'
      + body + "</body>",
    );
  };
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return send("<h2>설정 필요</h2><p>NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수를 먼저 등록하세요.</p>");
  if (!NAVER_REFRESH_TOKEN) return send("<h2>설정 필요</h2><p>NAVER_REFRESH_TOKEN이 없습니다. /api/naver-callback 인증을 먼저 진행하세요.</p>");
  try {
    const tokenUrl = "https://nid.naver.com/oauth2.0/token?grant_type=refresh_token"
      + `&client_id=${encodeURIComponent(NAVER_CLIENT_ID)}`
      + `&client_secret=${encodeURIComponent(NAVER_CLIENT_SECRET)}`
      + `&refresh_token=${encodeURIComponent(NAVER_REFRESH_TOKEN)}`;
    const tokenData = await (await fetch(tokenUrl)).json();
    if (!tokenData.access_token) return send(`<h2>토큰 발급 실패</h2><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);

    const response = await fetch("https://openapi.naver.com/calendar/getCalendarList.json", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const text = await response.text();
    if (!response.ok) return send(`<h2>캘린더 목록 조회 실패 (${response.status})</h2><pre>${text.slice(0, 800)}</pre>`);

    // 응답 형태가 버전마다 달라 원문도 함께 보여준다
    let rows = "";
    try {
      const parsed = JSON.parse(text);
      const list = parsed.calendarList || parsed.result || parsed.calendars || [];
      if (Array.isArray(list) && list.length) {
        rows = '<table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;margin-top:12px;">'
          + "<tr><th>이름</th><th>ID (이 값을 NAVER_CALENDAR_ID에)</th></tr>"
          + list.map((item) => {
            const name = item.name || item.calendarName || item.title || "(이름 없음)";
            const id = item.id || item.calendarId || "";
            const mark = id && id === CALENDAR_ID ? " ← 현재 설정됨" : "";
            return `<tr><td>${name}${mark}</td><td><code onclick="navigator.clipboard.writeText('${id}')" style="cursor:pointer">${id}</code></td></tr>`;
          }).join("")
          + "</table>";
      }
    } catch { /* 파싱 실패 시 원문만 */ }

    return send("<h2>네이버 캘린더 목록</h2>"
      + `<p>현재 NAVER_CALENDAR_ID: <b>${CALENDAR_ID || "(미설정 — 개인 기본 캘린더로 등록됨)"}</b></p>`
      + rows
      + `<details style="margin-top:16px;"><summary>응답 원문</summary><pre style="white-space:pre-wrap;">${text.slice(0, 3000)}</pre></details>`);
  } catch (error) {
    return send(`<h2>오류</h2><p>${error.message}</p>`);
  }
}
