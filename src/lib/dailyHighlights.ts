// Daily highlights: a few of the reader's own highlights each day, the way a commonplace book is read back. Each one
// comes back less often the more times it has been seen (a week, three weeks, six weeks, three months, then six),
// "More often" halves the wait, "Less often" doubles it and "Not again" leaves it out. The day's choice is kept, so it
// stays the same until tomorrow; a highlight counts as seen once it has been shown in the review. Kept as one small
// synced preference (accountLibrary.ts), so every device shows the same day and the same spacing.
import type { BrainNote } from './knowledge'
import { isBookmark } from './bookmarks'

export type Frequency = 'more' | 'less' | 'never'
export type HighlightState = { seen: number; last?: string; frequency?: Frequency }
export type DailyState = {
  items: Record<string, HighlightState>
  today?: { date: string; ids: string[]; done?: boolean }
}

export const DAILY_KEY = 'noesis:highlight-review:v1'
export const DAILY_COUNTS = [3, 5, 10] as const
const CHANGED = 'noesis-daily-highlights'
const WAITS = [0, 7, 21, 45, 90, 180]
const PER_BOOK = 2
const MIN_LENGTH = 15

export type DailyHighlight = { note: BrainNote; text: string; comment?: string }

/** What can come back: highlights, and notes written about a passage (the passage, with the note beneath). */
export function highlightPool(notes: BrainNote[]): DailyHighlight[] {
  const pool: DailyHighlight[] = []
  for (const note of notes) {
    if (isBookmark(note)) continue
    if (note.kind === 'highlight') {
      const text = note.body.trim()
      if (text.length >= MIN_LENGTH) pool.push({ note, text })
    } else if (note.quote && note.quote.trim().length >= MIN_LENGTH) {
      pool.push({ note, text: note.quote.trim(), comment: note.body.trim() || undefined })
    }
  }
  return pool
}

export const dayKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000)

/** Days to wait after a highlight was last seen. */
export function waitFor(state: HighlightState | undefined): number {
  if (!state || state.seen <= 0) return 0
  const base = WAITS[Math.min(state.seen, WAITS.length - 1)]
  return state.frequency === 'more' ? Math.max(3, Math.round(base / 2)) : state.frequency === 'less' ? base * 2 : base
}

// A steady number from 0 to 1 for a highlight on a day, so the order is the same all day and changes the next.
function jitter(id: string, date: string): number {
  let hash = 2166136261
  for (const char of `${id}|${date}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return ((hash >>> 0) % 10_000) / 10_000
}

/**
 * The highlights for a day: those whose wait is over, the longest overdue first (never seen counts as well overdue),
 * "More often" a little ahead, at most two from one book unless there are not enough others.
 */
export function chooseForDay(pool: DailyHighlight[], state: DailyState, date: string, count: number): string[] {
  const ready = pool
    .map((item) => {
      const own = state.items[item.note.id]
      if (own?.frequency === 'never') return null
      const wait = waitFor(own)
      const since = own?.last ? daysBetween(own.last, date) : Infinity
      if (since < wait) return null
      const overdue = !own?.seen ? 2 : Math.min(2, since / Math.max(1, wait))
      const score = overdue + (own?.frequency === 'more' ? 0.5 : 0) + jitter(item.note.id, date) * 0.6
      return { item, score }
    })
    .filter((entry): entry is { item: DailyHighlight; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score)
  const chosen: string[] = []
  const perBook = new Map<string, number>()
  const bookOf = (item: DailyHighlight) => item.note.bookId ?? item.note.bookTitle ?? item.note.source
  for (const { item } of ready) {
    if (chosen.length >= count) break
    const book = bookOf(item)
    if ((perBook.get(book) ?? 0) >= PER_BOOK) continue
    perBook.set(book, (perBook.get(book) ?? 0) + 1)
    chosen.push(item.note.id)
  }
  for (const { item } of ready) {
    if (chosen.length >= count) break
    if (!chosen.includes(item.note.id)) chosen.push(item.note.id)
  }
  return chosen
}

/** Today's highlights, choosing them once a day; the state is returned when it changed, so it can be kept. */
export function today(
  notes: BrainNote[],
  state: DailyState,
  count: number,
  date = dayKey(),
): { items: DailyHighlight[]; done: boolean; state: DailyState } {
  const pool = highlightPool(notes)
  const byId = new Map(pool.map((item) => [item.note.id, item]))
  let next = state
  if (state.today?.date !== date) {
    next = { ...state, today: { date, ids: chooseForDay(pool, state, date, count) } }
  }
  const items = (next.today?.ids ?? []).map((id) => byId.get(id)).filter((item): item is DailyHighlight => !!item)
  return { items, done: Boolean(next.today?.done), state: next }
}

/** Shown in the review: counts as seen today (once a day). */
export function markSeen(state: DailyState, id: string, date = dayKey()): DailyState {
  const own = state.items[id] ?? { seen: 0 }
  if (own.last === date) return state
  return { ...state, items: { ...state.items, [id]: { ...own, seen: own.seen + 1, last: date } } }
}

export function setFrequency(state: DailyState, id: string, frequency: Frequency | undefined): DailyState {
  const own = state.items[id] ?? { seen: 0 }
  const changed: HighlightState = { ...own, frequency }
  if (!frequency) delete changed.frequency
  return { ...state, items: { ...state.items, [id]: changed } }
}

export function markDone(state: DailyState, date = dayKey()): DailyState {
  return state.today?.date === date ? { ...state, today: { ...state.today, done: true } } : state
}

/** When a highlight is next due, in days from `date` (0 = it could come back now). */
export function nextIn(state: DailyState, id: string, date = dayKey()): number {
  const own = state.items[id]
  if (!own?.last) return 0
  return Math.max(0, waitFor(own) - daysBetween(own.last, date))
}

export function readDaily(storage: Storage | null = typeof window === 'undefined' ? null : localStorage): DailyState {
  try {
    const parsed = JSON.parse(storage?.getItem(DAILY_KEY) ?? 'null') as DailyState | null
    return parsed && typeof parsed.items === 'object' && parsed.items ? parsed : { items: {} }
  } catch {
    return { items: {} }
  }
}

export function writeDaily(state: DailyState, storage: Storage | null = typeof window === 'undefined' ? null : localStorage) {
  try {
    storage?.setItem(DAILY_KEY, JSON.stringify(state))
  } catch {
    // Storage full or blocked: this visit keeps it.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED))
}

export function onDailyChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const storage = (event: StorageEvent) => {
    if (event.key === DAILY_KEY) listener()
  }
  window.addEventListener(CHANGED, listener)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(CHANGED, listener)
    window.removeEventListener('storage', storage)
  }
}
