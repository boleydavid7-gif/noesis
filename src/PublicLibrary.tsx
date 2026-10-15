// "At your library": whether a book is on the shelf or in Libby at the reader's own public library.
import { useEffect, useState } from 'react'
import { ExternalLink, Library, LocateFixed } from 'lucide-react'
import {
  checkLibrary,
  copyLine,
  findLibraries,
  saveLibrary,
  useChosenLibrary,
  worldCatUrl,
  type LibraryCheck,
  type LibrarySystem,
} from './lib/publicLibrary'

// Choose a library by typing a city or ZIP code, or from where the reader is (asked only on that tap).
export function LibraryChooser({ onDone }: { onDone?: () => void }) {
  const chosen = useChosenLibrary()
  const [place, setPlace] = useState('')
  const [found, setFound] = useState<LibrarySystem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function look(query: { q?: string; lat?: number; lon?: number }) {
    setBusy(true)
    setError('')
    try {
      const systems = await findLibraries(query)
      setFound(systems)
      if (!systems.length)
        setError('No libraries with online lending near there. Each book still links to WorldCat for libraries nearby.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Libraries could not be looked up right now.')
    } finally {
      setBusy(false)
    }
  }

  function here() {
    if (!('geolocation' in navigator)) {
      setError('This browser cannot share a location. Enter a city or ZIP code.')
      return
    }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (position) => void look({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => {
        setBusy(false)
        setError('Location was not shared. Enter a city or ZIP code.')
      },
      { maximumAge: 3_600_000, timeout: 10_000, enableHighAccuracy: false },
    )
  }

  return (
    <div className="library-chooser">
      {chosen ? (
        <p className="library-chosen">
          <Library size={14} aria-hidden="true" /> {chosen.name}
          <button className="text-button" onClick={() => saveLibrary(null)}>
            Remove
          </button>
        </p>
      ) : null}
      <form
        className="subject-add"
        onSubmit={(event) => {
          event.preventDefault()
          if (place.trim().length >= 2) void look({ q: place.trim() })
        }}
      >
        <input
          value={place}
          onChange={(event) => setPlace(event.target.value)}
          placeholder="City or ZIP code"
          aria-label="City or ZIP code"
          maxLength={80}
        />
        <button className="secondary-button" type="submit" disabled={busy || place.trim().length < 2}>
          Find
        </button>
        <button className="text-button" type="button" onClick={here} disabled={busy}>
          <LocateFixed size={14} /> Use my location
        </button>
      </form>
      {busy ? <p className="subject-empty">Looking…</p> : null}
      {error ? <p className="weather-error">{error}</p> : null}
      {found?.length ? (
        <ul className="library-found">
          {found.map((system) => (
            <li key={system.key}>
              <button
                onClick={() => {
                  saveLibrary(system)
                  setFound(null)
                  setPlace('')
                  onDone?.()
                }}
              >
                <strong>{system.name}</strong>
                <small>
                  {[
                    system.place,
                    system.miles !== undefined ? `${system.miles} mi` : '',
                    system.catalog ? 'Shelf and Libby' : 'Libby',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="library-note">
        Your place is used once to find libraries and is not kept. E-books and audiobooks come from Libby, in many
        countries. Shelf copies show where the library's catalog is on BiblioCommons; anywhere else, WorldCat lists the
        libraries near you that hold a book.
      </p>
    </div>
  )
}

function Nearby({ title, author, isbn }: { title: string; author: string; isbn?: string }) {
  return (
    <a className="library-nearby" href={worldCatUrl(title, author, isbn)} target="_blank" rel="noreferrer noopener">
      Libraries near you (WorldCat) <ExternalLink size={10} aria-hidden="true" />
    </a>
  )
}

export function AtYourLibrary({ title, author, isbn }: { title: string; author: string; isbn?: string }) {
  const system = useChosenLibrary()
  const [answer, setAnswer] = useState<{ id: string; result?: LibraryCheck; failed?: boolean } | null>(null)
  const [choosing, setChoosing] = useState(false)
  const id = system ? `${system.key}|${title}|${author}` : ''

  useEffect(() => {
    if (!system) return
    let live = true
    checkLibrary(system, title, author)
      .then((found) => live && setAnswer({ id, result: found }))
      .catch(() => live && setAnswer({ id, failed: true }))
    return () => {
      live = false
    }
  }, [system, title, author, id])
  const current = answer?.id === id ? answer : null
  const result = current?.result ?? null
  const error = Boolean(current?.failed)

  if (!system) {
    return choosing ? (
      <LibraryChooser onDone={() => setChoosing(false)} />
    ) : (
      <div className="library-copies">
        <button className="text-button library-ask" onClick={() => setChoosing(true)}>
          <Library size={13} /> Check your library
        </button>
        <Nearby title={title} author={author} isbn={isbn} />
      </div>
    )
  }
  // Only what the library has is shown; otherwise just the WorldCat link, which works anywhere.
  if (error || (result && !result.copies.length)) return <Nearby title={title} author={author} isbn={isbn} />
  if (!result) return <small className="library-line">Checking {system.name}…</small>
  return (
    <ul className="library-copies" aria-label={`At ${system.name}`}>
      {result.copies.map((copy) => (
        <li key={copy.format} className={copy.available ? 'library-in' : ''}>
          <a href={copy.url} target="_blank" rel="noreferrer noopener">
            {copyLine(copy)} <ExternalLink size={10} aria-hidden="true" />
          </a>
        </li>
      ))}
      {!result.copies.some((copy) => copy.format === 'print') ? (
        <li>
          <Nearby title={title} author={author} isbn={isbn} />
        </li>
      ) : null}
    </ul>
  )
}
