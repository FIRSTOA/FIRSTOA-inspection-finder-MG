import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AlbumView from './AlbumView.tsx'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {albumId ? <AlbumView id={albumId} /> : <App />}
  </StrictMode>,
)
