import { describe, expect, it } from 'vitest'
import { parseClippings } from '../lib/clippings'
import { bookmarkletCode, decodeCollection, encodeCollection, readIncoming } from '../lib/share'

const sample = `﻿Atomic Habits (James Clear)
- Your Highlight on page 27 | location 412-413 | Added on Tuesday, October 6, 2026 8:12:01 PM

You do not rise to the level of your goals.
==========
Atomic Habits (James Clear)
- Your Note on page 27 | location 413 | Added on Tuesday, October 6, 2026 8:13:00 PM

Remember this for the talk.
==========
Atomic Habits (James Clear)
- Your Bookmark on page 30 | location 500 | Added on Tuesday, October 6, 2026 8:20:00 PM


==========
Deep Work: Rules (Cal Newport)
- Your Highlight at location 100-101 | Added on Monday, October 5, 2026 7:00:00 AM

Clarity about what matters provides clarity about what does not.
==========
`

describe('parseClippings', () => {
  const clips = parseClippings(sample)
  it('reads highlights and notes and skips bookmarks', () => {
    expect(clips).toHaveLength(3)
    expect(clips.map((clip) => clip.kind)).toEqual(['highlight', 'note', 'highlight'])
  })
  it('splits the title from the author and keeps the location and date', () => {
    expect(clips[0]).toMatchObject({ bookTitle: 'Atomic Habits', author: 'James Clear', location: 'page 27' })
    expect(clips[0].addedAt).toBeTruthy()
    expect(clips[2]).toMatchObject({ bookTitle: 'Deep Work: Rules', author: 'Cal Newport' })
  })
})

describe('share links', () => {
  it('round-trips a collection', async () => {
    const code = await encodeCollection({
      title: 'Habits',
      quotes: [{ text: 'You do not rise to the level of your goals.', source: 'Atomic Habits' }],
    })
    expect(code).toMatch(/^[zp]\./)
    expect(await decodeCollection(code)).toEqual({
      title: 'Habits',
      quotes: [{ text: 'You do not rise to the level of your goals.', source: 'Atomic Habits' }],
    })
  })
  it('rejects garbage', async () => {
    expect(await decodeCollection('z.@@@')).toBeNull()
  })
})

describe('incoming shares', () => {
  it('reads what a phone share or the browser button sends', () => {
    expect(readIncoming('?share-title=Page&share-text=Quote&share-url=https%3A%2F%2Fa.com%2Fx')).toEqual({
      title: 'Page',
      text: 'Quote',
      url: 'https://a.com/x',
    })
    expect(readIncoming('?text=Look%20at%20https%3A%2F%2Fb.com%2Fy')?.url).toBe('https://b.com/y')
    expect(readIncoming('?foo=1')).toBeNull()
  })
  it('builds a browser-bar button that points at the app', () => {
    expect(bookmarkletCode('https://noesis.example')).toContain("window.open('https://noesis.example/?share-title='")
  })
})
