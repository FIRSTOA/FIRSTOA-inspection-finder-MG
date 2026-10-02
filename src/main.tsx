import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Boot from './Boot.tsx'
import { applySsoTestParam, handleSsoCallback, SSO_CALLBACK_PATH, SSO_ERROR_KEY } from './sso'

// 네이버 캘린더 최초 연동: 네이버 로그인 동의 후 ?code=..&state=firstoa 로 돌아오면
// 코드를 서버(엣지 함수)로 넘겨 토큰 교환·보관까지 자동 처리 — 주소창 복사 불필요
const naverAuthParams = new URLSearchParams(window.location.search)
if (naverAuthParams.get('state') === 'firstoa' && naverAuthParams.get('code')) {
  const naverCode = naverAuthParams.get('code') || ''
  window.history.replaceState({}, '', window.location.pathname)
  void import('./supabase').then(({ invokeEdgeFunction }) =>
    invokeEdgeFunction('naver-calendar-push', { action: 'exchange', code: naverCode })
      .then(() => window.alert('네이버 캘린더 연동 완료 ✓\n이제 일정 등록 시 네이버 캘린더에도 자동으로 올라갑니다.'))
      .catch((e) => window.alert(`네이버 캘린더 연동 실패: ${(e as Error).message}`)),
  )
}

const checkForNewBuild = async () => {
  if (document.visibilityState !== 'visible') return
  try {
    const response = await fetch(`/?build-check=${Date.now()}`, { cache: 'no-store' })
    const html = await response.text()
    const latestAsset = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1]
    const currentAsset = [...document.scripts].map((script) => script.getAttribute('src') || '').find((src) => /\/assets\/[^/]+\.js$/.test(src))
    if (latestAsset && currentAsset && new URL(latestAsset, location.origin).pathname !== new URL(currentAsset, location.origin).pathname) location.reload()
  } catch {
    // Offline use keeps the currently loaded build.
  }
}

window.addEventListener('focus', () => void checkForNewBuild())
document.addEventListener('visibilitychange', () => void checkForNewBuild())
window.setInterval(() => void checkForNewBuild(), 5 * 60 * 1000)

// 카톡 사진 링크(?album=id)로 진입하면 앨범 갤러리만 렌더
const albumId = new URLSearchParams(window.location.search).get('album')

const boot = async () => {
  const root = document.getElementById('root')!
  // 그룹웨어에서 돌아온 길(/auth/callback?token=&state=)이면 토큰을 확인해 세션을 만들고 원래 화면으로
  applySsoTestParam() // ?sso=test → 이 기기를 검증 기기로
  if (window.location.pathname === SSO_CALLBACK_PATH) root.textContent = '그룹웨어 로그인 확인 중…'
  const sso = await handleSsoCallback()
  if (sso) {
    if (!sso.ok) { try { sessionStorage.setItem(SSO_ERROR_KEY, sso.error) } catch { /* 무시 */ } }
    window.history.replaceState({}, '', sso.returnTo)
    root.textContent = ''
  }
  createRoot(root).render(
    <StrictMode>
      <Boot albumId={albumId} />
    </StrictMode>,
  )
}
void boot()
