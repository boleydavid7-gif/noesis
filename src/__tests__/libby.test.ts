import { describe, expect, it } from 'vitest'
import { LIBBY_HOME, libbyAppLink, libbyLibrary, libbyLinkProps, libbySearch } from '../lib/libby'

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

describe('opening the Libby app', () => {
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36'
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari'
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'

  it('names the Libby app on Android, with the web page to fall back on', () => {
    expect(libbyAppLink('https://share.libbyapp.com/title/123', android)).toBe(
      'intent://share.libbyapp.com/title/123#Intent;scheme=https;package=com.overdrive.mobile.android.libby;S.browser_fallback_url=https%3A%2F%2Fshare.libbyapp.com%2Ftitle%2F123;end',
    )
    expect(libbyAppLink('https://example.com/x', android)).toBe('https://example.com/x')
  })

  it('follows the link in place on a phone (so iPhone can hand it to the app) and in a new tab on a computer', () => {
    expect(libbyLinkProps('https://libbyapp.com/shelf', iphone)).toEqual({ href: 'https://libbyapp.com/shelf' })
    expect(libbyLinkProps('https://libbyapp.com/shelf', mac)).toEqual({
      href: 'https://libbyapp.com/shelf',
      target: '_blank',
      rel: 'noreferrer noopener',
    })
  })
})
