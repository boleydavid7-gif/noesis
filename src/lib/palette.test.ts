import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_COLORS } from './knowledge'
import { ACCENTS, SURFACES, SURFACE_SWATCH, sanitizeSettings } from './settings'

describe('colour choices', () => {
  it('has a bright swatch and full variables for every app colour', () => {
    for (const name of Object.keys(SURFACES) as Array<keyof typeof SURFACES>) {
      expect(SURFACE_SWATCH[name]).toMatch(/^#[0-9a-f]{6}$/i)
      if (name !== 'midnight') expect(Object.keys(SURFACES[name].vars)).toContain('--surface-main-b')
    }
    for (const surface of Object.values(SURFACES))
      for (const value of Object.values(surface.vars)) expect(value).not.toContain('NaN')
  })
  it('keeps highlight ids unique and accents complete', () => {
    const ids = HIGHLIGHT_COLORS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(12)
    for (const accent of Object.values(ACCENTS)) expect(accent.rgb).toMatch(/^\d+, \d+, \d+$/)
  })
  it('accepts the new choices from saved settings', () => {
    const settings = sanitizeSettings({ appearance: { accent: 'teal', surface: 'wine' } })
    expect(settings.appearance.accent).toBe('teal')
    expect(settings.appearance.surface).toBe('wine')
  })
})
