import { describe, expect, it } from 'vitest'
import { foldDuplicates } from '../lib/duplicates'
import type { LibraryBook } from '../lib/library'

const book = (id: string, extra: Partial<LibraryBook> = {}): LibraryBook => ({
  id,
  title: 'Meditations',
  author: 'Marcus Aurelius',
  progress: 0,
  chapter: '',
  updated: '2026-10-01T10:00:00.000Z',
  cover: 'Meditations',
  format: 'epub',
  fileName: 'Meditations.epub',
  fileSize: 1000,
  ...extra,
})

describe('folding copies of one book', () => {
  it('keeps the first added, with the furthest place and everything set on either copy', () => {
    const phone = book('b-phone', { added: '2026-09-01T00:00:00Z', shelves: ['Stoics'], favorite: true })
    const laptop = book('b-laptop', {
      added: '2026-09-05T00:00:00Z',
      fileName: 'MEDITATIONS.epub',
      progress: 42,
      cfi: 'epubcfi(/6/8)',
      updated: '2026-10-10T00:00:00Z',
      shelves: ['Reading'],
    })
    const other = book('b-other', { fileName: 'Letters.epub', title: 'Letters' })
    const { books, moved } = foldDuplicates([laptop, other, phone])
    expect(moved).toEqual({ 'b-laptop': 'b-phone' })
    expect(books.map((item) => item.id)).toEqual(['b-other', 'b-phone'])
    const kept = books.find((item) => item.id === 'b-phone')!
    expect(kept.progress).toBe(42)
    expect(kept.cfi).toBe('epubcfi(/6/8)')
    expect(kept.favorite).toBe(true)
    expect(kept.shelves?.sort()).toEqual(['Reading', 'Stoics'])
    expect(kept.added).toBe('2026-09-01T00:00:00Z')
  })

  it('picks the same one whichever order the copies come in', () => {
    const a = book('b-a', { added: '2026-09-01T00:00:00Z' })
    const b = book('b-b', { added: '2026-09-01T00:00:00Z' })
    expect(foldDuplicates([a, b]).moved).toEqual({ 'b-b': 'b-a' })
    expect(foldDuplicates([b, a]).moved).toEqual({ 'b-b': 'b-a' })
  })

  it('leaves alone books that are not the same file', () => {
    const list = [
      book('b-1'),
      book('b-2', { fileSize: 2000 }),
      book('b-3', { format: 'pdf', fileName: 'Meditations.epub' }),
      book('b-4', { fileName: undefined }),
      book('b-5', { fileName: undefined }),
    ]
    const result = foldDuplicates(list)
    expect(result.moved).toEqual({})
    expect(result.books).toBe(list)
  })
})
