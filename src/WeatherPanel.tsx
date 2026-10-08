import { useEffect, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'
import { Segmented } from './settings/controls'
import { detectPlace, placeLabel, searchPlaces, type WeatherPlace, type WeatherSettings } from './lib/weather'

export function WeatherPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: WeatherSettings
  onChange: (settings: WeatherSettings) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WeatherPlace[] | null>(null)
  const [busy, setBusy] = useState<'search' | 'detect' | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function search(event: React.FormEvent) {
    event.preventDefault()
    if (query.trim().length < 2) return setMessage('Type at least two letters of a city name.')
    setBusy('search')
    setMessage('')
    try {
      const found = await searchPlaces(query)
      setResults(found)
      if (found.length === 0) setMessage(`No places found for “${query.trim()}”. Try a nearby larger city.`)
    } catch {
      setMessage('The place search is unavailable right now. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }
  async function detect() {
    setBusy('detect')
    setMessage('')
    try {
      onChange({ ...settings, place: await detectPlace() })
      onClose()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Your location could not be detected.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="utility-backdrop" data-overlay onMouseDown={onClose}>
      <section
        className="utility-panel weather-panel"
        role="dialog"
        aria-label="Weather location"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="utility-panel-head">
          <div>
            <p className="eyebrow">Weather</p>
            <h2>{settings.place ? placeLabel(settings.place) : 'Choose a location'}</h2>
            <span className="utility-muted">Forecast from Open-Meteo. Your location is saved on this device.</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close weather">
            <X size={18} />
          </button>
        </div>
        <button className="secondary-button" onClick={() => void detect()} disabled={busy !== null}>
          <MapPin size={15} /> {busy === 'detect' ? 'Detecting…' : 'Detect my location'}
        </button>
        <form className="weather-search" onSubmit={search}>
          <label>
            Or search for a city
            <span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. Houston"
                maxLength={80}
              />
              <button className="primary-button" type="submit" disabled={busy !== null} aria-label="Search">
                <Search size={14} />
              </button>
            </span>
          </label>
        </form>
        {message ? (
          <p className="weather-error" role="alert">
            {message}
          </p>
        ) : null}
        {results && results.length > 0 ? (
          <ul className="weather-results" aria-label="Matching places">
            {results.map((place) => (
              <li key={`${place.latitude},${place.longitude}`}>
                <button
                  onClick={() => {
                    onChange({ ...settings, place })
                    onClose()
                  }}
                >
                  <strong>{place.name}</strong>
                  <small>
                    {[place.region, place.country && place.country !== place.region ? place.country : '']
                      .filter(Boolean)
                      .join(', ')}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="weather-footer">
          <span>Units</span>
          <Segmented
            label="Temperature units"
            value={settings.unit}
            onChange={(unit) => onChange({ ...settings, unit })}
            options={[
              { value: 'F', label: '°F' },
              { value: 'C', label: '°C' },
            ]}
          />
          {settings.place ? (
            <button className="text-button" onClick={() => onChange({ ...settings, place: null })}>
              Remove location
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}
