import { useState } from 'react'
import { ArrowLeft, BookOpen, ChevronRight, Download, Plus, Search, Trash2 } from 'lucide-react'
import { OPDS_PRESETS, parseOpds, searchAddress, searchTemplateFrom, type OpdsEntry, type OpdsFeed } from './lib/opds'

type Catalogue = { id: string; name: string; url: string; user?: string; pass?: string }
const KEY = 'noesis:opds:v1'

function readCatalogues(): Catalogue[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Catalogue[]
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item.url) : []
  } catch {
    return []
  }
}
const writeCatalogues = (list: Catalogue[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // The list just isn't remembered.
  }
}

const basic = (catalogue: Catalogue): Record<string, string> =>
  catalogue.user ? { authorization: `Basic ${btoa(`${catalogue.user}:${catalogue.pass ?? ''}`)}` } : {}

// Reads a catalogue page: straight from the server if it allows that, otherwise through our own
// server for public catalogues.
async function loadFeed(address: string, catalogue: Catalogue): Promise<OpdsFeed> {
  return parseOpds(await loadText(address, catalogue), address)
}

async function loadText(address: string, catalogue: Catalogue): Promise<string> {
  const headers = { accept: 'application/atom+xml,application/xml;q=0.9', ...basic(catalogue) }
  try {
    const response = await fetch(address, { headers })
    if (response.status === 401) throw new Error('The server asked for a username and password.')
    if (response.ok) return await response.text()
  } catch (error) {
    if (error instanceof Error && /username and password/.test(error.message)) throw error
    if (catalogue.user) {
      throw new Error(
        'This server does not let Noesis connect from the web. Its owner needs to allow cross-origin requests (CORS).',
      )
    }
  }
  const proxied = await fetch(`/api/opds?url=${encodeURIComponent(address)}`)
  if (!proxied.ok) {
    const body = (await proxied.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || 'Could not open that catalogue.')
  }
  return proxied.text()
}

async function loadFile(href: string, catalogue: Catalogue): Promise<Blob> {
  try {
    const response = await fetch(href, { headers: basic(catalogue) })
    if (response.ok) return await response.blob()
  } catch {
    // Try our own server next.
  }
  const proxied = await fetch(`/api/resource?url=${encodeURIComponent(href)}`)
  // Our own server only passes on books; anything else (an error page) is not one.
  if (proxied.ok && /epub|pdf|zip|octet-stream/i.test(proxied.headers.get('content-type') ?? '')) return proxied.blob()
  throw new Error(
    'This server does not allow Noesis to download from it. Download the file yourself and add it to your library.',
  )
}

