import { describe, expect, it } from 'vitest'
import { dueCards, gradeCard, newCard } from '../lib/review'

const now = new Date('2026-10-01T12:00:00.000Z')
const fresh = () => newCard({ question: 'Q?', answer: 'A.' }, { source: 'passage' }, now)
const days = (card: { dueAt: string }) => (Date.parse(card.dueAt) - now.getTime()) / 86_400_000

describe('review scheduling', () => {
  it('makes a new card due immediately', () => {
    expect(dueCards([fresh()], now)).toHaveLength(1)
  })

  it('grows the interval on repeated good answers', () => {
    const first = gradeCard(fresh(), 'good', now)
    expect(first.intervalDays).toBe(1)
    const second = gradeCard(first, 'good', now)
    expect(second.intervalDays).toBe(3)
    const third = gradeCard(second, 'good', now)
    expect(third.intervalDays).toBe(Math.round(3 * second.ease))
    expect(days(third)).toBeGreaterThan(days(second))
  })

  it('resets and re-queues a lapsed card within minutes', () => {
    const learned = gradeCard(gradeCard(fresh(), 'good', now), 'good', now)
    const lapsed = gradeCard(learned, 'again', now)
    expect(lapsed.reps).toBe(0)
    expect(lapsed.lapses).toBe(1)
    expect(lapsed.ease).toBeLessThan(learned.ease)
    expect(days(lapsed)).toBeLessThan(0.01)
  })

  it('never lets ease fall below the floor', () => {
    let card = fresh()
    for (let i = 0; i < 20; i += 1) card = gradeCard(card, 'again', now)
    expect(card.ease).toBeGreaterThanOrEqual(1.3)
  })

  it('schedules easy further out than good', () => {
    expect(gradeCard(fresh(), 'easy', now).intervalDays).toBeGreaterThan(gradeCard(fresh(), 'good', now).intervalDays)
  })

  it('only returns cards that are due, oldest first', () => {
    const later = { ...fresh(), id: 'later', dueAt: '2026-11-01T00:00:00.000Z' }
    const earlier = { ...fresh(), id: 'earlier', dueAt: '2026-09-01T00:00:00.000Z' }
    const recent = { ...fresh(), id: 'recent', dueAt: '2026-10-01T00:00:00.000Z' }
    expect(dueCards([later, recent, earlier], now).map((card) => card.id)).toEqual(['earlier', 'recent'])
  })
})
