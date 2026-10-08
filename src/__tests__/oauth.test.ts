import { describe, expect, it } from 'vitest'
import { oauthProviderFromPath, oauthRedirectPath } from '../lib/cloudProviders'

describe('oauth redirect paths', () => {
  it('builds a clean path with no query string for every provider', () => {
    for (const id of ['google-drive', 'onedrive', 'dropbox'] as const) {
      expect(oauthRedirectPath(id)).toBe(`/oauth/${id}`)
      expect(oauthRedirectPath(id)).not.toContain('?')
    }
  })

  it('recognises each callback path, with or without a trailing slash', () => {
    expect(oauthProviderFromPath('/oauth/onedrive')).toBe('onedrive')
    expect(oauthProviderFromPath('/oauth/dropbox/')).toBe('dropbox')
    expect(oauthProviderFromPath('/oauth/google-drive')).toBe('google-drive')
  })

  it('ignores other paths and unknown providers', () => {
    expect(oauthProviderFromPath('/')).toBeNull()
    expect(oauthProviderFromPath('/oauth/evil')).toBeNull()
    expect(oauthProviderFromPath('/oauth/onedrive/extra')).toBeNull()
  })
})
