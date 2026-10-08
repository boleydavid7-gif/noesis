// A quiet record of when and what was read, kept on the device.

import type { BrainNote } from './knowledge'

const KEY = 'noesis:diary:v1'
export type DiaryEntry = { day: string; bookId: string; title: string; minutes: number; from: number; to: number }

export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function readDiary(): DiaryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is DiaryEntry => typeof item?.day === 'string' && typeof item?.bookId === 'string')
      : []
  } catch {
    return []
  }
}

export function writeDiary(entries: DiaryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-2000)))
  } catch {
    // The diary is a convenience.
  }
}

// Adds time and progress to today's line for a book.
export function logReading(
  entries: DiaryEntry[],
  input: { bookId: string; title: string; minutes: number; from: number; to: number },
  now = new Date(),
): DiaryEntry[] {
  const day = dayKey(now)
  const found = entries.findIndex((entry) => entry.day === day && entry.bookId === input.bookId)
  if (found < 0) return [...entries, { day, ...input, minutes: Math.round(input.minutes * 10) / 10 }]
  const next = [...entries]
  const entry = next[found]
  next[found] = {
    ...entry,
    title: input.title,
    minutes: Math.round((entry.minutes + input.minutes) * 10) / 10,
    from: Math.min(entry.from, input.from),
    to: Math.max(entry.to, input.to),
  }
  return next
}

export type DiaryDay = { day: string; reading: DiaryEntry[]; notes: BrainNote[] }

// Days with reading or notes, newest first.
export function diaryDays(entries: DiaryEntry[], notes: BrainNote[]): DiaryDay[] {
  const days = new Map<string, DiaryDay>()
  const get = (day: string) => {
    if (!days.has(day)) days.set(day, { day, reading: [], notes: [] })
    return days.get(day) as DiaryDay
  }
  for (const entry of entries) get(entry.day).reading.push(entry)
  for (const note of notes) {
    const date = new Date(note.createdAt)
    if (!Number.isNaN(date.valueOf())) get(dayKey(date)).notes.push(note)
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day))
}
