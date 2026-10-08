import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installNativeApi } from './lib/nativeApi'

installNativeApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

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
