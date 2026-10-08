import { useState } from 'react'
import {
  ArrowRight,
  Circle,
  CheckCircle2,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  FileText,
  Lightbulb,
  MapPin,
  Pause,
  Play,
  Plus,
  Sun,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  addFocusTask,
  formatTimer,
  removeFocusTask,
  toggleFocusTask,
  MAX_FOCUS_TASKS,
  type FocusState,
} from './lib/focus'
import { dateKey, formatClock, kindInfo, upcoming, type CalendarEvent } from './lib/calendar'
import { useForecast } from './lib/useForecast'
import {
  describeWeather,
  detectPlace,
  formatTemperature,
  placeLabel,
  type WeatherKind,
  type WeatherSettings,
} from './lib/weather'

const WEATHER_ICONS: Record<WeatherKind, LucideIcon> = {
  clear: Sun,
  partly: CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
}

type Props = {
  now: Date
  focus: FocusState
  remaining: number
  onFocusChange: (updater: (state: FocusState) => FocusState) => void
  onToggleTimer: () => void
  onOpenFocus: () => void
  events: CalendarEvent[]
  onToggleEvent: (eventId: string, date: string) => void
  onOpenCalendar: (date?: string, adding?: boolean) => void
  weather: WeatherSettings
  onWeatherChange: (settings: WeatherSettings) => void
  onOpenWeather: () => void
  onAddNote: () => void
  onAskNoema: () => void
}

