import { afterEach, describe, expect, it, vi } from 'vitest'
import { findFreeCopies } from '../lib/freeCopy'

const result = (over: Record<string, unknown>) => ({
  id: 'x',
  title: 'Pride and Prejudice',
  author: 'Austen, Jane',
  source: 'Project Gutenberg',
  sourceUrl: 'https://www.gutenberg.org/ebooks/1342',
  free: true,
  format: 'EPUB',
  kind: 'book',
  ...over,
})

const stub = (results: unknown[], ok = true) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok, results }), { status: ok ? 200 : 502 })),
  )

afterEach(() => vi.unstubAllGlobals())

describe('findFreeCopies', () => {
  it('keeps open copies of the right book and drops borrow-only, non-matching and unreadable results', async () => {
    stub([
      result({ id: 'a', downloadUrl: 'https://www.gutenberg.org/ebooks/1342.epub.images' }),
      result({ id: 'b', source: 'Internet Archive', readerUrl: 'https://archive.org/embed/pp', accessType: 'public' }),
      result({ id: 'c', readerUrl: 'https://archive.org/embed/loan', accessType: 'borrow', free: false }),
      result({ id: 'd', title: 'Sense and Sensibility', downloadUrl: 'https://www.gutenberg.org/x.epub' }),
      result({ id: 'e' }),
      result({ id: 'f', kind: 'article', downloadUrl: 'https://archive.org/x.pdf' }),
    ])
    const copies = await findFreeCopies({ title: 'Pride and Prejudice', authors: ['Jane Austen'] })
    expect(copies.map((copy) => copy.id)).toEqual(['a', 'b'])
  })

  it('returns nothing when no open copy exists', async () => {
    stub([])
    expect(await findFreeCopies({ title: 'Some New Book', authors: ['A Writer'] })).toEqual([])
  })

  it('reports an unavailable search', async () => {
    stub([], false)
    await expect(findFreeCopies({ title: 'T', authors: [] })).rejects.toThrow()
  })
})
