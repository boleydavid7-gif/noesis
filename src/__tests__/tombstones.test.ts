import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyTombstones,
  markDeleted,
  markRestored,
  mergeTombstones,
  pruneTombstones,
  readTombstones,
  sanitizeTombstones,
} from '../lib/tombstones'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  }
})

describe('tombstones', () => {
  it('drops deleted items and keeps the rest', () => {
    const tombstones = { 'book:a': { at: '2026-01-01T00:00:00.000Z', deleted: true } }
    expect(applyTombstones('book', [{ id: 'a' }, { id: 'b' }], tombstones)).toEqual([{ id: 'b' }])
  })

  it('does not apply a book tombstone to a note with the same id', () => {
    const tombstones = { 'book:a': { at: '2026-01-01T00:00:00.000Z', deleted: true } }
    expect(applyTombstones('note', [{ id: 'a' }], tombstones)).toHaveLength(1)
  })

  it('lets the later entry win, and a restore beat an older deletion', () => {
    const merged = mergeTombstones(
      { 'book:a': { at: '2026-01-01T00:00:00.000Z', deleted: true } },
      { 'book:a': { at: '2026-02-01T00:00:00.000Z', deleted: false } },
    )
    expect(merged['book:a'].deleted).toBe(false)
  })

  it('prefers a deletion on an exact tie', () => {
    const at = '2026-01-01T00:00:00.000Z'
    expect(
      mergeTombstones({ 'book:a': { at, deleted: false } }, { 'book:a': { at, deleted: true } })['book:a'].deleted,
    ).toBe(true)
  })

  it('prunes old entries but keeps recent ones', () => {
    const now = Date.parse('2026-12-01T00:00:00.000Z')
    const pruned = pruneTombstones(
      {
        'book:old': { at: '2025-01-01T00:00:00.000Z', deleted: true },
        'book:new': { at: '2026-11-20T00:00:00.000Z', deleted: true },
        'book:restoredOld': { at: '2026-09-01T00:00:00.000Z', deleted: false },
      },
      now,
    )
    expect(Object.keys(pruned)).toEqual(['book:new'])
  })

  it('ignores malformed stored data', () => {
    expect(
      sanitizeTombstones({
        'book:a': { at: 'nope', deleted: true },
        'book:b': 5,
        'book:c': { at: '2026-01-01', deleted: true },
      }),
    ).toEqual({
      'book:c': { at: '2026-01-01', deleted: true },
    })
  })

  it('records deletes, and only records a restore when something was deleted', () => {
    markRestored('book', 'x')
    expect(readTombstones()).toEqual({})
    markDeleted('book', 'x')
    expect(readTombstones()['book:x'].deleted).toBe(true)
    markRestored('book', 'x')
    expect(readTombstones()['book:x'].deleted).toBe(false)
  })
})
