import { describe, expect, it } from 'vitest'
import { mergeById } from '../lib/merge'

describe('mergeById', () => {
  it('keeps items that only exist on one side', () => {
    const merged = mergeById([{ id: 'a', updated: '2026-01-01' }], [{ id: 'b', updated: '2026-01-02' }])
    expect(merged.map((item) => item.id).sort()).toEqual(['a', 'b'])
  })

  it('prefers the newer copy of the same item', () => {
    const merged = mergeById([{ id: 'a', updated: '2026-01-01', v: 1 }], [{ id: 'a', updated: '2026-02-01', v: 2 }])
    expect(merged).toEqual([{ id: 'a', updated: '2026-02-01', v: 2 }])
  })

  it('keeps the local copy when the remote one is older', () => {
    const merged = mergeById([{ id: 'a', updated: '2026-02-01', v: 2 }], [{ id: 'a', updated: '2026-01-01', v: 1 }])
    expect(merged[0].v).toBe(2)
  })

  it('falls back to createdAt and sorts newest first', () => {
    const merged = mergeById([{ id: 'old', createdAt: '2026-01-01' }], [{ id: 'new', createdAt: '2026-03-01' }])
    expect(merged.map((item) => item.id)).toEqual(['new', 'old'])
  })
})
