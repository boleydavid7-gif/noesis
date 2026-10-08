import { useState } from 'react'
import { ArrowLeft, ChevronRight, Download, FileText, Folder, Plus, Trash2 } from 'lucide-react'
import { parseMultistatus, type DavEntry } from './lib/webdav'

type Place = { id: string; name: string; url: string; user?: string; pass?: string }
const KEY = 'noesis:webdav:v1'

function readPlaces(): Place[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is Place => typeof item?.url === 'string') : []
  } catch {
    return []
  }
}

async function ask(place: Place, url: string, op: 'list' | 'get'): Promise<Response> {
  const response = await fetch('/api/webdav', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, op, user: place.user, pass: place.pass }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || 'Could not reach that folder.')
  }
  return response
}

const formatSize = (bytes?: number) =>
  bytes === undefined
    ? ''
    : bytes > 1_048_576
      ? `${(bytes / 1_048_576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function WebdavBrowser({ onImport }: { onImport: (file: File) => Promise<void> }) {
  const [places, setPlaces] = useState<Place[]>(readPlaces)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', url: '', user: '', pass: '' })
  const [open, setOpen] = useState<Place | null>(null)
  const [trail, setTrail] = useState<string[]>([])
  const [entries, setEntries] = useState<DavEntry[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const save = (next: Place[]) => {
    setPlaces(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // The list is simply not remembered.
    }
  }
  async function visit(place: Place, url: string, nextTrail: string[]) {
    setBusy('Loading…')
    setError('')
    try {
      const xml = await (await ask(place, url, 'list')).text()
      setEntries(parseMultistatus(xml, url))
      setOpen(place)
      setTrail(nextTrail)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open that folder.')
    } finally {
      setBusy('')
    }
  }
  async function bringIn(entry: DavEntry) {
    if (!open) return
    setBusy(`Adding “${entry.name}”…`)
    setError('')
    try {
      const blob = await (await ask(open, entry.url, 'get')).blob()
      await onImport(new File([blob], entry.name, { type: blob.type }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add that book.')
    } finally {
      setBusy('')
    }
  }
  function add(event: React.FormEvent) {
    event.preventDefault()
    if (!draft.url.trim()) return
    const url = /^https?:\/\//i.test(draft.url.trim()) ? draft.url.trim() : `https://${draft.url.trim()}`
    save([
      ...places,
      {
        id: `dav-${crypto.randomUUID()}`,
        name: draft.name.trim() || new URL(url).hostname,
        url: url.endsWith('/') ? url : `${url}/`,
        user: draft.user.trim() || undefined,
        pass: draft.user.trim() ? draft.pass : undefined,
      },
    ])
    setDraft({ name: '', url: '', user: '', pass: '' })
    setAdding(false)
  }

  if (open) {
    return (
      <section className="resource-section opds" aria-label={open.name}>
        <div className="opds-head">
          <button
            className="text-button"
            onClick={() => {
              if (trail.length > 1) void visit(open, trail[trail.length - 2], trail.slice(0, -1))
              else {
                setOpen(null)
                setEntries([])
              }
            }}
          >
            <ArrowLeft size={14} /> {trail.length > 1 ? 'Back' : 'All folders'}
          </button>
          <h3>{open.name}</h3>
        </div>
        {error ? (
          <p className="weather-error" role="alert">
            {error}
          </p>
        ) : null}
        {busy ? <p className="context-empty">{busy}</p> : null}
        <ul className="opds-list">
          {entries.length === 0 && !busy ? <li className="context-empty">No books here.</li> : null}
          {entries.map((entry) => (
            <li key={entry.url} className="opds-entry">
              <span className="opds-nocover">{entry.folder ? <Folder size={18} /> : <FileText size={18} />}</span>
              <span className="opds-text">
                <strong>{entry.name}</strong>
                {entry.size ? <small>{formatSize(entry.size)}</small> : null}
              </span>
              {entry.folder ? (
                <button className="text-button" onClick={() => void visit(open, entry.url, [...trail, entry.url])}>
                  Open <ChevronRight size={14} />
                </button>
              ) : (
                <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void bringIn(entry)}>
                  <Download size={14} /> Add to library
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section className="resource-section opds" aria-label="Cloud folders">
      <div className="section-heading">
        <div>
          <h2>Your cloud folders</h2>
          <p>Browse a WebDAV folder, such as Nextcloud or ownCloud, and add books from it to your library.</p>
        </div>
        <button className="text-button" onClick={() => setAdding((value) => !value)}>
          <Plus size={14} /> Add a folder
        </button>
      </div>
      {error ? (
        <p className="weather-error" role="alert">
          {error}
        </p>
      ) : null}
      {busy ? <p className="context-empty">{busy}</p> : null}
      {adding ? (
        <form className="opds-form panel-card" onSubmit={add}>
          <input
            placeholder="Folder address, e.g. https://cloud.example.com/remote.php/dav/files/you/Books"
            value={draft.url}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            aria-label="Folder address"
            required
          />
          <input
            placeholder="Name (optional)"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            aria-label="Name"
          />
          <input
            placeholder="Username"
            value={draft.user}
            onChange={(event) => setDraft({ ...draft, user: event.target.value })}
            aria-label="Username"
            autoComplete="off"
          />
          <input
            type="password"
            placeholder="Password or app password"
            value={draft.pass}
            onChange={(event) => setDraft({ ...draft, pass: event.target.value })}
            aria-label="Password"
            autoComplete="off"
          />
          <p className="brain-source-hint">
            Your login passes through Noesis’s server to reach yours, only for each request. It is not stored or logged
            there, and it stays saved on this device only. Use an app password if your service offers one.
          </p>
          <button className="primary-button" type="submit">
            Save folder
          </button>
        </form>
      ) : null}
      <ul className="opds-list">
        {places.length === 0 ? <li className="context-empty">No folders yet.</li> : null}
        {places.map((place) => (
          <li key={place.id} className="opds-entry">
            <span className="opds-nocover">
              <Folder size={18} />
            </span>
            <span className="opds-text">
              <strong>{place.name}</strong>
              <small>{place.url}</small>
            </span>
            <button className="text-button" onClick={() => void visit(place, place.url, [place.url])}>
              Open <ChevronRight size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={`Remove ${place.name}`}
              onClick={() => save(places.filter((item) => item.id !== place.id))}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
