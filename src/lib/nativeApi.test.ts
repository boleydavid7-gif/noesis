import { describe, expect, it } from 'vitest'
import { withOrigin } from './nativeApi'

describe('withOrigin', () => {
  it('adds the server address to our own api paths only', () => {
    expect(withOrigin('/api/search?q=a', 'https://x.test')).toBe('https://x.test/api/search?q=a')
    expect(withOrigin('https://other.test/api/a', 'https://x.test')).toBe('https://other.test/api/a')
    expect(withOrigin('/notes', 'https://x.test')).toBe('/notes')
  })
})
