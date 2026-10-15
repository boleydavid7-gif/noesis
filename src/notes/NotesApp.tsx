// Noesis Notes: notebooks for every book, on paper or on screen, over the same notes as Noesis's Second Brain.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Pencil,
  ChevronRight,
  FolderClosed,
  HelpCircle,
  Inbox,
  Lightbulb,
  Plus,
  Quote,
  Search,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react'
import { getCurrentSession, isAnonymousUser } from '../lib/auth'
import {
  deleteNote,
  hydrateRemoteNotes,
  onNotesChanged,
  persistNote,
  readLocalNotes,
  syncPendingNotes,
  updateNote,
  type BrainNote,
  type BrainNoteKind,
} from '../lib/knowledge'
import { onLibraryChanged, readLibraryBooks, type LibraryBook } from '../lib/library'
import {
  BOOK_FORMATS,
  NOTE_KINDS,
  cleanLink,
  linkLabel,
  newNotesBook,
  noteFor,
  noteHeadline,
  notebooksFrom,
  readNotesBooks,
  searchNotes,
  sectionsOf,
  writeNotesBooks,
  type BookFormat,
  type Notebook,
  type NotesBook,
} from '../lib/notesBooks'
import { markDeleted } from '../lib/tombstones'
import { resizeCover } from '../lib/libraryTools'
import { CoverFinder } from '../CoverFinder'

type View =
  | { kind: 'home' }
  | { kind: 'notebook'; key: string }
  | { kind: 'note'; id: string; from?: string }
  | { kind: 'new'; notebook: string }

const KIND_ICON: Record<BrainNoteKind, typeof StickyNote> = {
  note: StickyNote,
  highlight: Quote,
  question: HelpCircle,
  idea: Lightbulb,
  connection: StickyNote,
}

function viewFromAddress(): View {
  const open = new URLSearchParams(location.search).get('open') ?? ''
  if (open.startsWith('notebook:')) return { kind: 'notebook', key: open.slice(9) }
  if (open.startsWith('note:')) return { kind: 'note', id: open.slice(5) }
  if (open === 'new') return { kind: 'new', notebook: 'inbox' }
  return { kind: 'home' }
}

