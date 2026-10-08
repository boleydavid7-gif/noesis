import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/auth', () => ({ authHeaders: async () => ({}) }))

import { bookKey, requestSuggestion, resolveBook, resolveBooks } from '../lib/pathClient'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  }
})
afterEach(() => vi.unstubAllGlobals())

const found = {
  title: 'Network Warrior',
  authors: ['Gary Donahue'],
  buy: [{ store: 'Amazon', url: 'https://amazon.com/x' }],
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('resolveBook', () => {
  it('returns the real record and remembers it', async () => {
    const mock = vi.fn(async () => reply({ ok: true, book: found }))
    vi.stubGlobal('fetch', mock)
    const candidate = { title: 'Network Warrior', author: 'Donahue', note: 'Practical skills' }
    expect((await resolveBook(candidate))?.title).toBe('Network Warrior')
    expect((await resolveBook(candidate))?.title).toBe('Network Warrior')
    expect(mock).toHaveBeenCalledTimes(1)
    expect(String((mock.mock.calls[0] as unknown as [string])[0])).toContain('note=Practical+skills')
  })

  it('leaves out a book that does not exist, and remembers that too', async () => {
    const mock = vi.fn(async () => reply({ ok: true, book: null }))
    vi.stubGlobal('fetch', mock)
    expect(await resolveBook({ title: 'Made Up Book', author: 'Nobody' })).toBeNull()
    expect(await resolveBook({ title: 'Made Up Book', author: 'Nobody' })).toBeNull()
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('keeps the suggestion but marks it unverified when the catalogue is down, without caching it', async () => {
    const mock = vi.fn(async () => reply({ ok: false }, 502))
    vi.stubGlobal('fetch', mock)
    const book = await resolveBook({ title: 'Network Warrior', author: 'Donahue' })
    expect(book?.unverified).toBe(true)
    expect(book?.buy.map((link) => link.store)).toContain('Amazon')
    await resolveBook({ title: 'Network Warrior', author: 'Donahue' })
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('refreshes an old cache entry', async () => {
    const mock = vi.fn(async () => reply({ ok: true, book: found }))
    vi.stubGlobal('fetch', mock)
    const candidate = { title: 'Network Warrior', author: 'Donahue' }
    await resolveBook(candidate, 0)
    await resolveBook(candidate, 31 * 86_400_000)
    expect(mock).toHaveBeenCalledTimes(2)
    expect(bookKey(candidate)).toBe('network warrior|donahue')
  })
})

describe('resolveBooks', () => {
  it('reports progress in the original order and drops missing books', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const title = new URL(String(input), 'https://x.test').searchParams.get('title')
        return reply({ ok: true, book: title === 'Missing' ? null : { ...found, title: String(title) } })
      }),
    )
    const seen: string[][] = []
    const books = await resolveBooks(
      [
        { title: 'First', author: '' },
        { title: 'Missing', author: '' },
        { title: 'Third', author: '' },
      ],
      (list) => seen.push(list.map((book) => book.title)),
      2,
    )
    expect(books.map((book) => book.title)).toEqual(['First', 'Third'])
    expect(seen.length).toBe(3)
    expect(seen.at(-1)).toEqual(['First', 'Third'])
  })
})

describe('requestSuggestion', () => {
  it('returns the plan, or the server message when it fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ ok: true, suggestion: { goal: 'g', paths: [], books: [], resources: [] } })),
    )
    expect((await requestSuggestion('learn networking')).goal).toBe('g')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ ok: false, error: 'Too many requests.' }, 429)),
    )
    await expect(requestSuggestion('learn networking')).rejects.toThrow('Too many requests.')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    await expect(requestSuggestion('learn networking')).rejects.toThrow(/connection/)
  })
})
