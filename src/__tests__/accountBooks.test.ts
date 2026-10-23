import { beforeEach, describe, expect, it, vi } from 'vitest'

// The site's storage (account bucket), one connected cloud, and this device's books.
const bucket = new Map<string, string>()
const cloud = new Map<string, string>()
let connections: Array<{
  provider: string
  accessToken: string
  expiresAt: number
  connectedAt: string
  ownerUserId?: string
}> = []
let shelf: Array<Record<string, unknown>> = []

vi.mock('../lib/auth', () => ({
  isAnonymousUser: () => false,
  getAuthClient: () => ({
    auth: { getSession: async () => ({ error: null, data: { session: { user: { id: 'u1', is_anonymous: false } } } }) },
    storage: {
      from: () => ({
        list: async (folder: string) => ({
          error: null,
          data: [...bucket.keys()]
            .filter((path) => path.startsWith(`${folder}/`))
            .map((path) => ({ name: path.slice(folder.length + 1) })),
        }),
        download: async (path: string) =>
          bucket.has(path)
            ? { error: null, data: new Blob([bucket.get(path) as string]) }
            : { error: { statusCode: '404', message: 'Object not found' }, data: null },
        upload: async (path: string, blob: Blob) => {
          bucket.set(path, await blob.text())
          return { error: null }
        },
        remove: async (paths: string[]) => {
          paths.forEach((path) => bucket.delete(path))
          return { error: null }
        },
      }),
    },
  }),
}))
vi.mock('../lib/cloudProviders', () => ({
  readCloudConnections: () => connections,
  cloudConnectionUsable: () => true,
  freshCloudConnection: async (connection: unknown) => connection,
  writeCloudFile: async (_connection: unknown, path: string, blob: Blob) => void cloud.set(path, await blob.text()),
  readCloudFile: async (_connection: unknown, path: string) =>
    cloud.has(path) ? new TextEncoder().encode(cloud.get(path)).buffer : null,
}))
vi.mock('../lib/library', () => ({
  readLibraryBooks: () => shelf,
  writeLibraryBooks: (books: Array<Record<string, unknown>>) => void (shelf = books),
  loadEpubFile: async () => new ArrayBuffer(8),
  saveBookText: async () => undefined,
}))

const memory = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
}

const { syncAccountLibrary } = await import('../lib/accountLibrary')

const book = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  format: 'epub',
  updated: '2026-10-01T00:00:00Z',
  ...extra,
})

beforeEach(() => {
  bucket.clear()
  cloud.clear()
  memory.clear()
  connections = []
  shelf = []
})

describe('book files and the site’s storage', () => {
  it('never sends a book file to the site’s storage, only the small list of books', async () => {
    shelf = [book('b1')]
    await syncAccountLibrary(shelf as never)
    expect([...bucket.keys()]).toEqual(['u1/library/manifest.json'])
  })

  it('moves files kept there before into the connected cloud, and lets go of library-folder books', async () => {
    connections = [
      {
        provider: 'google-drive',
        accessToken: 't',
        expiresAt: Date.now() + 3_600_000,
        connectedAt: '',
        ownerUserId: 'u1',
      },
    ]
    bucket.set('u1/library/books/b1.epub', 'first book')
    bucket.set('u1/library/books/b2.epub', 'folder book')
    bucket.set('u1/library/books/gone.epub', 'deleted book')
    shelf = [
      book('b1', { cloudAt: '2026-10-01T00:00:00Z' }),
      book('b2', { fromFolder: 'Books/b2.epub', cloudAt: '2026-10-01T00:00:00Z' }),
    ]
    const books = await syncAccountLibrary(shelf as never)
    expect([...bucket.keys()].filter((path) => path.includes('/books/'))).toEqual([])
    expect(cloud.get('books/b1.epub')).toBe('first book')
    expect(cloud.has('books/b2.epub')).toBe(false)
    expect(books.every((each) => each.cloudAt)).toBe(true)
  })

  it('leaves files where they are while no cloud is connected', async () => {
    bucket.set('u1/library/books/b1.epub', 'first book')
    shelf = [book('b1', { cloudAt: '2026-10-01T00:00:00Z' })]
    await syncAccountLibrary(shelf as never)
    expect(bucket.has('u1/library/books/b1.epub')).toBe(true)
  })
})
