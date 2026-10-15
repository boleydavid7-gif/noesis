import { useEffect, useState } from 'react'
import { fetchForecast, type Forecast, type WeatherSettings } from './weather'

type Result = { key: string; forecast?: Forecast; error?: string }

// Loads the forecast for the chosen place. Status is derived from which request
// the stored result belongs to, so a changed place or unit shows "loading"
// without setting state inside the effect.
export function useForecast(settings: WeatherSettings) {
  const [result, setResult] = useState<Result>({ key: '' })
  const [attempt, setAttempt] = useState(0)
  const place = settings.place
  const unit = settings.unit
  const key = place ? `${place.latitude},${place.longitude},${unit},${attempt}` : ''

  useEffect(() => {
    if (!place) return
    let canceled = false
    fetchForecast(place, unit)
      .then((forecast) => {
        if (!canceled) setResult({ key, forecast })
      })
      .catch((reason) => {
        if (!canceled) setResult({ key, error: reason instanceof Error ? reason.message : 'Weather is unavailable.' })
      })
    return () => {
      canceled = true
    }
  }, [key, place, unit])

  const status = !place ? 'none' : result.key !== key ? 'loading' : result.error ? 'error' : 'ready'
  return {
    status,
    forecast: status === 'ready' ? result.forecast : undefined,
    error: status === 'error' ? result.error : undefined,
    retry: () => setAttempt((value) => value + 1),
  } as const
}
