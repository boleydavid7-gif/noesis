import { describe, expect, it } from 'vitest'
import {
  bookProgress,
  chapterFlags,
  chapterPlace,
  chapterStartIndex,
  nextChapterIndex,
  previousChapterIndex,
} from './chapterSteps'

// Like "Mistakes Were Made": chapters with their sections listed beneath them.
const nested = [
  { href: 'cover.xhtml', level: 0 },
  { href: 'ch1.xhtml', level: 0 },
  { href: 'ch1.xhtml#believing', level: 1 },
  { href: 'ch1.xhtml#ingrid', level: 1 },
  { href: 'ch2.xhtml', level: 0 },
  { href: 'ch2.xhtml#road', level: 1 },
  { href: 'ch3.xhtml', level: 0 },
]

describe('chapters and sections', () => {
  it('tells chapters from the sections inside them', () => {
    expect(chapterFlags(nested)).toEqual([true, true, false, false, true, false, true])
  })

  it('never steps into a section of a chapter already read', () => {
    expect(nextChapterIndex(nested, 1)).toBe(4)
    expect(nextChapterIndex(nested, 3)).toBe(4)
    expect(nextChapterIndex(nested, 6)).toBe(-1)
  })

  it('goes back to the start of the current chapter, then to the one before', () => {
    expect(previousChapterIndex(nested, 3)).toBe(1)
    expect(previousChapterIndex(nested, 1)).toBe(0)
    expect(previousChapterIndex(nested, 0)).toBe(-1)
  })

  it('finds where the current chapter begins', () => {
    expect(chapterStartIndex(nested, 3)).toBe(1)
    expect(chapterStartIndex(nested, 4)).toBe(4)
    expect(chapterStartIndex(nested, 5)).toBe(4)
  })

  it('counts chapters only, wherever the reader is inside one', () => {
    expect(chapterPlace(nested, 3)).toEqual({ ordinal: 2, total: 4 })
    expect(chapterPlace(nested, 6)).toEqual({ ordinal: 4, total: 4 })
    expect(bookProgress(nested, 4, 0.5)).toBe(Math.round((2.5 / 4) * 100))
  })

  it('keeps anchored chapters in a one-file book as chapters', () => {
    const single = [{ href: 'book.xhtml#one' }, { href: 'book.xhtml#two' }, { href: 'book.xhtml#three' }]
    expect(chapterFlags(single)).toEqual([true, true, true])
    expect(nextChapterIndex(single, 0)).toBe(1)
  })

  it('without nesting, repeats in a many-file book are sections', () => {
    const flat = [
      { href: 'a.xhtml' },
      { href: 'a.xhtml#s1' },
      { href: 'b.xhtml' },
      { href: 'b.xhtml#s1' },
      { href: 'c.xhtml' },
    ]
    expect(chapterFlags(flat)).toEqual([true, false, true, false, true])
  })
})
