import { describe, expect, it } from 'vitest'
import {
  addDays,
  dateKey,
  eventsOn,
  formatClock,
  monthMarkers,
  newEvent,
  occursOn,
  sanitizeEvents,
  toggleDone,
  upcoming,
} from '../lib/calendar'

// 2026-10-05 is a Monday.
const make = (over: Partial<Parameters<typeof newEvent>[0]> = {}) =>
  newEvent({ title: 'Event', date: '2026-10-05', ...over })

describe('calendar', () => {
  it('formats and shifts dates in local time', () => {
    expect(dateKey(new Date(2026, 9, 5))).toBe('2026-10-05')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('shows a one-off event only on its day', () => {
    const event = make()
    expect(occursOn(event, '2026-10-05')).toBe(true)
    expect(occursOn(event, '2026-10-06')).toBe(false)
    expect(occursOn(event, '2026-10-04')).toBe(false)
  })

  it('repeats weekly on the same weekday and stops at the end date', () => {
    const event = make({ repeat: 'weekly', until: '2026-10-19' })
    expect(occursOn(event, '2026-10-12')).toBe(true)
    expect(occursOn(event, '2026-10-19')).toBe(true)
    expect(occursOn(event, '2026-10-26')).toBe(false)
    expect(occursOn(event, '2026-10-13')).toBe(false)
    expect(occursOn(event, '2026-09-28')).toBe(false)
  })

  it('repeats on weekdays only', () => {
    const event = make({ repeat: 'weekdays' })
    expect(occursOn(event, '2026-10-09')).toBe(true) // Friday
    expect(occursOn(event, '2026-10-10')).toBe(false) // Saturday
    expect(occursOn(event, '2026-10-11')).toBe(false) // Sunday
  })

  it('sorts timed events first, in time order', () => {
    const events = [
      make({ title: 'Anytime' }),
      make({ title: 'Late', time: '15:00' }),
      make({ title: 'Early', time: '08:00' }),
    ]
    expect(eventsOn(events, '2026-10-05').map((item) => item.event.title)).toEqual(['Early', 'Late', 'Anytime'])
  })

  it('checks off one occurrence of a repeating event at a time', () => {
    const event = toggleDone(make({ repeat: 'weekly' }), '2026-10-12')
    expect(eventsOn([event], '2026-10-12')[0].done).toBe(true)
    expect(eventsOn([event], '2026-10-19')[0].done).toBe(false)
    expect(toggleDone(event, '2026-10-12').doneDates).toEqual([])
  })

  it('finds upcoming events across days, up to the limit', () => {
    const events = [make({ title: 'Quiz', date: '2026-10-08' }), make({ title: 'Essay', date: '2026-10-12' })]
    expect(upcoming(events, '2026-10-05').map((item) => item.event.title)).toEqual(['Quiz', 'Essay'])
    expect(upcoming(events, '2026-10-05', 14, 1)).toHaveLength(1)
    expect(upcoming(events, '2026-10-13')).toEqual([])
  })

  it('marks the days of a month that have events', () => {
    const markers = monthMarkers([make({ kind: 'exam', date: '2026-10-09' })], 2026, 9)
    expect(markers[9]).toEqual(['exam'])
    expect(markers[10]).toBeUndefined()
  })

  it('formats clock times', () => {
    expect(formatClock('08:00')).toBe('8:00 AM')
    expect(formatClock('15:30')).toBe('3:30 PM')
    expect(formatClock('00:05')).toBe('12:05 AM')
    expect(formatClock('nope')).toBe('')
  })

  it('cleans stored events and drops invalid ones', () => {
    const events = sanitizeEvents([
      { id: 'a', title: 'Biology', date: '2026-10-05', kind: 'class', repeat: 'weekly', time: '09:30' },
      { id: 'b', title: '', date: '2026-10-05' },
      { id: 'c', title: 'Bad date', date: 'tomorrow' },
      { id: 'd', title: 'Odd', date: '2026-10-05', kind: 'weird', repeat: 'hourly', time: '99:99' },
    ])
    expect(events.map((event) => event.id)).toEqual(['a', 'd'])
    expect(events[1].kind).toBe('other')
    expect(events[1].repeat).toBe('none')
    expect(events[1].time).toBeUndefined()
    expect(sanitizeEvents('nope')).toEqual([])
  })
})
