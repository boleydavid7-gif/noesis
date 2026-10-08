// A small personal calendar. Events can be one-off or repeat (for classes),
// and each occurrence of a repeating event can be checked off on its own.

export type EventKind = 'class' | 'assignment' | 'exam' | 'study' | 'personal' | 'other'
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly'

export const EVENT_KINDS: Array<{ value: EventKind; label: string; color: string }> = [
  { value: 'class', label: 'Class', color: '#5eb0f6' },
  { value: 'assignment', label: 'Assignment due', color: '#e0b86b' },
  { value: 'exam', label: 'Exam', color: '#e57373' },
  { value: 'study', label: 'Study session', color: '#6dbf8f' },
  { value: 'personal', label: 'Personal', color: '#c39be8' },
  { value: 'other', label: 'Other', color: '#9fb3c8' },
]

export const REPEAT_OPTIONS: Array<{ value: Repeat; label: string }> = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
]

export type CalendarEvent = {
  id: string
  title: string
  date: string // YYYY-MM-DD (first day)
  time?: string // HH:MM
  endTime?: string
  kind: EventKind
  course?: string
  notes?: string
  repeat: Repeat
  until?: string // YYYY-MM-DD, last day a repeating event happens
  doneDates: string[]
}

export type Occurrence = { event: CalendarEvent; date: string; done: boolean }

const KEY = 'noesis:calendar:v1'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

export function occursOn(event: CalendarEvent, key: string): boolean {
  if (key < event.date) return false
  if (event.until && key > event.until) return false
  const weekday = parseDateKey(key).getDay()
  switch (event.repeat) {
    case 'none':
      return key === event.date
    case 'daily':
      return true
    case 'weekdays':
      return weekday >= 1 && weekday <= 5
    case 'weekly':
      return weekday === parseDateKey(event.date).getDay()
  }
}

function byTime(a: Occurrence, b: Occurrence): number {
  if (a.event.time && b.event.time)
    return a.event.time.localeCompare(b.event.time) || a.event.title.localeCompare(b.event.title)
  if (a.event.time) return -1
  if (b.event.time) return 1
  return a.event.title.localeCompare(b.event.title)
}

export function eventsOn(events: CalendarEvent[], key: string): Occurrence[] {
  return events
    .filter((event) => occursOn(event, key))
    .map((event) => ({ event, date: key, done: event.doneDates.includes(key) }))
    .sort(byTime)
}

// The next few days that have something on, starting at `fromKey`.
export function upcoming(events: CalendarEvent[], fromKey: string, days = 14, limit = 6): Occurrence[] {
  const found: Occurrence[] = []
  for (let offset = 0; offset < days && found.length < limit; offset += 1) {
    found.push(...eventsOn(events, addDays(fromKey, offset)))
  }
  return found.slice(0, limit)
}

export function monthMarkers(events: CalendarEvent[], year: number, month: number): Record<number, EventKind[]> {
  const markers: Record<number, EventKind[]> = {}
  const days = new Date(year, month + 1, 0).getDate()
  for (let day = 1; day <= days; day += 1) {
    const key = dateKey(new Date(year, month, day))
    const kinds = [...new Set(eventsOn(events, key).map((item) => item.event.kind))]
    if (kinds.length) markers[day] = kinds
  }
  return markers
}

export function toggleDone(event: CalendarEvent, key: string): CalendarEvent {
  return {
    ...event,
    doneDates: event.doneDates.includes(key) ? event.doneDates.filter((day) => day !== key) : [...event.doneDates, key],
  }
}

export function kindInfo(kind: EventKind) {
  return EVENT_KINDS.find((item) => item.value === kind) ?? EVENT_KINDS[EVENT_KINDS.length - 1]
}

export function formatClock(time: string | undefined): string {
  if (!time || !TIME.test(time)) return ''
  const [hours, minutes] = time.split(':').map(Number)
  const suffix = hours >= 12 ? 'PM' : 'AM'
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`
}

export function newEvent(input: Partial<CalendarEvent> & { title: string; date: string }): CalendarEvent {
  return {
    id: `event-${crypto.randomUUID()}`,
    title: input.title.trim().slice(0, 140),
    date: input.date,
    time: input.time && TIME.test(input.time) ? input.time : undefined,
    endTime: input.endTime && TIME.test(input.endTime) ? input.endTime : undefined,
    kind: input.kind ?? 'other',
    course: input.course?.trim() ? input.course.trim().slice(0, 80) : undefined,
    notes: input.notes?.trim() ? input.notes.trim().slice(0, 1000) : undefined,
    repeat: input.repeat ?? 'none',
    until: input.until && DATE.test(input.until) ? input.until : undefined,
    doneDates: input.doneDates ?? [],
  }
}

export function sanitizeEvents(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value)) return []
  const kinds = EVENT_KINDS.map((item) => item.value as string)
  const repeats = REPEAT_OPTIONS.map((item) => item.value as string)
  return value.flatMap((item) => {
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || !row.title.trim()) return []
    if (typeof row.date !== 'string' || !DATE.test(row.date)) return []
    return [
      {
        id: row.id,
        title: row.title.slice(0, 140),
        date: row.date,
        time: typeof row.time === 'string' && TIME.test(row.time) ? row.time : undefined,
        endTime: typeof row.endTime === 'string' && TIME.test(row.endTime) ? row.endTime : undefined,
        kind: (typeof row.kind === 'string' && kinds.includes(row.kind) ? row.kind : 'other') as EventKind,
        course: typeof row.course === 'string' && row.course.trim() ? row.course : undefined,
        notes: typeof row.notes === 'string' && row.notes.trim() ? row.notes : undefined,
        repeat: (typeof row.repeat === 'string' && repeats.includes(row.repeat) ? row.repeat : 'none') as Repeat,
        until: typeof row.until === 'string' && DATE.test(row.until) ? row.until : undefined,
        doneDates: Array.isArray(row.doneDates)
          ? row.doneDates.filter((day): day is string => typeof day === 'string' && DATE.test(day))
          : [],
      },
    ]
  })
}

export function readEvents(): CalendarEvent[] {
  try {
    return sanitizeEvents(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return []
  }
}

export function writeEvents(events: CalendarEvent[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(events))
  } catch {
    // Local storage can be unavailable in private browsing.
  }
}
