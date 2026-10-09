// Bookmarks are saved places in a book. They live beside notes, marked with a tag, so they sync and export with them.

import type { BrainNote } from './knowledge'

export const BOOKMARK_TAG = 'bookmark'

export const isBookmark = (note: Pick<BrainNote, 'tags'>) => (note.tags ?? []).includes(BOOKMARK_TAG)

// Notes in the order they appear in the book; undated places go last.
export function inBookOrder<T extends Pick<BrainNote, 'chapterIndex' | 'page' | 'createdAt'>>(notes: T[]): T[] {
  return [...notes].sort(
    (a, b) =>
      (a.chapterIndex ?? 1e9) - (b.chapterIndex ?? 1e9) ||
      (a.page ?? 1e9) - (b.page ?? 1e9) ||
      a.createdAt.localeCompare(b.createdAt),
  )
}

// "Quote" — Author, Title, Chapter, p. 12
export function citation(
  note: Pick<BrainNote, 'body' | 'quote' | 'chapter' | 'page'>,
  book: { title: string; author?: string },
): string {
  const text = (note.quote || note.body).replace(/\s+/g, ' ').trim()
  const where = [book.author, book.title, note.chapter, note.page ? `p. ${note.page}` : ''].filter(Boolean).join(', ')
  return `“${text}” — ${where}`
}

export function sameSpot(
  note: Pick<BrainNote, 'cfi' | 'href' | 'page'>,
  here: { cfi?: string; href?: string; page?: number },
): boolean {
  if (note.cfi && here.cfi) return note.cfi === here.cfi
  return Boolean(note.href && here.href && note.href === here.href && note.page && note.page === here.page)
}
