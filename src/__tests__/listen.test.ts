import { describe, expect, it } from 'vitest'
import { splitSpeech } from '../lib/listen'

describe('splitSpeech', () => {
  it('keeps short text as one piece', () => {
    expect(splitSpeech('One sentence. Another one.')).toEqual(['One sentence. Another one.'])
  })

  it('splits at sentence ends and keeps every word', () => {
    const text = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i} of the passage.`).join(' ')
    const pieces = splitSpeech(text, 100)
    expect(pieces.length).toBeGreaterThan(3)
    expect(pieces.every((piece) => piece.length <= 100)).toBe(true)
    expect(pieces.join(' ')).toBe(text)
  })

  it('cuts a very long sentence at spaces', () => {
    const long = Array.from({ length: 80 }, () => 'word').join(' ')
    const pieces = splitSpeech(long, 60)
    expect(pieces.every((piece) => piece.length <= 60)).toBe(true)
    expect(pieces.join(' ')).toBe(long)
  })

  it('returns nothing for blank text', () => {
    expect(splitSpeech('   ')).toEqual([])
  })
})
