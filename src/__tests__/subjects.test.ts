import { describe, expect, it } from 'vitest'
import { copyLine } from '../lib/publicLibrary'
import type { PathPlan } from '../lib/pathPlan'
import {
  NOW_LIMIT,
  addQuestion,
  answerQuestion,
  areaState,
  canSumUp,
  cleanQuestionReply,
  cleanSubjectReply,
  comingBack,
  groupPicks,
  isoMinutes,
  minutesText,
  moveQuestion,
  nowQuestions,
  removeArea,
  shelf,
  subjectFromDraft,
  subjectFromPlan,
  updatePick,
  youtubeId,
  subjectFor,
  booksForNow,
  type Subject,
} from '../lib/subjects'

const draft = cleanSubjectReply({
  title: 'Vegetable gardening',
  summary: 'Growing food in a small space.',
  areas: [
    {
      title: 'Soil',
      blurb: 'What plants grow in',
      questions: [{ text: 'What makes soil good?', hook: 'Most of it is alive' }, 'How do I test my soil?'],
    },
    { title: 'Water', questions: ['How often should tomatoes be watered?'] },
    { title: 'Pests', questions: ['Which insects help a garden?'] },
    { title: 'Seasons', questions: ['When do I plant garlic?'] },
    { title: 'Empty', questions: [] },
  ],
})!

describe('a new subject', () => {
  it('keeps areas with questions and drops empty ones', () => {
    expect(draft.areas.map((area) => area.title)).toEqual(['Soil', 'Water', 'Pests', 'Seasons'])
    expect(draft.areas[0].questions[0]).toEqual({ text: 'What makes soil good?', hook: 'Most of it is alive' })
  })
  it('refuses a map with fewer than two areas', () => {
    expect(cleanSubjectReply({ areas: [{ title: 'One', questions: ['Q?'] }] })).toBeNull()
  })
  it('starts with the first question of each of the first three areas in Now', () => {
    const subject = subjectFromDraft(draft)
    expect(nowQuestions(subject).map((q) => q.text)).toEqual([
      'What makes soil good?',
      'How often should tomatoes be watered?',
      'Which insects help a garden?',
    ])
    expect(subject.questions.find((q) => q.text === 'When do I plant garlic?')?.state).toBe('later')
  })
})

describe('moving and answering', () => {
  const subject = subjectFromDraft(draft)
  const later = subject.questions.find((q) => q.state === 'later')!
  it(`holds at most ${NOW_LIMIT} in Now`, () => {
    const moved = moveQuestion(subject, later.id, 'now')
    expect(moved.full).toBe(true)
    expect(moved.subject).toBe(subject)
  })
  it('an answer moves the question out of Now and makes room', () => {
    const first = nowQuestions(subject)[0]
    const answered = answerQuestion(subject, first.id, '  Loose, dark, full of life. ', ['p1'], new Date('2026-10-01'))
    const q = answered.questions.find((item) => item.id === first.id)!
    expect(q.state).toBe('answered')
    expect(q.answer).toEqual({ text: 'Loose, dark, full of life.', pickIds: ['p1'], at: '2026-10-01T00:00:00.000Z' })
    expect(moveQuestion(answered, later.id, 'now').full).toBe(false)
    expect(areaState(answered, first.areaId)).toBe('exploring')
  })
  it('an empty answer changes nothing', () => {
    expect(answerQuestion(subject, nowQuestions(subject)[0].id, '   ', [])).toBe(subject)
  })
  it('side questions wait in Later, and the same question is not added twice', () => {
    const area = subject.areas[0].id
    const added = addQuestion(subject, area, 'Is peat bad for the planet?', 'side')
    expect(added.question?.state).toBe('later')
    const again = addQuestion(added.subject, area, 'is peat bad for the planet?')
    expect(again.subject.questions.length).toBe(added.subject.questions.length)
  })
  it('removing an area keeps its questions in another area', () => {
    const gone = removeArea(subject, subject.areas[0].id)
    expect(gone.areas.length).toBe(subject.areas.length - 1)
    expect(gone.questions.length).toBe(subject.questions.length)
    expect(gone.questions.every((q) => gone.areas.some((area) => area.id === q.areaId))).toBe(true)
  })
})

describe('summing up and coming back', () => {
  function withAnswers(count: number, at: string): Subject {
    let subject = subjectFromDraft(draft)
    const area = subject.areas[0].id
    for (let i = 0; i < count; i += 1) {
      const added = addQuestion(subject, area, `Question ${i}?`)
      subject = answerQuestion(added.subject, added.question!.id, `Answer ${i}`, [], new Date(at))
    }
    return subject
  }
  it('offers a summary after five answers in an area', () => {
    expect(canSumUp(withAnswers(4, '2026-10-01'), withAnswers(4, '2026-10-01').areas[0].id)).toBe(false)
    const five = withAnswers(5, '2026-10-01')
    expect(canSumUp(five, five.areas[0].id)).toBe(true)
  })
  it('brings back an answer from two weeks ago, not a recent one', () => {
    const old = withAnswers(1, '2026-09-01')
    expect(comingBack(old, new Date('2026-09-10'))).toBeNull()
    expect(comingBack(old, new Date('2026-09-20'))?.answer?.text).toBe('Answer 0')
  })
})

