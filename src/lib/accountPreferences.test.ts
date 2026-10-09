import { beforeEach, describe, expect, it, vi } from 'vitest'

const cloud = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock('./auth', () => ({
  isAnonymousUser: () => false,
  getAuthClient: () => ({
    auth: { getSession: async () => ({ error: null, data: { session: { user: { id: 'u1' } } } }) },
    storage: {
      from: () => ({
        download: async (path: string) =>
          cloud.files.has(path)
            ? { error: null, data: new Blob([cloud.files.get(path) as string]) }
            : { error: { message: 'Object not found', statusCode: '404' }, data: null },
        upload: async (path: string, body: Blob) => {
          cloud.files.set(path, await body.text())
          return { error: null }
        },
      }),
    },
  }),
}))

import { syncAccountPreferences } from './accountLibrary'
import { writeDiary, readDiary } from './diary'

function device() {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  } as unknown as Storage
  return { storage, data }
}

const NAME = 'noesis:profile:first-name:v1'

describe('preferences follow the account', () => {
  beforeEach(() => {
    cloud.files.clear()
    const store = device()
    vi.stubGlobal('window', { localStorage: store.storage })
    vi.stubGlobal('localStorage', store.storage)
  })

  it('a second device takes what the first saved, and later edits travel back', async () => {
    const a = device()
    const b = device()
    a.storage.setItem(NAME, 'Ada')
    await syncAccountPreferences(a.storage)

    expect(await syncAccountPreferences(b.storage)).toContain(NAME)
    expect(b.storage.getItem(NAME)).toBe('Ada')

    await new Promise((resolve) => setTimeout(resolve, 5))
    b.storage.setItem(NAME, 'Ada L')
    expect(await syncAccountPreferences(b.storage)).toEqual([])
    expect(await syncAccountPreferences(a.storage)).toContain(NAME)
    expect(a.storage.getItem(NAME)).toBe('Ada L')
  })

  it('a wiped device gets everything back without erasing the account copy', async () => {
    const a = device()
    a.storage.setItem(NAME, 'Ada')
    await syncAccountPreferences(a.storage)
    const wiped = device()
    expect(await syncAccountPreferences(wiped.storage)).toContain(NAME)
    expect(wiped.storage.getItem(NAME)).toBe('Ada')
    const stored = JSON.parse(cloud.files.get('u1/data/preferences.json') as string)
    expect(stored.prefs[NAME].v).toBe('Ada')
  })

  it('combines the reading diary from both sides', async () => {
    const entry = (day: string, minutes: number) => ({ day, bookId: 'b', title: 'T', minutes, from: 0, to: 1 })
    writeDiary([entry('2026-10-01', 10)])
    await syncAccountPreferences(device().storage)
    cloud.files.set(
      'u1/data/preferences.json',
      JSON.stringify({
        ...JSON.parse(cloud.files.get('u1/data/preferences.json') as string),
        diary: [entry('2026-10-02', 5)],
      }),
    )
    await syncAccountPreferences(device().storage)
    expect(readDiary().map((item) => item.day)).toEqual(['2026-10-01', '2026-10-02'])
  })
})
