import { describe, expect, it } from 'vitest'
import {
  buyLinks,
  cleanSuggestion,
  matchScore,
  milestoneDone,
  pathFromSuggestion,
  pickBook,
  planProgress,
  toggleTopic,
  topicCount,
  type BookRecord,
  type PathPlan,
} from '../lib/pathPlan'

const raw = {
  paths: [
    {
      title: 'Networking Foundations',
      summary: 'Build a solid understanding of how networks work.',
      weeks: '6–8 weeks',
      level: 'Beginner',
      milestones: [
        { title: 'Fundamentals', topics: ['What a network is', 'IP addresses'] },
        { title: 'Protocols', topics: ['TCP and UDP', 'DNS', 'HTTP'] },
        { title: 'Empty', topics: [] },
      ],
    },
    { title: '', milestones: [] },
    { title: 'Too short', milestones: [{ title: 'Only one', topics: ['x'] }] },
  ],
  books: [
    { title: 'Computer Networking: A Top-Down Approach', author: 'Kurose', note: 'Best overview' },
    { title: 'Computer Networking: A Top-Down Approach', author: 'Kurose' },
    { author: 'No title' },
  ],
  resources: [
    { title: 'Cisco Networking Academy', publisher: 'Cisco', url: 'https://www.netacad.com/', kind: 'Free course' },
    { title: 'Bad scheme', url: 'http://example.com' },
    { title: 'Local', url: 'https://localhost/secret' },
    { title: 'IP', url: 'https://192.168.1.1/admin' },
    { title: 'No url' },
  ],
}

describe('cleanSuggestion', () => {
  it('keeps valid paths, drops incomplete ones and empty milestones', () => {
    const suggestion = cleanSuggestion('learn networking', raw)
    expect(suggestion?.paths).toHaveLength(1)
    expect(suggestion?.paths[0].milestones.map((milestone) => milestone.title)).toEqual(['Fundamentals', 'Protocols'])
    expect(topicCount(suggestion!.paths[0].milestones)).toBe(5)
  })

  it('removes duplicate and untitled books', () => {
    expect(cleanSuggestion('g', raw)?.books).toHaveLength(1)
  })

  it('keeps only public https resource links', () => {
    expect(cleanSuggestion('g', raw)?.resources.map((resource) => resource.title)).toEqual(['Cisco Networking Academy'])
  })

  it('rejects an answer with no usable path', () => {
    expect(cleanSuggestion('g', {})).toBeNull()
    expect(cleanSuggestion('g', null)).toBeNull()
    expect(cleanSuggestion('g', { paths: 'nope' })).toBeNull()
  })

  it('bounds the length of text it keeps', () => {
    const long = 'x'.repeat(1000)
    const suggestion = cleanSuggestion('g', {
      paths: [
        {
          title: long,
          summary: long,
          milestones: [
            { title: long, topics: [long, long] },
            { title: 'b', topics: ['c'] },
          ],
        },
      ],
    })
    expect(suggestion?.paths[0].title.length).toBe(80)
    expect(suggestion?.paths[0].summary.length).toBe(260)
  })
})

describe('book matching', () => {
  const records: BookRecord[] = [
    {
      title: 'Computer Networking: A Top-Down Approach, 7th Edition',
      authors: ['James F. Kurose', 'Keith W. Ross'],
      ratingsCount: 120,
      year: 2016,
    },
    { title: 'Computer Networking: A Top-Down Approach', authors: ['James F. Kurose'], ratingsCount: 900, year: 2021 },
    { title: 'Networking for Dummies', authors: ['Doug Lowe'], ratingsCount: 9999 },
  ]

  it('prefers the better-reviewed record when several match', () => {
    expect(pickBook(records, 'Computer Networking: A Top-Down Approach', 'Kurose')?.year).toBe(2021)
  })

  it('does not accept a different book with a similar subject', () => {
    expect(pickBook(records, 'Network Warrior', 'Gary Donahue')).toBeNull()
  })

  it('requires the author surname when one is given', () => {
    expect(matchScore(records[2], 'Networking for Dummies', 'Someone Else')).toBe(0)
    expect(matchScore(records[2], 'Networking for Dummies', 'Doug Lowe')).toBeGreaterThan(0)
  })

  it('builds buy links, using the ISBN when known', () => {
    const links = buyLinks({
      title: 'T',
      authors: ['A'],
      isbn10: '0136681557',
      isbn13: '9780136681557',
      buyLink: 'https://play.google.com/store/books/details?id=x',
    })
    expect(links.map((link) => link.store)).toEqual([
      'Bookshop.org',
      'Amazon',
      'Google Play Books',
      'Find in a library',
    ])
    expect(links[1].url).toBe('https://www.amazon.com/dp/0136681557')
    expect(links[0].url).toContain('9780136681557')
  })

  it('falls back to a title search without an ISBN and skips unsafe store links', () => {
    const links = buyLinks({ title: 'A Book', authors: ['Some Author'], buyLink: 'http://insecure.example' })
    expect(links.map((link) => link.store)).toEqual(['Bookshop.org', 'Amazon', 'Find in a library'])
    expect(links[1].url).toContain('amazon.com/s?k=A%20Book%20Some%20Author')
  })
})

describe('plan progress', () => {
  const plan: PathPlan = {
    goal: 'g',
    summary: '',
    weeks: '',
    level: '',
    books: [],
    resources: [],
    milestones: [
      {
        id: 'm1',
        title: 'One',
        topics: [
          { id: 't1', label: 'a', done: true },
          { id: 't2', label: 'b', done: false },
        ],
      },
      { id: 'm2', title: 'Two', topics: [{ id: 't3', label: 'c', done: false }] },
    ],
  }

  it('counts finished topics and milestones', () => {
    expect(planProgress(plan)).toEqual({ done: 1, total: 3, percent: 33 })
    expect(milestoneDone(plan.milestones[0])).toBe(false)
  })

  it('toggles one topic without touching others', () => {
    const next = toggleTopic(plan, 't2')
    expect(milestoneDone(next.milestones[0])).toBe(true)
    expect(planProgress(next).done).toBe(2)
    expect(planProgress(plan).done).toBe(1)
  })

  it('creates a saved learning path from a suggestion', () => {
    const suggestion = cleanSuggestion('learn networking', raw)!
    const saved = pathFromSuggestion(suggestion, suggestion.paths[0], [])
    expect(saved.title).toBe('Networking Foundations')
    expect(saved.plan?.goal).toBe('learn networking')
    expect(saved.plan?.resources).toHaveLength(1)
    expect(saved.updated).toBe(saved.createdAt)
  })
})
