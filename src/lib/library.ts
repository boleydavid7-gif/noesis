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
  intent?: string // why the reader chose this book, in their own choice of words
  toc?: Array<{ label: string; href: string }>
}

const BOOKS_KEY = 'noesis:library:v2'
const DB_NAME = 'noesis-library'
const DB_VERSION = 2
const FILE_STORE = 'epub-files'
const TEXT_STORE = 'book-text'

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

export function readLibraryBooks(): LibraryBook[] {
  try {
    const value = JSON.parse(storage()?.getItem(BOOKS_KEY) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is LibraryBook => {
      if (!item || typeof item !== 'object') return false
      const book = item as Record<string, unknown>
      return typeof book.id === 'string' && typeof book.title === 'string' && typeof book.author === 'string'
    })
  } catch {
    return []
  }
}

export function writeLibraryBooks(books: LibraryBook[]): void {
  storage()?.setItem(BOOKS_KEY, JSON.stringify(books))
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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not support local book storage.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(FILE_STORE)) request.result.createObjectStore(FILE_STORE)
      if (!request.result.objectStoreNames.contains(TEXT_STORE)) request.result.createObjectStore(TEXT_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local book storage.'))
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
