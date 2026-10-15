// Noesis Notes: notebooks over the same notes as Noesis's Second Brain. A notebook is a book (one kept outside
// Noesis, paper or digital, or one in the Noesis library), a named folder, or the inbox. Nothing here stores notes
// of its own; it only groups the shared ones. Books kept outside Noesis are a small synced preference.
import type { BrainNote, BrainNoteKind } from './knowledge'
import type { LibraryBook } from './library'

export type BookFormat = 'paper' | 'ebook' | 'library' | 'audio'
export const BOOK_FORMATS: Array<{ id: BookFormat; label: string }> = [
  { id: 'paper', label: 'Paper' },
  { id: 'ebook', label: 'E-book' },
  { id: 'library', label: 'Library loan' },
  { id: 'audio', label: 'Audiobook' },
]

export type NotesBook = {
  id: string // "outside-…", also the bookId its notes carry
  title: string
  author: string
  coverUrl?: string
  format: BookFormat
  isbn?: string
  year?: number
  link?: string // where the book is read or borrowed, when it can't be read in Noesis
  page?: number // where the reader is
  pages?: number
  added: string
  updated?: string
}

export const NOTES_BOOKS_KEY = 'noesis:notes-books:v1'

export function readNotesBooks(storage: Storage | null = typeof window === 'undefined' ? null : localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(NOTES_BOOKS_KEY) ?? '[]') as unknown
    return (Array.isArray(parsed) ? parsed : []).filter(
      (item): item is NotesBook =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.added === 'string',
    )
  } catch {
    return []
  }
}

export function writeNotesBooks(books: NotesBook[], storage: Storage | null = localStorage) {
  try {
    storage?.setItem(NOTES_BOOKS_KEY, JSON.stringify(books))
  } catch {
    // Full or blocked storage: the change lasts for this visit.
  }
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 12)
    : Math.random().toString(36).slice(2, 14)

export function newNotesBook(input: Omit<NotesBook, 'id' | 'added'>, now = new Date()): NotesBook {
  return {
    ...input,
    title: input.title.trim().slice(0, 200),
    author: input.author.trim().slice(0, 120),
    id: `outside-${uid()}`,
    added: now.toISOString(),
  }
}

export type NotebookKind = 'book' | 'noesis' | 'folder' | 'inbox'
export type Notebook = {
  key: string
  kind: NotebookKind
  title: string
  author?: string
  coverUrl?: string
  book?: NotesBook
  libraryBook?: LibraryBook
  notes: BrainNote[]
  updated: string // the latest note, or when the book was added
}

const noteTime = (note: BrainNote) => note.updated ?? note.createdAt
const latest = (notes: BrainNote[], fallback = '') => notes.map(noteTime).sort().at(-1) ?? fallback
const titleKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// Every note lands in exactly one notebook: its outside book, its Noesis book, a book named only by title,
// its named folder, or the inbox. Newest activity first; outside books show even before they have notes.
export function notebooksFrom(notes: BrainNote[], outside: NotesBook[], library: LibraryBook[]): Notebook[] {
  const result = new Map<string, Notebook>()
  for (const book of outside) {
    result.set(book.id, {
      key: book.id,
      kind: 'book',
      title: book.title,
      author: book.author,
      coverUrl: book.coverUrl,
      book,
      notes: [],
      updated: book.updated ?? book.added,
    })
  }
  const libraryById = new Map(library.map((book) => [book.id, book]))
  for (const note of notes) {
    let key = ''
    if (note.bookId && result.has(note.bookId)) key = note.bookId
    else if (note.bookId && libraryById.has(note.bookId)) {
      key = `noesis-${note.bookId}`
      if (!result.has(key)) {
        const book = libraryById.get(note.bookId)!
        result.set(key, {
          key,
          kind: 'noesis',
          title: book.title,
          author: book.author,
          coverUrl: book.coverDataUrl || book.coverUrl,
          libraryBook: book,
          notes: [],
          updated: '',
        })
      }
    } else if (note.bookTitle?.trim()) {
      key = `title-${titleKey(note.bookTitle)}`
      if (!result.has(key))
        result.set(key, {
          key,
          kind: 'book',
          title: note.bookTitle.trim(),
          author: note.author,
          notes: [],
          updated: '',
        })
    } else if (note.notebook?.trim()) {
      key = `folder-${titleKey(note.notebook)}`
      if (!result.has(key))
        result.set(key, { key, kind: 'folder', title: note.notebook.trim(), notes: [], updated: '' })
    } else {
      key = 'inbox'
      if (!result.has(key)) result.set(key, { key, kind: 'inbox', title: 'Inbox', notes: [], updated: '' })
    }
    result.get(key)!.notes.push(note)
  }
  return [...result.values()]
    .map((notebook) => ({
      ...notebook,
      notes: [...notebook.notes].sort(byPlace),
      updated: latest(notebook.notes, notebook.updated),
    }))
    .sort((a, b) => b.updated.localeCompare(a.updated))
}

