import { useState } from 'react'
import { BookOpen, Bookmark, Copy, Highlighter, StickyNote, Trash2 } from 'lucide-react'
import { HIGHLIGHT_COLORS, type BrainNote } from './lib/knowledge'
import { citation, inBookOrder, isBookmark } from './lib/bookmarks'

type Filter = 'all' | 'highlights' | 'notes' | 'bookmarks'

const kindOf = (note: BrainNote): Exclude<Filter, 'all'> =>
  isBookmark(note) ? 'bookmarks' : note.kind === 'highlight' ? 'highlights' : 'notes'

// Everything saved from one book in one place, in the order it appears, each with a way back to its spot.
export function BookNotesBrowser({
  notes,
  book,
  onOpen,
  onRemove,
  onCopied,
}: {
  notes: BrainNote[]
  book: { title: string; author?: string }
  onOpen: (note: BrainNote) => void
  onRemove: (note: BrainNote) => void
  onCopied: (message: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [sure, setSure] = useState<string | null>(null)
  const counts = { all: notes.length, highlights: 0, notes: 0, bookmarks: 0 }
  for (const note of notes) counts[kindOf(note)] += 1
  const shown = inBookOrder(notes.filter((note) => filter === 'all' || kindOf(note) === filter))
  const tabs: Array<[Filter, string]> = [
    ['all', 'All'],
    ['highlights', 'Highlights'],
    ['notes', 'Notes'],
    ['bookmarks', 'Bookmarks'],
  ]
  return (
    <div className="book-browser">
      <div className="book-browser-tabs" role="tablist" aria-label="Saved from this book">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={filter === id}
            className={filter === id ? 'book-browser-tab-on' : ''}
            onClick={() => setFilter(id)}
          >
            {label} <small>{counts[id]}</small>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="reader-rail-empty">
          {notes.length === 0
            ? 'Highlights, notes and bookmarks from this book will collect here.'
            : 'Nothing of that kind yet.'}
        </p>
      ) : (
        <ul className="book-browser-list">
          {shown.map((note) => {
            const kind = kindOf(note)
            const colour = HIGHLIGHT_COLORS.find((item) => item.id === note.color)?.css
            const text = (note.quote || note.body).replace(/\s+/g, ' ').trim()
            return (
              <li key={note.id}>
                <div className="book-browser-where">
                  {kind === 'bookmarks' ? (
                    <Bookmark size={12} />
                  ) : kind === 'highlights' ? (
                    <Highlighter size={12} style={colour ? { color: colour } : undefined} />
                  ) : (
                    <StickyNote size={12} />
                  )}
                  <span>
                    {note.chapter || 'Somewhere in the book'}
                    {note.page ? ` · p. ${note.page}` : ''}
                  </span>
                </div>
                {kind === 'notes' && note.title ? <strong>{note.title}</strong> : null}
                <p style={kind === 'highlights' && colour ? { borderLeftColor: colour } : undefined}>
                  {text.length > 200 ? `${text.slice(0, 200)}…` : text}
                </p>
                {kind === 'notes' && note.quote ? <small className="book-browser-quote">“{note.quote}”</small> : null}
                <div className="book-browser-actions">
                  <button onClick={() => onOpen(note)}>
                    <BookOpen size={11} /> Go there
                  </button>
                  {kind !== 'bookmarks' ? (
                    <button
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(citation(note, book))
                          .then(() => onCopied('Copied with its source.'))
                          .catch(() => onCopied('Could not copy here.'))
                      }}
                    >
                      <Copy size={11} /> Copy
                    </button>
                  ) : null}
                  <button
                    onClick={() => {
                      if (sure === note.id) {
                        setSure(null)
                        onRemove(note)
                      } else setSure(note.id)
                    }}
                    onBlur={() => setSure((current) => (current === note.id ? null : current))}
                    aria-label={sure === note.id ? 'Press again to remove' : 'Remove'}
                  >
                    <Trash2 size={11} /> {sure === note.id ? 'Remove?' : ''}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
