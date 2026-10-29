import { describe, expect, it } from 'vitest'
import type { BrainNote } from '../lib/knowledge'
import {
  chooseForDay,
  highlightPool,
  markDone,
  markSeen,
  nextIn,
  setFrequency,
  today,
  waitFor,
  type DailyState,
} from '../lib/dailyHighlights'

const note = (id: string, book: string, extra: Partial<BrainNote> = {}): BrainNote => ({
  id,
  kind: 'highlight',
  title: id,
  body: `A passage worth keeping, number ${id}.`,
  source: book,
  createdAt: '2026-01-01T00:00:00Z',
  bookId: book,
  ...extra,
})

const empty: DailyState = { items: {} }

describe('the highlights that can come back', () => {
  it('takes highlights and notes about a passage, never bookmarks or scraps', () => {
    const pool = highlightPool([
      note('h1', 'b1'),
      note('short', 'b1', { body: 'Too short' }),
      note('mark', 'b1', { tags: ['bookmark'] }),
      note('n1', 'b1', { kind: 'note', body: 'My thought', quote: 'The passage the thought was written about.' }),
      note('n2', 'b1', { kind: 'note', body: 'A note with no passage at all, long enough.' }),
    ])
    expect(pool.map((item) => item.note.id)).toEqual(['h1', 'n1'])
    expect(pool[1]).toMatchObject({ text: 'The passage the thought was written about.', comment: 'My thought' })
  })
})

describe('spacing', () => {
  it('waits longer each time a highlight is seen, halved or doubled by the reader', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((seen) => waitFor({ seen }))).toEqual([0, 7, 21, 45, 90, 180, 180])
    expect(waitFor({ seen: 2, frequency: 'more' })).toBe(11)
    expect(waitFor({ seen: 1, frequency: 'more' })).toBe(4)
    expect(waitFor({ seen: 2, frequency: 'less' })).toBe(42)
  })

  it('counts a highlight once a day, and says when it comes back', () => {
    let state = markSeen(empty, 'h1', '2026-10-01')
    state = markSeen(state, 'h1', '2026-10-01')
    expect(state.items.h1).toEqual({ seen: 1, last: '2026-10-01' })
    expect(nextIn(state, 'h1', '2026-10-03')).toBe(5)
    expect(nextIn(state, 'h1', '2026-10-20')).toBe(0)
  })
})

describe('choosing a day', () => {
  const pool = highlightPool([
    note('a1', 'A'),
    note('a2', 'A'),
    note('a3', 'A'),
    note('b1', 'B'),
    note('c1', 'C'),
  ])

  it('picks the same highlights all day, at most two from a book while others wait', () => {
    const first = chooseForDay(pool, empty, '2026-10-29', 4)
    expect(first).toEqual(chooseForDay(pool, empty, '2026-10-29', 4))
    expect(first).toHaveLength(4)
    expect(first.filter((id) => id.startsWith('a'))).toHaveLength(2)
    expect(first).toEqual(expect.arrayContaining(['b1', 'c1']))
  })

  it('fills from one book when nothing else is ready', () => {
    expect(chooseForDay(pool, empty, '2026-10-29', 5)).toHaveLength(5)
  })

  it('leaves out what was seen too recently and what the reader turned off', () => {
    let state = markSeen(empty, 'b1', '2026-10-25')
    state = setFrequency(state, 'c1', 'never')
    const chosen = chooseForDay(pool, state, '2026-10-29', 5)
    expect(chosen).not.toContain('b1')
    expect(chosen).not.toContain('c1')
    expect(chooseForDay(pool, state, '2026-11-02', 5)).toContain('b1')
  })

  it('keeps the day once chosen, and marks it done', () => {
    const notes = [note('a1', 'A'), note('b1', 'B')]
    const first = today(notes, empty, 5, '2026-10-29')
    expect(first.items.map((item) => item.note.id).sort()).toEqual(['a1', 'b1'])
    const seen = markSeen(first.state, 'a1', '2026-10-29')
    const again = today(notes, seen, 5, '2026-10-29')
    expect(again.items).toHaveLength(2)
    expect(today(notes, markDone(again.state, '2026-10-29'), 5, '2026-10-29').done).toBe(true)
    // The next day chooses again; a1 waits its week.
    expect(today(notes, seen, 5, '2026-10-30').items.map((item) => item.note.id)).toEqual(['b1'])
  })
})
