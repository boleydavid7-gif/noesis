import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../App.css'
import './notes.css'
import { readSettings, rootAppearance } from '../lib/settings'
import { startLibrary } from '../lib/library'
import { NotesApp } from './NotesApp'

// The same colors and surface as Noesis, chosen in Noesis's Settings.
const { classes, vars } = rootAppearance(readSettings())
const root = document.documentElement
for (const name of classes) root.classList.add(name)
for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)

void startLibrary().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <NotesApp />
    </StrictMode>,
  )
})

if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
