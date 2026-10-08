// Totals drawn from the reading diary and notes. Everything is computed on the device.

import type { DiaryEntry } from './diary'
import { dayKey } from './diary'
import type { BrainNote } from './knowledge'
import type { LibraryBook } from './library'

export type ReadingStats = {
  year: number
  minutes: number
  days: number
  longestStreak: number
  currentStreak: number
  booksFinished: number
  notes: number
  topBook?: { title: string; minutes: number }
}

const nextDay = (day: string) => {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + 1)
  return dayKey(date)
}

export function streaks(days: string[], today = new Date()): { longest: number; current: number } {
  const sorted = [...new Set(days)].sort()
  let longest = 0
  let run = 0
  let previous = ''
  for (const day of sorted) {
    run = previous && nextDay(previous) === day ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = day
  }
  // The current streak still counts if the last day read was yesterday.
  const todayKey = dayKey(today)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const last = sorted[sorted.length - 1]
  const live = last === todayKey || last === dayKey(yesterday)
  return { longest, current: live ? run : 0 }
}

export function readingStats(
  diary: DiaryEntry[],
  notes: BrainNote[],
  books: Pick<LibraryBook, 'finished'>[],
  year: number,
  today = new Date(),
): ReadingStats {
  const mine = diary.filter((entry) => entry.day.startsWith(`${year}-`))
  const perBook = new Map<string, { title: string; minutes: number }>()
  for (const entry of mine) {
    const found = perBook.get(entry.bookId) ?? { title: entry.title, minutes: 0 }
    found.minutes += entry.minutes
    perBook.set(entry.bookId, found)
  }
  const top = [...perBook.values()].sort((a, b) => b.minutes - a.minutes)[0]
  const run = streaks(
    diary.map((entry) => entry.day),
    today,
  )
  return {
    year,
    minutes: Math.round(mine.reduce((sum, entry) => sum + entry.minutes, 0)),
    days: new Set(mine.map((entry) => entry.day)).size,
    longestStreak: run.longest,
    currentStreak: run.current,
    booksFinished: books.filter((book) => book.finished?.startsWith(`${year}`)).length,
    notes: notes.filter((note) => new Date(note.createdAt).getFullYear() === year).length,
    topBook: top && { title: top.title, minutes: Math.round(top.minutes) },
  }
}

export const formatHours = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} hours`
