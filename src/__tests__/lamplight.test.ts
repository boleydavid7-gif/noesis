import { describe, expect, it } from 'vitest'
import { contrast } from '../lamplight/color'
import { noesisScheme } from '../lamplight/noesis'
import { ACCENTS, SURFACES } from '../lib/settings'

describe('Noesis in Lamplight', () => {
  it('reads in every background with every color', () => {
    for (const accent of Object.keys(ACCENTS))
      for (const [surface, { vars }] of Object.entries(SURFACES)) {
        const s = noesisScheme(accent, surface, vars['--surface-shell'])
        const where = `${surface} ${accent}`
        for (const bg of [s.page, s.card, s.inset]) {
          expect(contrast(s.ink, bg), where).toBeGreaterThanOrEqual(7)
          for (const fg of [s.ink2, s.ink3, s.lamp, s.remove])
            expect(contrast(fg, bg), where).toBeGreaterThanOrEqual(4.5)
        }
        expect(contrast(s.onLamp, s.lampFill), where).toBeGreaterThanOrEqual(4.5)
      }
  })

  it('keeps each background its own hue, in the deep cut', () => {
    const midnight = noesisScheme('gold', 'midnight')
    const forest = noesisScheme('gold', 'forest', SURFACES.forest.vars['--surface-shell'])
    expect(midnight.page).not.toBe(forest.page)
    expect(midnight.hair).toMatch(/0\.06\)$/)
  })
})
