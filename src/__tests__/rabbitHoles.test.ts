import { describe, expect, it } from 'vitest'
import {
  addQuestion,
  cleanDeeperReply,
  deeperFrom,
  deepestOpen,
  emptySubject,
  goDeeper,
  inTreeOrder,
  removeQuestion,
  trailOf,
  type Subject,
} from '../lib/subjects'

function start(): { subject: Subject; top: string } {
  const base: Subject = { ...emptySubject(), areas: [{ id: 'a1', title: 'Soil' }] }
  const added = addQuestion(base, 'a1', 'What makes soil good?', 'start', new Date('2026-10-01T10:00:00Z'))
  return { subject: added.subject, top: added.question!.id }
}

describe('rabbit holes', () => {
  it('adds up to three questions one level down, leaving out ones already there', () => {
    const { subject, top } = start()
    const next = goDeeper(subject, top, [
      'Why does clay hold water?',
      'What do worms do?',
      'What makes soil good?',
      'Is sand bad?',
      'Extra',
    ])
    const under = deeperFrom(next, top)
    expect(under.map((q) => q.text)).toEqual(['Why does clay hold water?', 'What do worms do?'])
    expect(under.every((q) => q.origin === 'deeper' && q.state === 'later' && q.areaId === 'a1')).toBe(true)
    expect(goDeeper(next, top, ['What do worms do?'])).toBe(next)
  })

  it('keeps the trail back up and the deepest open question', () => {
    const { subject, top } = start()
    const one = goDeeper(subject, top, ['Why does clay hold water?'], new Date('2026-10-02T10:00:00Z'))
    const clay = deeperFrom(one, top)[0]
    const two = goDeeper(one, clay.id, ['How small are clay particles?'], new Date('2026-10-03T10:00:00Z'))
    const tiny = deeperFrom(two, clay.id)[0]
    expect(trailOf(two, tiny.id).map((q) => q.text)).toEqual(['What makes soil good?', 'Why does clay hold water?'])
    expect(deepestOpen(two)?.id).toBe(tiny.id)
    expect(inTreeOrder(two.questions).map((item) => item.depth)).toEqual([0, 1, 2])
  })

  it('moves the questions under a removed one up a level', () => {
    const { subject, top } = start()
    const one = goDeeper(subject, top, ['Why does clay hold water?'])
    const clay = deeperFrom(one, top)[0]
    const two = goDeeper(one, clay.id, ['How small are clay particles?'])
    const after = removeQuestion(two, clay.id)
    expect(deeperFrom(after, top).map((q) => q.text)).toEqual(['How small are clay particles?'])
  })

  it('stops at a loop in the trail', () => {
    const { subject, top } = start()
    const looped: Subject = {
      ...subject,
      questions: subject.questions.map((q) => (q.id === top ? { ...q, parentId: top } : q)),
    }
    expect(trailOf(looped, top)).toEqual([])
    expect(inTreeOrder(looped.questions)).toHaveLength(1)
  })

  it('reads Noema’s reply', () => {
    expect(
      cleanDeeperReply({ deeper: ['Why does clay hold water?', 'short', 4, 'What do worms do in soil?'] }),
    ).toEqual(['Why does clay hold water?', 'What do worms do in soil?'])
    expect(cleanDeeperReply(null)).toEqual([])
  })
})
