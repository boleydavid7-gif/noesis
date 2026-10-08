import { describe, expect, it } from 'vitest'
import { ACCENTS, DEFAULT_SETTINGS, rootAppearance, sanitizeSettings, updateSetting } from '../lib/settings'

describe('settings', () => {
  it('returns defaults for missing or corrupt storage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values and fills in the rest', () => {
    const settings = sanitizeSettings({ reading: { theme: 'night', fontSize: 115 }, ai: { length: 'concise' } })
    expect(settings.reading.theme).toBe('night')
    expect(settings.reading.fontSize).toBe(115)
    expect(settings.reading.font).toBe(DEFAULT_SETTINGS.reading.font)
    expect(settings.ai.length).toBe('concise')
    expect(settings.ai.enabled).toBe(true)
  })

  it('rejects unknown choices and clamps numbers', () => {
    const settings = sanitizeSettings({
      reading: { theme: 'neon', fontSize: 900, lineHeight: 0.2 },
      appearance: { accent: 'purple', scenery: 'yes' },
    })
    expect(settings.reading.theme).toBe('paper')
    expect(settings.reading.fontSize).toBe(140)
    expect(settings.reading.lineHeight).toBe(1.3)
    expect(settings.appearance.accent).toBe('gold')
    expect(settings.appearance.scenery).toBe(true)
  })

  it('updates one value without mutating the original', () => {
    const next = updateSetting(DEFAULT_SETTINGS, 'reading', 'theme', 'sepia')
    expect(next.reading.theme).toBe('sepia')
    expect(next.reading.fontSize).toBe(DEFAULT_SETTINGS.reading.fontSize)
    expect(DEFAULT_SETTINGS.reading.theme).toBe('paper')
  })

  it('maps appearance settings to root classes and accent variables', () => {
    const settings = sanitizeSettings({ appearance: { accent: 'green', scenery: false, reduceMotion: true } })
    const { classes, vars } = rootAppearance(settings)
    expect(classes).toEqual(['no-scenery', 'reduce-motion'])
    expect(vars['--gold-warm']).toBe(ACCENTS.green.main)
    expect(rootAppearance(DEFAULT_SETTINGS).vars).toEqual({})
  })
})
