import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AlbumView from './AlbumView.tsx'

// 카톡 사진 링크(?album=id)로 진입하면 앨범 갤러리만 렌더
const albumId = new URLSearchParams(window.location.search).get('album')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {albumId ? <AlbumView id={albumId} /> : <App />}
  </StrictMode>,
)
