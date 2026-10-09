import { describe, expect, it } from 'vitest'
import type { BrainNote } from './knowledge'
import {
  backlinks,
  dueNotes,
  linkTitles,
  mergeNotes,
  notebookCounts,
  resolveLink,
  revisitDate,
  tagCounts,
} from './noteLinks'

const note = (id: string, title: string, body = '', extra: Partial<BrainNote> = {}): BrainNote => ({
  id,
  kind: 'note',
  title,
  body,
  source: '',
  createdAt: '2026-01-01T00:00:00Z',
  ...extra,
})

describe('note links', () => {
  it('reads [[links]] once each', () => {
    expect(linkTitles('See [[Focus]] and [[ Focus ]] and [[Depth of work]].')).toEqual(['Focus', 'Depth of work'])
    expect(linkTitles('none here')).toEqual([])
  })
  it('finds backlinks and resolves links ignoring case', () => {
    const a = note('a', 'Focus')
    const b = note('b', 'Other', 'relates to [[focus]]')
    const c = note('c', 'Else', 'nothing')
    expect(backlinks(a, [a, b, c]).map((item) => item.id)).toEqual(['b'])
    expect(resolveLink('FOCUS', [a, b])?.id).toBe('a')
    expect(resolveLink('missing', [a])).toBeUndefined()
  })
  it('counts tags (not word or bookmark) and notebooks', () => {
    const list = [
      note('1', 'a', '', { tags: ['x', 'word'], notebook: 'Work' }),
      note('2', 'b', '', { tags: ['x', 'y', 'bookmark'] }),
      note('3', 'c', '', { notebook: 'Work' }),
    ]
    expect(tagCounts(list)).toEqual([
      { name: 'x', count: 2 },
      { name: 'y', count: 1 },
    ])
    expect(notebookCounts(list)).toEqual([{ name: 'Work', count: 2 }])
  })
  it('merges two notes', () => {
    const merged = mergeNotes(
      note('1', 'a', 'one', { tags: ['x'] }),
      note('2', 'b', 'two', { tags: ['y'], notebook: 'N' }),
    )
    expect(merged.body).toBe('one\n\ntwo')
    expect(merged.tags).toEqual(['x', 'y'])
    expect(merged.notebook).toBe('N')
  })
  it('lists notes whose day has come', () => {
    const today = new Date('2026-03-10T12:00:00')
    const list = [
      note('1', 'old', '', { revisit: '2026-03-01' }),
      note('2', 'today', '', { revisit: '2026-03-10' }),
      note('3', 'later', '', { revisit: '2026-03-11' }),
      note('4', 'none'),
    ]
    expect(dueNotes(list, today).map((item) => item.id)).toEqual(['1', '2'])
    expect(revisitDate(7, today)).toBe('2026-03-17')
  })
})
