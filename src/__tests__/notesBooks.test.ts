import { describe, expect, it } from 'vitest'
import type { BrainNote } from '../lib/knowledge'
import type { LibraryBook } from '../lib/library'
import {
  cleanLink,
  linkLabel,
  newNotesBook,
  noteFor,
  noteHeadline,
  notebooksFrom,
  searchNotes,
  sectionsOf,
} from '../lib/notesBooks'

const note = (fields: Partial<BrainNote>): BrainNote => ({
  id: fields.id ?? Math.random().toString(36),
  kind: 'note',
  title: '',
  body: '',
  source: 'Noesis',
  createdAt: '2026-10-01T10:00:00.000Z',
  ...fields,
})

const paper = newNotesBook({ title: 'Meditations', author: 'Marcus Aurelius', format: 'paper' }, new Date('2026-10-01'))
const library = [{ id: 'lib-1', title: 'Dune', author: 'Frank Herbert' } as LibraryBook]

describe('notebooks', () => {
  const notes = [
    note({ id: 'a', bookId: paper.id, page: 40, chapter: 'Book Two', createdAt: '2026-10-03T00:00:00.000Z' }),
    note({ id: 'b', bookId: paper.id, page: 12, chapter: 'Book One' }),
    note({ id: 'c', bookId: 'lib-1', bookTitle: 'Dune' }),
    note({ id: 'd', bookTitle: 'Walden', author: 'Thoreau' }),
    note({ id: 'e', notebook: 'Lectures' }),
    note({ id: 'f' }),
  ]
  const books = notebooksFrom(notes, [paper], library)
  it('puts each note in one notebook: outside book, Noesis book, a book by title, a folder, or the inbox', () => {
    const byKey = Object.fromEntries(books.map((item) => [item.key, item.notes.map((n) => n.id)]))
    expect(byKey[paper.id]).toEqual(['b', 'a'])
    expect(byKey['noesis-lib-1']).toEqual(['c'])
    expect(byKey['title-walden']).toEqual(['d'])
    expect(byKey['folder-lectures']).toEqual(['e'])
    expect(byKey.inbox).toEqual(['f'])
  })
  it('shows an outside book before it has notes, newest activity first', () => {
    const fresh = notebooksFrom([], [paper], [])
    expect(fresh.map((item) => item.key)).toEqual([paper.id])
    expect(books[0].key).toBe(paper.id)
  })
  it('orders sections by reading order, with notes by page', () => {
    const sections = sectionsOf(books.find((item) => item.key === paper.id)!.notes)
    expect(sections.map((section) => section.title)).toEqual(['Book One', 'Book Two'])
  })
})

describe('writing and finding notes', () => {
  it('ties a new note to its book or folder so Second Brain shows it there too', () => {
    const [book] = notebooksFrom([], [paper], [])
    expect(noteFor(book, { quote: 'x' })).toMatchObject({
      bookId: paper.id,
      bookTitle: 'Meditations',
      author: 'Marcus Aurelius',
      source: 'Noesis Notes',
    })
    expect(noteFor({ kind: 'folder', title: 'Lectures' }, {}).notebook).toBe('Lectures')
    expect(noteFor(null, {}).id.startsWith('local-')).toBe(true)
  })
  it('finds every word, accents ignored', () => {
    const found = searchNotes(
      [
        note({ id: 'x', quote: 'The impediment to action advances action', bookTitle: 'Méditations' }),
        note({ id: 'y', body: 'other' }),
      ],
      'meditations action',
    )
    expect(found.map((item) => item.id)).toEqual(['x'])
  })
  it('heads a row with the title, else the quote or the note', () => {
    expect(noteHeadline(note({ quote: 'A line\nmore' }))).toBe('A line')
    expect(noteHeadline(note({}))).toBe('Untitled')
  })
})

describe('where a book is read', () => {
  it('keeps web addresses only, adding https when left off', () => {
    expect(cleanLink('read.amazon.com/kindle-library')).toBe('https://read.amazon.com/kindle-library')
    expect(cleanLink('https://libbyapp.com/shelf')).toBe('https://libbyapp.com/shelf')
    expect(cleanLink('javascript:alert(1)')).toBeUndefined()
    expect(cleanLink('  ')).toBeUndefined()
    expect(linkLabel('https://www.libbyapp.com/shelf')).toBe('libbyapp.com')
  })
})
