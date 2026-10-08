import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Download, Image, Plus, Search, Share2, Trash2, Upload } from 'lucide-react'
import { diaryDays, type DiaryEntry } from './lib/diary'
import { formatHours, readingStats } from './lib/stats'
import { renderYearCard } from './lib/yearCard'
import type { LibraryBook } from './lib/library'
import { relatedNotes } from './lib/related'
import { semanticRelated, type Embed } from './lib/semantic'
import { downloadBlob, renderQuoteCard } from './lib/quoteCard'
import { HIGHLIGHT_COLORS, type BrainNote, type BrainNoteKind, type HighlightColor } from './lib/knowledge'

type TabId = 'all' | BrainNoteKind | 'elsewhere' | 'words' | 'diary'
const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'all', label: 'All notes' },
  { id: 'highlight', label: 'Highlights' },
  { id: 'note', label: 'Quick notes' },
  { id: 'idea', label: 'Reflections' },
  { id: 'question', label: 'Questions' },
  { id: 'connection', label: 'Connections' },
  { id: 'elsewhere', label: 'Elsewhere' },
  { id: 'words', label: 'Words' },
  { id: 'diary', label: 'Diary' },
]
const KIND_LABEL: Record<BrainNoteKind, string> = {
  highlight: 'Highlight',
  note: 'Note',
  idea: 'Reflection',
  question: 'Question',
  connection: 'Connection',
}
type Sort = 'modified' | 'created' | 'title'
type Draft = { title: string; body: string; source: string; kind: BrainNoteKind; tags: string }

const NEW = 'new'
const stamp = (note: BrainNote) => note.updated ?? note.createdAt
const emptyDraft = (): Draft => ({ title: '', body: '', source: '', kind: 'note', tags: '' })
const draftOf = (note: BrainNote): Draft => ({
  title: note.title,
  body: note.body,
  source: note.source,
  kind: note.kind,
  tags: (note.tags ?? []).join(', '),
})
const parseTags = (value: string) =>
  [
    ...new Set(
      value
        .split(',')
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter(Boolean),
    ),
  ].slice(0, 12)
