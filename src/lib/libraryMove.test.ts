import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'

const book = (id: string) => ({
  id,
  title: id,
  author: 'A',
  progress: 0,
  chapter: '',
  updated: '',
  cover: '',
  format: 'epub' as const,
})

describe('the library list in IndexedDB', () => {
  it('moves the old browser-storage list over once, then saves there', async () => {
    const store = new Map<string, string>([['noesis:library:v2', JSON.stringify([book('old-1'), book('old-2')])]])
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    })
    const library = await import('./library')
    await library.startLibrary()
    expect(library.readLibraryBooks().map((item) => item.id)).toEqual(['old-1', 'old-2'])
    expect(store.has('noesis:library:v2')).toBe(false)

    // Far more than browser storage could hold, with big covers.
    const many = Array.from({ length: 60 }, (_, index) => ({ ...book(`b${index}`), coverDataUrl: 'x'.repeat(200_000) }))
    library.writeLibraryBooks(many)
    await library.libraryIdle()
    expect(library.readLibraryBooks()).toHaveLength(60)
    expect(store.has('noesis:library:v2')).toBe(false)

    // A fresh start reads it back from IndexedDB.
    vi.resetModules()
    const again = await import('./library')
    await again.startLibrary()
    expect(again.readLibraryBooks()).toHaveLength(60)
  })
})
