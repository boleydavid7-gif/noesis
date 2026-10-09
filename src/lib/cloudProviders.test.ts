import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudConnectionUsable, freshCloudConnection, readCloudConnections } from './cloudProviders'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
})

afterEach(() => vi.unstubAllGlobals())

const ended = {
  provider: 'dropbox' as const,
  accessToken: 'old',
  refreshToken: 'renew',
  expiresAt: Date.now() - 1000,
  connectedAt: '2026-01-01T00:00:00Z',
  ownerUserId: 'u1',
}

describe('cloud connection renewal', () => {
  it('counts an ended token as usable when it can renew', () => {
    expect(cloudConnectionUsable(ended)).toBe(true)
    expect(cloudConnectionUsable({ ...ended, refreshToken: undefined })).toBe(false)
  })

  it('renews an ended token and keeps the new one', async () => {
    store.set('noesis:cloud-connections:v1', JSON.stringify([ended]))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }), { status: 200 })),
    )
    const next = await freshCloudConnection(ended)
    expect(next.accessToken).toBe('new')
    expect(next.refreshToken).toBe('renew')
    expect(readCloudConnections()[0].accessToken).toBe('new')
  })

  it('keeps the connection when the network is down, drops renewal when refused', async () => {
    store.set('noesis:cloud-connections:v1', JSON.stringify([ended]))
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    await expect(freshCloudConnection(ended)).rejects.toThrow(/try again/)
    expect(readCloudConnections()[0].refreshToken).toBe('renew')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))
    await expect(freshCloudConnection(ended)).rejects.toThrow(/Reconnect/)
    expect(readCloudConnections()[0].refreshToken).toBeUndefined()
  })
})
