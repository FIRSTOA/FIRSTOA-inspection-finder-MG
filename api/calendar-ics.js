/**
 * 일정리스트(as_tickets)를 iCalendar(.ics) 피드로 내보낸다.
 * 네이버·구글·아웃룩 등 어떤 캘린더 앱에서든 "URL로 구독"하면 웹앱 일정이 그쪽에 보인다.
 * 읽기 전용이고 권한 설정이 필요 없다 (구독 캘린더는 앱에 따라 반영이 수십 분~수시간 지연됨).
 *
 * 주소에 거래처명·주소·연락처가 담기므로 반드시 토큰으로 보호한다.
 *   환경변수 CALENDAR_ICS_TOKEN=아무 긴 무작위 문자열
 *   구독 주소: https://<웹앱>/api/calendar-ics?token=<그 값>
 * 선택 필터: &team=A  &type=매월점검  (여러 개는 콤마)
 */
const SUPABASE_URL = (process.env.SUPABASE_URL || "https://kkdiihazgzesbqxjytqv.supabase.co").trim();
const SUPABASE_ANON = (process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw").trim();
const ICS_TOKEN = (process.env.CALENDAR_ICS_TOKEN || "").trim();

const pad = (n) => String(n).padStart(2, "0");
const esc = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// KST 날짜·시각 → UTC 스탬프 (구독하는 앱이 어느 시간대든 정확히 보이게)
function utcStamp(dateStr, hm) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hour, minute] = String(hm || "09:00").split(":").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0) - 9 * 3600 * 1000);
  return `${utc.getUTCFullYear()}${pad(utc.getUTCMonth() + 1)}${pad(utc.getUTCDate())}T${pad(utc.getUTCHours())}${pad(utc.getUTCMinutes())}00Z`;
}
const shiftDays = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
// 75옥텟 초과 줄은 접어야 일부 캘린더 앱에서 깨지지 않는다
const fold = (line) => {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) { parts.push(` ${rest.slice(0, 72)}`); rest = rest.slice(72); }
  if (rest) parts.push(` ${rest}`);
  return parts.join("\r\n");
};

export default async function handler(req, res) {
  const query = req.query || {};
  if (!ICS_TOKEN) return res.status(400).send("CALENDAR_ICS_TOKEN 환경변수를 먼저 등록하세요.");
  if (String(query.token || "") !== ICS_TOKEN) return res.status(401).send("unauthorized");
  try {
    const params = new URLSearchParams({
      select: "id,team,date,time,vendor,address,issue,note,assignee,status,scheduleType",
      order: "date.asc,time.asc",
      limit: "3000",
    });
    params.append("date", `gte.${shiftDays(-60)}`);
    params.append("date", `lte.${shiftDays(400)}`);
    if (query.team) params.append("team", `in.(${String(query.team)})`);
    if (query.type) params.append("scheduleType", `in.(${String(query.type)})`);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/as_tickets?${params.toString()}`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    if (!response.ok) return res.status(502).send(`일정 조회 실패(${response.status})`);
    const rows = await response.json();

    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//firstoa-cs//schedule//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "X-WR-CALNAME:퍼스트전산 CS 일정", "X-WR-TIMEZONE:Asia/Seoul",
      "REFRESH-INTERVAL;VALUE=DURATION:PT30M", "X-PUBLISHED-TTL:PT30M",
    ];
    for (const row of rows) {
      if (!row.date) continue;
      const endHour = Math.min(23, Number(String(row.time || "09:00").split(":")[0] || 9) + 1);
      const endTime = `${pad(endHour)}:${String(row.time || "09:00").split(":")[1] || "00"}`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${row.id}@firstoa`,                    // 같은 UID면 구독 앱이 갱신으로 처리한다
        `DTSTAMP:${utcStamp(row.date, row.time)}`,
        `DTSTART:${utcStamp(row.date, row.time)}`,
        `DTEND:${utcStamp(row.date, endTime)}`,
        fold(`SUMMARY:${esc(`[${row.scheduleType}] ${row.vendor || "일정"}${row.status === "완료" ? " ✓" : ""}`)}`),
        row.address ? fold(`LOCATION:${esc(row.address)}`) : "",
        fold(`DESCRIPTION:${esc([
          row.issue && `내용: ${row.issue}`,
          `팀/담당: ${row.team}팀 ${row.assignee || "미배정"}`,
          `상태: ${row.status}`,
          row.note,
        ].filter(Boolean).join("\n"))}`),
        `STATUS:${row.status === "완료" ? "CONFIRMED" : "TENTATIVE"}`,
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=600");
    return res.status(200).send(lines.filter(Boolean).join("\r\n"));
  } catch (error) {
    return res.status(500).send(`오류: ${error.message}`);
  }
}
