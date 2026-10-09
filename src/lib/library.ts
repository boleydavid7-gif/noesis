import { markDeleted, markRestored } from './tombstones'
export type BookFormat = 'epub' | 'pdf' | 'resource' | 'web'

export type LibraryBook = {
  id: string
  title: string
  author: string
  progress: number
  chapter: string
  updated: string
  added?: string // when the book first joined the library
  finished?: string // when the reader first reached the end
  shelves?: string[] // the reader's own groupings
  series?: string
  seriesIndex?: number
  review?: { stars: number; line: string; reread: boolean; at: string }
  reviewAsked?: boolean // so the finish note is only offered once

  cover: string
  coverDataUrl?: string
  coverUrl?: string
  format: BookFormat
  sourceUrl?: string
  readerUrl?: string
  sourceName?: string
  description?: string
  accessType?: 'public' | 'borrow'
  fileName?: string
  fileSize?: number
  cfi?: string
  currentHref?: string
  chapterIndex?: number
  chapterProgress?: number
  bookmarked?: boolean
  look?: { fontSize?: number; theme?: 'paper' | 'sepia' | 'night' | 'contrast'; font?: string; lineHeight?: number } // this book's own page look
  favorite?: boolean
  cloudAt?: string // when this book was last confirmed in the account's cloud
  intent?: string // why the reader chose this book, in their own choice of words
  toc?: Array<{ label: string; href: string }>
}

const BOOKS_KEY = 'noesis:library:v2'
const DB_NAME = 'noesis-library'
const DB_VERSION = 3
const FILE_STORE = 'epub-files'
const TEXT_STORE = 'book-text'
const LIST_STORE = 'library-list'
const LIST_KEY = 'books'

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

function validBooks(value: unknown): LibraryBook[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is LibraryBook => {
    if (!item || typeof item !== 'object') return false
    const book = item as Record<string, unknown>
    return typeof book.id === 'string' && typeof book.title === 'string' && typeof book.author === 'string'
  })
}

// Once started, the list lives in memory and is saved to IndexedDB, which holds far more than the
// few megabytes browser storage allows. Before that (and where IndexedDB is missing) the old storage is used.
let cache: LibraryBook[] | null = null
let saving: Promise<void> = Promise.resolve()
const listeners = new Set<() => void>()
let channel: BroadcastChannel | null = null

/** Runs when another tab changes the library, after this tab has caught up. Returns a way to stop. */
export function onLibraryChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function readLibraryBooks(): LibraryBook[] {
  if (cache) return cache
  try {
    return validBooks(JSON.parse(storage()?.getItem(BOOKS_KEY) ?? '[]'))
  } catch {
    return []
  }
}

async function readSavedList(): Promise<unknown> {
  const db = await openDatabase()
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(LIST_STORE, 'readonly').objectStore(LIST_STORE).get(LIST_KEY)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Could not read the library.'))
    })
  } finally {
    db.close()
  }
}

async function saveList(books: LibraryBook[]): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(LIST_STORE, 'readwrite')
      transaction.objectStore(LIST_STORE).put(books, LIST_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the library.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not save the library.'))
    })
  } finally {
    db.close()
  }
}

