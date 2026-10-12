import { describe, expect, it } from 'vitest'
import { MARK_GLYPH } from '../lib/markGlyph'

describe("the app's mark", () => {
  it('draws the same shapes as the icon', async () => {
    // @ts-expect-error a plain script, with no type declarations
    const { GLYPH } = await import('../../scripts/icons/build.mjs')
    expect(MARK_GLYPH).toEqual(GLYPH)
  })
})
