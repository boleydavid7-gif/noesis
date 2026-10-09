import { describe, expect, it } from 'vitest'
import { formatHours, readingStats } from './stats'

describe('readingStats', () => {
  it('totals the year and picks the most-read book', () => {
    const diary = [
      { day: '2026-01-01', bookId: 'a', title: 'A', minutes: 30, from: 0, to: 10 },
      { day: '2026-01-02', bookId: 'b', title: 'B', minutes: 90, from: 0, to: 10 },
      { day: '2025-12-31', bookId: 'a', title: 'A', minutes: 500, from: 0, to: 10 },
    ]
    const stats = readingStats(diary, [], [{ finished: '2026-02-01T00:00:00Z' }, {}], 2026)
    expect(stats).toMatchObject({ minutes: 120, days: 2, booksFinished: 1, topBook: { title: 'B', minutes: 90 } })
  })
  it('formats time', () => {
    expect(formatHours(45)).toBe('45 min')
    expect(formatHours(90)).toBe('1.5 hours')
  })
})
