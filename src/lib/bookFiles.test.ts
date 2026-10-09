import { beforeEach, describe, expect, it, vi } from 'vitest'

const library = vi.hoisted(() => ({ files: new Map<string, ArrayBuffer>() }))
const account = vi.hoisted(() => ({ result: null as ArrayBuffer | null }))
const cloud = vi.hoisted(() => ({ result: null as ArrayBuffer | null, connections: [] as unknown[] }))

vi.mock('./library', () => ({
  loadEpubFile: async (id: string) => library.files.get(id) ?? null,
  saveEpubFile: async (id: string, bytes: ArrayBuffer) => void library.files.set(id, bytes),
}))
vi.mock('./accountLibrary', () => ({
  downloadAccountBook: async () => account.result,
  indexDownloadedBook: async () => undefined,
}))
vi.mock('./cloudProviders', () => ({ readCloudConnections: () => cloud.connections }))
vi.mock('./cloudSync', () => ({ downloadCloudBook: async () => cloud.result }))

import { BookNotFoundError, openBookFile } from './bookFiles'

const book = { id: 'b1', title: 'B', format: 'epub' } as never
const bytes = (n: number) => new Uint8Array(n).buffer

describe('opening a book file', () => {
  beforeEach(() => {
    library.files.clear()
    account.result = null
    cloud.result = null
    cloud.connections = [{ provider: 'dropbox' }]
  })

  it('uses the copy on this device', async () => {
    library.files.set('b1', bytes(3))
    expect((await openBookFile(book)).byteLength).toBe(3)
  })

  it('fetches from the account when the device does not have it, and keeps it', async () => {
    account.result = bytes(5)
    expect((await openBookFile(book)).byteLength).toBe(5)
    expect(library.files.get('b1')?.byteLength).toBe(5)
  })

  it('falls back to a connected cloud', async () => {
    cloud.result = bytes(7)
    expect((await openBookFile(book)).byteLength).toBe(7)
  })

  it('says the book was not found when it is nowhere', async () => {
    await expect(openBookFile(book)).rejects.toBeInstanceOf(BookNotFoundError)
    await expect(openBookFile(book)).rejects.toThrow(/Book not found/)
  })
})
