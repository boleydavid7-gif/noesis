import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LearningPath } from '../lib/pathPlan'
import { cleanSubjectReply, subjectFromDraft, withAnswerPart, withPicks, type Subject } from '../lib/subjects'

vi.mock('../lib/pathClient', () => ({
  exploreQuestion: vi.fn(async (input: { part?: string }) =>
    input.part === 'answer'
      ? {
          hook: 'A hook',
          short: 'Short.',
          followUp: 'Next?',
          doors: [{ kind: 'deeper', text: 'What lives in a spoon of soil?' }],
          ticket: 't-1',
          books: [],
          picks: [],
        }
      : {
          books: [{ title: 'Teaming with Microbes', author: 'Jeff Lowenfels' }],
          picks: [{ type: 'read', title: 'Soil', source: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Soil' }],
        },
  ),
  resolveBooks: vi.fn(async () => [{ title: 'Teaming with Microbes', authors: ['Jeff Lowenfels'], buy: [] }]),
}))

const { exploreQuestion } = await import('../lib/pathClient')
const { exploreInto, isExploring } = await import('../lib/subjectExplore')

const draft = cleanSubjectReply({
  title: 'Gardening',
  areas: [
    { title: 'Soil', questions: ['What makes soil good?'] },
    { title: 'Water', questions: ['How often to water?'] },
  ],
})!

afterEach(() => vi.clearAllMocks())

describe('filling a question in', () => {
  it('adds the answer part without replacing what is there', () => {
    const subject = subjectFromDraft(draft)
    const q = subject.questions[0]
    const next = withAnswerPart(
      { ...subject, questions: [{ ...q, hook: 'Mine' }, ...subject.questions.slice(1)] },
      q.id,
      {
        hook: 'Theirs',
        short: 'Short.',
        useIt: 'Try it',
      },
    )
    expect(next.questions[0]).toMatchObject({ hook: 'Mine', short: 'Short.', useIt: { text: 'Try it' } })
  })
  it('adds picks once, and starting over keeps only saved ones', () => {
    const subject = subjectFromDraft(draft)
    const q = subject.questions[0]
    let next = withPicks(subject, q.id, [
      { type: 'read', title: 'A', source: 'S', url: 'https://a.org' },
      { type: 'read', title: 'B', source: 'S', url: 'https://b.org', saved: true },
    ])
    next = withPicks(next, q.id, [{ type: 'read', title: 'A again', source: 'S', url: 'https://a.org' }])
    expect(next.questions[0].picks?.map((pick) => pick.title)).toEqual(['A', 'B'])
    next = withPicks(next, q.id, [{ type: 'watch', title: 'C', source: 'Y', url: 'https://c.org' }], true)
    expect(next.questions[0].picks?.map((pick) => pick.title)).toEqual(['B', 'C'])
  })
})

describe('exploring in the background', () => {
  it('asks for the answer, then the reading list on its ticket; saves each, books last, never twice at once', async () => {
    let subject: Subject = subjectFromDraft(draft)
    const path = { id: 'p', title: 'Gardening', description: '', bookIds: [], createdAt: '', subject } as LearningPath
    const edit = vi.fn((_id: string, change: (s: Subject) => Subject) => {
      subject = change(subject)
    })
    const q = subject.questions[0]
    const first = exploreInto({ path, question: q, reading: [] }, edit)
    const second = exploreInto({ path, question: q, reading: [] }, edit)
    expect(second).toBe(first)
    expect(isExploring(q.id)).toBe(true)
    await first
    expect(isExploring(q.id)).toBe(false)
    expect(
      vi
        .mocked(exploreQuestion)
        .mock.calls.map((call) => call[0].part)
        .sort(),
    ).toEqual(['answer', 'picks'])
    const picksCall = vi.mocked(exploreQuestion).mock.calls.find((call) => call[0].part === 'picks')!
    expect(picksCall[0]).toMatchObject({ ticket: 't-1' })
    const filled = subject.questions.find((item) => item.id === q.id)!
    expect(filled.short).toBe('Short.')
    expect(filled.doors?.map((door) => door.kind)).toEqual(['deeper'])
    expect(filled.picks?.map((pick) => pick.type)).toEqual(['read', 'book'])
  })
})
