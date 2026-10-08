import { describe, expect, it } from 'vitest'
import type { LibraryBook } from './library'
import { discoverQuery, interestTerms, libraryPicks, onboardingSteps } from './readNext'

const book = (id: string, title: string, extra: Partial<LibraryBook> = {}): LibraryBook => ({
  id,
  title,
  author: 'A',
  progress: 0,
  chapter: '',
  updated: '',
  cover: title,
  format: 'epub',
  ...extra,
})

describe('read next', () => {
  const notes = [
    { title: 'Stoic practice', body: 'Stoicism asks us to meditate on what we control.' },
    { title: 'Control', body: 'Stoic writers say what we control is small.' },
  ]
  it('finds repeated interests', () => {
    const terms = interestTerms(notes, [])
    expect(terms).toContain('control')
    expect(terms).not.toContain('meditate')
  })
  it('ranks unread books by shared words and skips started ones', () => {
    const terms = interestTerms(notes, [])
    const picks = libraryPicks(
      [book('1', 'Meditations on Control'), book('2', 'Cooking'), book('3', 'Control Everything', { progress: 40 })],
      terms,
    )
    expect(picks.map((pick) => pick.book.id)).toEqual(['1'])
    expect(picks[0].because).toContain('control')
  })
  it('counts liked finished books as interests', () => {
    const finished = book('f', 'Quantum Gardens', {
      finished: '2026-01-01',
      review: { stars: 5, line: '', reread: false, at: '' },
    })
    expect(interestTerms([{ title: 'quantum notes', body: 'about quantum things' }], [finished])).toContain('quantum')
  })
  it('builds a search and a checklist', () => {
    expect(discoverQuery(['stoic', 'control', 'x'])).toBe('stoic control')
    const steps = onboardingSteps({ books: [book('1', 'A', { progress: 3 })], noteCount: 0, pathCount: 0 })
    expect(steps.map((step) => step.done)).toEqual([true, true, false, false])
  })
})
