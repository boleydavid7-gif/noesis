import { describe, expect, it } from 'vitest'
import { LIBBY_HOME, libbyLibrary, libbySearch } from '../lib/libby'

const dayton = { key: 'd', libbyKey: 'daytonmetro', name: 'Dayton Metro Library', place: 'Dayton, OH' }

describe('Libby links', () => {
  it('opens the chosen library, or Libby itself without one', () => {
    expect(libbyLibrary(dayton)).toBe('https://libbyapp.com/library/daytonmetro')
    expect(libbyLibrary(null)).toBe(LIBBY_HOME)
  })
  it('searches the chosen library', () => {
    expect(libbySearch(dayton, ' The Daily Stoic ')).toBe(
      'https://libbyapp.com/search/daytonmetro/search/query-The%20Daily%20Stoic/page-1',
    )
    expect(libbySearch(dayton, '')).toBe('https://libbyapp.com/library/daytonmetro')
    expect(libbySearch(null, 'x')).toBe(LIBBY_HOME)
  })
})
