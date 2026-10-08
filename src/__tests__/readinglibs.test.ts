import { describe, expect, it } from 'vitest'
import { addReading, countWords, DEFAULT_WPM, formatDuration, timeLeft, wordsPerMinute } from '../lib/pace'
import { relatedNotes } from '../lib/related'
import { excerpt, searchLibrary, searchPhrase } from '../lib/librarySearch'

describe('pace', () => {
  it('uses the default until there is enough reading to learn from', () => {
    expect(wordsPerMinute({ words: 100, minutes: 1 })).toBe(DEFAULT_WPM)
    expect(wordsPerMinute({ words: 1500, minutes: 5 })).toBe(300)
  })
  it('ignores skimming and a page left open', () => {
    const start = { words: 0, minutes: 0 }
    expect(addReading(start, 3000, 2)).toEqual(start)
    expect(addReading(start, 300, 20)).toEqual(start)
    expect(addReading(start, 460, 2)).toEqual({ words: 460, minutes: 2 })
  })
  it('works out time left in the chapter and the book', () => {
    const left = timeLeft({
      chapterWords: 2300,
      chapterProgress: 0.5,
      chapterIndex: 1,
      chapterCount: 5,
      averageChapterWords: 2300,
      wpm: 230,
    })
    expect(Math.round(left.chapter)).toBe(5)
    expect(Math.round(left.book)).toBe(35)
  })
  it('formats durations', () => {
    expect(formatDuration(0.2)).toBe('1 min')
    expect(formatDuration(75)).toBe('1 h 15 min')
    expect(countWords('one two  three')).toBe(3)
  })
})

describe('relatedNotes', () => {
  const notes = [
    { id: 'a', title: 'Compounding', body: 'Small habits compound over time like interest on savings.' },
    { id: 'b', title: 'Money', body: 'Interest compounds on savings, so start saving early.' },
    { id: 'c', title: 'Cooking', body: 'Salt the pasta water generously before boiling.' },
  ]
  it('finds notes about the same ideas and skips unrelated ones', () => {
    const found = relatedNotes(notes[0], notes)
    expect(found.map((item) => item.note.id)).toEqual(['b'])
    expect(found[0].shared.length).toBeGreaterThanOrEqual(2)
  })
})

describe('library search', () => {
  const books = [
    { id: '1', title: 'Habits', author: 'A' },
    { id: '2', title: 'Cooking', author: 'B' },
  ]
  const texts: Record<string, string> = {
    '1': 'Habits compound like interest. Small changes repeated daily become remarkable results over the years.',
    '2': 'Boil the pasta in salted water. Drain it and add the sauce.',
  }
  it('returns passages from the books that mention the question', async () => {
    const hits = await searchLibrary(books, 'how do habits compound', async (id) => texts[id] ?? null)
    expect(hits.map((hit) => hit.bookId)).toEqual(['1'])
    expect(searchPhrase(hits[0].text, 'habits compound').split(' ').length).toBeLessThanOrEqual(6)
    expect(excerpt('x'.repeat(500) + ' compound ' + 'y'.repeat(500), 'compound').startsWith('…')).toBe(true)
  })
})

import { diaryDays, logReading } from '../lib/diary'
import { noteToMarkdown, slug } from '../lib/exportNotes'

describe('diary', () => {
  it('adds up a day of reading and lists notes on the same day', () => {
    const now = new Date(2026, 9, 8, 10)
    let entries = logReading([], { bookId: 'a', title: 'A', minutes: 10, from: 10, to: 14 }, now)
    entries = logReading(entries, { bookId: 'a', title: 'A', minutes: 5, from: 14, to: 17 }, now)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ minutes: 15, from: 10, to: 17 })
    const note = {
      id: 'n',
      kind: 'note' as const,
      title: 'T',
      body: 'b',
      source: 's',
      createdAt: new Date(2026, 9, 8, 12).toISOString(),
    }
    const days = diaryDays(entries, [note])
    expect(days).toHaveLength(1)
    expect(days[0].notes).toHaveLength(1)
  })
})

describe('markdown export', () => {
  it('makes a readable file with a passage quote and tags', () => {
    const md = noteToMarkdown({
      id: '1',
      kind: 'highlight',
      title: 'Compounding "small" wins',
      body: 'My thought.',
      source: 'Atomic Habits',
      createdAt: '2026-10-01T00:00:00Z',
      tags: ['Habits', 'big ideas'],
      quote: 'Habits are the compound interest of self-improvement.',
    })
    expect(md).toContain('title: "Compounding \\"small\\" wins"')
    expect(md).toContain('tags: [habits, big-ideas]')
    expect(md).toContain('> Habits are the compound interest')
    expect(md.trim().endsWith('My thought.')).toBe(true)
  })
  it('makes safe file names', () => {
    expect(slug('Why? / Because: Ünïcode!')).toBe('why-because-unicode')
    expect(slug('???')).toBe('note')
  })
})

import { duplicateGroups } from '../lib/libraryTools'
import type { LibraryBook } from '../lib/library'

describe('duplicateGroups', () => {
  const book = (id: string, title: string, author: string, fileSize?: number): LibraryBook => ({
    id,
    title,
    author,
    progress: 0,
    chapter: '',
    updated: `2026-01-0${id}T00:00:00Z`,
    cover: title,
    format: 'epub',
    fileSize,
  })
  it('groups the same book added twice, even with different capitalisation or "The"', () => {
    const groups = duplicateGroups([
      book('1', 'The Hobbit', 'J. R. R. Tolkien'),
      book('2', 'Hobbit', 'j r r tolkien'),
      book('3', 'Dune', 'Frank Herbert'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].map((item) => item.id)).toEqual(['1', '2'])
  })
  it('groups by title and file size when the author is missing', () => {
    expect(
      duplicateGroups([book('1', 'Notes', 'Imported PDF', 500), book('2', 'Notes', 'Imported PDF', 500)]),
    ).toHaveLength(1)
  })
  it('leaves different books alone', () => {
    expect(duplicateGroups([book('1', 'A', 'x', 1), book('2', 'B', 'x', 1)])).toEqual([])
  })
})
