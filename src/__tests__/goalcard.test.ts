import { describe, expect, it } from 'vitest'
import { goalProgress } from '../lib/goal'
import { wrapLines } from '../lib/quoteCard'

describe('goalProgress', () => {
  const now = new Date(2026, 9, 8)
  const books = [
    { finished: new Date(2026, 9, 2).toISOString() },
    { finished: new Date(2026, 3, 2).toISOString() },
    { finished: new Date(2025, 11, 30).toISOString() },
    {},
  ]
  it('counts books finished this year', () => {
    expect(goalProgress(books, { target: 4, period: 'year' }, now)).toEqual({ done: 2, target: 4, percent: 50 })
  })
  it('counts books finished this month', () => {
    expect(goalProgress(books, { target: 1, period: 'month' }, now)).toEqual({ done: 1, target: 1, percent: 100 })
  })
})

describe('wrapLines', () => {
  const measure = (text: string) => text.length * 10
  it('wraps words to the width', () => {
    expect(wrapLines(measure, 'one two three four five', 100)).toEqual(['one two', 'three four', 'five'])
  })
  it('keeps paragraph breaks', () => {
    expect(wrapLines(measure, 'alpha\nbeta', 500)).toEqual(['alpha', 'beta'])
  })
})