describe('picks', () => {
  it('reads the model reply, books first, and drops unsafe links', () => {
    const reply = cleanQuestionReply({
      hook: 'Most soil life is invisible',
      short: 'Good soil is loose and alive.',
      followUp: 'How do worms help?',
      read: [
        { title: 'Soil basics', source: 'RHS', url: 'https://www.rhs.org.uk/soil', minutes: 6, why: 'Plain overview' },
      ],
      watch: [{ title: 'Bad', url: 'http://localhost/x', search: 'soil structure explained' }],
      listen: [{ search: 'soil health podcast' }],
      books: [{ title: 'Teaming with Microbes', author: 'Jeff Lowenfels' }],
    })
    expect(reply.picks.map((pick) => pick.type)).toEqual(['book', 'read', 'watch', 'listen'])
    expect(reply.picks[2].url).toBeUndefined()
    expect(reply.picks[3].title).toBe('soil health podcast')
    expect(reply.followUp).toBe('How do worms help?')
  })
  it('groups in a fixed order with Books first', () => {
    const groups = groupPicks([
      { id: '1', type: 'watch', title: 'V', source: 'YouTube' },
      { id: '2', type: 'book', title: 'B', source: 'A' },
      { id: '3', type: 'read', title: 'R', source: 'S' },
    ])
    expect(groups.map((group) => group.label)).toEqual(['Books', 'Read', 'Watch'])
  })
  it('lists saved picks by kind with their question', () => {
    let subject = subjectFromDraft(draft)
    const q = subject.questions[0]
    subject = {
      ...subject,
      questions: subject.questions.map((item) =>
        item.id === q.id
          ? { ...item, picks: [{ id: 'a', type: 'listen' as const, title: 'Ep', source: 'Show' }] }
          : item,
      ),
    }
    expect(shelf(subject)).toEqual([])
    subject = updatePick(subject, q.id, 'a', { saved: true })
    expect(shelf(subject)[0].label).toBe('Listen')
    expect(shelf(subject)[0].items[0].question.id).toBe(q.id)
  })
  it('says lengths plainly', () => {
    expect(minutesText({ id: 'x', type: 'read', title: '', source: '', minutes: 6 })).toBe('6 min read')
    expect(minutesText({ id: 'x', type: 'watch', title: '', source: '', minutes: 75 })).toBe('1 h 15 min')
    expect(isoMinutes('PT12M30S')).toBe(13)
    expect(isoMinutes('PT1H')).toBe(60)
    expect(isoMinutes('nonsense')).toBeUndefined()
  })
  it('knows YouTube addresses', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=abc123XYZ')).toBe('abc123XYZ')
    expect(youtubeId('https://youtu.be/abc123XYZ')).toBe('abc123XYZ')
    expect(youtubeId('https://example.com/watch?v=abc')).toBeNull()
  })
})

describe('older paths', () => {
  const plan: PathPlan = {
    goal: 'Networking',
    summary: '',
    weeks: '6 weeks',
    level: 'Beginner',
    milestones: [
      {
        id: 'm1',
        title: 'Basics',
        outcome: 'Explain a network',
        resourceTitles: ['Intro video'],
        bookTitles: ['Networking 101'],
        topics: [
          { id: 't1', label: 'What a network is', done: true },
          { id: 't2', label: 'IP addresses', done: false },
        ],
      },
      { id: 'm2', title: 'Protocols', topics: [{ id: 't3', label: 'TCP and UDP', done: false }] },
    ],
    books: [{ title: 'Networking 101', authors: ['A. Writer'], buy: [] }],
    resources: [{ title: 'Intro video', publisher: 'Uni', url: 'https://uni.edu/v', kind: 'Video series' }],
  }
  it('turns stages into areas and topics into questions, keeping what was done', () => {
    const subject = subjectFromPlan(plan)
    expect(subject.areas.map((area) => area.title)).toEqual(['Basics', 'Protocols'])
    expect(subject.questions.map((q) => q.state)).toEqual(['answered', 'now', 'now'])
    const first = subject.questions[0]
    expect(first.picks?.map((pick) => pick.type)).toEqual(['watch', 'book'])
    expect(subjectFromPlan(plan).questions[0].picks?.[0].id).toBe(first.picks?.[0].id)
  })
})

describe('library lines', () => {
  it('says what is there in plain words', () => {
    expect(copyLine({ format: 'print', available: true, url: 'x' })).toBe('On the shelf: in now')
    expect(copyLine({ format: 'print', available: false, held: 2, url: 'x' })).toBe('On the shelf: all out · 2 waiting')
    expect(copyLine({ format: 'ebook', available: false, waitDays: 53, url: 'x' })).toBe(
      'E-book in Libby: wait about 8 weeks',
    )
    expect(copyLine({ format: 'audiobook', available: true, url: 'x' })).toBe('Audiobook in Libby: available now')
  })
})

describe('while reading', () => {
  const subject = subjectFromDraft(draft)
  const first = nowQuestions(subject)[0]
  const withBook: Subject = {
    ...subject,
    questions: subject.questions.map((q) =>
      q.id === first.id
        ? {
            ...q,
            picks: [
              { id: 'b', type: 'book' as const, title: 'Teaming with Microbes: The Organic Gardener', source: 'J' },
            ],
          }
        : q,
    ),
  }
  const path = {
    id: 'p',
    title: 'Gardening',
    description: '',
    bookIds: ['lib-2'],
    createdAt: '2026-10-01',
    subject: withBook,
  }
  it('finds the subject for a book a question suggested, with that question first', () => {
    const found = subjectFor({ id: 'lib-1', title: 'Teaming with Microbes' }, [path])
    expect(found?.questions[0].id).toBe(first.id)
    expect(found?.questions.length).toBe(3)
  })
  it('finds it for a book added to the subject, and not for others', () => {
    expect(subjectFor({ id: 'lib-2', title: 'Anything' }, [path])?.path.id).toBe('p')
    expect(subjectFor({ id: 'lib-3', title: 'Unrelated' }, [path])).toBeNull()
  })
  it('lists books for questions in Now once each', () => {
    expect(booksForNow([path, { ...path, id: 'p2' }]).map((row) => row.pick.id)).toEqual(['b'])
  })
})
