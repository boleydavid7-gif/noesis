import { describe, expect, it } from 'vitest'
import { cssForImage } from './images'

describe('cssForImage', () => {
  it('turns presets and saved pictures into backgrounds', () => {
    expect(cssForImage('dusk')).toContain('linear-gradient')
    expect(cssForImage('data:image/jpeg;base64,AAAA')).toBe('url("data:image/jpeg;base64,AAAA")')
  })
  it('uses the wide or tall picture of a built-in scene', () => {
    expect(cssForImage('cabin', 'banner')).toContain('cabin-wide')
    expect(cssForImage('cabin', 'sidebar')).toContain('cabin-tall')
  })
  it('ignores anything else', () => {
    expect(cssForImage('javascript:alert(1)')).toBeUndefined()
    expect(cssForImage('unknown')).toBeUndefined()
  })
})
