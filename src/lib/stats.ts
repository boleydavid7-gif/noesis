// Totals drawn from the reading diary and notes. Everything is computed on the device.

import type { DiaryEntry } from './diary'
import type { BrainNote } from './knowledge'
import type { LibraryBook } from './library'

export type ReadingStats = {
  year: number
  minutes: number
  days: number
  booksFinished: number
  notes: number
  topBook?: { title: string; minutes: number }
}

export function readingStats(
  diary: DiaryEntry[],
  notes: BrainNote[],
  books: Pick<LibraryBook, 'finished'>[],
  year: number,
): ReadingStats {
  const mine = diary.filter((entry) => entry.day.startsWith(`${year}-`))
  const perBook = new Map<string, { title: string; minutes: number }>()
  for (const entry of mine) {
    const found = perBook.get(entry.bookId) ?? { title: entry.title, minutes: 0 }
    found.minutes += entry.minutes
    perBook.set(entry.bookId, found)
  }
  const top = [...perBook.values()].sort((a, b) => b.minutes - a.minutes)[0]
  return {
    year,
    minutes: Math.round(mine.reduce((sum, entry) => sum + entry.minutes, 0)),
    days: new Set(mine.map((entry) => entry.day)).size,
    booksFinished: books.filter((book) => book.finished?.startsWith(`${year}`)).length,
    notes: notes.filter((note) => new Date(note.createdAt).getFullYear() === year).length,
    topBook: top && { title: top.title, minutes: Math.round(top.minutes) },
  }
}

export const formatHours = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} hours`