function listenForOtherTabs() {
  if (channel || typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel('noesis-library')
  channel.onmessage = () => {
    void saving
      .then(readSavedList)
      .then((saved) => {
        if (saved === undefined) return
        cache = validBooks(saved)
        for (const listener of listeners) listener()
      })
      .catch(() => undefined)
  }
}

/**
 * Loads the library into memory. Call once before the app starts. The first time, the list kept by
 * older versions in browser storage is moved over, and removed only after it is safely saved.
 */
export async function startLibrary(): Promise<void> {
  if (cache) return
  try {
    listenForOtherTabs()
    const saved = await readSavedList()
    if (saved !== undefined) {
      cache = validBooks(saved)
      return
    }
    const old = readLibraryBooks()
    await saveList(old)
    cache = old
    try {
      storage()?.removeItem(BOOKS_KEY)
    } catch {
      // The copy in browser storage is harmless; it is no longer read.
    }
    void navigator.storage?.persist?.().catch(() => undefined)
  } catch {
    // No IndexedDB (a private window, an old browser): keep using browser storage as before.
    cache = null
  }
}

export function writeLibraryBooks(books: LibraryBook[]): void {
  if (cache) {
    cache = books
    saving = saving
      .then(() => saveList(books))
      .then(() => channel?.postMessage('changed'))
      .catch(() => undefined)
    return
  }
  writeToBrowserStorage(books)
}

/** Resolves when everything written so far has reached IndexedDB. */
export function libraryIdle(): Promise<void> {
  return saving
}

function writeToBrowserStorage(books: LibraryBook[]): void {
  const target = storage()
  if (!target) return
  try {
    target.setItem(BOOKS_KEY, JSON.stringify(books))
    return
  } catch (error) {
    // Browser storage is small. Rather than lose a book, let go of the biggest covers first (they can be regenerated).
    const withCovers = books
      .map((book, index) => ({ index, size: book.coverDataUrl?.length ?? 0 }))
      .filter((entry) => entry.size > 0)
      .sort((a, b) => b.size - a.size)
    const trimmed = books.map((book) => ({ ...book }))
    for (const entry of withCovers) {
      delete trimmed[entry.index].coverDataUrl
      try {
        target.setItem(BOOKS_KEY, JSON.stringify(trimmed))
        return
      } catch {
        // Keep trimming.
      }
    }
    throw error
  }
}

/** Reduces covers saved at full size by older versions, so the library keeps fitting in browser storage. */
export async function shrinkStoredCovers(): Promise<LibraryBook[] | null> {
  const books = readLibraryBooks()
  if (!books.some((book) => (book.coverDataUrl?.length ?? 0) > 40_000)) return null
  const { shrinkCover } = await import('./cover')
  const next: LibraryBook[] = []
  for (const book of books) next.push({ ...book, coverDataUrl: await shrinkCover(book.coverDataUrl) })
  // Re-read so a book added while this ran is not lost.
  const latest = new Map(readLibraryBooks().map((book) => [book.id, book]))
  const merged: LibraryBook[] = next.map((book) => {
    const { coverDataUrl, ...rest } = latest.get(book.id) ?? book
    return book.coverDataUrl
      ? { ...rest, coverDataUrl: book.coverDataUrl }
      : coverDataUrl
        ? { ...rest, coverDataUrl }
        : rest
  })
  for (const book of latest.values()) if (!merged.some((item) => item.id === book.id)) merged.unshift(book)
  writeLibraryBooks(merged)
  return merged
}

export function upsertLibraryBook(book: LibraryBook): LibraryBook[] {
  markRestored('book', book.id)
  const existing = readLibraryBooks()
  const previous = existing.find((item) => item.id === book.id)
  const books = existing.filter((item) => item.id !== book.id)
  const next = [{ ...book, added: book.added ?? previous?.added ?? new Date().toISOString() }, ...books]
  writeLibraryBooks(next)
  return next
}

export function removeLibraryBook(id: string): LibraryBook[] {
  markDeleted('book', id)
  const books = readLibraryBooks().filter((item) => item.id !== id)
  writeLibraryBooks(books)
  void deleteEpubFile(id)
  return books
}

const STORES = [FILE_STORE, TEXT_STORE, LIST_STORE]

function createStores(db: IDBDatabase) {
  for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
}

/**
 * Opens the library database at whatever version it is already at, and upgrades only when a store is missing.
 * That way a newer or older copy of the app (another tab, a cached page) never trips over a version number.
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not support local book storage.'))
      return
    }
    const release = (db: IDBDatabase) => {
      // Let another tab upgrade the database instead of blocking it.
      db.onversionchange = () => db.close()
      return db
    }
    const first = indexedDB.open(DB_NAME)
    first.onupgradeneeded = () => createStores(first.result)
    first.onerror = () => reject(first.error ?? new Error('Could not open local book storage.'))
    first.onsuccess = () => {
      const db = first.result
      if (STORES.every((name) => db.objectStoreNames.contains(name))) {
        resolve(release(db))
        return
      }
      const version = Math.max(db.version + 1, DB_VERSION)
      db.close()
      const upgrade = indexedDB.open(DB_NAME, version)
      upgrade.onupgradeneeded = () => createStores(upgrade.result)
      upgrade.onsuccess = () => resolve(release(upgrade.result))
      upgrade.onerror = () => reject(upgrade.error ?? new Error('Could not open local book storage.'))
    }
  })
}

export async function saveEpubFile(id: string, file: ArrayBuffer): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(FILE_STORE, 'readwrite')
    transaction.objectStore(FILE_STORE).put(file, id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the EPUB.'))
  })
  db.close()
}

export async function loadEpubFile(id: string): Promise<ArrayBuffer | null> {
  const db = await openDatabase()
  return new Promise<ArrayBuffer | null>((resolve, reject) => {
    const request = db.transaction(FILE_STORE, 'readonly').objectStore(FILE_STORE).get(id)
    request.onsuccess = () => {
      db.close()
      resolve((request.result as ArrayBuffer | undefined) ?? null)
    }
    request.onerror = () => {
      db.close()
      reject(request.error ?? new Error('Could not load the EPUB.'))
    }
  })
}

export async function deleteEpubFile(id: string): Promise<void> {
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve) => {
      const transaction = db.transaction([FILE_STORE, TEXT_STORE], 'readwrite')
      transaction.objectStore(FILE_STORE).delete(id)
      transaction.objectStore(TEXT_STORE).delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
    })
    db.close()
  } catch {
    // Metadata can still be removed when IndexedDB is unavailable.
  }
}

export async function saveBookText(id: string, value: string): Promise<void> {
  if (!value.trim()) return
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(TEXT_STORE, 'readwrite')
    transaction.objectStore(TEXT_STORE).put(value, id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the book text.'))
  })
  db.close()
}

export async function loadBookText(id: string): Promise<string | null> {
  const db = await openDatabase()
  return new Promise<string | null>((resolve, reject) => {
    const request = db.transaction(TEXT_STORE, 'readonly').objectStore(TEXT_STORE).get(id)
    request.onsuccess = () => {
      db.close()
      resolve(typeof request.result === 'string' ? request.result : null)
    }
    request.onerror = () => {
      db.close()
      reject(request.error ?? new Error('Could not load the book text.'))
    }
  })
}

// A book counts as started once it has been opened and moved on, even if the percentage still rounds to zero.
export const isStarted = (book: Pick<LibraryBook, 'progress' | 'chapterIndex' | 'cfi' | 'currentHref'>): boolean =>
  book.progress > 0 || (book.chapterIndex ?? 0) > 0 || Boolean(book.cfi) || Boolean(book.currentHref)

// "Want to read" is an ordinary shelf with a fixed name, so it works with everything shelves already do.
export const WANT_SHELF = 'Want to read'

export const INTENTS = [
  'Understand the core argument',
  'Prepare for a class',
  'Apply the ideas at work',
  'Explore a personal interest',
  'Read for enjoyment',
]
