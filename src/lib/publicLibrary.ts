import { useEffect, useState } from 'react'

// The reader's public library: chosen once (by a city or ZIP code, or their location), kept as a synced
// preference, and used to say whether a suggested book is on the library's shelf.

export type LibrarySystem = {
  key: string
  libbyKey: string
  name: string
  place: string
  miles?: number
  website?: string
  catalog?: string
}
export type LibraryCopy = {
  format: 'print'
  available: boolean
  copies?: number
  held?: number
  waitDays?: number
  url: string
}
export type LibraryCheck = { copies: LibraryCopy[]; searchUrl?: string }

export const PUBLIC_LIBRARY_KEY = 'noesis:public-library:v1'
const CHANGED = 'noesis-public-library'

export function readLibrary(): LibrarySystem | null {
  try {
    const value = JSON.parse(localStorage.getItem(PUBLIC_LIBRARY_KEY) ?? 'null') as LibrarySystem | null
    return value && typeof value.key === 'string' && typeof value.name === 'string' ? value : null
  } catch {
    return null
  }
}

export function saveLibrary(system: LibrarySystem | null) {
  try {
    if (system) localStorage.setItem(PUBLIC_LIBRARY_KEY, JSON.stringify(system))
    else localStorage.removeItem(PUBLIC_LIBRARY_KEY)
  } catch {
    // Storage full or blocked: the choice lasts for this visit only.
  }
  window.dispatchEvent(new Event(CHANGED))
}

export function onLibraryChosen(listener: () => void): () => void {
  const storage = (event: StorageEvent) => {
    if (event.key === PUBLIC_LIBRARY_KEY) listener()
  }
  window.addEventListener(CHANGED, listener)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(CHANGED, listener)
    window.removeEventListener('storage', storage)
  }
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } })
  } catch {
    throw new Error('Could not reach Noesis. Check your connection and try again.')
  }
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T
  if (!response.ok || !body.ok) throw new Error(body.error || fallback)
  return body
}

export async function findLibraries(place: { q?: string; lat?: number; lon?: number }): Promise<LibrarySystem[]> {
  const params = new URLSearchParams()
  if (place.q) params.set('q', place.q)
  if (place.lat !== undefined && place.lon !== undefined) {
    params.set('lat', place.lat.toFixed(2))
    params.set('lon', place.lon.toFixed(2))
  }
  const body = await getJson<{ systems?: LibrarySystem[] }>(
    `/api/libraries?${params}`,
    'Libraries could not be looked up right now.',
  )
  return body.systems ?? []
}

const checks = new Map<string, { at: number; result: Promise<LibraryCheck> }>()
const CHECK_MINUTES = 30

export function checkLibrary(system: LibrarySystem, title: string, author: string): Promise<LibraryCheck> {
  const id = `${system.key}|${title}|${author}`.toLowerCase()
  const known = checks.get(id)
  if (known && Date.now() - known.at < CHECK_MINUTES * 60_000) return known.result
  const params = new URLSearchParams({ library: system.key, title, author })
  if (system.catalog) params.set('catalog', system.catalog)
  const result = getJson<LibraryCheck>(`/api/library-has?${params}`, 'Your library could not be checked right now.')
  checks.set(id, { at: Date.now(), result })
  result.catch(() => checks.delete(id))
  return result
}

// One plain line for a printed copy: "On the shelf: in now", "On the shelf: all out · 3 waiting".
export function copyLine(copy: LibraryCopy): string {
  if (copy.available) return 'On the shelf: in now'
  return `On the shelf: all out${copy.held ? ` · ${copy.held} waiting` : ''}`
}

export function useChosenLibrary(): LibrarySystem | null {
  const [system, setSystem] = useState(readLibrary)
  useEffect(() => onLibraryChosen(() => setSystem(readLibrary())), [])
  return system
}

// WorldCat lists libraries near any place that hold a printed copy; it works in every country.
export function worldCatUrl(title: string, author: string, isbn?: string): string {
  return isbn
    ? `https://search.worldcat.org/search?q=bn:${encodeURIComponent(isbn)}`
    : `https://search.worldcat.org/search?q=${encodeURIComponent(`ti:${title} au:${author.split(',')[0] ?? ''}`.trim())}`
}
