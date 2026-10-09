import { describe, expect, it } from 'vitest'
import { cleanChapterLabel } from './chapterLabel'

describe('cleanChapterLabel', () => {
  it('names empty or meaningless entries by position', () => {
    expect(cleanChapterLabel('', 4)).toBe('Section 5')
    expect(cleanChapterLabel('Untitled chapter', 0)).toBe('Section 1')
    expect(cleanChapterLabel('12', 11)).toBe('Section 12')
  })
  it('picks the chapter name out of a long caption', () => {
    expect(
      cleanChapterLabel(
        'I hope Mr. Bingley will like it. And a very long caption here to pass seventy characters in total. CHAPTER II.',
        2,
      ),
    ).toBe('Chapter II')
  })
  it('shortens other long labels and tidies spaces', () => {
    expect(cleanChapterLabel('  A   plain  title ', 0)).toBe('A plain title')
    expect(cleanChapterLabel('x'.repeat(90), 0).endsWith('…')).toBe(true)
  })
})
