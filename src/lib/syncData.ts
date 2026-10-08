// Calendar events, focus steps and review cards travel together as one bundle
// through the account and cloud-provider manifests. Each item carries an
// `updated` time, so when two devices edit the same item the newer edit wins,
// and tombstones keep a deletion on one device from being undone by another.
import type { CalendarEvent } from './calendar'
import { sanitizeEvents } from './calendar'
import { sanitizeTasks, type FocusState, type FocusTask } from './focus'
import { mergeById } from './merge'
import type { ReviewCard } from './review'
import { applyTombstones, type Tombstones } from './tombstones'

export type FocusSync = {
  title: string
  session: string
  durationMinutes: number
  metaUpdated?: string
  tasks: FocusTask[]
}
export type SyncBundle = { events: CalendarEvent[]; cards: ReviewCard[]; focus: FocusSync }

export function focusToSync(state: FocusState): FocusSync {
  return {
    title: state.title,
    session: state.session,
    durationMinutes: state.durationMinutes,
    metaUpdated: state.metaUpdated,
    tasks: state.tasks,
  }
}

// Applies synced fields to the local focus state without touching the running
// timer, which belongs to this device. Returns the same object when nothing
// changed so callers can skip a re-render.
export function applyFocusSync(state: FocusState, sync: FocusSync): FocusState {
  if (JSON.stringify(focusToSync(state)) === JSON.stringify(sync)) return state
  return {
    ...state,
    title: sync.title,
    session: sync.session,
    durationMinutes: sync.durationMinutes,
    metaUpdated: sync.metaUpdated,
    tasks: sync.tasks,
  }
}

// A missing or unreadable time counts as the oldest possible, so any real edit beats it.
const time = (value?: string) => (value && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : 0)
const later = (a?: string, b?: string) => time(b) > time(a)

// Keeps this device's order, replaces a step when the other copy is newer, and
// adds steps that only exist on the other device at the end.
export function mergeTasks(local: FocusTask[], remote: FocusTask[]): FocusTask[] {
  const remoteById = new Map(remote.map((task) => [task.id, task]))
  const localIds = new Set(local.map((task) => task.id))
  const merged = local.map((task) => {
    const other = remoteById.get(task.id)
    return other && later(task.updated, other.updated) ? other : task
  })
  return [...merged, ...remote.filter((task) => !localIds.has(task.id))]
}

export function mergeBundles(local: SyncBundle, remote: SyncBundle | undefined, tombstones: Tombstones): SyncBundle {
  const events = remote ? mergeById(local.events, remote.events) : local.events
  const cards = remote ? mergeById(local.cards, remote.cards) : local.cards
  const useRemoteMeta = remote ? later(local.focus.metaUpdated, remote.focus.metaUpdated) : false
  const meta = useRemoteMeta && remote ? remote.focus : local.focus
  const tasks = remote ? mergeTasks(local.focus.tasks, remote.focus.tasks) : local.focus.tasks
  return {
    events: applyTombstones('event', events, tombstones),
    cards: applyTombstones('card', cards, tombstones),
    focus: {
      title: meta.title,
      session: meta.session,
      durationMinutes: meta.durationMinutes,
      metaUpdated: meta.metaUpdated,
      tasks: applyTombstones('focus', tasks, tombstones),
    },
  }
}

function sanitizeCards(value: unknown): ReviewCard[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ReviewCard => {
    const card = item as Partial<ReviewCard> | null
    return (
      !!card &&
      typeof card.id === 'string' &&
      typeof card.question === 'string' &&
      typeof card.answer === 'string' &&
      typeof card.dueAt === 'string' &&
      typeof card.createdAt === 'string' &&
      typeof card.intervalDays === 'number' &&
      typeof card.ease === 'number' &&
      typeof card.reps === 'number' &&
      typeof card.lapses === 'number'
    )
  })
}

// Accepts whatever a manifest holds (including nothing, or an older shape) and
// returns a valid bundle, or undefined when there is none.
export function sanitizeBundle(value: unknown): SyncBundle | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as { events?: unknown; cards?: unknown; focus?: unknown }
  const focus = (row.focus ?? {}) as Partial<FocusSync>
  return {
    events: sanitizeEvents(row.events),
    cards: sanitizeCards(row.cards),
    focus: {
      title: typeof focus.title === 'string' && focus.title.trim() ? focus.title : 'Today’s focus',
      session: typeof focus.session === 'string' && focus.session.trim() ? focus.session : 'Reading',
      durationMinutes:
        typeof focus.durationMinutes === 'number' && focus.durationMinutes >= 1
          ? Math.min(240, Math.round(focus.durationMinutes))
          : 25,
      metaUpdated: typeof focus.metaUpdated === 'string' ? focus.metaUpdated : undefined,
      tasks: sanitizeTasks(focus.tasks),
    },
  }
}

// True when two lists hold the same items, ignoring their order.
export function sameItems(a: Array<{ id: string }>, b: Array<{ id: string }>): boolean {
  if (a.length !== b.length) return false
  const byId = (list: Array<{ id: string }>) => JSON.stringify([...list].sort((x, y) => x.id.localeCompare(y.id)))
  return byId(a) === byId(b)
}
