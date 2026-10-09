import { describe, expect, it } from 'vitest'
import { howFarThrough, lastReadPhrase, resumeLine } from './resume'

const now = Date.parse('2026-10-09T12:00:00Z')

describe('resume line', () => {
  it('describes progress in words', () => {
    expect(howFarThrough(1)).toBe('just beginning')
    expect(howFarThrough(50)).toBe('about halfway')
    expect(howFarThrough(97)).toBe('nearly finished')
  })
  it('says when without a guilt trip', () => {
    expect(lastReadPhrase('2026-10-09T08:00:00Z', now)).toBe('earlier today')
    expect(lastReadPhrase('2026-10-08T08:00:00Z', now)).toBe('yesterday')
    expect(lastReadPhrase('2026-10-04T08:00:00Z', now)).toBe('5 days ago')
    expect(lastReadPhrase('2026-06-01T08:00:00Z', now)).toBe('a while ago')
    expect(lastReadPhrase('nonsense', now)).toBe('')
  })
  it('joins the pieces', () => {
    expect(resumeLine({ progress: 45, chapter: 'Chapter 3', updated: '2026-10-08T08:00:00Z' }, now)).toBe(
      'Chapter 3, about halfway. Last read yesterday.',
    )
  })
})
