// Noesis Notes: notebooks for every book, on paper or on screen, over the same notes as Noesis's Second Brain.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
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
  NOTE_KINDS,
  newNotesBook,
  noteFor,
  noteHeadline,
  notebooksFrom,
  readNotesBooks,
  searchNotes,
  sectionsOf,
  writeNotesBooks,
  type Notebook,
  type NotesBook,
} from '../lib/notesBooks'
import { markDeleted } from '../lib/tombstones'

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
        <BookPicker
          library={library}
          onClose={() => setAdding(false)}
          onTitle={(title, author) => {
            const book = newNotesBook({ title, author, format: 'paper' })
            saveOutside([book, ...outside])
            setAdding(false)
            go({ kind: 'notebook', key: book.id })
          }}
          onPickNoesis={(book) => {
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

// Notebooks are told apart by a small icon: a book, a folder, or the inbox. No covers here; books live in Noesis.
function NotebookIcon({ notebook }: { notebook: Notebook }) {
  const Icon = notebook.kind === 'folder' ? FolderClosed : notebook.kind === 'inbox' ? Inbox : BookOpen
  return (
    <span className={`notes-kind notes-kind-${notebook.kind}`} aria-hidden="true">
      <Icon size={16} />
    </span>
  )
}

function Home({
  notebooks,
  notes,
  onOpen,
  onOpenNote,
  onAdd,
  onNewNote,
  onNewFolder,
}: {
  notebooks: Notebook[]
  notes: BrainNote[]
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
          <button className="notes-primary" onClick={onAdd}>
            <Plus size={16} /> Add a book
          </button>
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
              <div className="notes-list">
                {books.map((book) => (
                  <NotebookRow key={book.key} notebook={book} onOpen={() => onOpen(book.key)} />
                ))}
              </div>
            ) : null}
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
      <NotebookIcon notebook={notebook} />
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
  onRemoveBook,
}: {
  notebook: Notebook
  onBack: () => void
  onOpenNote: (id: string) => void
  onNew: () => void
  onRemoveBook: (book: NotesBook) => void
}) {
  const [kind, setKind] = useState<BrainNoteKind | 'all'>('all')
  const kinds = NOTE_KINDS.filter((item) => notebook.notes.some((note) => note.kind === item.id))
  const shown = notebook.notes.filter((note) => kind === 'all' || note.kind === kind)
  const sections = sectionsOf(shown)
  const book = notebook.book
  return (
    <div className="notes-page">
      <TopBar onBack={onBack} title="Notes">
        <button className="notes-primary notes-small" onClick={onNew}>
          <Plus size={15} /> Note
        </button>
      </TopBar>
      <header className="notes-book-head">
        <h1>{notebook.title}</h1>
        {notebook.author ? <p>{notebook.author}</p> : null}
        {notebook.kind === 'noesis' && notebook.libraryBook ? (
          <a className="notes-chip notes-chip-link" href={`/?book=${encodeURIComponent(notebook.libraryBook.id)}`}>
            Open in Noesis <ExternalLink size={11} aria-hidden="true" />
          </a>
        ) : null}
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
          <button className="notes-primary" onClick={onNew}>
            <Plus size={16} /> New note
          </button>
        </section>
      )}
      {book ? (
        <button className="notes-link notes-danger" onClick={() => onRemoveBook(book)}>
          <Trash2 size={14} /> Remove this notebook (its notes stay)
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

// Notes for a book: one from the Noesis library (where covers, links and loans are kept), or any title typed in.
function BookPicker({
  library,
  onClose,
  onTitle,
  onPickNoesis,
}: {
  library: LibraryBook[]
  onClose: () => void
  onTitle: (title: string, author: string) => void
  onPickNoesis: (book: LibraryBook) => void
}) {
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('')
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  const words = query.trim().toLowerCase()
  const matches = library.filter((book) => !words || `${book.title} ${book.author}`.toLowerCase().includes(words))
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
        <label className="notes-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title"
            aria-label="Title"
          />
        </label>
        {query.trim() ? (
          <form
            className="notes-inline-form"
            onSubmit={(event) => {
              event.preventDefault()
              onTitle(query.trim(), author.trim())
            }}
          >
            <input
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              placeholder="Author (optional)"
              aria-label="Author"
            />
            <button className="notes-primary" type="submit">
              Start “{query.trim().slice(0, 40)}”
            </button>
          </form>
        ) : null}
        {matches.length ? (
          <section className="notes-section">
            <h2>In your Noesis library</h2>
            <div className="notes-list">
              {matches.slice(0, 30).map((book) => (
                <button key={book.id} className="notes-row" onClick={() => onPickNoesis(book)}>
                  <span className="notes-kind notes-kind-noesis" aria-hidden="true">
                    <BookOpen size={16} />
                  </span>
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
      </div>
    </div>
  )
}
