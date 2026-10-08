import { describe, expect, it } from 'vitest'
import { formatHours, readingStats, streaks } from './stats'

describe('streaks', () => {
  it('finds the longest and current run', () => {
    const result = streaks(
      ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-10', '2026-03-11'],
      new Date('2026-03-12T10:00:00'),
    )
    expect(result).toEqual({ longest: 3, current: 2 })
  })
  it('ends the current streak after a missed day', () => {
    expect(streaks(['2026-03-01'], new Date('2026-03-05T10:00:00')).current).toBe(0)
  })
})

describe('readingStats', () => {
  it('totals the year and picks the most-read book', () => {
    const diary = [
      { day: '2026-01-01', bookId: 'a', title: 'A', minutes: 30, from: 0, to: 10 },
      { day: '2026-01-02', bookId: 'b', title: 'B', minutes: 90, from: 0, to: 10 },
      { day: '2025-12-31', bookId: 'a', title: 'A', minutes: 500, from: 0, to: 10 },
    ]
    const stats = readingStats(
      diary,
      [],
      [{ finished: '2026-02-01T00:00:00Z' }, {}],
      2026,
      new Date('2026-01-02T09:00:00'),
    )
    expect(stats).toMatchObject({ minutes: 120, days: 2, booksFinished: 1, topBook: { title: 'B', minutes: 90 } })
    expect(stats.currentStreak).toBe(3)
  })
  it('formats time', () => {
    expect(formatHours(45)).toBe('45 min')
    expect(formatHours(90)).toBe('1.5 hours')
  })
})