export function OpdsBrowser({ onImport }: { onImport: (file: File) => Promise<void> }) {
  const [catalogues, setCatalogues] = useState<Catalogue[]>(readCatalogues)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', url: '', user: '', pass: '' })
  const [open, setOpen] = useState<Catalogue | null>(null)
  const [trail, setTrail] = useState<Array<{ address: string; title: string }>>([])
  const [feed, setFeed] = useState<OpdsFeed | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const save = (next: Catalogue[]) => {
    setCatalogues(next)
    writeCatalogues(next)
  }
  // mode: "start" begins a trail, "push" goes deeper, "none" is used for going back, "append" adds the next page.
  async function visit(
    catalogue: Catalogue,
    address: string,
    title: string,
    mode: 'start' | 'push' | 'none' | 'append' = 'push',
  ) {
    setBusy('Loading…')
    setError('')
    try {
      const next = await loadFeed(address, catalogue)
      if (!next.search && next.searchDescription) {
        // Some servers name their search address in a separate small file.
        try {
          next.search = searchTemplateFrom(await loadText(next.searchDescription, catalogue))
        } catch {
          // Without it there is simply no search box.
        }
      }
      setOpen(catalogue)
      setFeed((current) =>
        mode === 'append' && current ? { ...next, entries: [...current.entries, ...next.entries] } : next,
      )
      const label = next.title || title
      if (mode === 'start') setTrail([{ address, title: label }])
      else if (mode === 'push') setTrail((current) => [...current, { address, title: label }])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open that catalogue.')
    } finally {
      setBusy('')
    }
  }
  async function bringIn(entry: OpdsEntry) {
    if (!open) return
    const file = entry.files[0]
    setBusy(`Adding “${entry.title}”…`)
    setError('')
    try {
      const blob = await loadFile(file.href, open)
      const extension = /pdf/i.test(file.type) ? 'pdf' : 'epub'
      await onImport(
        new File([blob], `${entry.title.replace(/[^\w\- ]+/g, '').trim() || 'book'}.${extension}`, { type: file.type }),
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add that book.')
    } finally {
      setBusy('')
    }
  }
  function add(event: React.FormEvent) {
    event.preventDefault()
    const url = /^https?:\/\//i.test(draft.url.trim()) ? draft.url.trim() : `https://${draft.url.trim()}`
    if (!draft.url.trim()) return
    save([
      ...catalogues,
      {
        id: `opds-${crypto.randomUUID()}`,
        name: draft.name.trim() || new URL(url).hostname,
        url,
        user: draft.user.trim() || undefined,
        pass: draft.user.trim() ? draft.pass : undefined,
      },
    ])
    setDraft({ name: '', url: '', user: '', pass: '' })
    setAdding(false)
  }

  if (open && feed) {
    const here = trail[trail.length - 1]
    return (
      <section className="resource-section opds" aria-label={open.name}>
        <div className="opds-head">
          <button
            className="text-button"
            onClick={() => {
              if (trail.length > 1) {
                const parent = trail[trail.length - 2]
                setTrail(trail.slice(0, -1))
                void visit(open, parent.address, parent.title, 'none')
              } else {
                setOpen(null)
                setFeed(null)
                setTrail([])
              }
            }}
          >
            <ArrowLeft size={14} /> {trail.length > 1 ? 'Back' : 'All catalogues'}
          </button>
          <h3>{feed.title || open.name}</h3>
        </div>
        {feed.search ? (
          <form
            className="opds-search"
            onSubmit={(event) => {
              event.preventDefault()
              if (query.trim())
                void visit(open, searchAddress(feed.search ?? '', query.trim()), `Search: ${query.trim()}`)
            }}
          >
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${open.name}`}
              aria-label={`Search ${open.name}`}
            />
          </form>
        ) : null}
        {error ? (
          <p className="weather-error" role="alert">
            {error}
          </p>
        ) : null}
        {busy ? <p className="context-empty">{busy}</p> : null}
        <ul className="opds-list">
          {feed.entries.length === 0 && !busy ? <li className="context-empty">Nothing here.</li> : null}
          {feed.entries.map((entry) => (
            <li key={entry.id} className="opds-entry">
              {entry.cover ? (
                <img src={entry.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <span className="opds-nocover">
                  <BookOpen size={18} />
                </span>
              )}
              <span className="opds-text">
                <strong>{entry.title}</strong>
                {entry.author ? <small>{entry.author}</small> : null}
                {entry.summary ? <em>{entry.summary}</em> : null}
              </span>
              {entry.files.length > 0 ? (
                <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void bringIn(entry)}>
                  <Download size={14} /> Add to library
                </button>
              ) : entry.open ? (
                <button className="text-button" onClick={() => void visit(open, entry.open as string, entry.title)}>
                  Open <ChevronRight size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {feed.next ? (
          <button
            className="secondary-button"
            disabled={Boolean(busy)}
            onClick={() => void visit(open, feed.next as string, here?.title ?? '', 'append')}
          >
            Show more
          </button>
        ) : null}
      </section>
    )
  }

  return (
    <section className="resource-section opds" aria-label="Book servers">
      <div className="section-heading">
        <div>
          <h2>Your book servers</h2>
          <p>
            Connect a catalogue (OPDS) such as Calibre-Web or Kavita, or browse a free one, and add books straight to
            your library.
          </p>
        </div>
        <button className="text-button" onClick={() => setAdding((value) => !value)}>
          <Plus size={14} /> Add a server
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
          <label>
            Name
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="My Calibre library"
            />
          </label>
          <label>
            Catalogue address
            <input
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              placeholder="https://books.example.com/opds"
              required
            />
          </label>
          <label>
            Username (if it needs one)
            <input
              value={draft.user}
              onChange={(event) => setDraft({ ...draft, user: event.target.value })}
              autoComplete="off"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={draft.pass}
              onChange={(event) => setDraft({ ...draft, pass: event.target.value })}
              autoComplete="off"
            />
          </label>
          <small>
            Saved only on this device. Servers on your home network need to be reachable over https from the web and
            allow CORS; public catalogues always work.
          </small>
          <div className="recovery-actions">
            <button className="primary-button" type="submit">
              Save server
            </button>
            <button type="button" className="text-button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      <ul className="opds-servers">
        {[
          ...OPDS_PRESETS.map((preset) => ({ id: `preset-${preset.name}`, ...preset, preset: true })),
          ...catalogues.map((item) => ({ ...item, preset: false })),
        ].map((item) => (
          <li key={item.id}>
            <button className="opds-server" onClick={() => void visit(item as Catalogue, item.url, item.name, 'start')}>
              <strong>{item.name}</strong>
              <small>{item.preset ? 'Free catalogue' : new URL(item.url).hostname}</small>
              <ChevronRight size={16} />
            </button>
            {!item.preset ? (
              <button
                className="icon-button tiny"
                aria-label={`Remove ${item.name}`}
                onClick={() => save(catalogues.filter((entry) => entry.id !== item.id))}
              >
                <Trash2 size={13} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
