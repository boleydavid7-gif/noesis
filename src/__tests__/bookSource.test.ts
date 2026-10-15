import { describe, expect, it } from 'vitest'
import { bookSource } from '../lib/bookSource'
import type { LibraryBook } from '../lib/library'

const base: LibraryBook = {
  id: 'b',
  title: 'Meditations',
  author: 'Marcus Aurelius',
  progress: 0,
  chapter: '',
  updated: '2026-10-01T10:00:00Z',
  cover: 'M',
  format: 'epub',
}

describe('where a book came from', () => {
  it('names the folder, a storage service, a site, a store, or the day it was added', () => {
    expect(bookSource({ ...base, fromFolder: 'Stoics/Meditations.epub' }, 'onedrive')).toBe(
      'OneDrive folder · Stoics/Meditations.epub',
    )
    expect(bookSource({ ...base, foundIn: { provider: 'google-drive', id: 'x' } })).toBe('From Google Drive')
    expect(bookSource({ ...base, sourceName: 'Standard Ebooks' })).toBe('From Standard Ebooks')
    expect(bookSource({ ...base, format: 'external', store: 'Libby' })).toBe('Read in Libby')
    expect(bookSource({ ...base, added: '2026-10-03T12:00:00Z' })).toBe('Added Oct 3')
  })
})
