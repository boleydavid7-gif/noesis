import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readLibraryBooks, writeLibraryBooks, type LibraryBook } from './library'

const book = (id: string, cover?: string): LibraryBook =>
  ({ id, title: id, author: 'A', progress: 0, chapter: '', updated: '', cover: '', coverDataUrl: cover }) as LibraryBook

function fakeStorage(limit: number) {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > limit) throw new DOMException('full', 'QuotaExceededError')
      data.set(key, value)
    },
    removeItem: (key: string) => void data.delete(key),
  }
}

describe('saving the library when browser storage is nearly full', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('keeps every book by letting go of the biggest covers first', () => {
    vi.stubGlobal('window', { localStorage: fakeStorage(1500) })
    const books = [book('a', 'x'.repeat(1000)), book('b', 'y'.repeat(300)), book('c', 'z'.repeat(900))]
    writeLibraryBooks(books)
    const saved = readLibraryBooks()
    expect(saved.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(saved.find((item) => item.id === 'a')?.coverDataUrl).toBeUndefined()
    expect(saved.find((item) => item.id === 'b')?.coverDataUrl).toBeDefined()
  })

  it('still throws when even bare books cannot fit', () => {
    vi.stubGlobal('window', { localStorage: fakeStorage(10) })
    expect(() => writeLibraryBooks([book('a')])).toThrow()
  })
})
