import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installNativeApi } from './lib/nativeApi'
import { startLibrary } from './lib/library'

installNativeApi()

// The library is read into memory first, so the app opens with every book in place.
void startLibrary().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})

// Keeps the app available offline once it has been opened.
if (
  'serviceWorker' in navigator &&
  import.meta.env.PROD &&
  location.protocol === 'https:' &&
  location.hostname !== 'localhost'
) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
