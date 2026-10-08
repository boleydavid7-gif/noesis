import { describe, expect, it } from 'vitest'
import {
  describeWeather,
  forecastUrl,
  formatTemperature,
  geocodeUrl,
  parseForecast,
  parseGeocode,
  parseReverseGeocode,
  placeLabel,
  sanitizeWeatherSettings,
} from '../lib/weather'

describe('weather', () => {
  it('maps weather codes to readable labels', () => {
    expect(describeWeather(0).kind).toBe('clear')
    expect(describeWeather(2)).toEqual({ label: 'Partly cloudy', kind: 'partly' })
    expect(describeWeather(63).kind).toBe('rain')
    expect(describeWeather(73).kind).toBe('snow')
    expect(describeWeather(96).kind).toBe('storm')
    expect(describeWeather(-1).kind).toBe('cloud')
  })

  it('builds request URLs with the unit and coordinates', () => {
    const url = forecastUrl({ latitude: 29.76, longitude: -95.37 }, 'F')
    expect(url).toContain('latitude=29.7600')
    expect(url).toContain('temperature_unit=fahrenheit')
    expect(forecastUrl({ latitude: 1, longitude: 2 }, 'C')).toContain('temperature_unit=celsius')
    expect(geocodeUrl(' New York ')).toContain('name=New%20York')
  })

  it('parses place search results and drops malformed rows', () => {
    const places = parseGeocode({
      results: [
        { name: 'Houston', latitude: 29.76, longitude: -95.37, admin1: 'Texas', country: 'United States' },
        { name: 'Broken' },
        { name: 'Paris', latitude: 48.85, longitude: 2.35, country: 'France' },
      ],
    })
    expect(places).toHaveLength(2)
    expect(placeLabel(places[0])).toBe('Houston, Texas')
    expect(places[1].region).toBe('France')
    expect(parseGeocode({})).toEqual([])
    expect(parseGeocode(null)).toEqual([])
  })

  it('names a detected location, with fallbacks', () => {
    expect(parseReverseGeocode({ city: 'Austin', principalSubdivision: 'Texas' }, 30.2, -97.7).name).toBe('Austin')
    expect(parseReverseGeocode({ locality: 'Pearland' }, 29.5, -95.3).name).toBe('Pearland')
    expect(parseReverseGeocode({}, 1, 2).name).toBe('Your location')
  })

  it('parses a forecast into current conditions and five days', () => {
    const forecast = parseForecast({
      current: { temperature_2m: 56.4, weather_code: 2 },
      daily: {
        time: ['d0', 'd1', 'd2', 'd3', 'd4', 'd5'],
        temperature_2m_max: [62, 64, 58, 61, 59, 60],
        temperature_2m_min: [48, 50, 47, 49, 46, 45],
        weather_code: [2, 3, 61, 0, 1, 2],
      },
    })
    expect(forecast?.temperature).toBe(56.4)
    expect(forecast?.high).toBe(62)
    expect(forecast?.low).toBe(48)
    expect(forecast?.days).toHaveLength(5)
    expect(forecast?.days[0]).toEqual({ date: 'd1', high: 64, low: 50, code: 3 })
  })

  it('rejects an unexpected forecast shape', () => {
    expect(parseForecast(null)).toBeNull()
    expect(parseForecast({ current: {}, daily: {} })).toBeNull()
    expect(parseForecast({ current: { temperature_2m: 1, weather_code: 0 }, daily: { time: [] } })).toBeNull()
  })

  it('formats temperatures', () => {
    expect(formatTemperature(56.6)).toBe('57°')
  })

  it('validates stored settings', () => {
    expect(sanitizeWeatherSettings(null)).toEqual({ place: null, unit: 'F' })
    expect(sanitizeWeatherSettings({ place: { name: 'X', latitude: 200, longitude: 0 }, unit: 'C' }).place).toBeNull()
    const ok = sanitizeWeatherSettings({ place: { name: 'Houston', latitude: 29.7, longitude: -95.3 }, unit: 'C' })
    expect(ok.place?.name).toBe('Houston')
    expect(ok.unit).toBe('C')
  })
})
