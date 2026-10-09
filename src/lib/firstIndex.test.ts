import { describe, expect, it } from 'vitest'
import { firstReadingIndex } from './epub'

const toc = (...labels: string[]) => labels.map((label) => ({ label }))

describe('firstReadingIndex', () => {
  it('skips the title and licence entries', () => {
    expect(firstReadingIndex(toc('PRIDE. and PREJUDICE', 'Chapter I.', 'Chapter II.'), 'Pride and Prejudice')).toBe(1)
    expect(firstReadingIndex(toc('Cover', 'Title Page', 'Copyright', 'Chapter 1'), 'Anything')).toBe(3)
  })
  it('stays at the start when the first entry is real', () => {
    expect(firstReadingIndex(toc('Prologue', 'Chapter 1'), 'Book')).toBe(0)
    expect(firstReadingIndex(toc('Cover'), 'Book')).toBe(0)
  })
})
