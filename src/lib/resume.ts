// A plain sentence about where the reader left off, with no pressure in it.

import type { LibraryBook } from './library'

export function howFarThrough(progress: number): string {
  if (progress < 3) return 'just beginning'
  if (progress < 20) return 'early on'
  if (progress < 40) return 'about a third through'
  if (progress < 60) return 'about halfway'
  if (progress < 80) return 'about two-thirds through'
  if (progress < 95) return 'near the end'
  return 'nearly finished'
}

export function lastReadPhrase(updated: string, now = Date.now()): string {
  const time = Date.parse(updated)
  if (!Number.isFinite(time)) return ''
  const days = Math.floor((now - time) / 86_400_000)
  if (days <= 0) return 'earlier today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return 'a while ago'
}

export function resumeLine(book: Pick<LibraryBook, 'progress' | 'chapter' | 'updated'>, now = Date.now()): string {
  const chapter = book.chapter && book.chapter !== 'Ready to read' ? book.chapter : ''
  const where = [chapter, howFarThrough(book.progress)].filter(Boolean).join(', ')
  const when = lastReadPhrase(book.updated, now)
  return when ? `${where}. Last read ${when}.` : `${where}.`
}