const sourceLine = (note: BrainNote) =>
  note.bookTitle
    ? `${note.bookTitle}${note.chapter ? ` · ${note.chapter}` : ''}${note.page ? ` · p. ${note.page}` : ''}`
    : note.source

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.valueOf())
    ? ''
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// The full Second Brain: every note in one list, with an editor beside it.
export function SecondBrainPage({
  notes,
  onSave,
  onCreate,
  onDelete,
  onOpenNote,
  diary,
  bookmarklet,
  onExport,
  onShare,
  onImportClippings,
  embed,
  books = [],
}: {
  books?: Pick<LibraryBook, 'finished'>[]
  embed?: Embed
  diary: DiaryEntry[]
  bookmarklet: string
  onExport: () => void
  onShare: (notes: BrainNote[]) => void
  onImportClippings: (file: File) => void
  notes: BrainNote[]
  onSave: (note: BrainNote) => void
  onCreate: (draft: { title: string; body: string; source: string; kind: BrainNoteKind; tags: string[] }) => void
  onDelete: (note: BrainNote) => void
  onOpenNote: (note: BrainNote) => void
}) {
  const [tab, setTab] = useState<TabId>('all')
  const [colorFilter, setColorFilter] = useState<HighlightColor | ''>('')
  const [captureOpen, setCaptureOpen] = useState(false)
  const clippingsInput = useRef<HTMLInputElement | null>(null)
  const bookmarkletLink = useRef<HTMLAnchorElement | null>(null)
  useEffect(() => {
    // React won't render a javascript: address, so the button is given its address directly.
    bookmarkletLink.current?.setAttribute('href', bookmarklet)
  }, [bookmarklet, captureOpen])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('modified')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes
      .filter((note) => !colorFilter || note.color === colorFilter)
      .filter((note) =>
        tab === 'all' || tab === 'diary'
          ? true
          : tab === 'elsewhere'
            ? !note.bookId && !(note.tags ?? []).includes('word')
            : tab === 'words'
              ? (note.tags ?? []).includes('word')
              : note.kind === tab,
      )
      .filter(
        (note) =>
          !q ||
          `${note.title} ${note.body} ${sourceLine(note)} ${(note.tags ?? []).join(' ')}`.toLowerCase().includes(q),
      )
      .sort((a, b) =>
        sort === 'title'
          ? a.title.localeCompare(b.title)
          : sort === 'created'
            ? b.createdAt.localeCompare(a.createdAt)
            : stamp(b).localeCompare(stamp(a)),
      )
  }, [notes, tab, query, sort, colorFilter])

  const selected = selectedId && selectedId !== NEW ? (notes.find((note) => note.id === selectedId) ?? null) : null
  const keywordRelated = useMemo(() => (selected ? relatedNotes(selected, notes) : []), [selected, notes])
  // With the model on, notes that mean the same thing are added to the ones that share words.
  const vectorCache = useRef(new Map<string, Float32Array>())
  const [byMeaning, setByMeaning] = useState<{ id: string; found: typeof notes }>({ id: '', found: [] })
  useEffect(() => {
    if (!embed || !selected) return
    let active = true
    void semanticRelated(selected, notes, embed, vectorCache.current)
      .then((found) => {
        if (active) setByMeaning({ id: selected.id, found: found.map((item) => item.note) })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [embed, selected, notes])
  const related = useMemo(() => {
    const seen = new Set(keywordRelated.map((item) => item.note.id))
    const extra = byMeaning.id === selected?.id ? byMeaning.found.filter((note) => !seen.has(note.id)) : []
    return [...keywordRelated, ...extra.map((note) => ({ note, shared: ['similar idea'] }))].slice(0, 5)
  }, [keywordRelated, byMeaning, selected])
  const editing = selected !== null || selectedId === NEW
  const dirty = selected ? JSON.stringify(draft) !== JSON.stringify(draftOf(selected)) : draft.body.trim() !== ''

  function pick(note: BrainNote) {
    setSelectedId(note.id)
    setDraft(draftOf(note))
    setConfirmDelete(false)
  }
  function startNew() {
    setSelectedId(NEW)
    setDraft(emptyDraft())
    setConfirmDelete(false)
  }
  function save() {
    const body = draft.body.trim()
    if (body.length < 2) return
    const tags = parseTags(draft.tags)
    if (selected) {
      onSave({
        ...selected,
        kind: draft.kind,
        title: draft.title.trim() || selected.title,
        body,
        source: selected.bookId ? selected.source : draft.source.trim() || 'Noesis',
        tags: tags.length ? tags : undefined,
        updated: new Date().toISOString(),
        synced: undefined,
      })
    } else {
      onCreate({ title: draft.title.trim(), body, source: draft.source.trim(), kind: draft.kind, tags })
      setSelectedId(null)
      setDraft(emptyDraft())
    }
  }

  return (
    <div className="brain-page">
      <div className="brain-page-bar">
        <div className="brain-page-tabs" role="tablist" aria-label="Note types">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'brain-filter-active' : ''}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {notes.some((note) => note.color) ? (
          <span className="brain-page-colors" role="group" aria-label="Filter by highlight colour">
            {HIGHLIGHT_COLORS.map((item) => (
              <button
                key={item.id}
                className={'brain-color-dot' + (colorFilter === item.id ? ' brain-color-dot-on' : '')}
                style={{ background: item.css }}
                aria-label={`${item.label} highlights`}
                aria-pressed={colorFilter === item.id}
                onClick={() => setColorFilter(colorFilter === item.id ? '' : item.id)}
              />
            ))}
          </span>
        ) : null}
        <span className="brain-page-bar-actions">
          <button
            className="secondary-button"
            onClick={() => setCaptureOpen((value) => !value)}
            aria-expanded={captureOpen}
          >
            <Upload size={14} /> Bring in notes
          </button>
          <button
            className="secondary-button"
            onClick={() => onShare(shown)}
            disabled={shown.length === 0 || tab === 'diary'}
          >
            <Share2 size={14} /> Share
          </button>
          <button className="secondary-button" onClick={onExport}>
            <Download size={14} /> Export
          </button>
          <button className="primary-button" onClick={startNew}>
            <Plus size={15} /> Add note
          </button>
        </span>
      </div>
      {captureOpen ? (
        <section className="brain-capture panel-card" aria-label="Bring in notes from elsewhere">
          <div>
            <strong>From your phone</strong>
            <p>
              Install Noesis, then use Share in any app or browser and choose Noesis. The text and link arrive as a
              note.
            </p>
          </div>
          <div>
            <strong>From your computer’s browser</strong>
            <p>
              Drag this button to your bookmarks bar. On any page, select some text and press it.
              <br />
              <a
                ref={bookmarkletLink}
                className="brain-bookmarklet"
                onClick={(event) => event.preventDefault()}
                draggable
              >
                Save to Noesis
              </a>
            </p>
          </div>
          <div>
            <strong>From a Kindle</strong>
            <p>
              Connect it to a computer, find “My Clippings.txt”, and import it here. Highlights and notes come in under
              their books.
            </p>
            <button className="secondary-button" onClick={() => clippingsInput.current?.click()}>
              Import Kindle highlights
            </button>
            <input
              ref={clippingsInput}
              type="file"
              accept=".txt,text/plain"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onImportClippings(file)
                event.target.value = ''
              }}
            />
          </div>
          <div>
            <strong>Anything else</strong>
            <p>Press Add note and paste text. If the source is a web address, it stays a link you can click.</p>
          </div>
        </section>
      ) : null}
      {tab === 'diary' ? (
        <section className="brain-diary panel-card" aria-label="Reading diary">
          <YearStats diary={diary} notes={notes} books={books} />
          {diaryDays(diary, notes).length === 0 ? (
            <p className="brain-rail-empty">Your reading days will appear here as you read.</p>
          ) : (
            diaryDays(diary, notes)
              .slice(0, 60)
              .map((day) => (
                <div className="brain-diary-day" key={day.day}>
                  <h4>
                    {new Date(`${day.day}T12:00:00`).toLocaleDateString(undefined, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </h4>
                  <ul>
                    {day.reading.map((entry) => (
                      <li key={entry.bookId}>
                        Read <strong>{entry.title}</strong> for {Math.max(1, Math.round(entry.minutes))} min
                        <small>
                          {' '}
                          · {Math.round(entry.from)}% → {Math.round(entry.to)}%
                        </small>
                      </li>
                    ))}
                    {day.notes.map((note) => (
                      <li key={note.id}>
                        Saved {note.kind === 'idea' ? 'a reflection' : `a ${note.kind}`}: <em>{note.title}</em>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
          )}
        </section>
      ) : (
        <div className="brain-page-body">
          <section className="brain-page-list panel-card" aria-label="Your notes">
            <div className="brain-page-search">
              <div className="field-with-icon">
                <Search size={15} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search notes, books, tags…"
                  aria-label="Search notes"
                />
              </div>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort notes">
                <option value="modified">Last modified</option>
                <option value="created">Date created</option>
                <option value="title">Title</option>
              </select>
            </div>
            <small className="brain-page-count">
              {shown.length} {shown.length === 1 ? 'note' : 'notes'}
            </small>
            {shown.length === 0 ? (
              <p className="brain-rail-empty">
                {notes.length === 0
                  ? 'Select text while reading, or press Add note, to start your Second Brain.'
                  : 'No notes match that.'}
              </p>
            ) : (
              <ul>
                {shown.map((note) => (
                  <li key={note.id}>
                    <button
                      className={`brain-page-item${selectedId === note.id ? ' brain-page-item-active' : ''}`}
                      onClick={() => pick(note)}
                    >
                      <strong>
                        {note.color ? (
                          <i
                            className="brain-item-dot"
                            style={{ background: HIGHLIGHT_COLORS.find((item) => item.id === note.color)?.css }}
                          />
                        ) : null}
                        {note.title}
                      </strong>
                      <span>{note.body}</span>
                      <small>
                        {KIND_LABEL[note.kind]} · {sourceLine(note)} · {when(stamp(note))}
                      </small>
                      {note.tags?.length ? (
                        <em>
                          {note.tags.slice(0, 4).map((tag) => (
                            <i key={tag}>#{tag}</i>
                          ))}
                        </em>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="brain-page-editor panel-card" aria-label="Note editor">
            {editing ? (
              <>
                <div className="brain-page-editor-head">
                  <span className="plan-pill">{selected ? KIND_LABEL[selected.kind] : 'New note'}</span>
                  <span className="brain-page-links">
                    {selected ? (
                      <button
                        className="text-button"
                        onClick={() =>
                          void renderQuoteCard(selected.body, sourceLine(selected))
                            .then((blob) => downloadBlob(blob, 'noesis-quote.png'))
                            .catch(() => undefined)
                        }
                      >
                        <Image size={13} /> Quote card
                      </button>
                    ) : null}
                    {selected?.bookId ? (
                      <button className="text-button" onClick={() => onOpenNote(selected)}>
                        <BookOpen size={13} /> Open in book
                      </button>
                    ) : null}
                  </span>
                </div>
                <label>
                  Title
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    placeholder="Quick note"
                  />
                </label>
                <div className="brain-page-row">
                  <label>
                    Type
                    <select
                      value={draft.kind}
                      onChange={(event) => setDraft({ ...draft, kind: event.target.value as BrainNoteKind })}
                    >
                      {(Object.keys(KIND_LABEL) as BrainNoteKind[]).map((kind) => (
                        <option key={kind} value={kind}>
                          {KIND_LABEL[kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Source
                    <input
                      value={draft.source}
                      onChange={(event) => setDraft({ ...draft, source: event.target.value })}
                      readOnly={Boolean(selected?.bookId)}
                      placeholder="Book, chapter, or link"
                    />
                  </label>
                </div>
                <label>
                  Content
                  <textarea
                    value={draft.body}
                    onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    rows={10}
                    placeholder="Write an idea, question, or highlighted passage…"
                  />
                </label>
                <label>
                  Tags
                  <input
                    value={draft.tags}
                    onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                    placeholder="habits, progress (separate with commas)"
                  />
                </label>
                {selected ? (
                  <>
                    {/^https?:\/\//i.test(selected.source) ? (
                      <a className="text-button" href={selected.source} target="_blank" rel="noreferrer noopener">
                        Open the source
                      </a>
                    ) : null}
                    {selected.quote ? <blockquote className="reader-note-quote">{selected.quote}</blockquote> : null}
                    {related.length > 0 ? (
                      <div className="brain-related">
                        <strong>Related</strong>
                        <ul>
                          {related.map(({ note, shared }) => (
                            <li key={note.id}>
                              <button className="text-button" onClick={() => pick(note)}>
                                {note.title}
                              </button>
                              <small> · {shared.join(', ')}</small>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div className="brain-page-actions">
                  {selected ? (
                    confirmDelete ? (
                      <span className="brain-page-confirm">
                        Delete this note?
                        <button
                          className="secondary-button"
                          onClick={() => {
                            onDelete(selected)
                            setSelectedId(null)
                            setConfirmDelete(false)
                          }}
                        >
                          Yes, delete
                        </button>
                        <button className="text-button" onClick={() => setConfirmDelete(false)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button className="text-button" onClick={() => setConfirmDelete(true)}>
                        <Trash2 size={13} /> Delete
                      </button>
                    )
                  ) : (
                    <span />
                  )}
                  <span className="brain-page-save">
                    <button
                      className="text-button"
                      disabled={!dirty}
                      onClick={() => (selected ? setDraft(draftOf(selected)) : setDraft(emptyDraft()))}
                    >
                      Discard changes
                    </button>
                    <button className="primary-button" disabled={!dirty || draft.body.trim().length < 2} onClick={save}>
                      Save note
                    </button>
                  </span>
                </div>
              </>
            ) : (
              <div className="brain-page-placeholder">
                <BookOpen size={22} />
                <p>Pick a note to read or edit it, or add a new one.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function YearStats({
  diary,
  notes,
  books,
}: {
  diary: DiaryEntry[]
  notes: BrainNote[]
  books: Pick<LibraryBook, 'finished'>[]
}) {
  const [year] = useState(() => new Date().getFullYear())
  const stats = readingStats(diary, notes, books, year)
  if (stats.days === 0) return null
  return (
    <div className="year-stats">
      <h4>Your {stats.year} so far</h4>
      <dl>
        <div>
          <dt>Time reading</dt>
          <dd>{formatHours(stats.minutes)}</dd>
        </div>
        <div>
          <dt>Days</dt>
          <dd>{stats.days}</dd>
        </div>
        <div>
          <dt>Streak</dt>
          <dd>{stats.currentStreak}</dd>
        </div>
        <div>
          <dt>Finished</dt>
          <dd>{stats.booksFinished}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="secondary-button"
        onClick={() => void renderYearCard(stats).then((blob) => downloadBlob(blob, `noesis-${stats.year}.png`))}
      >
        Save as picture
      </button>
    </div>
  )
}
