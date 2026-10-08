import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake Supabase account store shared by both "devices".
const files = new Map<string, string>()
vi.mock('../lib/auth', () => ({
  isAnonymousUser: () => false,
  getAuthClient: () => ({
    auth: {
      getSession: async () => ({ error: null, data: { session: { user: { id: 'user-1', is_anonymous: false } } } }),
    },
    storage: {
      from: () => ({
        download: async (path: string) =>
          files.has(path)
            ? { error: null, data: new Blob([files.get(path) as string]) }
            : { error: { statusCode: '404', message: 'Object not found' }, data: null },
        upload: async (path: string, blob: Blob) => {
          files.set(path, await blob.text())
          return { error: null }
        },
      }),
    },
  }),
}))

import { syncAccountBundle } from '../lib/accountLibrary'
import { newEvent, toggleDone } from '../lib/calendar'
import { defaultFocusState, addFocusTask, removeFocusTask } from '../lib/focus'
import { newCard } from '../lib/review'
import { focusToSync, type SyncBundle } from '../lib/syncData'
import { markRemoved } from '../lib/tombstones'

// Each device has its own browser storage (tombstones live there).
function useDevice(storage: Map<string, string>) {
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  }
}
const empty = (): SyncBundle => ({ events: [], cards: [], focus: focusToSync(defaultFocusState()) })

let laptop: Map<string, string>
let phone: Map<string, string>
beforeEach(() => {
  files.clear()
  laptop = new Map()
  phone = new Map()
})

describe('account sync between two devices', () => {
  it('shows a calendar event, review card and focus step created on another device', async () => {
    useDevice(laptop)
    const event = newEvent({ title: 'Biology midterm', date: '2026-10-20', kind: 'exam' })
    const card = newCard({ question: 'What is ATP?', answer: 'Energy currency.' }, { source: 'notes' })
    const focus = addFocusTask(defaultFocusState(), 'Read chapter 5')
    await syncAccountBundle({ events: [event], cards: [card], focus: focusToSync(focus) })

    useDevice(phone)
    const onPhone = await syncAccountBundle(empty())
    expect(onPhone.events.map((item) => item.title)).toEqual(['Biology midterm'])
    expect(onPhone.cards.map((item) => item.question)).toEqual(['What is ATP?'])
    expect(onPhone.focus.tasks.map((item) => item.label)).toContain('Read chapter 5')
    expect(onPhone.focus.tasks).toHaveLength(5) // four starter steps + the new one, no duplicates
  })

  it('removes an event on every device after it is deleted on one', async () => {
    useDevice(laptop)
    const event = newEvent({ title: 'Cancelled lab', date: '2026-10-21' })
    const first = await syncAccountBundle({ ...empty(), events: [event] })

    useDevice(phone)
    const onPhone = await syncAccountBundle(empty())
    expect(onPhone.events).toHaveLength(1)
    markRemoved('event', onPhone.events, [])
    await syncAccountBundle({ ...onPhone, events: [] })

    useDevice(laptop)
    const afterDelete = await syncAccountBundle(first)
    expect(afterDelete.events).toEqual([])
  })

  it('keeps the most recent edit when both devices changed the same event', async () => {
    useDevice(laptop)
    const original = {
      ...newEvent({ title: 'Quiz', date: '2026-10-22' }),
      id: 'shared',
      updated: '2026-10-01T00:00:00.000Z',
    }
    await syncAccountBundle({ ...empty(), events: [original] })

    useDevice(phone)
    await syncAccountBundle(empty())
    const phoneEdit = { ...original, title: 'Quiz (moved to Friday)', updated: '2026-10-03T00:00:00.000Z' }
    await syncAccountBundle({ ...empty(), events: [phoneEdit] })

    useDevice(laptop)
    const laptopEdit = { ...original, title: 'Quiz at 9am', updated: '2026-10-02T00:00:00.000Z' }
    const merged = await syncAccountBundle({ ...empty(), events: [laptopEdit] })
    expect(merged.events[0].title).toBe('Quiz (moved to Friday)')
  })

  it('syncs a checked-off repeating class and a removed focus step', async () => {
    useDevice(laptop)
    const lecture = {
      ...newEvent({ title: 'Lecture', date: '2026-10-05', repeat: 'weekly' }),
      id: 'lec',
      updated: '2026-10-01T00:00:00.000Z',
    }
    const focusBefore = defaultFocusState()
    await syncAccountBundle({ ...empty(), events: [lecture] })

    useDevice(phone)
    const seen = await syncAccountBundle(empty())
    const checked = toggleDone(seen.events[0], '2026-10-12')
    const trimmed = removeFocusTask(focusBefore, 1)
    markRemoved('focus', focusBefore.tasks, trimmed.tasks)
    await syncAccountBundle({ ...seen, events: [checked], focus: focusToSync(trimmed) })

    useDevice(laptop)
    const merged = await syncAccountBundle({ ...empty(), events: [lecture], focus: focusToSync(focusBefore) })
    expect(merged.events[0].doneDates).toEqual(['2026-10-12'])
    expect(merged.focus.tasks.map((task) => task.id)).not.toContain('starter-ideas')
  })
})
