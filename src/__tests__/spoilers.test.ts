import { describe, expect, it } from 'vitest'
import { readSoFar, recapExcerpt } from '../lib/spoilers'

describe('readSoFar', () => {
  const text = 'a'.repeat(100)
  it('returns only what has been read', () => {
    expect(readSoFar(text, 40)).toHaveLength(40)
  })
  it('returns nothing before the book is started', () => {
    expect(readSoFar(text, 0)).toBe('')
  })
  it('returns everything once the book is finished', () => {
    expect(readSoFar(text, 99.5)).toBe(text)
  })
})

describe('recapExcerpt', () => {
  it('keeps short text whole and trims long text to the start and the latest pages', () => {
    expect(recapExcerpt('short')).toBe('short')
    const long = `START${'x'.repeat(30_000)}END`
    const excerpt = recapExcerpt(long)
    expect(excerpt.startsWith('START')).toBe(true)
    expect(excerpt.endsWith('END')).toBe(true)
    expect(excerpt.length).toBeLessThan(12_000)
  })
})
