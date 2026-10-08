import { describe, expect, it } from 'vitest'
import { cssForImage } from './images'

describe('cssForImage', () => {
  it('turns presets and saved pictures into backgrounds', () => {
    expect(cssForImage('dusk')).toContain('linear-gradient')
    expect(cssForImage('data:image/jpeg;base64,AAAA')).toBe('url("data:image/jpeg;base64,AAAA")')
  })
  it('ignores anything else', () => {
    expect(cssForImage('javascript:alert(1)')).toBeUndefined()
    expect(cssForImage('unknown')).toBeUndefined()
  })
})
