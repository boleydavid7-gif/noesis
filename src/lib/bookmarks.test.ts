import { describe, expect, it } from 'vitest'
import { citation, inBookOrder, isBookmark, sameSpot } from './bookmarks'

describe('bookmarks', () => {
  it('recognises the tag', () => {
    expect(isBookmark({ tags: ['bookmark'] })).toBe(true)
    expect(isBookmark({ tags: ['word'] })).toBe(false)
    expect(isBookmark({})).toBe(false)
  })
  it('orders by place in the book', () => {
    const list = inBookOrder([
      { chapterIndex: 3, page: 1, createdAt: 'b' },
      { chapterIndex: 1, page: 9, createdAt: 'c' },
      { chapterIndex: 1, page: 2, createdAt: 'a' },
      { createdAt: 'z' },
    ])
    expect(list.map((item) => item.createdAt)).toEqual(['a', 'c', 'b', 'z'])
  })
  it('builds a citation', () => {
    expect(citation({ body: 'x', quote: 'A  line', chapter: 'Ch 2', page: 4 }, { title: 'Book', author: 'Ann' })).toBe(
      '“A line” — Ann, Book, Ch 2, p. 4',
    )
  })
  it('compares places', () => {
    expect(sameSpot({ cfi: 'a' }, { cfi: 'a' })).toBe(true)
    expect(sameSpot({ cfi: 'a' }, { cfi: 'b' })).toBe(false)
    expect(sameSpot({ href: 'h', page: 2 }, { href: 'h', page: 2 })).toBe(true)
  })
})
