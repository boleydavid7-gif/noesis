// Reading pace: how long what's left will take, using the reader's own speed once it is known.

const KEY = 'noesis:pace:v1'
export const DEFAULT_WPM = 230
const MIN_WPM = 120
const MAX_WPM = 600

export type PaceRecord = { words: number; minutes: number }

export function readPace(): PaceRecord {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as PaceRecord | null
    if (parsed && Number.isFinite(parsed.words) && Number.isFinite(parsed.minutes)) return parsed
  } catch {
    // Fall through to an empty record.
  }
  return { words: 0, minutes: 0 }
}

export function writePace(record: PaceRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record))
  } catch {
    // Pace is a convenience.
  }
}

// Adds one stretch of reading. Stretches that look like skimming, or like the page being left open, are ignored.
export function addReading(record: PaceRecord, words: number, minutes: number): PaceRecord {
  if (!(words > 20) || !(minutes > 0.05)) return record
  const wpm = words / minutes
  if (wpm < MIN_WPM || wpm > MAX_WPM) return record
  // Keep a moving window so a changing pace is followed.
  const scale = record.minutes > 600 ? 0.5 : 1
  return { words: record.words * scale + words, minutes: record.minutes * scale + minutes }
}

export function wordsPerMinute(record: PaceRecord): number {
  if (record.minutes < 3) return DEFAULT_WPM
  return Math.max(MIN_WPM, Math.min(MAX_WPM, Math.round(record.words / record.minutes)))
}

export const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

export function formatDuration(minutes: number): string {
  const total = Math.max(1, Math.round(minutes))
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest === 0 || hours >= 10 ? `${hours} h` : `${hours} h ${rest} min`
}

// Time left in the chapter, and to the end of the book from the chapter lengths seen so far.
export function timeLeft(input: {
  chapterWords: number
  chapterProgress: number
  chapterIndex: number
  chapterCount: number
  averageChapterWords: number
  wpm: number
}): { chapter: number; book: number } {
  const chapter = (input.chapterWords * (1 - Math.max(0, Math.min(1, input.chapterProgress)))) / input.wpm
  const remainingChapters = Math.max(0, input.chapterCount - input.chapterIndex - 1)
  return { chapter, book: chapter + (remainingChapters * input.averageChapterWords) / input.wpm }
}
