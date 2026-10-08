import { describe, expect, it } from 'vitest'
import { findInPages, parsePdfLocation } from './pdfMarks'

describe('pdf marks', () => {
  it('reads a saved place', () => {
    expect(parsePdfLocation('pdf:3:0.1,0.2,0.3,0.02;0.1,0.23,0.2,0.02')).toEqual({
      page: 3,
      rects: [
        { x: 0.1, y: 0.2, w: 0.3, h: 0.02 },
        { x: 0.1, y: 0.23, w: 0.2, h: 0.02 },
      ],
    })
    expect(parsePdfLocation('pdf:12')).toEqual({ page: 12, rects: [] })
  })
  it('ignores anything that is not a PDF place', () => {
    expect(parsePdfLocation('epubcfi(/6/2)')).toBeNull()
    expect(parsePdfLocation(undefined)).toBeNull()
    expect(parsePdfLocation('pdf:2:a,b,c,d')?.rects).toEqual([])
  })
  it('finds words page by page', () => {
    const hits = findInPages(['nothing here', 'The Quick fox jumps', 'quick quick'], 'quick')
    expect(hits.map((hit) => hit.page)).toEqual([2, 3, 3])
    expect(hits[0].snippet).toContain('Quick fox')
    expect(findInPages(['abc'], 'a')).toEqual([])
  })
})
