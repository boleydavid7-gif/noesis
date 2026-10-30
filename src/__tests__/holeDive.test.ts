import { describe, expect, it } from 'vitest'
import {
  cleanDoors,
  climbOut,
  connectedHoles,
  firstQuestion,
  foundIn,
  holeMap,
  holeMarkdown,
  lastOpen,
  markRecalled,
  markVisited,
  openDoors,
  recallDue,
  recallPassage,
  sinceSurfaced,
  startHole,
  sumItUp,
  takeDoor,
  withDoors,
  withGround,
} from '../lib/rabbitHole'
import { answerQuestion, subjectOf, type Subject } from '../lib/subjects'
import { stepTicket, ticketHolds } from '../worker'

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12))

function hole(words = 'why do we dream') {
  const path = startHole(words, undefined, day(1))!
  return { path, subject: path.subject as Subject, first: firstQuestion(path.subject!)! }
}

describe('falling in', () => {
  it('starts with one question, adding a question mark when the words ask', () => {
    const { path, subject, first } = hole()
    expect(first.text).toBe('why do we dream?')
    expect(subject.questions).toHaveLength(1)
    expect(path.title).toBe('why do we dream')
    expect(startHole(' ')).toBeNull()
  })
  it('keeps the passage it began with, and asks about it when no words are given', () => {
    const path = startHole('', {
      kind: 'book',
      title: 'Meditations',
      quote: 'The impediment to action advances action.',
      bookId: 'b1',
    })!
    expect(path.subject!.from?.title).toBe('Meditations')
    expect(path.bookIds).toEqual(['b1'])
    expect(firstQuestion(path.subject!)!.text).toMatch(/^What is behind “The impediment/)
  })
})

describe('doors', () => {
  it('reads three kinds and leaves out short or repeated ones', () => {
    const doors = cleanDoors({
      deeper: { text: 'What happens in REM sleep?', hook: 'The busiest hour' },
      sideways: 'Do animals dream too?',
      curiouser: { text: 'Do animals dream too?' },
    })
    expect(doors.map((door) => door.kind)).toEqual(['deeper', 'side'])
    expect(cleanDoors({ deeper: 'Why?' })).toEqual([])
  })
  it('going through a door adds the question under this one; the same door opens what is there', () => {
    const { subject, first } = hole()
    const withThem = withDoors(
      subject,
      first.id,
      cleanDoors({ deeper: 'What happens in REM sleep?', sideways: 'Do animals dream too?' }),
    )
    const went = takeDoor(withThem, first.id, withThem.questions[0].doors![0])
    expect(went.question).toMatchObject({ parentId: first.id, origin: 'deeper' })
    expect(openDoors(went.subject, first.id).map((door) => door.kind)).toEqual(['side'])
    const again = takeDoor(went.subject, first.id, { kind: 'own', text: 'what happens in rem sleep?' })
    expect(again.question?.id).toBe(went.question?.id)
    expect(again.subject.questions).toHaveLength(2)
  })
})

describe('the map', () => {
  it('outlines the tree, with open doors of visited questions as faint rows', () => {
    const { subject, first } = hole()
    let next = markVisited(
      withDoors(
        subject,
        first.id,
        cleanDoors({ deeper: 'What happens in REM sleep?', curiouser: 'Did dreams shape early religion?' }),
      ),
      first.id,
      day(2),
    )
    next = takeDoor(next, first.id, next.questions[0].doors![0]).subject
    const rows = holeMap(next)[0].rows
    expect(rows.map((row) => row.kind)).toEqual(['question', 'question', 'door'])
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 1])
    expect(lastOpen(next)?.id).toBe(first.id)
  })
  it('Map the ground adds groups of questions without moving the ones asked', () => {
    const { subject, first } = hole()
    const grounded = withGround(subject, {
      title: '',
      summary: '',
      areas: [
        { title: 'Sleep stages', questions: [{ text: 'What is REM?' }] },
        { title: 'Meaning', questions: [{ text: 'why do we dream?' }, { text: 'Did Freud get it right?' }] },
      ],
    })
    expect(grounded.grounded).toBe(true)
    expect(grounded.questions).toHaveLength(3)
    expect(grounded.questions.find((q) => q.id === first.id)!.areaId).toBe(first.areaId)
    expect(holeMap(grounded).map((group) => group.area?.title)).toEqual([
      subject.areas[0].title,
      'Sleep stages',
      'Meaning',
    ])
  })
})

