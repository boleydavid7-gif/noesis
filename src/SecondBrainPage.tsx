import { useMemo, useState } from 'react'
import { BookOpen, Image, Plus, Search, Trash2 } from 'lucide-react'
import { downloadBlob, renderQuoteCard } from './lib/quoteCard'
import type { BrainNote, BrainNoteKind } from './lib/knowledge'

const TABS: Array<{ id: 'all' | BrainNoteKind; label: string }> = [
  { id: 'all', label: 'All notes' },
  { id: 'highlight', label: 'Highlights' },
  { id: 'note', label: 'Quick notes' },
  { id: 'idea', label: 'Reflections' },
  { id: 'question', label: 'Questions' },
  { id: 'connection', label: 'Connections' },
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
}: {
  notes: BrainNote[]
  onSave: (note: BrainNote) => void
  onCreate: (draft: { title: string; body: string; source: string; kind: BrainNoteKind; tags: string[] }) => void
  onDelete: (note: BrainNote) => void
  onOpenNote: (note: BrainNote) => void
}) {
  const [tab, setTab] = useState<'all' | BrainNoteKind>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('modified')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes
      .filter((note) => tab === 'all' || note.kind === tab)
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
  }, [notes, tab, query, sort])

  const selected = selectedId && selectedId !== NEW ? (notes.find((note) => note.id === selectedId) ?? null) : null
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
        <button className="primary-button" onClick={startNew}>
          <Plus size={15} /> Add note
        </button>
      </div>
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
                    <strong>{note.title}</strong>
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
    </div>
  )
}
