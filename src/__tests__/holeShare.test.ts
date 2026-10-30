import { describe, expect, it } from 'vitest'
import { holeCode, holeLink, keepSharedHole, MAX_LINK_CODE, readHoleCode, sharedHole } from '../lib/holeShare'
import { packJson } from '../lib/share'
import { startHole, takeDoor, withDoors } from '../lib/rabbitHole'
import type { LearningPath } from '../lib/pathPlan'
import type { Subject } from '../lib/subjects'

function aHole(): LearningPath {
  const path = startHole('why do we dream', {
    kind: 'page',
    title: 'Dream',
    quote: 'A dream is…',
    url: 'https://example.com/dream',
  })!
  let subject = path.subject as Subject
  const first = subject.questions[0]
  subject = {
    ...subject,
    questions: [
      {
        ...first,
        guess: 'To sort the day',
        short: 'Mostly in REM sleep.',
        answer: { text: 'In REM, maybe to sort memories.', pickIds: [], at: '2026-10-30T10:00:00Z' },
        state: 'answered',
        picks: [
          {
            id: 'p1',
            type: 'read',
            title: 'Dream',
            source: 'Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Dream',
            saved: true,
            looked: true,
          },
        ],
      },
    ],
    stuck: [{ text: 'REM matters', at: '2026-10-30T11:00:00Z' }],
  }
  subject = withDoors(subject, first.id, [{ kind: 'deeper', text: 'What happens in REM?' }])
  subject = takeDoor(subject, first.id, { kind: 'deeper', text: 'What happens in REM?' }).subject
  return { ...path, subject, bookIds: ['book-1'] }
}

describe('sharing a rabbit hole', () => {
  it('carries questions, answers, own words, doors and sources, never guesses or what stuck', async () => {
    const shared = sharedHole(aHole())
    const text = JSON.stringify(shared)
    expect(text).toContain('In REM, maybe to sort memories.')
    expect(text).toContain('What happens in REM?')
    expect(text).toContain('en.wikipedia.org')
    expect(text).not.toContain('To sort the day')
    expect(text).not.toContain('REM matters')
    expect(text).not.toContain('book-1')
    expect(text).not.toContain('"saved"')
    const back = await readHoleCode(await holeCode(aHole()))
    expect(back?.title).toBe('why do we dream')
    expect(back?.questions).toHaveLength(2)
    expect(back?.questions[1].parentId).toBe(back?.questions[0].id)
    expect(back?.from?.url).toBe('https://example.com/dream')
  })

  it('puts the hole in the fragment, which never reaches a server', async () => {
    expect(holeLink('https://noesis.proairetos.com', 'z.abc')).toBe('https://noesis.proairetos.com/#hole=z.abc')
  })

  it('fits a long hole into the link, sources first to go', async () => {
    const path = aHole()
    const subject = path.subject as Subject
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...subject.questions[0],
      id: `q-${i}`,
      parentId: undefined,
      text: `Question ${i} ${crypto.randomUUID()}`,
      short: Array.from({ length: 40 }, () => crypto.randomUUID()).join(' '),
      picks: Array.from({ length: 6 }, (_, j) => ({
        id: `p${j}`,
        type: 'read' as const,
        title: crypto.randomUUID(),
        source: 'S',
        url: `https://example.com/${crypto.randomUUID()}`,
      })),
    }))
    const code = await holeCode({ ...path, subject: { ...subject, questions: many } })
    expect(code.length).toBeLessThanOrEqual(MAX_LINK_CODE)
    const back = await readHoleCode(code)
    expect(back?.questions.length).toBeGreaterThan(0)
    expect(back?.questions.every((q) => !q.picks)).toBe(true)
  })

  it('reads only what is well formed', async () => {
    expect(await readHoleCode('nonsense')).toBeNull()
    expect(await readHoleCode(await packJson({ v: 2, title: 'x', questions: [] }))).toBeNull()
    const odd = await readHoleCode(
      await packJson({
        v: 1,
        title: 'Odd',
        questions: [
          {
            id: 'a',
            text: 'Real question',
            askedAt: 'x',
            picks: [{ type: 'read', title: 'Bad link', url: 'javascript:alert(1)' }],
            doors: [{ kind: 'sideways!', text: 'no' }],
          },
          { id: 'b' },
        ],
      }),
    )
    expect(odd?.questions).toHaveLength(1)
    expect(odd?.questions[0].picks?.[0].url).toBeUndefined()
    expect(odd?.questions[0].doors).toEqual([])
  })

  it('keeps a copy with fresh ids, open questions and none of the sharer’s words as the reader’s own', async () => {
    const shared = (await readHoleCode(await holeCode(aHole())))!
    const kept = keepSharedHole(shared)
    const questions = kept.subject!.questions
    expect(questions).toHaveLength(2)
    expect(questions.every((q) => q.state === 'later' && !q.answer && !q.guess)).toBe(true)
    expect(questions[1].parentId).toBe(questions[0].id)
    expect(questions[0].id).not.toBe(shared.questions[0].id)
    expect(questions[0].short).toBe('Mostly in REM sleep.')
    expect(kept.subject!.from?.url).toBe('https://example.com/dream')
  })
})
