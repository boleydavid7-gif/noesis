import { describe, expect, it } from 'vitest'
import { timeAgo } from '../lib/time'

const now = Date.parse('2026-10-08T12:00:00.000Z')
const ago = (ms: number) => new Date(now - ms).toISOString()

describe('timeAgo', () => {
  it('describes recent and older times', () => {
    expect(timeAgo(ago(10_000), now)).toBe('just now')
    expect(timeAgo(ago(60_000), now)).toBe('1 minute ago')
    expect(timeAgo(ago(10 * 60_000), now)).toBe('10 minutes ago')
    expect(timeAgo(ago(2 * 3_600_000), now)).toBe('2 hours ago')
    expect(timeAgo(ago(3 * 86_400_000), now)).toBe('3 days ago')
  })
  it('handles missing or invalid values', () => {
    expect(timeAgo('', now)).toBe('never')
    expect(timeAgo('garbage', now)).toBe('never')
  })
})
