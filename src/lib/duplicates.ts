// Two records of one book: the same file (name, case aside, and size) added on two devices, or brought in from the
// library folder on each before they synced, so each has its own id. They are folded into one. Every device picks
// the same one to keep (the earliest added, then the smallest id), so folding on two devices at once agrees.
import type { LibraryBook } from './library'

const fileKey = (book: LibraryBook) =>
  (book.format === 'epub' || book.format === 'pdf') && book.fileName && book.fileSize
    ? `${book.format}\n${book.fileName.toLowerCase()}\n${book.fileSize}`
    : ''

const addedAt = (book: LibraryBook) => book.added || book.updated || ''

function keeperFirst(a: LibraryBook, b: LibraryBook): number {
  const byAdded = addedAt(a).localeCompare(addedAt(b))
  return byAdded || a.id.localeCompare(b.id)
}

// One record from the copies: the keeper's id and first-added date, the reading place from the copy read furthest
// (the most recently read when equal), and anything set on any copy (shelves, favorite, finished, review, cover).
export function foldCopies(copies: LibraryBook[]): LibraryBook {
  const [keep, ...rest] = [...copies].sort(keeperFirst)
  const place = [...copies].sort(
    (a, b) => b.progress - a.progress || (b.updated || '').localeCompare(a.updated || ''),
  )[0]
  const latest = [...copies].sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))[0]
  const firstSet = <K extends keyof LibraryBook>(key: K) =>
    [keep, ...rest].map((book) => book[key]).find((value) => value !== undefined && value !== '')
  const finished = copies
    .map((book) => book.finished)
    .filter(Boolean)
    .sort()[0]
  const shelves = [...new Set(copies.flatMap((book) => book.shelves ?? []))]
  return {
    ...latest,
    id: keep.id,
    added: keep.added ?? firstSet('added'),
    progress: place.progress,
    chapter: place.chapter,
    cfi: place.cfi,
    currentHref: place.currentHref,
    chapterIndex: place.chapterIndex,
    chapterProgress: place.chapterProgress,
    updated: latest.updated,
    shelves: shelves.length ? shelves : undefined,
    favorite: copies.some((book) => book.favorite) || undefined,
    bookmarked: copies.some((book) => book.bookmarked) || undefined,
    finished,
    review: firstSet('review'),
    series: firstSet('series'),
    seriesIndex: firstSet('seriesIndex'),
    intent: firstSet('intent'),
    look: firstSet('look'),
    coverDataUrl: firstSet('coverDataUrl'),
    coverUrl: firstSet('coverUrl'),
    description: firstSet('description'),
    toc: firstSet('toc'),
    fromFolder: firstSet('fromFolder'),
    foundIn: firstSet('foundIn'),
    cloudAt: firstSet('cloudAt'),
  }
}

/** The library with each book's copies folded into one, and which ids went into which. */
export function foldDuplicates(books: LibraryBook[]): { books: LibraryBook[]; moved: Record<string, string> } {
  const groups = new Map<string, LibraryBook[]>()
  for (const book of books) {
    const key = fileKey(book)
    if (key) groups.set(key, [...(groups.get(key) ?? []), book])
  }
  const moved: Record<string, string> = {}
  const folded = new Map<string, LibraryBook>()
  for (const copies of groups.values()) {
    if (copies.length < 2) continue
    const one = foldCopies(copies)
    folded.set(one.id, one)
    for (const copy of copies) if (copy.id !== one.id) moved[copy.id] = one.id
  }
  if (!Object.keys(moved).length) return { books, moved }
  return {
    books: books.filter((book) => !moved[book.id]).map((book) => folded.get(book.id) ?? book),
    moved,
  }
}