describe('climbing out and coming back', () => {
  it('keeps what stuck, and the dive starts afresh after', () => {
    const { subject, first } = hole()
    let next = markVisited(subject, first.id, day(2))
    next = answerQuestion(next, first.id, 'Sorting the day, mostly.', [], day(2))
    expect(sinceSurfaced(next)).toHaveLength(1)
    expect(recallPassage(next)).toContain('Sorting the day')
    next = climbOut(next, 'Dreams sort memories.', day(2))
    expect(next.stuck?.map((line) => line.text)).toEqual(['Dreams sort memories.'])
    expect(sinceSurfaced(next)).toHaveLength(0)
  })
  it('asks one explained question after two days away, and not again once recalled', () => {
    const { subject, first } = hole()
    let next = answerQuestion(markVisited(subject, first.id, day(2)), first.id, 'Sorting the day.', [], day(2))
    expect(recallDue(next, day(3))).toBeNull()
    expect(recallDue(next, day(5))?.id).toBe(first.id)
    next = markRecalled(next, first.id, day(5))
    expect(recallDue(next, day(5))).toBeNull()
  })
})

describe('what you found', () => {
  it('gathers own words and saved picks in order, sums up and exports', () => {
    const { path, subject, first } = hole()
    let next: Subject = {
      ...subject,
      questions: subject.questions.map((q) => ({
        ...q,
        guess: 'Memory',
        picks: [
          {
            id: 'p',
            type: 'read' as const,
            title: 'Dream',
            source: 'Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Dream',
            saved: true,
          },
        ],
      })),
    }
    next = answerQuestion(next, first.id, 'To sort the day.', [], day(2))
    next = sumItUp(climbOut(next, 'Sleep tidies.', day(2)), 'I think dreams tidy memory.', day(2))
    expect(foundIn(next)).toHaveLength(1)
    const text = holeMarkdown(path, next)
    expect(text).toContain('# why do we dream')
    expect(text).toContain('*My guess:* Memory')
    expect(text).toContain('[Dream](https://en.wikipedia.org/wiki/Dream)')
    expect(text).toContain('- Sleep tidies.')
  })
  it('finds another hole with a question sharing two meaningful words', () => {
    const a = hole('Why do we dream at night')
    const b = hole('What happens to memory during dream sleep at night')
    const links = connectedHoles([a.path, b.path], a.path.id, a.first, subjectOf)
    expect(links.map((link) => link.path.id)).toEqual([b.path.id])
  })
})

describe('step tickets', () => {
  const env = { SUPABASE_SERVICE_ROLE_KEY: 'secret' } as never
  it('hold for the same question within fifteen minutes', async () => {
    const now = Date.UTC(2026, 9, 30, 12)
    const ticket = await stepTicket(env, 'Why do we dream?', now)
    expect(await ticketHolds(env, ticket, 'why do we dream?', now + 60_000)).toBe(true)
    expect(await ticketHolds(env, ticket, 'Another question?', now)).toBe(false)
    expect(await ticketHolds(env, ticket, 'Why do we dream?', now + 16 * 60_000)).toBe(false)
    expect(await ticketHolds(env, 'nope', 'Why do we dream?', now)).toBe(false)
  })
  it('are not made without the server secret', async () => {
    expect(await stepTicket({} as never, 'Q?')).toBeUndefined()
  })
})

describe('the map shows a door once', () => {
  it('when two questions offer the same one', () => {
    const { subject, first } = hole()
    const door = { deeper: 'What happens in the brain during REM sleep?' }
    let next = markVisited(
      withDoors(subject, first.id, cleanDoors({ ...door, sideways: 'Do animals dream?' })),
      first.id,
      day(2),
    )
    const went = takeDoor(next, first.id, next.questions[0].doors![1])
    next = markVisited(withDoors(went.subject, went.question!.id, cleanDoors(door)), went.question!.id, day(2))
    expect(holeMap(next)[0].rows.filter((row) => row.kind === 'door')).toHaveLength(1)
  })
})
