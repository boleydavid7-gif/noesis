import { describe, expect, it } from 'vitest'
import { newEvent, toggleDone } from '../lib/calendar'
import { defaultFocusState } from '../lib/focus'
import { gradeCard, newCard } from '../lib/review'
import { applyFocusSync, focusToSync, mergeBundles, mergeTasks, sanitizeBundle, type SyncBundle } from '../lib/syncData'
import type { Tombstones } from '../lib/tombstones'

const bundle = (over: Partial<SyncBundle> = {}): SyncBundle => ({
  events: [],
  cards: [],
  focus: focusToSync(defaultFocusState()),
  ...over,
})
const none: Tombstones = {}
const at = (iso: string) => ({ at: iso, deleted: true })

describe('mergeBundles', () => {
  it('combines items that exist on only one device', () => {
    const a = newEvent({ title: 'Biology', date: '2026-10-05' })
    const b = newEvent({ title: 'Chemistry', date: '2026-10-06' })
    const merged = mergeBundles(bundle({ events: [a] }), bundle({ events: [b] }), none)
    expect(merged.events.map((event) => event.title).sort()).toEqual(['Biology', 'Chemistry'])
  })

  it('keeps the newer edit of the same event', () => {
    const old = { ...newEvent({ title: 'Quiz', date: '2026-10-05' }), id: 'e1', updated: '2026-10-01T00:00:00.000Z' }
    const edited = { ...old, title: 'Quiz moved', updated: '2026-10-02T00:00:00.000Z' }
    expect(mergeBundles(bundle({ events: [old] }), bundle({ events: [edited] }), none).events[0].title).toBe(
      'Quiz moved',
    )
    expect(mergeBundles(bundle({ events: [edited] }), bundle({ events: [old] }), none).events[0].title).toBe(
      'Quiz moved',
    )
  })

  it('does not bring back an event deleted on another device', () => {
    const event = { ...newEvent({ title: 'Gone', date: '2026-10-05' }), id: 'e2' }
    const merged = mergeBundles(bundle({ events: [event] }), bundle(), { 'event:e2': at('2026-10-03T00:00:00.000Z') })
    expect(merged.events).toEqual([])
  })

  it('carries a checked-off day to the other device when it is newer', () => {
    const base = {
      ...newEvent({ title: 'Lecture', date: '2026-10-05', repeat: 'weekly' }),
      id: 'e3',
      updated: '2026-10-01T00:00:00.000Z',
    }
    const checked = { ...toggleDone(base, '2026-10-12'), updated: '2026-10-12T09:00:00.000Z' }
    const merged = mergeBundles(bundle({ events: [base] }), bundle({ events: [checked] }), none)
    expect(merged.events[0].doneDates).toEqual(['2026-10-12'])
  })

  it('merges review cards by latest grade and respects deleted cards', () => {
    const card = { ...newCard({ question: 'Q', answer: 'A' }, { source: 's' }), id: 'c1' }
    const graded = { ...gradeCard(card, 'good', new Date('2099-01-01T00:00:00.000Z')), id: 'c1' }
    const merged = mergeBundles(bundle({ cards: [card] }), bundle({ cards: [graded] }), none)
    expect(merged.cards[0].reps).toBe(1)
    expect(
      mergeBundles(bundle({ cards: [card] }), bundle(), { 'card:c1': at('2026-10-03T00:00:00.000Z') }).cards,
    ).toEqual([])
  })

  it('keeps focus step order and adds new steps from the other device', () => {
    const local = defaultFocusState().tasks
    const remote = [...local, { id: 'phone-1', label: 'Read ch. 3', done: false, updated: '2026-10-02T00:00:00.000Z' }]
    const merged = mergeTasks(local, remote)
    expect(merged.map((task) => task.id)).toEqual([...local.map((task) => task.id), 'phone-1'])
  })

  it('does not duplicate the starter steps across devices', () => {
    const merged = mergeBundles(bundle(), bundle(), none)
    expect(merged.focus.tasks).toHaveLength(4)
  })

  it('takes a focus step edit and honours a deleted step', () => {
    const local = defaultFocusState()
    const remoteTasks = local.tasks.map((task, index) =>
      index === 0 ? { ...task, done: true, updated: '2026-10-05T00:00:00.000Z' } : task,
    )
    const merged = mergeBundles(bundle(), bundle({ focus: { ...focusToSync(local), tasks: remoteTasks } }), {
      'focus:starter-ideas': at('2026-10-04T00:00:00.000Z'),
    })
    expect(merged.focus.tasks[0].done).toBe(true)
    expect(merged.focus.tasks.find((task) => task.id === 'starter-ideas')).toBeUndefined()
  })

  it('uses the focus title, session and length from the device that changed them last', () => {
    const older = { ...focusToSync(defaultFocusState()), title: 'Old', metaUpdated: '2026-10-01T00:00:00.000Z' }
    const newerMeta = {
      ...focusToSync(defaultFocusState()),
      title: 'New',
      session: 'Studying',
      durationMinutes: 45,
      metaUpdated: '2026-10-02T00:00:00.000Z',
    }
    const merged = mergeBundles(bundle({ focus: older }), bundle({ focus: newerMeta }), none)
    expect(merged.focus).toMatchObject({ title: 'New', session: 'Studying', durationMinutes: 45 })
  })

  it('returns local data unchanged when there is nothing remote', () => {
    const event = newEvent({ title: 'Solo', date: '2026-10-05' })
    expect(mergeBundles(bundle({ events: [event] }), undefined, none).events).toEqual([event])
  })
})

describe('focus sync application', () => {
  it('leaves the running timer alone', () => {
    const local = { ...defaultFocusState(), running: true, startedAt: 123, elapsedSeconds: 40 }
    const next = applyFocusSync(local, { ...focusToSync(local), title: 'Synced title' })
    expect(next.title).toBe('Synced title')
    expect(next.running).toBe(true)
    expect(next.startedAt).toBe(123)
    expect(next.elapsedSeconds).toBe(40)
  })

  it('returns the same object when nothing changed', () => {
    const local = defaultFocusState()
    expect(applyFocusSync(local, focusToSync(local))).toBe(local)
  })
})

describe('sanitizeBundle', () => {
  it('accepts a missing or malformed bundle', () => {
    expect(sanitizeBundle(undefined)).toBeUndefined()
    expect(sanitizeBundle('x')).toBeUndefined()
    const cleaned = sanitizeBundle({ events: 'nope', cards: [{ id: 1 }], focus: { tasks: 'nope' } })
    expect(cleaned?.events).toEqual([])
    expect(cleaned?.cards).toEqual([])
    expect(cleaned?.focus.tasks).toEqual([])
    expect(cleaned?.focus.title).toBe('Today’s focus')
  })
})

describe('sameItems', () => {
  it('ignores order but notices changes', async () => {
    const { sameItems } = await import('../lib/syncData')
    const a = { id: 'a', v: 1 }
    const b = { id: 'b', v: 1 }
    expect(sameItems([a, b], [b, a])).toBe(true)
    expect(sameItems([a], [a, b])).toBe(false)
    expect(sameItems([a, b], [a, { ...b, v: 2 }])).toBe(false)
    expect(sameItems([], [])).toBe(true)
  })
})
