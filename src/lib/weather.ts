// Weather from Open-Meteo (free, no key, no account). Place search uses its
// geocoding service; "detect my location" asks the browser for coordinates
// and, only to show a readable name, looks them up with BigDataCloud's
// client-side reverse geocoder. Nothing is requested until the learner asks.

export type WeatherUnit = 'F' | 'C'
export type WeatherPlace = { name: string; latitude: number; longitude: number; region?: string; country?: string }
export type WeatherSettings = { place: WeatherPlace | null; unit: WeatherUnit }
export type WeatherKind = 'clear' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'
export type DayForecast = { date: string; high: number; low: number; code: number }
export type Forecast = { temperature: number; code: number; high: number; low: number; days: DayForecast[] }

const SETTINGS_KEY = 'noesis:weather:v2'
const LEGACY_KEY = 'noesis:weather:v1'
const CACHE_KEY = 'noesis:weather-cache:v1'
const CACHE_MINUTES = 30

export function describeWeather(code: number): { label: string; kind: WeatherKind } {
  if (code === 0) return { label: 'Clear', kind: 'clear' }
  if (code === 1) return { label: 'Mostly clear', kind: 'clear' }
  if (code === 2) return { label: 'Partly cloudy', kind: 'partly' }
  if (code === 3) return { label: 'Cloudy', kind: 'cloud' }
  if (code === 45 || code === 48) return { label: 'Foggy', kind: 'fog' }
  if (code >= 51 && code <= 57) return { label: 'Drizzle', kind: 'drizzle' }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', kind: 'rain' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', kind: 'snow' }
  if (code >= 95) return { label: 'Thunderstorm', kind: 'storm' }
  return { label: 'Cloudy', kind: 'cloud' }
}

export function formatTemperature(value: number): string {
  return `${Math.round(value)}°`
}

export function placeLabel(place: WeatherPlace): string {
  return [place.name, place.region].filter(Boolean).join(', ')
}

export function geocodeUrl(query: string): string {
  return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=6&language=en&format=json`
}

export function forecastUrl(place: Pick<WeatherPlace, 'latitude' | 'longitude'>, unit: WeatherUnit): string {
  const params = new URLSearchParams({
    latitude: place.latitude.toFixed(4),
    longitude: place.longitude.toFixed(4),
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    temperature_unit: unit === 'F' ? 'fahrenheit' : 'celsius',
    timezone: 'auto',
    forecast_days: '6',
  })
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`
}

export function reverseGeocodeUrl(latitude: number, longitude: number): string {
  return `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&localityLanguage=en`
}

export function parseGeocode(json: unknown): WeatherPlace[] {
  const results = (json as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) return []
  return results.flatMap((item) => {
    const row = item as Record<string, unknown>
    if (typeof row.name !== 'string' || typeof row.latitude !== 'number' || typeof row.longitude !== 'number') return []
    return [
      {
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        region: typeof row.admin1 === 'string' ? row.admin1 : typeof row.country === 'string' ? row.country : undefined,
        country: typeof row.country === 'string' ? row.country : undefined,
      },
    ]
  })
}

