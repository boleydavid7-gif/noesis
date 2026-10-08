import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  EVENT_KINDS,
  REPEAT_OPTIONS,
  dateKey,
  eventsOn,
  formatClock,
  kindInfo,
  monthMarkers,
  newEvent,
  parseDateKey,
  toggleDone,
  type CalendarEvent,
  type EventKind,
  type Repeat,
} from './lib/calendar'

type Draft = {
  id?: string
  title: string
  date: string
  time: string
  endTime: string
  kind: EventKind
  course: string
  notes: string
  repeat: Repeat
  until: string
}

const blank = (date: string): Draft => ({
  title: '',
  date,
  time: '',
  endTime: '',
  kind: 'class',
  course: '',
  notes: '',
  repeat: 'none',
  until: '',
})

function draftFrom(event: CalendarEvent): Draft {
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    time: event.time ?? '',
    endTime: event.endTime ?? '',
    kind: event.kind,
    course: event.course ?? '',
    notes: event.notes ?? '',
    repeat: event.repeat,
    until: event.until ?? '',
  }
}

export function CalendarPanel({
  now,
  events,
  onChange,
  initialDate,
  startAdding,
  onClose,
}: {
  now: Date
  events: CalendarEvent[]
  onChange: (events: CalendarEvent[]) => void
  initialDate?: string
  startAdding?: boolean
  onClose: () => void
}) {
  const todayKey = dateKey(now)
  const [selected, setSelected] = useState(initialDate ?? todayKey)
  const [view, setView] = useState(() => {
    const start = parseDateKey(initialDate ?? todayKey)
    return new Date(start.getFullYear(), start.getMonth(), 1)
  })
  const [draft, setDraft] = useState<Draft | null>(() => (startAdding ? blank(initialDate ?? todayKey) : null))
  const [problem, setProblem] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const year = view.getFullYear()
  const month = view.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const markers = useMemo(() => monthMarkers(events, year, month), [events, year, month])
  const dayEvents = useMemo(() => eventsOn(events, selected), [events, selected])

  function shiftMonth(by: number) {
    setView(new Date(year, month + by, 1))
  }
  function pick(key: string) {
    setSelected(key)
    if (draft && !draft.id) setDraft({ ...draft, date: key })
  }
  function save(event: React.FormEvent) {
    event.preventDefault()
    if (!draft) return
    if (!draft.title.trim()) return setProblem('Give the event a title.')
    if (!draft.date) return setProblem('Choose a date.')
    if (draft.time && draft.endTime && draft.endTime <= draft.time)
      return setProblem('The end time must be after the start time.')
    if (draft.repeat !== 'none' && draft.until && draft.until < draft.date)
      return setProblem('“Repeat until” must be on or after the first date.')
    const fields = {
      title: draft.title,
      date: draft.date,
      time: draft.time || undefined,
      endTime: draft.endTime || undefined,
      kind: draft.kind,
      course: draft.course,
      notes: draft.notes,
      repeat: draft.repeat,
      until: draft.repeat === 'none' ? undefined : draft.until || undefined,
    }
    if (draft.id) {
      onChange(
        events.map((item) =>
          item.id === draft.id ? { ...newEvent({ ...fields, doneDates: item.doneDates }), id: item.id } : item,
        ),
      )
    } else {
      onChange([...events, newEvent(fields)])
    }
    setSelected(draft.date)
    setView(new Date(parseDateKey(draft.date).getFullYear(), parseDateKey(draft.date).getMonth(), 1))
    setDraft(null)
    setProblem('')
  }
  function remove(event: CalendarEvent) {
    const message =
      event.repeat === 'none' ? `Delete “${event.title}”?` : `Delete “${event.title}” and all of its repeats?`
    if (!window.confirm(message)) return
    onChange(events.filter((item) => item.id !== event.id))
    if (draft?.id === event.id) setDraft(null)
  }

  const selectedLabel = parseDateKey(selected).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="utility-backdrop" data-overlay onMouseDown={onClose}>
      <section
        className="utility-panel cal-panel"
        role="dialog"
        aria-label="Calendar"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="utility-panel-head">
          <div>
            <h2>{view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close calendar">
            <X size={18} />
          </button>
        </div>
        <div className="cal-body">
          <div className="cal-month">
            <div className="calendar-toolbar">
              <button className="icon-button" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                <ArrowLeft size={15} />
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setView(new Date(now.getFullYear(), now.getMonth(), 1))
                  pick(todayKey)
                }}
              >
                Today
              </button>
              <button className="icon-button" onClick={() => shiftMonth(1)} aria-label="Next month">
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="calendar-grid calendar-weekdays">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="calendar-grid calendar-days">
              {Array.from({ length: firstDay }, (_, index) => (
                <span className="calendar-day calendar-day-empty" key={`empty-${index}`} />
              ))}
              {Array.from({ length: days }, (_, index) => {
                const day = index + 1
                const key = dateKey(new Date(year, month, day))
                const kinds = markers[day] ?? []
                return (
                  <button
                    key={key}
                    className={`calendar-day${key === todayKey ? ' calendar-day-today' : ''}${key === selected ? ' calendar-day-selected' : ''}`}
                    onClick={() => pick(key)}
                    aria-label={`${parseDateKey(key).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}${kinds.length ? `, ${kinds.length} kind${kinds.length === 1 ? '' : 's'} of event` : ''}`}
                    aria-pressed={key === selected}
                  >
                    <span>{day}</span>
                    <span className="cal-dots">
                      {kinds.slice(0, 3).map((kind) => (
                        <i key={kind} style={{ background: kindInfo(kind).color }} />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="cal-side">
            {draft ? (
              <form className="cal-form" onSubmit={save}>
                <h3>{draft.id ? 'Edit event' : 'New event'}</h3>
                <label>
                  Title
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    placeholder="e.g. Biology midterm"
                    maxLength={140}
                    autoFocus
                  />
                </label>
                <div className="cal-form-row">
                  <label>
                    Type
                    <select
                      value={draft.kind}
                      onChange={(event) => setDraft({ ...draft, kind: event.target.value as EventKind })}
                    >
                      {EVENT_KINDS.map((kind) => (
                        <option key={kind.value} value={kind.value}>
                          {kind.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Class or subject
                    <input
                      value={draft.course}
                      onChange={(event) => setDraft({ ...draft, course: event.target.value })}
                      placeholder="Optional"
                      maxLength={80}
                    />
                  </label>
                </div>
                <div className="cal-form-row">
                  <label>
                    Date
                    <input
                      type="date"
                      value={draft.date}
                      onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                    />
                  </label>
                  <label>
                    Starts
                    <input
                      type="time"
                      value={draft.time}
                      onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                    />
                  </label>
                  <label>
                    Ends
                    <input
                      type="time"
                      value={draft.endTime}
                      onChange={(event) => setDraft({ ...draft, endTime: event.target.value })}
                    />
                  </label>
                </div>
                <div className="cal-form-row">
                  <label>
                    Repeat
                    <select
                      value={draft.repeat}
                      onChange={(event) => setDraft({ ...draft, repeat: event.target.value as Repeat })}
                    >
                      {REPEAT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.repeat !== 'none' ? (
                    <label>
                      Until
                      <input
                        type="date"
                        value={draft.until}
                        onChange={(event) => setDraft({ ...draft, until: event.target.value })}
                      />
                    </label>
                  ) : null}
                </div>
                <label>
                  Notes
                  <textarea
                    value={draft.notes}
                    onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                    placeholder="Room, chapters to cover, what to bring…"
                    rows={3}
                    maxLength={1000}
                  />
                </label>
                {problem ? (
                  <p className="weather-error" role="alert">
                    {problem}
                  </p>
                ) : null}
                <div className="cal-form-actions">
                  <button className="primary-button" type="submit">
                    {draft.id ? 'Save changes' : 'Add event'}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setDraft(null)
                      setProblem('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="cal-day-head">
                  <h3>{selectedLabel}</h3>
                  <button className="primary-button" onClick={() => setDraft(blank(selected))}>
                    <Plus size={14} /> Add
                  </button>
                </div>
                {dayEvents.length === 0 ? (
                  <p className="context-empty">Nothing scheduled. Add a class, assignment, exam, or study session.</p>
                ) : (
                  <ul className="cal-day-list">
                    {dayEvents.map(({ event, date, done }) => {
                      const kind = kindInfo(event.kind)
                      return (
                        <li key={event.id} className={done ? 'cal-day-item cal-row-done' : 'cal-day-item'}>
                          <button
                            className="cal-check"
                            onClick={() =>
                              onChange(events.map((item) => (item.id === event.id ? toggleDone(item, date) : item)))
                            }
                            aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${event.title}`}
                          >
                            {done ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                          </button>
                          <div>
                            <strong>
                              <i style={{ background: kind.color }} />
                              {event.title}
                            </strong>
                            <small>
                              {[
                                kind.label,
                                event.time
                                  ? `${formatClock(event.time)}${event.endTime ? `–${formatClock(event.endTime)}` : ''}`
                                  : 'All day',
                                event.course,
                                event.repeat !== 'none'
                                  ? REPEAT_OPTIONS.find((option) => option.value === event.repeat)?.label
                                  : undefined,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </small>
                            {event.notes ? <p>{event.notes}</p> : null}
                          </div>
                          <div className="cal-item-actions">
                            <button onClick={() => setDraft(draftFrom(event))} aria-label={`Edit ${event.title}`}>
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => remove(event)} aria-label={`Delete ${event.title}`}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
