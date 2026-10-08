import { describe, expect, it } from 'vitest'
import { relevantExcerpt } from '../lib/text'

describe('relevantExcerpt', () => {
  it('returns short text untouched', () => {
    expect(relevantExcerpt('short book', 'anything', 100)).toBe('short book')
  })

  it('centres the excerpt near the first matching question term', () => {
    const text = `${'filler '.repeat(500)}photosynthesis happens here${' filler'.repeat(500)}`
    const excerpt = relevantExcerpt(text, 'Explain photosynthesis', 400)
    expect(excerpt).toContain('photosynthesis')
    expect(excerpt.length).toBeLessThanOrEqual(402)
    expect(excerpt.startsWith('…')).toBe(true)
  })

  it('starts at the beginning when no term matches', () => {
    const excerpt = relevantExcerpt('abcdefghij'.repeat(100), 'zzzz', 200)
    expect(excerpt.startsWith('…')).toBe(false)
    expect(excerpt.endsWith('…')).toBe(true)
  })
})
