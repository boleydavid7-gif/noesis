// How notes relate: [[links]] between them, tags, notebooks, notes to see again, and saved searches.

import type { BrainNote } from './knowledge'
import { isBookmark } from './bookmarks'

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()

export function linkTitles(body: string): string[] {
  return [...new Set([...body.matchAll(/\[\[([^\]\n]{1,120})\]\]/g)].map((match) => match[1].trim()).filter(Boolean))]
}

export const resolveLink = <T extends Pick<BrainNote, 'title' | 'id'>>(title: string, notes: T[]): T | undefined =>
  notes.find((note) => norm(note.title) === norm(title))

// Notes that point at this one.
export function backlinks<T extends Pick<BrainNote, 'title' | 'id' | 'body'>>(
  note: Pick<BrainNote, 'title' | 'id'>,
  notes: T[],
): T[] {
  const mine = norm(note.title)
  if (!mine) return []
  return notes.filter((other) => other.id !== note.id && linkTitles(other.body).some((title) => norm(title) === mine))
}

export function countBy(values: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export const tagCounts = (notes: BrainNote[]) =>
  countBy(notes.flatMap((note) => (note.tags ?? []).filter((tag) => tag !== 'word' && tag !== 'bookmark')))

export const notebookCounts = (notes: BrainNote[]) =>
  countBy(notes.flatMap((note) => (note.notebook ? [note.notebook] : [])))

// Joins two notes into one. The kept note takes the other's text, tags and place if it had none.
export function mergeNotes(keep: BrainNote, other: BrainNote): BrainNote {
  const tags = [...new Set([...(keep.tags ?? []), ...(other.tags ?? [])])]
  return {
    ...keep,
    body: [keep.body.trim(), other.body.trim()].filter(Boolean).join('\n\n'),
    tags: tags.length ? tags : undefined,
    quote: keep.quote ?? other.quote,
    notebook: keep.notebook ?? other.notebook,
    updated: new Date().toISOString(),
    synced: undefined,
  }
}

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export const REVISIT_CHOICES: Array<{ id: string; label: string; days: number }> = [
  { id: '1', label: 'Tomorrow', days: 1 },
  { id: '7', label: 'In a week', days: 7 },
  { id: '30', label: 'In a month', days: 30 },
]

export function revisitDate(days: number, from = new Date()): string {
  const date = new Date(from)
  date.setDate(date.getDate() + days)
  return dayKey(date)
}

// Notes whose day has come, oldest request first. Nothing here is graded.
export function dueNotes(notes: BrainNote[], today = new Date()): BrainNote[] {
  const now = dayKey(today)
  return notes
    .filter((note) => note.revisit && note.revisit <= now && !isBookmark(note))
    .sort((a, b) => (a.revisit ?? '').localeCompare(b.revisit ?? ''))
}

const SEARCHES = 'noesis:saved-searches:v1'
export function readSavedSearches(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEARCHES) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 12) : []
  } catch {
    return []
  }
}
export function writeSavedSearches(list: string[]): void {
  try {
    localStorage.setItem(SEARCHES, JSON.stringify(list.slice(0, 12)))
  } catch {
    // Saved searches are a convenience.
  }
}