// Inside a book: by page where there is one, then by when written.
export function byPlace(a: BrainNote, b: BrainNote): number {
  const pa = a.page ?? Number.POSITIVE_INFINITY
  const pb = b.page ?? Number.POSITIVE_INFINITY
  return pa !== pb ? pa - pb : a.createdAt.localeCompare(b.createdAt)
}

// Sections are chapters, in reading order (by their first page, else when first written).
export function sectionsOf(notes: BrainNote[]): Array<{ title: string; notes: BrainNote[] }> {
  const groups = new Map<string, BrainNote[]>()
  for (const note of [...notes].sort(byPlace)) {
    const title = note.chapter?.trim() || ''
    groups.set(title, [...(groups.get(title) ?? []), note])
  }
  return [...groups.entries()]
    .map(([title, list]) => ({ title, notes: list }))
    .sort((a, b) => {
      if (!a.title) return 1
      if (!b.title) return -1
      return byPlace(a.notes[0], b.notes[0])
    })
}

// Every word must appear somewhere in the note (accents and case ignored); newest first.
export function searchNotes(notes: BrainNote[], query: string): BrainNote[] {
  const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return notes
    .filter((note) => {
      const text = fold(
        [
          note.title,
          note.body,
          note.quote,
          note.bookTitle,
          note.author,
          note.chapter,
          note.notebook,
          ...(note.tags ?? []),
        ]
          .filter(Boolean)
          .join(' '),
      )
      return words.every((word) => text.includes(word))
    })
    .sort((a, b) => noteTime(b).localeCompare(noteTime(a)))
}

export const NOTE_KINDS: Array<{ id: BrainNoteKind; label: string }> = [
  { id: 'note', label: 'Note' },
  { id: 'highlight', label: 'Quote' },
  { id: 'question', label: 'Question' },
  { id: 'idea', label: 'Idea' },
]

// A new note in a notebook carries what ties it there, so Noesis's Second Brain shows the same book or folder.
export function noteFor(
  notebook: Pick<Notebook, 'kind' | 'title' | 'author' | 'book' | 'libraryBook'> | null,
  fields: Partial<BrainNote>,
  now = new Date(),
): BrainNote {
  const stamp = now.toISOString()
  const where: Partial<BrainNote> =
    notebook?.kind === 'book'
      ? { bookId: notebook.book?.id, bookTitle: notebook.title, author: notebook.author }
      : notebook?.kind === 'noesis'
        ? { bookId: notebook.libraryBook?.id, bookTitle: notebook.title, author: notebook.author }
        : notebook?.kind === 'folder'
          ? { notebook: notebook.title }
          : {}
  return {
    id: `local-${uid()}`,
    kind: 'note',
    title: '',
    body: '',
    source: 'Noesis Notes',
    createdAt: stamp,
    updated: stamp,
    ...where,
    ...fields,
  }
}

// The words a row shows: the title, else the quote or the start of the note.
export function noteHeadline(note: BrainNote): string {
  const text = note.title?.trim() || note.quote?.trim() || note.body.trim()
  return text.split('\n')[0].slice(0, 120) || 'Untitled'
}

// A link is kept only when it is a web address; "kindle.amazon.com/…" gets its https:// added.
export function cleanLink(value: string): string | undefined {
  const raw = value.trim()
  if (!raw) return undefined
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function linkLabel(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return 'the link'
  }
}