export function parseReverseGeocode(json: unknown, latitude: number, longitude: number): WeatherPlace {
  const row = (json ?? {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
  const name = text(row.city) ?? text(row.locality) ?? 'Your location'
  return {
    name,
    latitude,
    longitude,
    region: text(row.principalSubdivision) ?? text(row.countryName),
    country: text(row.countryName),
  }
}

export function parseForecast(json: unknown): Forecast | null {
  const root = (json ?? {}) as { current?: Record<string, unknown>; daily?: Record<string, unknown> }
  const current = root.current
  const daily = root.daily
  if (!current || !daily) return null
  const times = daily.time
  const highs = daily.temperature_2m_max
  const lows = daily.temperature_2m_min
  const codes = daily.weather_code
  if (typeof current.temperature_2m !== 'number' || typeof current.weather_code !== 'number') return null
  if (![times, highs, lows, codes].every(Array.isArray)) return null
  const days: DayForecast[] = []
  const count = Math.min(
    (times as unknown[]).length,
    (highs as unknown[]).length,
    (lows as unknown[]).length,
    (codes as unknown[]).length,
  )
  for (let index = 0; index < count; index += 1) {
    const date = (times as unknown[])[index]
    const high = (highs as unknown[])[index]
    const low = (lows as unknown[])[index]
    const code = (codes as unknown[])[index]
    if (typeof date === 'string' && typeof high === 'number' && typeof low === 'number' && typeof code === 'number') {
      days.push({ date, high, low, code })
    }
  }
  if (days.length === 0) return null
  return {
    temperature: current.temperature_2m,
    code: current.weather_code,
    high: days[0].high,
    low: days[0].low,
    days: days.slice(1, 6),
  }
}

async function getJson(url: string, milliseconds = 8_000): Promise<unknown> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), milliseconds)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Weather service returned ${response.status}.`)
    return await response.json()
  } finally {
    window.clearTimeout(timer)
  }
}

export async function searchPlaces(query: string): Promise<WeatherPlace[]> {
  if (query.trim().length < 2) return []
  return parseGeocode(await getJson(geocodeUrl(query)))
}

export async function fetchForecast(place: WeatherPlace, unit: WeatherUnit): Promise<Forecast> {
  const cached = readCachedForecast(place, unit)
  if (cached) return cached
  const forecast = parseForecast(await getJson(forecastUrl(place, unit)))
  if (!forecast) throw new Error('The weather service returned something unexpected.')
  writeCachedForecast(place, unit, forecast)
  return forecast
}

export function detectPlace(): Promise<WeatherPlace> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('This browser cannot detect your location. Search for a city instead.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        try {
          resolve(parseReverseGeocode(await getJson(reverseGeocodeUrl(latitude, longitude)), latitude, longitude))
        } catch {
          resolve({ name: 'Your location', latitude, longitude })
        }
      },
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? 'Location access was blocked. Allow it for this site, or search for a city instead.'
              : 'Your location could not be detected. Search for a city instead.',
          ),
        ),
      { timeout: 10_000, maximumAge: 600_000 },
    )
  })
}

function cacheKeyFor(place: WeatherPlace, unit: WeatherUnit) {
  return `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)},${unit}`
}

export function readCachedForecast(place: WeatherPlace, unit: WeatherUnit, now = Date.now()): Forecast | null {
  try {
    const entry = (JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') ?? {}) as {
      key?: string
      at?: number
      forecast?: Forecast
    }
    if (
      entry.key === cacheKeyFor(place, unit) &&
      typeof entry.at === 'number' &&
      now - entry.at < CACHE_MINUTES * 60_000
    ) {
      return entry.forecast ?? null
    }
  } catch {
    // A bad cache entry is the same as no cache.
  }
  return null
}

function writeCachedForecast(place: WeatherPlace, unit: WeatherUnit, forecast: Forecast) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ key: cacheKeyFor(place, unit), at: Date.now(), forecast }))
  } catch {
    // Caching is only an optimisation.
  }
}

export function sanitizeWeatherSettings(value: unknown): WeatherSettings {
  const row = (value ?? {}) as Record<string, unknown>
  const place = row.place as Record<string, unknown> | null | undefined
  const valid =
    place &&
    typeof place.name === 'string' &&
    typeof place.latitude === 'number' &&
    typeof place.longitude === 'number' &&
    Math.abs(place.latitude) <= 90 &&
    Math.abs(place.longitude) <= 180
  return {
    place: valid
      ? {
          name: place.name as string,
          latitude: place.latitude as number,
          longitude: place.longitude as number,
          region: typeof place.region === 'string' ? place.region : undefined,
          country: typeof place.country === 'string' ? place.country : undefined,
        }
      : null,
    unit: row.unit === 'C' ? 'C' : 'F',
  }
}

export function readWeatherSettings(): WeatherSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    if (stored) return sanitizeWeatherSettings(JSON.parse(stored))
    // The first version only stored a unit and a free-text location, which
    // cannot be turned into coordinates, so keep the unit and ask again.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null') as { unit?: unknown } | null
    return { place: null, unit: legacy?.unit === 'C' ? 'C' : 'F' }
  } catch {
    return { place: null, unit: 'F' }
  }
}

export function writeWeatherSettings(settings: WeatherSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Without storage the choice lasts for this session.
  }
}
