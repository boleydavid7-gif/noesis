import { describe, expect, it } from 'vitest'
import { locateRange, wordAt } from './wordRange'

describe('locateRange', () => {
  it('finds a word across text pieces and collapsed spaces', () => {
    const parts = ['  Hello   big ', 'world today']
    // Flattened: "Hello big world today"
    const found = locateRange(parts, 10, 15)
    expect(found).toEqual({ start: { part: 1, offset: 0 }, end: { part: 1, offset: 5 } })
    const first = locateRange(parts, 0, 5)
    expect(first).toEqual({ start: { part: 0, offset: 2 }, end: { part: 0, offset: 7 } })
  })
  it('returns null past the end', () => {
    expect(locateRange(['abc'], 5, 8)).toBeNull()
  })
})

describe('wordAt', () => {
  it('runs to the next space', () => {
    expect(wordAt('read this aloud', 5)).toEqual({ start: 5, end: 9 })
    expect(wordAt('end', 3)).toEqual({ start: 3, end: 4 })
  })
})
