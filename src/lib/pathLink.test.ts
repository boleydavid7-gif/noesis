import { describe, expect, it } from 'vitest'
import { libraryBooksForStage, readNextOnPath, studyFor } from './pathLink'
import type { LearningPath } from './pathPlan'

const path = (bookIds: string[] = []): LearningPath => ({
  id: 'p',
  title: 'Stoic foundations',
  description: '',
  bookIds,
  createdAt: '',
  plan: {
    goal: 'Stoicism',
    summary: '',
    weeks: '',
    level: '',
    books: [],
    resources: [],
    milestones: [
      { id: 'm1', title: 'Basics', topics: [{ id: 't1', label: 'Control', done: true }], bookTitles: ['Meditations'] },
      {
        id: 'm2',
        title: 'Practice',
        topics: [{ id: 't2', label: 'Review', done: false }],
        bookTitles: ['Letters from a Stoic'],
      },
    ],
  },
})

describe('studyFor', () => {
  it('finds the stage that names the book', () => {
    const found = studyFor({ id: 'b', title: 'Meditations', author: 'Marcus Aurelius' }, [path()])
    expect(found?.milestone.id).toBe('m1')
    expect(studyFor({ id: 'b', title: 'Letters from a Stoic' }, [path()])?.milestone.id).toBe('m2')
  })
  it('puts a hand-added book on the current stage', () => {
    expect(studyFor({ id: 'x', title: 'Some Other Book' }, [path(['x'])])?.milestone.id).toBe('m2')
  })
  it('returns null for unrelated books', () => {
    expect(studyFor({ id: 'y', title: 'Cooking' }, [path()])).toBeNull()
  })
  it('lists library books for a stage', () => {
    const p = path()
    const books = [
      { id: '1', title: 'Meditations' },
      { id: '2', title: 'Cooking' },
    ]
    expect(libraryBooksForStage(p.plan!.milestones[0], books).map((book) => book.id)).toEqual(['1'])
  })
})

describe('readNextOnPath', () => {
  const p = path()
  it('continues a started book for the current stage', () => {
    const next = readNextOnPath(p, [{ id: '1', title: 'Letters from a Stoic', progress: 30 }])
    expect(next).toMatchObject({ kind: 'continue', book: { id: '1' } })
  })
  it('starts one that is in the library but unopened', () => {
    expect(readNextOnPath(p, [{ id: '1', title: 'Letters from a Stoic', progress: 0 }])?.kind).toBe('start')
  })
  it('says so when the stage books are all finished', () => {
    expect(readNextOnPath(p, [{ id: '1', title: 'Letters from a Stoic', progress: 100, finished: 'x' }])?.kind).toBe(
      'finished-all',
    )
  })
  it('suggests getting a named book that is not in the library', () => {
    expect(readNextOnPath(p, [])).toMatchObject({ kind: 'get', title: 'Letters from a Stoic' })
  })
  it('asks to find materials when the stage names nothing', () => {
    const bare = path()
    bare.plan!.milestones[1].bookTitles = []
    expect(readNextOnPath(bare, [])?.kind).toBe('find')
  })
  it('is null when every topic is done', () => {
    const complete = path()
    for (const milestone of complete.plan!.milestones) for (const topic of milestone.topics) topic.done = true
    expect(readNextOnPath(complete, [])).toBeNull()
  })
})
