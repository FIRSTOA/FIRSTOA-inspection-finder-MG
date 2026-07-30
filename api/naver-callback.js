/**
 * 네이버 캘린더 연동 1회 인증용 콜백.
 * 브라우저로 네이버 인증을 마치면 refresh_token(연결코드)을 화면에 보여준다.
 * 그 값을 Vercel 환경변수 NAVER_REFRESH_TOKEN에 넣으면 이후로는 서버가 알아서 갱신한다.
 */
const NAVER_CLIENT_ID = (process.env.NAVER_CLIENT_ID || "").trim();
const NAVER_CLIENT_SECRET = (process.env.NAVER_CLIENT_SECRET || "").trim();

export default async function handler(req, res) {
  const query = req.query || {};
  const send = (body) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(
      '<!doctype html><meta charset="utf-8"/><body style="font-family:system-ui,sans-serif;padding:22px;line-height:1.7;max-width:680px;margin:auto;">'
      + body + "</body>",
    );
  };
  if (query.error) return send(`<h2>연결 실패</h2><p>${query.error}: ${query.error_description || ""}</p>`);
  if (!query.code) return send("<h2>잘못된 접근</h2><p>인가코드가 없습니다.</p>");
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return send("<h2>설정 필요</h2><p>NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수를 먼저 등록하세요.</p>");
  try {
    const url = "https://nid.naver.com/oauth2.0/token?grant_type=authorization_code"
      + `&client_id=${encodeURIComponent(NAVER_CLIENT_ID)}`
      + `&client_secret=${encodeURIComponent(NAVER_CLIENT_SECRET)}`
      + `&code=${encodeURIComponent(query.code)}`
      + `&state=${encodeURIComponent(query.state || "")}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.refresh_token) return send(`<h2>실패</h2><pre>${JSON.stringify(data, null, 2)}</pre>`);
    return send('<h2>연결 성공</h2><p>아래 연결코드를 복사해 Vercel 환경변수 <b>NAVER_REFRESH_TOKEN</b>에 넣고 재배포하세요.</p>'
      + `<textarea readonly onclick="this.select()" style="width:100%;height:96px;">${data.refresh_token}</textarea>`);
  } catch (error) {
    return send(`<h2>오류</h2><p>${error.message}</p>`);
  }
}
