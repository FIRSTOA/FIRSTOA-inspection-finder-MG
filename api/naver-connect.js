/**
 * 네이버 캘린더 연동 시작 — 이 주소로 접속하면 알아서 네이버 인증 화면으로 보낸다.
 * client_id·redirect_uri를 손으로 URL인코딩할 필요가 없다.
 * 인증 후에는 /api/naver-callback 이 연결코드(refresh_token)를 화면에 보여준다.
 */
const NAVER_CLIENT_ID = (process.env.NAVER_CLIENT_ID || "").trim();

export default async function handler(req, res) {
  if (!NAVER_CLIENT_ID) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send('<!doctype html><meta charset="utf-8"/><body style="font-family:system-ui,sans-serif;padding:22px;line-height:1.8;max-width:680px;margin:auto;">'
      + "<h2>설정이 먼저 필요합니다</h2><p>Vercel 환경변수에 <b>NAVER_CLIENT_ID</b>, <b>NAVER_CLIENT_SECRET</b>을 등록하고 재배포한 뒤 다시 접속하세요.</p></body>");
  }
  // 배포된 실제 도메인을 그대로 사용 — 네이버 앱에 등록한 Callback URL과 일치해야 한다
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const redirectUri = `${proto}://${host}/api/naver-callback`;
  const authorizeUrl = "https://nid.naver.com/oauth2.0/authorize?response_type=code"
    + `&client_id=${encodeURIComponent(NAVER_CLIENT_ID)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + "&state=connect";
  res.writeHead(302, { Location: authorizeUrl });
  return res.end();
}
