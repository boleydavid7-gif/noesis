import { describe, expect, it } from 'vitest'
import { parseLibbyExport } from '../lib/libbyExport'

const journey = {
  version: 1,
  readingJourney: { title: { text: 'Meditations', titleId: '123' }, author: 'Marcus Aurelius', percent: 0.4 },
  highlights: [
    {
      timestamp: 1760000000000,
      chapter: 'Book II',
      percent: 0.12,
      color: '#ffeb3b',
      quote: 'Begin the morning by saying to thyself.',
      note: '',
    },
    {
      timestamp: 1760000100000,
      chapter: 'Book IV',
      percent: 0.31,
      quote: 'The universe is change.',
      note: 'Ties to Heraclitus.',
    },
  ],
  bookmarks: [{ timestamp: 1760000200000, percent: 0.5 }],
}

describe('Libby reading journey export', () => {
  it('reads highlights and the notes on them from the JSON', () => {
    const clips = parseLibbyExport(JSON.stringify(journey))
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({
      bookTitle: 'Meditations',
      author: 'Marcus Aurelius',
      kind: 'highlight',
      body: 'Begin the morning by saying to thyself.',
      location: 'Book II · 12%',
      from: 'libby',
    })
    expect(clips[1]).toMatchObject({ kind: 'note', body: 'Ties to Heraclitus.', quote: 'The universe is change.' })
    expect(clips[0].addedAt).toBe(new Date(1760000000000).toISOString())
  })

  it('reads several books at once, and leaves out a file with no highlights', () => {
    expect(parseLibbyExport(JSON.stringify([journey, journey]))).toHaveLength(4)
    expect(parseLibbyExport('{"readingJourney":{"title":{"text":"X"}},"highlights":[]}')).toEqual([])
    expect(parseLibbyExport('not a libby file')).toEqual([])
  })

  it('reads the spreadsheet (CSV) too, quotes and commas inside cells included', () => {
    const csv = [
      'Title,Author,Timestamp,Chapter,Percent,Quote,Note',
      'Walden,Henry David Thoreau,2026-10-01T10:00:00Z,Economy,0.05,"I went to the woods, because I wished to live deliberately.",',
      'Walden,Henry David Thoreau,2026-10-02T10:00:00Z,Solitude,0.4,"I never found the companion that was so companionable as solitude.","Says ""companionable"" twice"',
    ].join('\n')
    const clips = parseLibbyExport(csv)
    expect(clips).toHaveLength(2)
    expect(clips[0].body).toBe('I went to the woods, because I wished to live deliberately.')
    expect(clips[1]).toMatchObject({ kind: 'note', body: 'Says "companionable" twice', location: 'Solitude · 40%' })
  })
})