export function ContextSidebar(props: Props) {
  const { now, focus, remaining, onFocusChange, events, weather } = props
  const [draft, setDraft] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState('')
  const forecast = useForecast(weather)
  const today = dateKey(now)
  const coming = upcoming(events, today, 14, 4)
  const untouched = remaining >= focus.durationMinutes * 60

  async function detect() {
    setDetecting(true)
    setDetectError('')
    try {
      props.onWeatherChange({ ...weather, place: await detectPlace() })
    } catch (reason) {
      setDetectError(reason instanceof Error ? reason.message : 'Your location could not be detected.')
    } finally {
      setDetecting(false)
    }
  }

  function submitTask(event: React.FormEvent) {
    event.preventDefault()
    onFocusChange((state) => addFocusTask(state, draft))
    setDraft('')
  }

  const current = forecast.forecast
  const CurrentIcon = current ? WEATHER_ICONS[describeWeather(current.code).kind] : CloudSun

  return (
    <aside className="desktop-context-sidebar" aria-label="Daily context">
      <section className="context-section context-focus">
        <div className="context-section-heading">
          <button className="context-heading-button" onClick={props.onOpenFocus}>
            <h2>{focus.title}</h2>
            <ArrowRight size={12} />
          </button>
        </div>

        <div className="focus-session">
          <button
            className="focus-play"
            onClick={props.onToggleTimer}
            aria-label={focus.running ? 'Pause focus session' : 'Start focus session'}
          >
            {focus.running ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <div>
            <small>Focus Session</small>
            <strong>{focus.session}</strong>
            <span>{focus.running || !untouched ? formatTimer(remaining) : `${focus.durationMinutes} min`}</span>
          </div>
          <button className="primary-button focus-start" onClick={props.onToggleTimer}>
            {focus.running ? 'Pause' : untouched ? 'Start' : 'Resume'}
          </button>
        </div>
        <ul className="focus-list">
          {focus.tasks.map((task, index) => (
            <li key={`${task.label}-${index}`} className={task.done ? 'focus-item focus-item-done' : 'focus-item'}>
              <button
                className="focus-item-main"
                onClick={() => onFocusChange((state) => toggleFocusTask(state, index))}
                aria-label={`${task.done ? 'Mark not done' : 'Mark done'}: ${task.label}`}
              >
                {task.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                <span>{task.label}</span>
              </button>
              <button
                className="focus-item-remove"
                onClick={() => onFocusChange((state) => removeFocusTask(state, index))}
                aria-label={`Remove: ${task.label}`}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
        {focus.tasks.length < MAX_FOCUS_TASKS ? (
          <form className="focus-add" onSubmit={submitTask}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a focus step"
              maxLength={120}
              aria-label="Add a focus step"
            />
            <button type="submit" aria-label="Add focus step" disabled={!draft.trim()}>
              <Plus size={14} />
            </button>
          </form>
        ) : null}
      </section>

      <section className="context-section">
        <div className="context-section-heading">
          <button className="context-heading-button" onClick={() => props.onOpenCalendar()}>
            <h2>Calendar</h2>
            <ArrowRight size={12} />
          </button>
          <button
            className="context-plus"
            onClick={() => props.onOpenCalendar(today, true)}
            aria-label="Add to calendar"
          >
            <Plus size={15} />
          </button>
        </div>
        {coming.length === 0 ? (
          <p className="context-empty">Nothing coming up.</p>
        ) : (
          <ul className="cal-list">
            {coming.map(({ event, date, done }) => {
              const kind = kindInfo(event.kind)
              const weekday = date === today ? '' : parseWeekday(date)
              const when = event.time ? formatClock(event.time) : event.kind === 'assignment' ? 'Due' : 'All day'
              return (
                <li key={`${event.id}-${date}`} className={done ? 'cal-row cal-row-done' : 'cal-row'}>
                  <button
                    className="cal-check"
                    onClick={() => props.onToggleEvent(event.id, date)}
                    aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${event.title}`}
                  >
                    {done ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                  </button>
                  <button className="cal-main" onClick={() => props.onOpenCalendar(date)}>
                    <small>{[weekday, when].filter(Boolean).join(' · ')}</small>
                    <span>
                      <i style={{ background: kind.color }} />
                      {event.title}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="context-section context-weather">
        <div className="context-section-heading">
          <button className="context-heading-button" onClick={props.onOpenWeather}>
            <h2>Weather</h2>
            <ArrowRight size={12} />
          </button>
        </div>
        {forecast.status === 'none' ? (
          <div className="weather-setup">
            <p className="context-empty">Add your location to see the forecast.</p>
            <div className="weather-setup-actions">
              <button className="secondary-button" onClick={() => void detect()} disabled={detecting}>
                <MapPin size={14} /> {detecting ? 'Detecting…' : 'Detect'}
              </button>
              <button className="secondary-button" onClick={props.onOpenWeather}>
                Choose
              </button>
            </div>
            {detectError ? <p className="weather-error">{detectError}</p> : null}
          </div>
        ) : forecast.status === 'loading' ? (
          <p className="context-empty">Loading the forecast…</p>
        ) : forecast.status === 'error' || !current ? (
          <div className="weather-setup">
            <p className="weather-error">{forecast.error ?? 'Weather is unavailable.'}</p>
            <button className="secondary-button" onClick={forecast.retry}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="weather-now">
              <CurrentIcon size={42} strokeWidth={1.5} />
              <div>
                <strong>{formatTemperature(current.temperature)}</strong>
                <span>{describeWeather(current.code).label}</span>
              </div>
              <div className="weather-hilo">
                <span>H: {formatTemperature(current.high)}</span>
                <span>L: {formatTemperature(current.low)}</span>
              </div>
            </div>
            {weather.place ? <p className="weather-place">{placeLabel(weather.place)}</p> : null}
            <ul className="weather-days">
              {current.days.map((day) => {
                const DayIcon = WEATHER_ICONS[describeWeather(day.code).kind]
                return (
                  <li key={day.date} title={describeWeather(day.code).label}>
                    <small>{parseWeekday(day.date)}</small>
                    <DayIcon size={18} strokeWidth={1.6} />
                    <span>{formatTemperature(day.high)}</span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      <section className="context-section">
        <div className="context-section-heading">
          <h2>Quick Actions</h2>
        </div>
        <div className="quick-actions">
          <button onClick={props.onAddNote}>
            <FileText size={18} />
            <strong>Add Note</strong>
          </button>
          <button onClick={props.onAskNoema}>
            <Lightbulb size={18} />
            <strong>Ask Noema</strong>
          </button>
        </div>
      </section>
    </aside>
  )
}

function parseWeekday(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'short' })
}
