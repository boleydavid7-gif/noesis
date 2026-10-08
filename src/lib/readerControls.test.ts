import { describe, expect, it } from 'vitest'
import { autoScrollPixelsPerSecond, pageScroll, tapZone } from './readerControls'

describe('reader controls', () => {
  it('finds the tap zone', () => {
    expect(tapZone(50, 1000)).toBe('up')
    expect(tapZone(900, 1000)).toBe('down')
    expect(tapZone(500, 1000)).toBeNull()
    expect(tapZone(-5, 1000)).toBeNull()
    expect(tapZone(10, 0)).toBeNull()
  })
  it('scrolls most of a screen', () => {
    expect(pageScroll(1000)).toBe(880)
  })
  it('keeps auto-scroll speed in range', () => {
    expect(autoScrollPixelsPerSecond(0)).toBe(14)
    expect(autoScrollPixelsPerSecond(5)).toBe(70)
    expect(autoScrollPixelsPerSecond(99)).toBe(140)
  })
})