function addressFor(view: View): string {
  const open = view.kind === 'notebook' ? `notebook:${view.key}` : view.kind === 'note' ? `note:${view.id}` : ''
  return open ? `/notes/?open=${encodeURIComponent(open)}` : '/notes/'
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function NotesApp() {
  const [notes, setNotes] = useState<BrainNote[]>(() => readLocalNotes())
  const [outside, setOutside] = useState<NotesBook[]>(() => readNotesBooks())
  const [library, setLibrary] = useState<LibraryBook[]>(() => readLibraryBooks())
  const [view, setView] = useState<View>(viewFromAddress)
  const [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => onNotesChanged(() => setNotes(readLocalNotes())), [])
  useEffect(() => onLibraryChanged(() => setLibrary(readLibraryBooks())), [])
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (event.key === 'noesis:notes-books:v1') setOutside(readNotesBooks())
    }
    window.addEventListener('storage', storage)
    return () => window.removeEventListener('storage', storage)
  }, [])
  // The same notes as Noesis: brought up to date from the account when signed in.
  useEffect(() => {
    void (async () => {
      const session = await getCurrentSession().catch(() => null)
      const user = session?.user ?? null
      const next =
        user && !isAnonymousUser(user)
          ? await syncPendingNotes(readLocalNotes()).catch(() => null)
          : await hydrateRemoteNotes(readLocalNotes()).catch(() => null)
      if (next) setNotes(next)
    })()
  }, [])
  useEffect(() => {
    const back = () => setView(viewFromAddress())
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])
  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), 7_000)
    return () => window.clearTimeout(timer)
  }, [undo])

  const go = useCallback((next: View, replace = false) => {
    if (replace) history.replaceState(null, '', addressFor(next))
    else history.pushState(null, '', addressFor(next))
    setView(next)
    window.scrollTo({ top: 0 })
  }, [])
  const back = () => (history.length > 1 ? history.back() : go({ kind: 'home' }, true))

  const notebooks = useMemo(() => notebooksFrom(notes, outside, library), [notes, outside, library])
  const notebookFor = (key: string): Notebook | null => {
    const found = notebooks.find((item) => item.key === key)
    if (found) return found
    if (key.startsWith('noesis-')) {
      const book = library.find((item) => `noesis-${item.id}` === key)
      if (book)
        return {
          key,
          kind: 'noesis',
          title: book.title,
          author: book.author,
          coverUrl: book.coverDataUrl || book.coverUrl,
          libraryBook: book,
          notes: [],
          updated: '',
        }
    }
    if (key === 'inbox') return { key, kind: 'inbox', title: 'Inbox', notes: [], updated: '' }
    if (key.startsWith('folder:')) return { key, kind: 'folder', title: key.slice(7), notes: [], updated: '' }
    return null
  }

  function saveOutside(next: NotesBook[]) {
    setOutside(next)
    writeNotesBooks(next)
  }

  async function saveNote(note: BrainNote, isNew: boolean) {
    const stamped = { ...note, updated: new Date().toISOString(), synced: undefined }
    if (isNew) {
      setNotes((current) => [stamped, ...current])
      await persistNote(stamped)
    } else {
      setNotes((current) => current.map((item) => (item.id === note.id ? stamped : item)))
      await updateNote(stamped)
    }
    setNotes(readLocalNotes())
  }

  function removeNote(note: BrainNote) {
    markDeleted('note', note.id)
    setNotes((current) => current.filter((item) => item.id !== note.id))
    void deleteNote(note.id)
    setUndo({
      label: 'Note deleted.',
      run: () => void saveNote({ ...note, id: `local-${Date.now().toString(36)}`, synced: undefined }, true),
    })
  }

  const current =
    view.kind === 'notebook' ? notebookFor(view.key) : view.kind === 'new' ? notebookFor(view.notebook) : null
  const editing = view.kind === 'note' ? (notes.find((note) => note.id === view.id) ?? null) : null
  const editingBook = editing
    ? (notebooks.find((item) => item.notes.some((note) => note.id === editing.id)) ?? null)
    : null

  return (
    <div className="notes-app">
      {view.kind === 'home' ? (
        <Home
          notebooks={notebooks}
          notes={notes}
          library={library}
          onOpen={(key) => go({ kind: 'notebook', key })}
          onOpenNote={(id) => go({ kind: 'note', id })}
          onAdd={() => setAdding(true)}
          onNewNote={() => go({ kind: 'new', notebook: 'inbox' })}
          onNewFolder={(name) => go({ kind: 'new', notebook: `folder:${name}` })}
        />
      ) : null}
      {view.kind === 'notebook' && current ? (
        <NotebookPage
          notebook={current}
          onBack={back}
          onOpenNote={(id) => go({ kind: 'note', id, from: current.key })}
          onNew={() => go({ kind: 'new', notebook: current.key })}
          onBook={(book) => saveOutside(outside.map((item) => (item.id === book.id ? book : item)))}
          onRemoveBook={(book) => {
            const before = outside
            saveOutside(outside.filter((item) => item.id !== book.id))
            setUndo({ label: `Removed “${book.title}”. Its notes stay.`, run: () => saveOutside(before) })
            go({ kind: 'home' }, true)
          }}
        />
      ) : null}
      {view.kind === 'notebook' && !current ? (
        <div className="notes-page">
          <TopBar onBack={back} title="Notes" />
          <p className="notes-empty">This notebook is not on this device.</p>
        </div>
      ) : null}
      {view.kind === 'new' ? (
        <NoteEditor
          note={noteFor(current, {})}
          notebook={current}
          isNew
          onCancel={back}
          onSave={(note) => {
            void saveNote(note, true)
            back()
          }}
        />
      ) : null}
      {view.kind === 'note' && editing ? (
        <NoteEditor
          key={editing.id}
          note={editing}
          notebook={editingBook}
          onCancel={back}
          onSave={(note) => {
            void saveNote(note, false)
            back()
          }}
          onDelete={() => {
            removeNote(editing)
            back()
          }}
        />
      ) : null}
      {view.kind === 'note' && !editing ? (
        <div className="notes-page">
          <TopBar onBack={back} title="Notes" />
          <p className="notes-empty">This note is not on this device.</p>
        </div>
      ) : null}
      {adding ? (
        <AddBook
          library={library}
          onClose={() => setAdding(false)}
          onAdd={(book) => {
            saveOutside([book, ...outside])
            setAdding(false)
            go({ kind: 'notebook', key: book.id })
          }}
          onOpenNoesis={(book) => {
            setAdding(false)
            go({ kind: 'notebook', key: `noesis-${book.id}` })
          }}
        />
      ) : null}
      {undo ? (
        <div className="notes-undo" role="status">
          <span>{undo.label}</span>
          <button
            onClick={() => {
              undo.run()
              setUndo(null)
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>
  )
}

function TopBar({ onBack, title, children }: { onBack?: () => void; title: string; children?: React.ReactNode }) {
  return (
    <header className="notes-topbar">
      {onBack ? (
        <button className="notes-back" onClick={onBack}>
          <ArrowLeft size={18} /> {title}
        </button>
      ) : (
        <a className="notes-back" href="/">
          <ArrowLeft size={18} /> Noesis
        </a>
      )}
      <div className="notes-topbar-actions">{children}</div>
    </header>
  )
}

function Cover({ notebook, size = 'small' }: { notebook: Notebook; size?: 'small' | 'large' }) {
  const Icon = notebook.kind === 'folder' ? FolderClosed : notebook.kind === 'inbox' ? Inbox : BookOpen
  return notebook.coverUrl ? (
    <img className={`notes-cover notes-cover-${size}`} src={notebook.coverUrl} alt="" referrerPolicy="no-referrer" />
  ) : (
    <span className={`notes-cover notes-cover-${size} notes-cover-blank`} aria-hidden="true">
      {notebook.kind === 'book' || notebook.kind === 'noesis' ? notebook.title.slice(0, 1) : <Icon size={18} />}
    </span>
  )
}

function Home({
  notebooks,
  notes,
  library,
  onOpen,
  onOpenNote,
  onAdd,
  onNewNote,
  onNewFolder,
}: {
  notebooks: Notebook[]
  notes: BrainNote[]
  library: LibraryBook[]
  onOpen: (key: string) => void
  onOpenNote: (id: string) => void
  onAdd: () => void
  onNewNote: () => void
  onNewFolder: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [folderName, setFolderName] = useState<string | null>(null)
  const results = useMemo(() => searchNotes(notes, query), [notes, query])
  const books = notebooks.filter((item) => item.kind === 'book' || item.kind === 'noesis')
  const folders = notebooks.filter((item) => item.kind === 'folder')
  const inbox = notebooks.find((item) => item.kind === 'inbox')
  const fresh = notes.length === 0 && books.length === 0

  return (
    <div className="notes-page">
      <TopBar title="Noesis" />
      <div className="notes-brand">
        <h1>Notes</h1>
        <small>Noesis Notes · by Proairetos</small>
      </div>
      <label className="notes-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search every note"
          aria-label="Search every note"
        />
        {query ? (
          <button onClick={() => setQuery('')} aria-label="Clear search">
            <X size={14} />
          </button>
        ) : null}
      </label>

      {query.trim() ? (
        <section className="notes-section">
          <h2>{results.length ? 'Notes' : 'Nothing matches'}</h2>
          {results.length ? (
            <div className="notes-list">
              {results.slice(0, 60).map((note) => (
                <NoteRow key={note.id} note={note} showBook onOpen={() => onOpenNote(note.id)} />
              ))}
            </div>
          ) : null}
        </section>
      ) : fresh ? (
        <section className="notes-first">
          <p>Notes for every book, on paper or on screen. Quotes with their page, your own words, and questions.</p>
          <button className="notes-primary" onClick={onAdd}>
            <Plus size={16} /> Add a book
          </button>
          {library.length ? (
            <small>Books in your Noesis library are here too, once you add notes to them.</small>
          ) : null}
        </section>
      ) : (
        <>
          <section className="notes-section">
            <div className="notes-section-head">
              <h2>Books</h2>
              <button className="notes-link" onClick={onAdd}>
                <Plus size={14} /> Add a book
              </button>
            </div>
            {books.length ? (
              <div className="notes-shelf">
                {books.map((book) => (
                  <button key={book.key} className="notes-book" onClick={() => onOpen(book.key)}>
                    <Cover notebook={book} size="large" />
                    <strong>{book.title}</strong>
                    <small>
                      {book.notes.length} {book.notes.length === 1 ? 'note' : 'notes'}
                      {book.kind === 'noesis' ? ' · in Noesis' : ''}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="notes-empty">No books yet.</p>
            )}
          </section>
          <section className="notes-section">
            <div className="notes-section-head">
              <h2>Notebooks</h2>
              <button className="notes-link" onClick={() => setFolderName('')}>
                <Plus size={14} /> New notebook
              </button>
            </div>
            {folderName !== null ? (
              <form
                className="notes-inline-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (folderName.trim()) onNewFolder(folderName.trim().slice(0, 60))
                }}
              >
                <input
                  autoFocus
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  placeholder="Name, e.g. Lectures"
                  aria-label="Notebook name"
                />
                <button className="notes-primary" type="submit" disabled={!folderName.trim()}>
                  Start
                </button>
                <button type="button" className="notes-link" onClick={() => setFolderName(null)}>
                  Cancel
                </button>
              </form>
            ) : null}
            <div className="notes-list">
              {inbox ? <NotebookRow notebook={inbox} onOpen={() => onOpen(inbox.key)} /> : null}
              {folders.map((folder) => (
                <NotebookRow key={folder.key} notebook={folder} onOpen={() => onOpen(folder.key)} />
              ))}
              {!inbox && !folders.length ? (
                <p className="notes-empty notes-list-empty">Notes without a book go here.</p>
              ) : null}
            </div>
          </section>
        </>
      )}
      <button className="notes-fab" onClick={onNewNote} aria-label="New note">
        <Plus size={22} />
      </button>
    </div>
  )
}

function NotebookRow({ notebook, onOpen }: { notebook: Notebook; onOpen: () => void }) {
  return (
    <button className="notes-row" onClick={onOpen}>
      <Cover notebook={notebook} />
      <span className="notes-row-text">
        <strong>{notebook.title}</strong>
        <small>
          {notebook.notes.length} {notebook.notes.length === 1 ? 'note' : 'notes'}
          {notebook.updated ? ` · ${day(notebook.updated)}` : ''}
        </small>
      </span>
      <ChevronRight size={16} className="notes-chevron" aria-hidden="true" />
    </button>
  )
}

function NoteRow({ note, showBook, onOpen }: { note: BrainNote; showBook?: boolean; onOpen: () => void }) {
  const Icon = KIND_ICON[note.kind] ?? StickyNote
  const extra = note.title?.trim() ? note.quote?.trim() || note.body.trim() : note.quote?.trim() ? note.body.trim() : ''
  return (
    <button className={`notes-row notes-note notes-note-${note.kind}`} onClick={onOpen}>
      <span className="notes-kind" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="notes-row-text">
        <strong className={note.kind === 'highlight' && !note.title ? 'notes-quote-line' : ''}>
          {noteHeadline(note)}
        </strong>
        {extra ? <em>{extra.split('\n')[0].slice(0, 140)}</em> : null}
        <small>
          {[
            showBook ? note.bookTitle || note.notebook : '',
            note.page ? `p. ${note.page}` : '',
            day(note.updated ?? note.createdAt),
          ]
            .filter(Boolean)
            .join(' · ')}
        </small>
      </span>
      <ChevronRight size={16} className="notes-chevron" aria-hidden="true" />
    </button>
  )
}

function NotebookPage({
  notebook,
  onBack,
  onOpenNote,
  onNew,
  onBook,
  onRemoveBook,
}: {
  notebook: Notebook
  onBack: () => void
  onOpenNote: (id: string) => void
  onNew: () => void
  onBook: (book: NotesBook) => void
  onRemoveBook: (book: NotesBook) => void
}) {
  const [kind, setKind] = useState<BrainNoteKind | 'all'>('all')
  const [editing, setEditing] = useState(false)
  const kinds = NOTE_KINDS.filter((item) => notebook.notes.some((note) => note.kind === item.id))
  const shown = notebook.notes.filter((note) => kind === 'all' || note.kind === kind)
  const sections = sectionsOf(shown)
  const book = notebook.book
  return (
    <div className="notes-page">
      <TopBar onBack={onBack} title="Notes">
        {book ? (
          <button className="notes-link" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Edit
          </button>
        ) : null}
        <button className="notes-primary notes-small" onClick={onNew}>
          <Plus size={15} /> Note
        </button>
      </TopBar>
      <header className="notes-book-head">
        {book?.link ? (
          <a
            href={book.link}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${notebook.title} at ${linkLabel(book.link)}`}
          >
            <Cover notebook={notebook} size="large" />
          </a>
        ) : (
          <Cover notebook={notebook} size="large" />
        )}
        <div>
          <h1>{notebook.title}</h1>
          {notebook.author ? <p>{notebook.author}</p> : null}
          <div className="notes-chips">
            {book ? (
              <span className="notes-chip">{BOOK_FORMATS.find((item) => item.id === book.format)?.label}</span>
            ) : null}
            {book?.link ? (
              <a className="notes-chip notes-chip-link" href={book.link} target="_blank" rel="noreferrer noopener">
                Open at {linkLabel(book.link)} <ExternalLink size={11} aria-hidden="true" />
              </a>
            ) : null}
            {notebook.kind === 'noesis' && notebook.libraryBook ? (
              <a className="notes-chip notes-chip-link" href={`/?book=${encodeURIComponent(notebook.libraryBook.id)}`}>
                Open in Noesis
              </a>
            ) : null}
          </div>
          {book ? (
            <label className="notes-place">
              Where I am: p.
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={book.page ?? ''}
                onChange={(event) =>
                  onBook({
                    ...book,
                    page: event.target.value ? Math.max(0, Math.round(Number(event.target.value))) : undefined,
                    updated: new Date().toISOString(),
                  })
                }
                aria-label="Page you are on"
              />
              {book.pages ? <span>of {book.pages}</span> : null}
            </label>
          ) : null}
        </div>
      </header>
      {kinds.length > 1 ? (
        <div className="notes-filter" role="tablist" aria-label="Show">
          <button role="tab" aria-selected={kind === 'all'} onClick={() => setKind('all')}>
            All <span>{notebook.notes.length}</span>
          </button>
          {kinds.map((item) => (
            <button key={item.id} role="tab" aria-selected={kind === item.id} onClick={() => setKind(item.id)}>
              {item.label === 'Quote' ? 'Quotes' : `${item.label}s`}{' '}
              <span>{notebook.notes.filter((note) => note.kind === item.id).length}</span>
            </button>
          ))}
        </div>
      ) : null}
      {sections.length ? (
        sections.map((section) => (
          <section className="notes-section" key={section.title || 'none'}>
            <h2>{section.title || (sections.length > 1 ? 'No chapter' : 'Notes')}</h2>
            <div className="notes-list">
              {section.notes.map((note) => (
                <NoteRow key={note.id} note={note} onOpen={() => onOpenNote(note.id)} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <section className="notes-first">
          <p>Nothing here yet. Keep a quote with its page, or write what you think.</p>
          <button className="notes-primary" onClick={onNew}>
            <Plus size={16} /> New note
          </button>
        </section>
      )}
      {book && editing ? (
        <EditBook
          book={book}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            onBook({ ...next, updated: new Date().toISOString() })
            setEditing(false)
          }}
        />
      ) : null}
      {book ? (
        <button className="notes-link notes-danger" onClick={() => onRemoveBook(book)}>
          <Trash2 size={14} /> Remove this book (its notes stay)
        </button>
      ) : null}
    </div>
  )
}

function NoteEditor({
  note,
  notebook,
  isNew = false,
  onCancel,
  onSave,
  onDelete,
}: {
  note: BrainNote
  notebook: Notebook | null
  isNew?: boolean
  onCancel: () => void
  onSave: (note: BrainNote) => void
  onDelete?: () => void
}) {
  const [draft, setDraft] = useState(note)
  const [tags, setTags] = useState((note.tags ?? []).join(', '))
  const chapters = useMemo(
    () => [...new Set((notebook?.notes ?? []).map((item) => item.chapter?.trim()).filter(Boolean))] as string[],
    [notebook],
  )
  const set = (change: Partial<BrainNote>) => setDraft((current) => ({ ...current, ...change }))
  const empty = !draft.body.trim() && !draft.quote?.trim() && !draft.title.trim()
  const save = () =>
    onSave({
      ...draft,
      title: draft.title.trim(),
      body: draft.body.trim(),
      quote: draft.quote?.trim() || undefined,
      chapter: draft.chapter?.trim() || undefined,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12),
    })
  return (
    <div className="notes-page notes-editor">
      <header className="notes-topbar">
        <button className="notes-back" onClick={onCancel}>
          Cancel
        </button>
        <span className="notes-editor-where">{notebook?.title ?? 'Inbox'}</span>
        <button className="notes-primary notes-small" onClick={save} disabled={empty}>
          Done
        </button>
      </header>
      <div className="notes-segmented" role="radiogroup" aria-label="Kind">
        {NOTE_KINDS.map((item) => (
          <button
            key={item.id}
            role="radio"
            aria-checked={draft.kind === item.id}
            onClick={() => set({ kind: item.id })}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="notes-fields">
        {draft.kind === 'highlight' || draft.quote ? (
          <textarea
            className="notes-quote-field"
            rows={3}
            value={draft.quote ?? ''}
            onChange={(event) => set({ quote: event.target.value })}
            placeholder="The passage, as written"
            aria-label="Quote"
            maxLength={4_000}
            autoFocus={isNew}
          />
        ) : null}
        <div className="notes-field-row">
          <label>
            Page
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={draft.page ?? ''}
              onChange={(event) =>
                set({ page: event.target.value ? Math.max(0, Math.round(Number(event.target.value))) : undefined })
              }
            />
          </label>
          <label className="notes-grow">
            Chapter (optional)
            <input
              list="notes-chapters"
              value={draft.chapter ?? ''}
              onChange={(event) => set({ chapter: event.target.value })}
              maxLength={120}
            />
            <datalist id="notes-chapters">
              {chapters.map((chapter) => (
                <option key={chapter} value={chapter} />
              ))}
            </datalist>
          </label>
        </div>
        <input
          className="notes-title-field"
          value={draft.title}
          onChange={(event) => set({ title: event.target.value })}
          placeholder="Title (optional)"
          aria-label="Title"
          maxLength={160}
        />
        <textarea
          className="notes-body-field"
          rows={10}
          value={draft.body}
          onChange={(event) => set({ body: event.target.value })}
          placeholder={draft.kind === 'question' ? 'What do you want to find out?' : 'Your own words'}
          aria-label="Note"
          maxLength={20_000}
          autoFocus={isNew && draft.kind !== 'highlight'}
        />
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="Tags (optional), separated by commas"
          aria-label="Tags"
        />
      </div>
      {onDelete ? (
        <button className="notes-link notes-danger" onClick={onDelete}>
          <Trash2 size={14} /> Delete note
        </button>
      ) : null}
    </div>
  )
}

type Found = { id: string; title: string; author: string; year?: number; coverUrl?: string; source: string }

function AddBook({
  library,
  onClose,
  onAdd,
  onOpenNoesis,
}: {
  library: LibraryBook[]
  onClose: () => void
  onAdd: (book: NotesBook) => void
  onOpenNoesis: (book: LibraryBook) => void
}) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Found[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Found | null>(null)
  const [format, setFormat] = useState<BookFormat>('paper')
  const [manual, setManual] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  async function look(event: React.FormEvent) {
    event.preventDefault()
    if (query.trim().length < 2) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
      const body = (await response.json()) as { ok?: boolean; error?: string; results?: Array<Record<string, unknown>> }
      if (!response.ok || !body.ok) throw new Error(body.error || 'Books could not be looked up right now.')
      const seen = new Set<string>()
      setFound(
        (body.results ?? [])
          .filter((row) => typeof row.title === 'string')
          .map((row) => ({
            id: String(row.id ?? row.title),
            title: String(row.title),
            author: typeof row.author === 'string' && row.author !== 'Unknown author' ? row.author : '',
            year: typeof row.year === 'number' ? row.year : undefined,
            coverUrl: typeof row.coverUrl === 'string' ? row.coverUrl : undefined,
            source: String(row.source ?? ''),
          }))
          .filter((row) => {
            const key = `${row.title}|${row.author}`.toLowerCase()
            return !seen.has(key) && Boolean(seen.add(key))
          })
          .slice(0, 12),
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Books could not be looked up right now.')
    } finally {
      setBusy(false)
    }
  }

  const inLibrary = library.filter(
    (book) => !query.trim() || `${book.title} ${book.author}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <div className="notes-sheet-backdrop" onClick={onClose}>
      <div
        className="notes-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Add a book"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="notes-topbar">
          <button className="notes-back" onClick={onClose}>
            Cancel
          </button>
          <span className="notes-editor-where">Add a book</span>
          <span />
        </header>
        {picked || manual ? (
          <div className="notes-fields">
            {picked ? (
              <div className="notes-picked">
                {picked.coverUrl ? <img src={picked.coverUrl} alt="" referrerPolicy="no-referrer" /> : null}
                <div>
                  <strong>{picked.title}</strong>
                  <small>{[picked.author, picked.year].filter(Boolean).join(' · ')}</small>
                </div>
              </div>
            ) : (
              <>
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" autoFocus />
                <input
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                  placeholder="Author (optional)"
                />
              </>
            )}
            <div className="notes-segmented" role="radiogroup" aria-label="Kind of copy">
              {BOOK_FORMATS.map((item) => (
                <button key={item.id} role="radio" aria-checked={format === item.id} onClick={() => setFormat(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <button
              className="notes-primary"
              disabled={!picked && !title.trim()}
              onClick={() =>
                onAdd(
                  newNotesBook({
                    title: picked?.title ?? title,
                    author: picked?.author ?? author,
                    coverUrl: picked?.coverUrl,
                    year: picked?.year,
                    format,
                  }),
                )
              }
            >
              Add
            </button>
            <button
              className="notes-link"
              onClick={() => {
                setPicked(null)
                setManual(false)
              }}
            >
              Back to search
            </button>
          </div>
        ) : (
          <>
            <form className="notes-search" onSubmit={look}>
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Title or author"
                aria-label="Title or author"
              />
            </form>
            {busy ? <p className="notes-empty">Looking…</p> : null}
            {error ? <p className="notes-empty">{error}</p> : null}
            {found?.length ? (
              <div className="notes-list">
                {found.map((row) => (
                  <button key={row.id} className="notes-row" onClick={() => setPicked(row)}>
                    {row.coverUrl ? (
                      <img
                        className="notes-cover notes-cover-small"
                        src={row.coverUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="notes-cover notes-cover-small notes-cover-blank">{row.title.slice(0, 1)}</span>
                    )}
                    <span className="notes-row-text">
                      <strong>{row.title}</strong>
                      <small>{[row.author, row.year].filter(Boolean).join(' · ')}</small>
                    </span>
                    <ChevronRight size={16} className="notes-chevron" aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : found ? (
              <p className="notes-empty">No books found. Type it in instead.</p>
            ) : null}
            <button className="notes-link" onClick={() => setManual(true)}>
              Type it in instead
            </button>
            {inLibrary.length ? (
              <section className="notes-section">
                <h2>In your Noesis library</h2>
                <div className="notes-list">
                  {inLibrary.slice(0, 20).map((book) => (
                    <button key={book.id} className="notes-row" onClick={() => onOpenNoesis(book)}>
                      {book.coverDataUrl || book.coverUrl ? (
                        <img
                          className="notes-cover notes-cover-small"
                          src={book.coverDataUrl || book.coverUrl}
                          alt=""
                        />
                      ) : (
                        <span className="notes-cover notes-cover-small notes-cover-blank">
                          {book.title.slice(0, 1)}
                        </span>
                      )}
                      <span className="notes-row-text">
                        <strong>{book.title}</strong>
                        <small>{book.author}</small>
                      </span>
                      <ChevronRight size={16} className="notes-chevron" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

// A book kept outside Noesis: its details, its cover (found online, a photo, or an address), and where to read it.
function EditBook({
  book,
  onClose,
  onSave,
}: {
  book: NotesBook
  onClose: () => void
  onSave: (book: NotesBook) => void
}) {
  const [draft, setDraft] = useState(book)
  const [link, setLink] = useState(book.link ?? '')
  const [coverAddress, setCoverAddress] = useState('')
  const [finding, setFinding] = useState(false)
  const [problem, setProblem] = useState('')
  const set = (change: Partial<NotesBook>) => setDraft((current) => ({ ...current, ...change }))
  const linkOk = !link.trim() || Boolean(cleanLink(link))
  return (
    <div className="notes-sheet-backdrop" onClick={onClose}>
      <div
        className="notes-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Edit book"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="notes-topbar">
          <button className="notes-back" onClick={onClose}>
            Cancel
          </button>
          <span className="notes-editor-where">Edit book</span>
          <button
            className="notes-primary notes-small"
            disabled={!draft.title.trim() || !linkOk}
            onClick={() =>
              onSave({ ...draft, title: draft.title.trim(), author: draft.author.trim(), link: cleanLink(link) })
            }
          >
            Done
          </button>
        </header>
        <div className="notes-edit-cover">
          {draft.coverUrl ? (
            <img src={draft.coverUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="notes-cover notes-cover-large notes-cover-blank">{draft.title.slice(0, 1)}</span>
          )}
          <div className="notes-edit-cover-actions">
            <button className="notes-link" onClick={() => setFinding(true)}>
              Find a cover
            </button>
            <label className="notes-link">
              Choose a photo
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  resizeCover(file).then(
                    (dataUrl) => set({ coverUrl: dataUrl }),
                    () => setProblem('That picture could not be read.'),
                  )
                }}
              />
            </label>
            {draft.coverUrl ? (
              <button className="notes-link notes-danger" onClick={() => set({ coverUrl: undefined })}>
                Remove cover
              </button>
            ) : null}
          </div>
        </div>
        <div className="notes-inline-form">
          <input
            value={coverAddress}
            onChange={(event) => setCoverAddress(event.target.value)}
            placeholder="Or paste a picture's address"
            aria-label="Cover picture address"
          />
          <button
            className="notes-link"
            disabled={!cleanLink(coverAddress)}
            onClick={() => {
              set({ coverUrl: cleanLink(coverAddress) })
              setCoverAddress('')
            }}
          >
            Use
          </button>
        </div>
        {problem ? <p className="notes-empty">{problem}</p> : null}
        <div className="notes-fields">
          <input
            value={draft.title}
            onChange={(event) => set({ title: event.target.value })}
            placeholder="Title"
            aria-label="Title"
          />
          <input
            value={draft.author}
            onChange={(event) => set({ author: event.target.value })}
            placeholder="Author (optional)"
            aria-label="Author"
          />
          <div className="notes-segmented" role="radiogroup" aria-label="Kind of copy">
            {BOOK_FORMATS.map((item) => (
              <button
                key={item.id}
                role="radio"
                aria-checked={draft.format === item.id}
                onClick={() => set({ format: item.id })}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="notes-field-label">
            Where you read it (optional)
            <input
              type="url"
              inputMode="url"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="e.g. a Kindle, Libby, store or library page"
              aria-invalid={!linkOk}
            />
          </label>
          {!linkOk ? <p className="notes-empty">That doesn't look like a web address.</p> : null}
          {link.trim() ? (
            <button className="notes-link notes-danger" onClick={() => setLink('')}>
              Remove link
            </button>
          ) : null}
          <label className="notes-field-label">
            Pages (optional)
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={draft.pages ?? ''}
              onChange={(event) =>
                set({ pages: event.target.value ? Math.max(1, Math.round(Number(event.target.value))) : undefined })
              }
            />
          </label>
        </div>
      </div>
      {finding ? (
        <div onClick={(event) => event.stopPropagation()}>
          <CoverFinder
            title={draft.title}
            author={draft.author}
            onClose={() => setFinding(false)}
            onPick={(cover) => {
              set({ coverUrl: cover })
              setFinding(false)
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
